"""
Fine-tuning script for the PRISM video forensics module.

Usage:
    python training/video/train.py \\
        --data data/video \\
        --epochs 20 \\
        --warmup-epochs 5 \\
        --batch 8 \\
        --lr 2e-4 \\
        --output models/video_detector.pt

Strategy (mirrors the image module two-phase approach):
  Phase 1 (warmup): Freeze the EfficientNet-B0 backbone; train only the
      classification head for --warmup-epochs epochs.
  Phase 2 (fine-tune): Unfreeze all parameters, continue with 0.1× LR.

Architecture:
  - EfficientNet-B0 frame encoder (pretrained on ImageNet-1K).
  - Input per sample: (FRAMES_PER_VIDEO, 3, 224, 224).
  - All frames in a clip are passed through the shared encoder,
    yielding (FRAMES_PER_VIDEO, 2) logits.
  - Temporal aggregation: mean pooling across the frame dimension.
  - Final logits: (2,) per clip → binary cross-entropy with class weights.

Why EfficientNet-B0 (not B3)?
  Video clips carry 32× more data per sample than images.  B0 reduces
  per-frame cost by ~4× vs B3, keeping batch sizes practical on consumer
  hardware (i5/Ryzen 5 with 8 GB GPU memory or CPU fallback).

Checkpoint: saves state_dict() of the full EfficientNet-B0 model
(backbone + classifier head) to --output.  The VideoDetector loads this
same state_dict at inference time.
"""

from __future__ import annotations

import argparse
import os
import sys

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Subset, random_split
from torchvision import models
from sklearn.metrics import f1_score, classification_report

# Allow running from repo root: python training/video/train.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../api"))

from training.video.dataset import VideoForensicsDataset, FRAMES_PER_VIDEO


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train PRISM video forensics module")
    p.add_argument("--data", default="data/video",
                   help="Root of real/fake video dataset (contains real/ and fake/ dirs)")
    p.add_argument("--epochs", type=int, default=20,
                   help="Total training epochs (warmup + fine-tune)")
    p.add_argument("--warmup-epochs", type=int, default=5,
                   help="Head-only epochs before backbone is unfrozen")
    p.add_argument("--batch", type=int, default=8,
                   help="Video clips per batch (each clip = 32 frames)")
    p.add_argument("--lr", type=float, default=2e-4,
                   help="Initial learning rate for the head (warmup phase)")
    p.add_argument("--val-split", type=float, default=0.15,
                   help="Fraction of dataset held out for validation")
    p.add_argument("--output", default="models/video_detector.pt",
                   help="Path where the best checkpoint is saved")
    p.add_argument("--device", default=None,
                   help="'cuda' or 'cpu' (auto-detected when omitted)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Model factory
# ---------------------------------------------------------------------------

def build_model(freeze_backbone: bool = True) -> nn.Module:
    """
    EfficientNet-B0 with a binary classification head.

    The classifier head replaces the stock 1000-class linear layer with:
        Dropout(0.2) → Linear(1280, 2)

    Parameters
    ----------
    freeze_backbone : bool
        If True, only the classifier parameters require gradients
        (used during the warmup phase).
    """
    model = models.efficientnet_b0(
        weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
    )

    # Replace final classifier
    in_features = model.classifier[1].in_features  # 1280
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.2, inplace=True),
        nn.Linear(in_features, 2),
    )

    if freeze_backbone:
        # Freeze all feature-extraction layers; keep classifier trainable
        for name, param in model.named_parameters():
            if not name.startswith("classifier"):
                param.requires_grad = False

    return model


# ---------------------------------------------------------------------------
# Per-epoch helpers
# ---------------------------------------------------------------------------

def train_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: str,
) -> tuple[float, float]:
    """
    One training epoch.

    For each batch of shape (B, FRAMES_PER_VIDEO, 3, 224, 224):
    1. Reshape to (B * FRAMES_PER_VIDEO, 3, 224, 224).
    2. Forward through the shared encoder → (B * FRAMES, 2) logits.
    3. Reshape to (B, FRAMES_PER_VIDEO, 2), mean-pool over frames → (B, 2).
    4. Compute cross-entropy loss against clip-level labels.

    Returns (mean_loss, accuracy).
    """
    model.train()
    total_loss, correct, total = 0.0, 0, 0

    for clips, labels in loader:
        # clips: (B, F, 3, 224, 224)   labels: (B,)
        B, F, C, H, W = clips.shape
        clips = clips.to(device)
        labels = labels.to(device)

        # Flatten frames into batch dimension
        flat = clips.view(B * F, C, H, W)                 # (B*F, 3, 224, 224)
        logits_flat = model(flat)                          # (B*F, 2)
        logits = logits_flat.view(B, F, 2).mean(dim=1)    # (B, 2)  — temporal mean pool

        loss = criterion(logits, labels)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * B
        correct += (logits.argmax(1) == labels).sum().item()
        total += B

    return total_loss / total, correct / total


@torch.no_grad()
def eval_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: str,
) -> tuple[float, float, list[int], list[int]]:
    """
    One evaluation epoch.  Returns (mean_loss, f1, all_preds, all_labels).
    """
    model.eval()
    total_loss = 0.0
    all_preds: list[int] = []
    all_labels: list[int] = []

    for clips, labels in loader:
        B, F, C, H, W = clips.shape
        clips = clips.to(device)
        labels = labels.to(device)

        flat = clips.view(B * F, C, H, W)
        logits_flat = model(flat)
        logits = logits_flat.view(B, F, 2).mean(dim=1)

        loss = criterion(logits, labels)
        total_loss += loss.item() * B
        all_preds.extend(logits.argmax(1).cpu().tolist())
        all_labels.extend(labels.cpu().tolist())

    n = len(all_labels)
    f1 = f1_score(all_labels, all_preds, average="binary", zero_division=0)
    return total_loss / n, f1, all_preds, all_labels


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # --- Data ---
    # Build two separate dataset instances so their transforms are independent.
    # Sharing a single dataset and patching .transform on the Subset would also
    # change the transform for the training split (both Subsets hold a reference
    # to the same underlying Dataset object).
    full_ds = VideoForensicsDataset(args.data, augment=True)
    counts = full_ds.class_counts()
    print(f"Dataset: {counts} — {len(full_ds)} clips total")

    val_n = max(1, int(len(full_ds) * args.val_split))
    train_n = len(full_ds) - val_n

    # Determine the split indices once, then apply them to both dataset variants.
    all_indices = list(range(len(full_ds)))
    train_indices = all_indices[:train_n]
    val_indices = all_indices[train_n:]

    train_ds = Subset(full_ds, train_indices)

    # Validation uses a non-augmented copy so we don't touch full_ds.transform.
    val_ds_base = VideoForensicsDataset(args.data, augment=False)
    val_ds = Subset(val_ds_base, val_indices)

    # num_workers=0 is recommended for video datasets on Windows to avoid
    # OpenCV forking issues; increase if running on Linux with large datasets.
    train_loader = DataLoader(
        train_ds, batch_size=args.batch, shuffle=True, num_workers=0, pin_memory=True
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, shuffle=False, num_workers=0, pin_memory=True
    )

    # Class-weighted loss
    real_n, fake_n = counts["real"], counts["fake"]
    total = real_n + fake_n
    weights = torch.tensor(
        [total / (2 * real_n), total / (2 * fake_n)], dtype=torch.float
    ).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    # --- Phase 1: head-only warmup ---
    model = build_model(freeze_backbone=True).to(device)
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.warmup_epochs)

    best_f1 = 0.0
    best_path = args.output
    os.makedirs(os.path.dirname(best_path) or ".", exist_ok=True)

    for epoch in range(1, args.epochs + 1):

        # --- Phase 2 transition: unfreeze backbone ---
        if epoch == args.warmup_epochs + 1:
            print("Unfreezing backbone for end-to-end fine-tuning")
            for p in model.parameters():
                p.requires_grad = True
            optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr * 0.1)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=args.epochs - args.warmup_epochs
            )

        train_loss, train_acc = train_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_f1, preds, labels = eval_epoch(model, val_loader, criterion, device)
        scheduler.step()

        print(
            f"Epoch {epoch:02d}/{args.epochs}  "
            f"train_loss={train_loss:.4f}  train_acc={train_acc:.4f}  "
            f"val_loss={val_loss:.4f}  val_f1={val_f1:.4f}"
        )

        if val_f1 > best_f1:
            best_f1 = val_f1
            torch.save(model.state_dict(), best_path)
            print(f"  → New best F1 {best_f1:.4f} — saved to {best_path}")

    print(f"\nTraining complete. Best val F1: {best_f1:.4f}")
    print("\nFinal classification report:")
    _, _, preds, labels = eval_epoch(model, val_loader, criterion, device)
    print(classification_report(labels, preds, target_names=["real", "fake"]))


if __name__ == "__main__":
    main()
