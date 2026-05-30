"""
VideoDetector: inference pipeline for the video forensics module.

Usage:
    detector = VideoDetector(model_path="../../models/video_detector.pt")
    result = detector.predict("path/to/video.mp4")
    # result.label        → "fake" | "real"
    # result.confidence   → P(fake) in [0, 1]
    # result.explanation  → {
    #     "spatial_score": float,
    #     "temporal_score": float,
    #     "frames_analyzed": int,
    #     "method": "ELA+OpticalFlow",
    # }

Architecture:
    Rule-based fallback (no weights required):
        - Extract up to MAX_FRAMES evenly-spaced frames with OpenCV.
        - Run SpatialAnalyzer.analyze() on each frame → per-frame scores.
        - Run TemporalAnalyzer.analyze() on consecutive frame pairs → temporal score.
        - Combine: confidence = 0.5 * mean(spatial_scores) + 0.5 * temporal_score.

    Learned model (optional, loaded from model_path if the file exists):
        - EfficientNet-B0 frame encoder, mean-pooled over frames.
        - Binary classification head (same as training/video/train.py).
        - When weights are present the learned model replaces the rule-based
          spatial score; temporal analysis always runs as a complementary signal.
"""

from __future__ import annotations

import os

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from .forensics import SpatialAnalyzer, TemporalAnalyzer
from schemas.verdict import VerdictResponse

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_FRAMES = 32           # maximum frames sampled per video
_FRAME_SIZE = (224, 224)  # spatial resize for the learned encoder

_MODEL_PATH_DEFAULT = os.path.join(
    os.path.dirname(__file__), "../../../models/video_detector.pt"
)


# ---------------------------------------------------------------------------
# Optional learned model — imported lazily so OpenCV-only usage works without
# torchvision being installed.
# ---------------------------------------------------------------------------

def _try_load_model(device: str) -> "torch.nn.Module | None":
    """
    Attempt to import and instantiate the EfficientNet-B0 frame encoder.
    Returns None if torchvision is unavailable.
    """
    try:
        from torchvision import models

        eff = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
        )
        # Replace the final classifier: 1280 features → 2 logits
        import torch.nn as nn
        in_features = eff.classifier[1].in_features
        eff.classifier = nn.Sequential(
            nn.Dropout(p=0.2, inplace=True),
            nn.Linear(in_features, 2),
        )
        eff.to(device)
        eff.eval()
        return eff
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

def extract_frames(video_path: str, max_frames: int = MAX_FRAMES) -> list[np.ndarray]:
    """
    Extract up to `max_frames` evenly-spaced frames from a video file.

    Parameters
    ----------
    video_path : str
        Path to the video (any format supported by OpenCV).
    max_frames : int
        Maximum number of frames to extract.

    Returns
    -------
    list[np.ndarray]
        List of BGR uint8 frames.  Empty list if the video cannot be opened.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return []

    # Compute evenly-spaced frame indices
    n = min(max_frames, total)
    if n == 1:
        indices = [0]
    else:
        step = (total - 1) / (n - 1)
        indices = [round(i * step) for i in range(n)]

    frames: list[np.ndarray] = []
    prev_pos = -1
    for idx in indices:
        if idx != prev_pos:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            prev_pos = idx
        ok, frame = cap.read()
        if ok:
            frames.append(frame)

    cap.release()
    return frames


# ---------------------------------------------------------------------------
# Preprocessing for the learned model
# ---------------------------------------------------------------------------

def _preprocess_frame(frame: np.ndarray, device: str) -> "torch.Tensor":
    """Convert a BGR frame to a normalised ImageNet tensor."""
    import torch
    from torchvision import transforms

    _transform = transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize(_FRAME_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return _transform(rgb).to(device)  # (3, 224, 224)


# ---------------------------------------------------------------------------
# VideoDetector
# ---------------------------------------------------------------------------

class VideoDetector:
    """
    End-to-end video forensics detector.

    Parameters
    ----------
    model_path : str | None
        Path to a saved state_dict (.pt) for the EfficientNet-B0 frame encoder.
        Falls back to the module-relative default path.  If the file does not
        exist the detector operates in rule-based mode (ELA + OpticalFlow only).
    device : str | None
        "cuda" or "cpu".  Auto-detected when None.
    """

    def __init__(self, model_path: str | None = None, device: str | None = None) -> None:
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        self.spatial = SpatialAnalyzer()
        self.temporal = TemporalAnalyzer()

        # Try to load the learned model
        self.model = _try_load_model(self.device)

        path = model_path or _MODEL_PATH_DEFAULT
        if self.model is not None and path and os.path.isfile(path):
            state = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state)
            print(f"[VideoDetector] Loaded weights from {path}")
        else:
            if self.model is not None:
                print("[VideoDetector] No weights found — running untrained model (demo only)")
            # model stays as randomly initialised or None; rule-based path covers both
            self.model = None  # disable learned model when no weights

    # ------------------------------------------------------------------
    # Rule-based inference helpers
    # ------------------------------------------------------------------

    def _spatial_scores_rule_based(self, frames: list[np.ndarray]) -> list[float]:
        """Run SpatialAnalyzer on each frame, return per-frame scores."""
        return [self.spatial.analyze(f) for f in frames]

    # ------------------------------------------------------------------
    # Learned model inference helper
    # ------------------------------------------------------------------

    @torch.no_grad()
    def _spatial_score_learned(self, frames: list[np.ndarray]) -> float:
        """
        Run frames through the EfficientNet-B0 frame encoder.
        Mean-pool logits across frames, then apply softmax to get P(fake).
        """
        assert self.model is not None
        tensors = torch.stack(
            [_preprocess_frame(f, self.device) for f in frames]
        )  # (N, 3, 224, 224)

        # Process in batches of 8 to avoid OOM on long clips
        batch_size = 8
        all_logits: list[torch.Tensor] = []
        for start in range(0, len(tensors), batch_size):
            batch = tensors[start : start + batch_size]
            all_logits.append(self.model(batch))  # (B, 2)

        logits = torch.cat(all_logits, dim=0)              # (N, 2)
        mean_logits = logits.mean(dim=0, keepdim=True)     # (1, 2)
        probs = F.softmax(mean_logits, dim=1)              # (1, 2)
        return float(probs[0, 1].item())                   # P(fake)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, video_path: str) -> VerdictResponse:
        """
        Run deepfake detection on a video file.

        Parameters
        ----------
        video_path : str
            Absolute or relative path to the video file.

        Returns
        -------
        VerdictResponse
            label      : "fake" if P(fake) >= 0.5 else "real"
            confidence : P(fake) rounded to 4 decimal places
            explanation: dict with spatial_score, temporal_score,
                         frames_analyzed, method
        """
        frames = extract_frames(video_path, max_frames=MAX_FRAMES)
        frames_analyzed = len(frames)

        if frames_analyzed == 0:
            # Cannot open video — return unknown verdict; confidence=0.0 is not
            # meaningful here, so label is explicitly "unknown" (valid per schema).
            return VerdictResponse(
                label="unknown",
                confidence=0.0,
                explanation={
                    "spatial_score": None,
                    "temporal_score": None,
                    "frames_analyzed": 0,
                    "method": "ELA+OpticalFlow",
                    "warning": "Could not open video file — returning default verdict",
                },
            )

        # --- Spatial score ---
        if self.model is not None:
            spatial_score = self._spatial_score_learned(frames)
        else:
            per_frame = self._spatial_scores_rule_based(frames)
            spatial_score = float(np.mean(per_frame)) if per_frame else 0.0

        # --- Temporal score ---
        temporal_score = self.temporal.analyze(frames)

        # --- Combine: equal weighting ---
        fake_prob = float(np.clip(0.5 * spatial_score + 0.5 * temporal_score, 0.0, 1.0))

        label = "fake" if fake_prob >= 0.5 else "real"
        return VerdictResponse(
            label=label,
            confidence=round(fake_prob, 4),
            explanation={
                "spatial_score": round(spatial_score, 4),
                "temporal_score": round(temporal_score, 4),
                "frames_analyzed": frames_analyzed,
                "method": "ELA+OpticalFlow",
            },
        )
