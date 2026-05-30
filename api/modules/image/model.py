"""
CNN-ViT hybrid classifier for AI-generated image detection.

Architecture:
  CNN branch  — EfficientNet-B3 (local artifact detection: compression artefacts,
                GAN fingerprints, diffusion noise patterns)
  ViT branch  — ViT-B/16 via HuggingFace (global semantic inconsistencies)
  Fusion head — concatenate CLS token + pooled CNN features → binary classifier

Both backbones use ImageNet normalisation (mean/std 0.485/0.229 etc.).
The ViT was pre-trained with slightly different stats but fine-tunes well under
ImageNet normalisation in practice; use a single preprocessing pipeline for simplicity.
"""

import torch
import torch.nn as nn
from torchvision import models
from transformers import ViTModel


CNN_FEAT_DIM = 1536   # EfficientNet-B3 output channels
VIT_FEAT_DIM = 768    # ViT-B/16 hidden dim (CLS token)
FUSED_DIM = CNN_FEAT_DIM + VIT_FEAT_DIM


class CNNViTHybrid(nn.Module):
    def __init__(self, num_classes: int = 2, freeze_backbones: bool = False):
        super().__init__()

        # --- CNN branch ---
        eff = models.efficientnet_b3(weights=models.EfficientNet_B3_Weights.IMAGENET1K_V1)
        self.cnn = eff.features          # Sequential; output (B, 1536, H/32, W/32)
        self.cnn_pool = nn.AdaptiveAvgPool2d(1)

        # --- ViT branch ---
        self.vit = ViTModel.from_pretrained("google/vit-base-patch16-224")

        if freeze_backbones:
            for p in self.cnn.parameters():
                p.requires_grad = False
            for p in self.vit.parameters():
                p.requires_grad = False

        # --- Fusion head ---
        self.head = nn.Sequential(
            nn.Linear(FUSED_DIM, 512),
            nn.GELU(),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(128, num_classes),
        )

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        # CNN path
        cnn_feat = self.cnn(pixel_values)           # (B, 1536, h, w)
        cnn_feat = self.cnn_pool(cnn_feat).flatten(1)  # (B, 1536)

        # ViT path — CLS token
        vit_out = self.vit(pixel_values=pixel_values)
        vit_feat = vit_out.last_hidden_state[:, 0, :]  # (B, 768)

        fused = torch.cat([cnn_feat, vit_feat], dim=1)  # (B, 2304)
        return self.head(fused)                          # (B, 2)

    def cnn_last_layer(self) -> nn.Module:
        """Return the last CNN block — used as GradCAM target."""
        return self.cnn[-1]
