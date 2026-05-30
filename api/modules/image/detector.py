"""
ImageDetector: inference pipeline for the CNN-ViT hybrid.

Usage:
    detector = ImageDetector(model_path="../../models/image_detector.pt")
    result = detector.predict(pil_image)
    # result.label        → "fake" | "real"
    # result.confidence   → P(fake) in [0, 1]
    # result.explanation  → {"heatmap_b64": "...", "method": "GradCAM"}
"""

import os
import torch
import torch.nn.functional as F
from torchvision import transforms
from PIL import Image

from .model import CNNViTHybrid
from .cam import GradCAM, cam_to_heatmap_b64
from schemas.verdict import VerdictResponse

# ImageNet normalisation — used by both EfficientNet and ViT branches
_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# Repo root = .../PRISM (this file is at PRISM/api/modules/image/detector.py).
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_MODEL_PATH_DEFAULT = os.path.join(_PROJECT_ROOT, "models", "image_detector.pt")


class ImageDetector:
    def __init__(self, model_path: str | None = None, device: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = CNNViTHybrid()
        self.model.to(self.device)

        path = model_path or _MODEL_PATH_DEFAULT
        if path and os.path.isfile(path):
            state = torch.load(path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state)
            self.trained = True
            print(f"[ImageDetector] Loaded weights from {path}")
        else:
            # No fine-tuned weights: the classification head is randomly
            # initialised, so any confidence would be meaningless. The detector
            # ABSTAINS (label='unknown') rather than fabricating a verdict.
            self.trained = False
            print("[ImageDetector] No weights found — abstaining (train via training/image/)")

        self.model.eval()
        self.gradcam = GradCAM(self.model.cnn_last_layer())

    @torch.no_grad()
    def _forward_no_grad(self, tensor: torch.Tensor) -> torch.Tensor:
        return self.model(tensor)

    def predict(self, image: Image.Image) -> VerdictResponse:
        # Untrained model abstains so it cannot corrupt the fused verdict.
        if not self.trained:
            return VerdictResponse(
                label="unknown",
                confidence=0.0,
                explanation={
                    "method": "GradCAM",
                    "heatmap_b64": None,
                    "demo_untrained": True,
                    "note": (
                        "Image model has no fine-tuned weights yet, so it abstains "
                        "from scoring. Train it via training/image/ to enable verdicts."
                    ),
                },
            )

        tensor = _TRANSFORM(image).unsqueeze(0).to(self.device)

        # Enable gradients only for GradCAM backward pass
        tensor.requires_grad_(True)
        self.gradcam.reset()

        logits = self.model(tensor)                          # (1, 2)
        probs = F.softmax(logits, dim=1)                     # (1, 2)
        fake_prob = probs[0, 1].item()                       # P(fake)

        # Backprop on the fake class score to generate GradCAM
        self.model.zero_grad()
        logits[0, 1].backward()
        cam = self.gradcam.generate()

        heatmap_b64 = cam_to_heatmap_b64(cam, image) if cam is not None else None

        label = "fake" if fake_prob >= 0.5 else "real"
        return VerdictResponse(
            label=label,
            confidence=round(fake_prob, 4),
            explanation={
                "method": "GradCAM",
                "heatmap_b64": heatmap_b64,
                "note": "heatmap highlights regions that triggered the fake classification",
            },
        )
