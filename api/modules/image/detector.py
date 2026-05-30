"""
ImageDetector: inference pipeline for AI-generated image forensics.

Two operating modes:

1. PRETRAINED HUB (default, no local training needed):
   Organika/sdxl-detector — ViT fine-tuned to classify images as
   "artificial" (AI/GAN/diffusion-generated) vs "human" (real camera photo).
   Returns genuine predictions immediately. ELA forensics runs alongside
   as a supplementary signal and explanation.

2. FINE-TUNED LOCAL (weights present at models/image_detector.pt):
   The project's own CNN-ViT hybrid (EfficientNet-B4 + ViT), trained via
   training/image/train.py on FaceForensics++ / GAN + diffusion datasets.
   Enables full GradCAM heatmap explanation. Takes over automatically once
   the checkpoint exists.

This mirrors how the text module uses iceman2434/xlm-roberta-base-fake-news-
detection-tl as the pretrained fallback before custom training is complete.
"""

import io
import os

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import pipeline as hf_pipeline
from torchvision import transforms

from .model import CNNViTHybrid
from .cam import GradCAM, cam_to_heatmap_b64
from schemas.verdict import VerdictResponse

# ---------------------------------------------------------------------------
# Pretrained hub model
# ---------------------------------------------------------------------------

# ViT fine-tuned on real vs AI-generated images (SDXL + related diffusion).
# Labels: {0: "artificial", 1: "human"}  →  artificial=fake, human=real
_HUB_MODEL_ID = "Organika/sdxl-detector"

# ---------------------------------------------------------------------------
# Fine-tuned local model path
# ---------------------------------------------------------------------------

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_MODEL_PATH_DEFAULT = os.path.join(_PROJECT_ROOT, "models", "image_detector.pt")

# ImageNet normalisation for the CNN-ViT hybrid (local fine-tuned only)
_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# ---------------------------------------------------------------------------
# ELA helper (supplementary signal, not primary)
# ---------------------------------------------------------------------------

def _ela_signals(image: Image.Image) -> list[str]:
    """Run ELA and return human-readable forensic signals for the explanation."""
    img = image.convert("RGB").resize((256, 256), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    buf.seek(0)
    comp = Image.open(buf).convert("RGB")

    orig = np.array(img,  dtype=np.float32) / 255.0
    comp = np.array(comp, dtype=np.float32) / 255.0
    ela  = np.abs(orig - comp)

    ela_mean = ela.mean()
    ela_std  = ela.std()
    ela_conc = ela_std / (ela_mean + 1e-6)

    gray = np.array(img.convert("L"), dtype=np.float32) / 255.0
    fft  = np.fft.fftshift(np.abs(np.fft.fft2(gray)))
    cy, cx = fft.shape[0] // 2, fft.shape[1] // 2
    r = min(fft.shape) // 4
    yy, xx = np.ogrid[:fft.shape[0], :fft.shape[1]]
    mask = (yy - cy)**2 + (xx - cx)**2 > r**2
    hf_ratio = float(fft[mask].mean() / (fft[~mask].mean() + 1e-6))

    h_diff = float(np.abs(gray[:, 8::8] - gray[:, 7:-1:8]).mean()) if gray.shape[1] > 8 else 0.0
    v_diff = float(np.abs(gray[8::8, :] - gray[7:-1:8, :]).mean()) if gray.shape[0] > 8 else 0.0
    blocking = (h_diff + v_diff) / 2.0

    signals = []
    if ela_conc > 3.5 and ela_mean > 0.02:
        signals.append("Localised ELA spike — possible region splice or compositing")
    if blocking < 1.5 and ela_mean < 0.012:
        signals.append("Unusually smooth texture — consistent with AI/GAN generation")
    if hf_ratio < 0.008:
        signals.append("Low high-frequency energy — possible AI over-smoothing artifact")
    if not signals:
        signals.append("No strong ELA or frequency anomalies detected")
    return signals


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class ImageDetector:
    def __init__(self, model_path: str | None = None, device: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        # Check for a locally fine-tuned checkpoint first.
        path = model_path or _MODEL_PATH_DEFAULT
        if path and os.path.isfile(path):
            self.mode = "local"
            self.model = CNNViTHybrid()
            self.model.to(self.device)
            state = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state)
            self.model.eval()
            self.gradcam = GradCAM(self.model.cnn_last_layer())
            self.pipe = None
            print(f"[ImageDetector] Loaded fine-tuned weights from {path}")
        else:
            # Fall back to the pretrained hub ViT model — real predictions,
            # no local training required.
            self.mode = "hub"
            self.model = None
            self.gradcam = None
            self.pipe = hf_pipeline(
                "image-classification",
                model=_HUB_MODEL_ID,
                device=-1,    # CPU
            )
            print(f"[ImageDetector] Using pretrained hub model {_HUB_MODEL_ID}")

    def predict(self, image: Image.Image) -> VerdictResponse:

        # ---- Pretrained hub model ----------------------------------------
        if self.mode == "hub":
            results = self.pipe(image.convert("RGB"))
            # {label: "artificial"|"human", score: float}
            score_map = {r["label"]: r["score"] for r in results}
            fake_prob = float(score_map.get("artificial", 0.0))
            label = "fake" if fake_prob >= 0.5 else "real"

            ela = _ela_signals(image)

            return VerdictResponse(
                label=label,
                confidence=round(fake_prob, 4),
                explanation={
                    "method": f"ViT ({_HUB_MODEL_ID})",
                    "heatmap_b64": None,
                    "signals": ela,
                    "note": (
                        "Pretrained ViT classifier detects AI/diffusion-generated images. "
                        "ELA forensics below provides supplementary structural analysis."
                    ),
                },
            )

        # ---- Locally fine-tuned CNN-ViT hybrid ---------------------------
        tensor = _TRANSFORM(image).unsqueeze(0).to(self.device)
        tensor.requires_grad_(True)
        self.gradcam.reset()

        logits    = self.model(tensor)
        probs     = F.softmax(logits, dim=1)
        fake_prob = probs[0, 1].item()

        self.model.zero_grad()
        logits[0, 1].backward()
        cam = self.gradcam.generate()
        heatmap_b64 = cam_to_heatmap_b64(cam, image) if cam is not None else None

        label = "fake" if fake_prob >= 0.5 else "real"
        ela   = _ela_signals(image)

        return VerdictResponse(
            label=label,
            confidence=round(fake_prob, 4),
            explanation={
                "method": "GradCAM (CNN-ViT fine-tuned)",
                "heatmap_b64": heatmap_b64,
                "signals": ela,
                "note": "GradCAM heatmap shows which image regions drove the classification.",
            },
        )
