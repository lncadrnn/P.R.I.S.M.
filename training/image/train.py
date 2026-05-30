"""
Fine-tuning script for the CNN-ViT hybrid image detector.

Usage:
    python training/image/train.py \
        --data data/image \
        --epochs 20 \
        --batch 32 \
        --lr 2e-4 \
        --output models/image_detector.pt

Strategy (from PRISM research):
  1. Freeze both backbones for the first N warmup epochs — train only the fusion head.
  2. Unfreeze and fine-tune end-to-end with a lower LR.
  3. Save the checkpoint with the best validation F1.
"""

import argparse
import os
import sys

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from sklearn.metrics import f1_score, classification_report

# Allow running from repo root: python training/image/train.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../api"))

from modules.image.model import CNNViTHybrid
from training.image.dataset import ImageForensicsDataset


def parse_args():
    p = argparse.ArgumentParser(description="Train PRISM image forensics module")
    p.add_argument("--data", default="data/image", help="Root of real/fake dataset")
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--warmup-epochs", type=int, default=5,
                   help="Epochs to train head-only before unfreezing backbones")
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--val-split", type=float, default=0.15)
    p.add_argument("--output", default="models/image_detector.pt")
    p.add_argument("--device", default=None)
    return p.parse_args()


def train_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss, correct, total = 0.0, 0, 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        logits = model(images)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * len(labels)
        correct += (logits.argmax(1) == labels).sum().item()
        total += len(labels)
    return total_loss / total, correct / total


@torch.no_grad()
def eval_epoch(model, loader, criterion, device):
    model.eval()
    total_loss, all_preds, all_labels = 0.0, [], []
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        logits = model(images)
        loss = criterion(logits, labels)
        total_loss += loss.item() * len(labels)
        all_preds.extend(logits.argmax(1).cpu().tolist())
        all_labels.extend(labels.cpu().tolist())
    n = len(all_labels)
    f1 = f1_score(all_labels, all_preds, average="binary")
    return total_loss / n, f1, all_preds, all_labels


def main():
    args = parse_args()
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # --- Data ---
    full_ds = ImageForensicsDataset(args.data, augment=True)
    counts = full_ds.class_counts()
    print(f"Dataset: {counts}")

    val_n = int(len(full_ds) * args.val_split)
    train_n = len(full_ds) - val_n
    train_ds, val_ds = random_split(full_ds, [train_n, val_n])
    # Val should not augment
    val_ds.dataset.transform = full_ds.__class__(args.data, augment=False).transform

    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=4)
    val_loader = DataLoader(val_ds, batch_size=args.batch, shuffle=False, num_workers=4)

    # Class-weighted loss to handle potential imbalance
    real_n, fake_n = counts["real"], counts["fake"]
    total = real_n + fake_n
    weights = torch.tensor([total / (2 * real_n), total / (2 * fake_n)], dtype=torch.float).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    # --- Model ---
    model = CNNViTHybrid(freeze_backbones=True).to(device)

    # Phase 1: head-only warmup
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_f1, best_path = 0.0, args.output
    os.makedirs(os.path.dirname(best_path) or ".", exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        # Unfreeze backbones after warmup
        if epoch == args.warmup_epochs + 1:
            print("Unfreezing backbones for end-to-end fine-tuning")
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
    _, _, preds, labels = eval_epoch(
        model, val_loader, criterion, device
    )
    print(classification_report(labels, preds, target_names=["real", "fake"]))


if __name__ == "__main__":
    main()
