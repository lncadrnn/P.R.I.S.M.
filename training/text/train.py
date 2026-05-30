"""
Fine-tuning script for the PRISM text forensics module.

Usage:
    python training/text/train.py \
        --data data/text \
        --epochs 10 \
        --warmup-epochs 2 \
        --batch 16 \
        --lr 2e-5 \
        --output models/text_detector.pt

Strategy (mirroring training/image/train.py):
  Phase 1 — Freeze transformer backbone; train only the classification head
             for `--warmup-epochs` epochs.  Allows the head to converge
             before the backbone weights are disturbed.
  Phase 2 — Unfreeze all parameters and fine-tune end-to-end at 0.1× LR.
             CosineAnnealingLR used for both phases.

Checkpoint policy:
  Best validation F1 (binary, fake=positive) is tracked and saved to
  `--output`.  A final classification report is printed after training.
"""

import argparse
import os
import sys

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from sklearn.metrics import f1_score, classification_report

# Allow running from repo root: python training/text/train.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../api"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from modules.text.model import TextClassifier
from training.text.dataset import TextForensicsDataset, TRAIN_MAX_LENGTH


def parse_args():
    p = argparse.ArgumentParser(description="Train PRISM text forensics module")
    p.add_argument("--data", default="data/text",
                   help="Directory containing real.csv and fake.csv")
    p.add_argument("--epochs", type=int, default=10,
                   help="Total training epochs (including warmup)")
    p.add_argument("--warmup-epochs", type=int, default=2,
                   help="Epochs to train head-only before unfreezing backbone")
    p.add_argument("--batch", type=int, default=16,
                   help="Batch size (reduce if OOM; 16 fits ~6 GB VRAM for XLM-R base)")
    p.add_argument("--lr", type=float, default=2e-5,
                   help="Peak learning rate (backbone uses 0.1× after unfreeze)")
    p.add_argument("--val-split", type=float, default=0.15,
                   help="Fraction of data held out for validation")
    p.add_argument("--output", default="models/text_detector.pt",
                   help="Path to save the best checkpoint")
    p.add_argument("--max-length", type=int, default=TRAIN_MAX_LENGTH,
                   help="Maximum token sequence length for the tokenizer (default: 256)")
    p.add_argument("--device", default=None,
                   help="'cuda' or 'cpu' (auto-detected when omitted)")
    return p.parse_args()


def train_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss, correct, total = 0.0, 0, 0
    for input_ids, attention_mask, labels in loader:
        input_ids = input_ids.to(device)
        attention_mask = attention_mask.to(device)
        labels = labels.to(device)

        optimizer.zero_grad()
        logits = model(input_ids=input_ids, attention_mask=attention_mask)
        loss = criterion(logits, labels)
        loss.backward()
        # Gradient clipping prevents exploding gradients during transformer fine-tuning
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

        total_loss += loss.item() * len(labels)
        correct += (logits.argmax(1) == labels).sum().item()
        total += len(labels)

    return total_loss / total, correct / total


@torch.no_grad()
def eval_epoch(model, loader, criterion, device):
    model.eval()
    total_loss, all_preds, all_labels = 0.0, [], []
    for input_ids, attention_mask, labels in loader:
        input_ids = input_ids.to(device)
        attention_mask = attention_mask.to(device)
        labels = labels.to(device)

        logits = model(input_ids=input_ids, attention_mask=attention_mask)
        loss = criterion(logits, labels)
        total_loss += loss.item() * len(labels)
        all_preds.extend(logits.argmax(1).cpu().tolist())
        all_labels.extend(labels.cpu().tolist())

    n = len(all_labels)
    # pos_label=1 → fake is the positive class (P(fake) is our confidence score)
    f1 = f1_score(all_labels, all_preds, average="binary", pos_label=1)
    return total_loss / n, f1, all_preds, all_labels


def main():
    args = parse_args()
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # --- Data ---
    full_ds = TextForensicsDataset(args.data, max_length=args.max_length)
    counts = full_ds.class_counts()
    print(f"Dataset: {counts}")

    val_n = int(len(full_ds) * args.val_split)
    train_n = len(full_ds) - val_n
    train_ds, val_ds = random_split(full_ds, [train_n, val_n])

    # Use num_workers=0 on Windows to avoid DataLoader pickling issues with the tokenizer
    num_workers = 0 if os.name == "nt" else 4
    train_loader = DataLoader(
        train_ds, batch_size=args.batch, shuffle=True, num_workers=num_workers
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, shuffle=False, num_workers=num_workers
    )

    # Class-weighted loss to handle dataset imbalance
    real_n, fake_n = counts["real"], counts["fake"]
    total = real_n + fake_n
    weights = torch.tensor(
        [total / (2 * real_n), total / (2 * fake_n)], dtype=torch.float
    ).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    # --- Model (Phase 1: freeze backbone, train head only) ---
    model = TextClassifier(freeze_backbone=True).to(device)

    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.warmup_epochs
    )

    best_f1 = 0.0
    best_path = args.output
    os.makedirs(os.path.dirname(best_path) or ".", exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        # --- Phase 2: unfreeze backbone for end-to-end fine-tuning ---
        if epoch == args.warmup_epochs + 1:
            print("Unfreezing backbone for end-to-end fine-tuning")
            model.unfreeze()
            optimizer = torch.optim.AdamW(
                model.parameters(), lr=args.lr * 0.1
            )
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=args.epochs - args.warmup_epochs
            )

        train_loss, train_acc = train_epoch(
            model, train_loader, criterion, optimizer, device
        )
        val_loss, val_f1, preds, labels = eval_epoch(
            model, val_loader, criterion, device
        )
        scheduler.step()

        print(
            f"Epoch {epoch:02d}/{args.epochs}  "
            f"train_loss={train_loss:.4f}  train_acc={train_acc:.4f}  "
            f"val_loss={val_loss:.4f}  val_f1={val_f1:.4f}"
        )

        if val_f1 > best_f1:
            best_f1 = val_f1
            torch.save(model.state_dict(), best_path)
            print(f"  -> New best F1 {best_f1:.4f} — saved to {best_path}")

    print(f"\nTraining complete. Best val F1: {best_f1:.4f}")
    print("\nFinal classification report:")
    _, _, preds, labels = eval_epoch(model, val_loader, criterion, device)
    print(classification_report(labels, preds, target_names=["real", "fake"]))


if __name__ == "__main__":
    main()
