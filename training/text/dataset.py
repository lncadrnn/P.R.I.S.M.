"""
Dataset for Filipino/Taglish fake news detection training.

Expected directory structure:
    data/text/
    ├── real.csv     ← authentic Filipino/Taglish news articles
    └── fake.csv     ← fabricated or misrepresenting articles

CSV format — each file must have at minimum a `text` column.
An optional `label` column is accepted but ignored (label is inferred from
the filename: real.csv → 0, fake.csv → 1).

Example:
    text
    "Ang gobyerno ay nagdeklara ng emergency dahil sa bagyo."
    "Si Presidente ay nagresigna na ayon sa pinagkakatiwalaang source."

The tokenizer is loaded from the same HuggingFace model used at inference
so that vocabulary coverage and max_length behaviour are identical.
"""

import os
from pathlib import Path

import pandas as pd
import torch
from torch.utils.data import Dataset
from transformers import AutoTokenizer

# Import model constants so training stays in sync with inference
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../api"))
from modules.text.model import MODEL_ID

# Training uses 256 tokens (half of inference MAX_LENGTH=512) for faster
# mini-batch iteration and to reduce GPU memory pressure during fine-tuning.
# The model can still handle up to 512 tokens at inference time.
TRAIN_MAX_LENGTH = 256

LABEL_MAP = {"real": 0, "fake": 1}


class TextForensicsDataset(Dataset):
    """
    Loads real/fake news text from CSV files.

    Parameters
    ----------
    data_dir : str | Path
        Root directory containing real.csv and fake.csv.
    tokenizer_id : str
        HuggingFace tokenizer identifier (defaults to the production model).
    max_length : int
        Maximum token sequence length passed to the tokenizer.
        Defaults to 256 (TRAIN_MAX_LENGTH) for efficient training batches.
    """

    def __init__(
        self,
        data_dir: str | Path,
        tokenizer_id: str = MODEL_ID,
        max_length: int = TRAIN_MAX_LENGTH,
    ):
        self.max_length = max_length
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_id)
        self.samples: list[tuple[str, int]] = []  # (text, label)

        data_dir = Path(data_dir)
        for class_name, label in LABEL_MAP.items():
            csv_path = data_dir / f"{class_name}.csv"
            if not csv_path.is_file():
                raise FileNotFoundError(
                    f"Expected CSV file: {csv_path}\n"
                    "Each CSV must have a 'text' column."
                )
            df = pd.read_csv(csv_path)
            if "text" not in df.columns:
                raise ValueError(
                    f"{csv_path} is missing the required 'text' column. "
                    f"Found columns: {list(df.columns)}"
                )
            # Drop rows with null/empty text
            df = df.dropna(subset=["text"])
            df = df[df["text"].str.strip() != ""]
            for text in df["text"].tolist():
                self.samples.append((str(text), label))

        if not self.samples:
            raise RuntimeError(f"No text samples found under {data_dir}")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Returns
        -------
        input_ids      : LongTensor of shape (max_length,)
        attention_mask : LongTensor of shape (max_length,)
        label          : LongTensor scalar — 0 (real) or 1 (fake)
        """
        text, label = self.samples[idx]
        encoded = self.tokenizer(
            text,
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        input_ids = encoded["input_ids"].squeeze(0)           # (L,)
        attention_mask = encoded["attention_mask"].squeeze(0)  # (L,)
        return input_ids, attention_mask, torch.tensor(label, dtype=torch.long)

    def class_counts(self) -> dict[str, int]:
        """Return per-class sample counts for loss weighting."""
        counts = {"real": 0, "fake": 0}
        for _, label in self.samples:
            key = "fake" if label == 1 else "real"
            counts[key] += 1
        return counts
