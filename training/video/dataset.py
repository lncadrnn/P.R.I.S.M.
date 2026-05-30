"""
Dataset for video deepfake detection training.

Expected directory structure:
    data/video/
    ├── real/      ← authentic Filipino political/social media video clips
    │   ├── clip001.mp4
    │   └── ...
    └── fake/      ← deepfake / AI-generated video clips
        ├── clip001.mp4
        └── ...

Each video is sampled at load-time: FRAMES_PER_VIDEO evenly-spaced frames
are extracted and returned as a tensor of shape (FRAMES_PER_VIDEO, 3, 224, 224).

Video formats accepted: any container supported by OpenCV VideoCapture
(mp4, avi, mov, mkv, webm, etc.).

Label convention: 0 = real, 1 = fake  (P(fake) target during training).
"""

from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset
from torchvision import transforms

# Allow running this file standalone (e.g. python training/video/dataset.py)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../api"))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FRAMES_PER_VIDEO = 32
FRAME_SIZE = (224, 224)

LABEL_MAP: dict[str, int] = {"real": 0, "fake": 1}
VIDEO_EXTS: set[str] = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"}

# ImageNet normalisation — matches the EfficientNet-B0 inference pipeline
_FRAME_TRANSFORM = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize(FRAME_SIZE),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

_AUGMENT_TRANSFORM = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((256, 256)),
    transforms.RandomCrop(224),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ---------------------------------------------------------------------------
# Frame extraction helper
# ---------------------------------------------------------------------------

def _extract_frames(video_path: str, n: int = FRAMES_PER_VIDEO) -> list[np.ndarray]:
    """
    Extract `n` evenly-spaced frames from a video file.

    Returns
    -------
    list[np.ndarray]
        BGR uint8 arrays of shape (H, W, 3).  Empty list if the video
        cannot be opened or has no readable frames.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return []

    count = min(n, total)
    if count == 1:
        indices = [0]
    else:
        step = (total - 1) / (count - 1)
        indices = [round(i * step) for i in range(count)]

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


def _pad_or_trim(frames: list[np.ndarray], n: int) -> list[np.ndarray]:
    """
    Ensure the frame list has exactly `n` entries.
    - If too short: repeat the last frame until length == n.
    - If too long:  truncate to the first n frames.
    """
    if not frames:
        blank = np.zeros((FRAME_SIZE[0], FRAME_SIZE[1], 3), dtype=np.uint8)
        return [blank] * n
    while len(frames) < n:
        frames.append(frames[-1])
    return frames[:n]


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class VideoForensicsDataset(Dataset):
    """
    Loads real/fake video clips from a root directory, extracts frames,
    and returns normalised frame tensors for EfficientNet-B0 training.

    Parameters
    ----------
    root : str | Path
        Root directory containing real/ and fake/ sub-directories.
    frames_per_video : int
        Number of frames to extract per video clip.
    augment : bool
        If True, apply random augmentation to each frame (for training).
        If False, apply deterministic base transform (for validation/test).
    """

    def __init__(
        self,
        root: str | Path,
        frames_per_video: int = FRAMES_PER_VIDEO,
        augment: bool = False,
    ) -> None:
        self.frames_per_video = frames_per_video
        self.transform = _AUGMENT_TRANSFORM if augment else _FRAME_TRANSFORM
        self.samples: list[tuple[Path, int]] = []

        root = Path(root)
        for class_name, label in LABEL_MAP.items():
            class_dir = root / class_name
            if not class_dir.is_dir():
                raise FileNotFoundError(
                    f"Expected directory: {class_dir}\n"
                    f"Place {class_name} video clips inside data/video/{class_name}/"
                )
            for p in sorted(class_dir.iterdir()):
                if p.suffix.lower() in VIDEO_EXTS:
                    self.samples.append((p, label))

        if not self.samples:
            raise RuntimeError(
                f"No video files found under {root}.\n"
                f"Supported extensions: {VIDEO_EXTS}"
            )

    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        """
        Load a video, extract frames, apply transform, return tensor + label.

        Returns
        -------
        frames_tensor : torch.Tensor
            Shape (FRAMES_PER_VIDEO, 3, 224, 224) — one tensor per clip.
        label : int
            0 for real, 1 for fake.
        """
        path, label = self.samples[idx]

        raw_frames = _extract_frames(str(path), n=self.frames_per_video)
        if not raw_frames:
            warnings.warn(
                f"Could not extract frames from {path}; substituting blank frames. "
                "This sample will degrade training — consider removing the file.",
                RuntimeWarning,
                stacklevel=2,
            )
        raw_frames = _pad_or_trim(raw_frames, self.frames_per_video)

        frame_tensors: list[torch.Tensor] = []
        for frame_bgr in raw_frames:
            # Convert BGR → RGB before applying the torchvision transform
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            frame_tensors.append(self.transform(frame_rgb))

        frames_tensor = torch.stack(frame_tensors)  # (FRAMES_PER_VIDEO, 3, 224, 224)
        return frames_tensor, label

    # ------------------------------------------------------------------

    def class_counts(self) -> dict[str, int]:
        """Return per-class sample counts for loss weighting."""
        counts = {"real": 0, "fake": 0}
        for _, label in self.samples:
            key = "fake" if label == 1 else "real"
            counts[key] += 1
        return counts
