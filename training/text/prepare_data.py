"""
Prepare FakeNewsNet CSVs into the layout PRISM's text dataset expects.

Reads the four FakeNewsNet files:
    politifact_fake.csv, politifact_real.csv,
    gossipcop_fake.csv,  gossipcop_real.csv
each of which has columns: id, news_url, title, tweet_ids  (NO article body).

It maps  *_fake -> fake  and  *_real -> real, uses the `title` column as the
training `text`, applies whitespace / light Taglish normalization and dedup,
then writes the layout training/text/dataset.py expects:

    <out-dir>/
    ├── real.csv     ← one `text` column
    └── fake.csv     ← one `text` column

IMPORTANT — read the printed warnings:
  (a) FakeNewsNet titles are ENGLISH and short. This data is suitable for
      PRE-TRAINING the fake-news head only (transfer-learning warm start).
  (b) The in-domain Taglish fine-tune STILL needs a Filipino labeled set
      (Vera Files / AFP Philippines fact-check outputs). Do not ship a model
      trained on this data alone as the PRISM text deliverable.

Usage:
    python training/text/prepare_data.py
    python training/text/prepare_data.py \
        --fnn-dir FakeNewsNet/dataset \
        --out-dir data/text \
        --min-chars 15

Stdlib + pandas only.
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

# (source filename stem, output class)  — *_fake -> fake, *_real -> real
SOURCE_FILES = [
    ("politifact_fake", "fake"),
    ("gossipcop_fake", "fake"),
    ("politifact_real", "real"),
    ("gossipcop_real", "real"),
]

TEXT_SOURCE_COLUMN = "title"  # FakeNewsNet has no article body; use the title.

# Collapse runs of whitespace (incl. tabs/newlines from messy CSV cells).
_WS_RE = re.compile(r"\s+")


def normalize_text(raw: str) -> str:
    """
    Light, Taglish-safe normalization:
      - Unicode NFKC fold (smart quotes / full-width chars -> ASCII-ish).
      - Strip control chars and collapse all whitespace to single spaces.
      - Trim.

    Deliberately does NOT lowercase or strip punctuation — casing and tokens
    carry signal, and the SentencePiece tokenizer used downstream handles
    Taglish code-switching natively.
    """
    if not isinstance(raw, str):
        raw = str(raw)
    text = unicodedata.normalize("NFKC", raw)
    # Drop control characters (category C*) except those whitespace handles.
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    text = _WS_RE.sub(" ", text).strip()
    return text


def load_class(fnn_dir: Path, stems: list[str], min_chars: int) -> list[str]:
    """Load + normalize + dedup the `title` column across the given source stems."""
    texts: list[str] = []
    for stem in stems:
        path = fnn_dir / f"{stem}.csv"
        if not path.is_file():
            raise FileNotFoundError(
                f"Expected FakeNewsNet file: {path}\n"
                "Pass --fnn-dir pointing at the folder with the four "
                "politifact_/gossipcop_ {fake,real}.csv files."
            )
        df = pd.read_csv(path)
        if TEXT_SOURCE_COLUMN not in df.columns:
            raise ValueError(
                f"{path} missing '{TEXT_SOURCE_COLUMN}' column. "
                f"Found: {list(df.columns)}"
            )
        df = df.dropna(subset=[TEXT_SOURCE_COLUMN])
        for raw in df[TEXT_SOURCE_COLUMN].tolist():
            norm = normalize_text(raw)
            if len(norm) >= min_chars:
                texts.append(norm)
    # Case-insensitive dedup, preserving first occurrence / original casing.
    seen: set[str] = set()
    deduped: list[str] = []
    for t in texts:
        key = t.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(t)
    return deduped


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(
        description="Prepare FakeNewsNet titles into data/text/{real,fake}.csv"
    )
    p.add_argument(
        "--fnn-dir",
        default=str(repo_root / "data" / "FakeNewsNet" / "dataset"),
        help="Directory containing the four FakeNewsNet CSVs",
    )
    p.add_argument(
        "--out-dir",
        default=str(repo_root / "data" / "text"),
        help="Output directory for real.csv and fake.csv",
    )
    p.add_argument(
        "--min-chars",
        type=int,
        default=15,
        help="Drop titles shorter than this many characters (default: 15)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    fnn_dir = Path(args.fnn_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    by_class = {"fake": [], "real": []}
    for cls in ("fake", "real"):
        stems = [stem for stem, c in SOURCE_FILES if c == cls]
        by_class[cls] = load_class(fnn_dir, stems, args.min_chars)

    for cls in ("real", "fake"):
        out_path = out_dir / f"{cls}.csv"
        pd.DataFrame({"text": by_class[cls]}).to_csv(out_path, index=False)
        print(f"Wrote {len(by_class[cls]):>6} rows -> {out_path}")

    real_n, fake_n = len(by_class["real"]), len(by_class["fake"])
    total = real_n + fake_n
    print("\nClass counts:")
    print(f"  real: {real_n}")
    print(f"  fake: {fake_n}")
    print(f"  total: {total}")
    if total:
        print(f"  balance (fake/total): {fake_n / total:.3f}")

    print("\n" + "=" * 70)
    print("WARNING (a): This is ENGLISH news-TITLE data from FakeNewsNet.")
    print("  Titles are short and English-only. Use it for PRE-TRAINING the")
    print("  fake-news head (transfer-learning warm start) ONLY.")
    print("WARNING (b): The in-domain Taglish fine-tune STILL requires a")
    print("  Filipino labeled set (Vera Files / AFP Philippines fact-checks).")
    print("  Do NOT ship a model trained on this data alone as the PRISM")
    print("  text deliverable. See CLAUDE.md > Data sources.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
