"""
Dataset for AI-generated image detection training.

Expected directory structure:
    data/image/
    ├── real/      ← authentic images scraped from social media
    │   ├── img001.jpg
    │   └── ...
    └── fake/      ← GAN-generated + diffusion-model images
        ├── img001.jpg
        └── ...

Both GAN and diffusion paradigms must be covered in the fake/ split —
artifact patterns differ between them (Park et al., 2024).
"""

import os
from pathlib import Path

import torch
from torch.utils.data import Dataset
from torchvision import transforms
from PIL import Image


# ImageNet normalisation — matches both EfficientNet and ViT preprocessing
_BASE_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

_AUGMENT_TRANSFORM = transforms.Compose([
    transforms.Resize((256, 256)),
    transforms.RandomCrop(224),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

LABEL_MAP = {"real": 0, "fake": 1}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


class ImageForensicsDataset(Dataset):
    """
    Loads real/fake image pairs from a root directory.
    label 0 = real, label 1 = fake (P(fake) target for training).
    """

    def __init__(self, root: str | Path, augment: bool = False):
        self.transform = _AUGMENT_TRANSFORM if augment else _BASE_TRANSFORM
        self.samples: list[tuple[Path, int]] = []

        root = Path(root)
        for class_name, label in LABEL_MAP.items():
            class_dir = root / class_name
            if not class_dir.is_dir():
                raise FileNotFoundError(f"Expected directory: {class_dir}")
            for p in class_dir.iterdir():
                if p.suffix.lower() in IMG_EXTS:
                    self.samples.append((p, label))

        if not self.samples:
            raise RuntimeError(f"No images found under {root}")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        path, label = self.samples[idx]
        image = Image.open(path).convert("RGB")
        return self.transform(image), label

    def class_counts(self) -> dict[str, int]:
        counts = {"real": 0, "fake": 0}
        for _, label in self.samples:
            key = "fake" if label == 1 else "real"
            counts[key] += 1
        return counts
