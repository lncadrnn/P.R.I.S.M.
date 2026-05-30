"""
Colab/Kaggle launcher for the PRISM IMAGE forensics trainer.

HOW TO USE (Colab):
  1. Runtime > Change runtime type > GPU (T4 is fine).
  2. Clone the repo (private repo: use a token or upload it), e.g.:
         !git clone https://github.com/<you>/PRISM.git
         %cd PRISM
  3. Upload / mount your dataset so it sits at  data/image/{real,fake}/
     (e.g. unzip from Google Drive — see DATASET_PATH below).
  4. Paste THIS file's contents into a single Colab cell and run it, or:
         !python training/image/train_image_colab.py
  5. The trained checkpoint is copied to OUTPUT_COPY (Drive) so it survives
     the runtime being recycled. Download models/image_detector.pt.

This script just installs deps, sanity-checks the dataset path, then calls the
EXISTING trainer in training/image/train.py — no training logic is duplicated.
"""

import os
import shutil
import subprocess
import sys

# --- Config: edit these for your environment -------------------------------
REPO_ROOT = os.getcwd()                       # assumes you've %cd'd into PRISM
DATASET_PATH = "data/image"                   # must contain real/ and fake/
OUTPUT_CKPT = "models/image_detector.pt"      # where the trainer writes
OUTPUT_COPY = "/content/drive/MyDrive/image_detector.pt"  # persistent copy

EPOCHS = 20
BATCH = 32
LR = 2e-4
# ---------------------------------------------------------------------------


def sh(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)


def main() -> None:
    # 1. Install deps (torch/torchvision already present on Colab GPU runtimes).
    req = os.path.join(REPO_ROOT, "training", "requirements.txt")
    if os.path.isfile(req):
        sh([sys.executable, "-m", "pip", "install", "-q", "-r", req])

    # 2. Sanity-check the dataset layout before burning GPU time.
    for cls in ("real", "fake"):
        d = os.path.join(REPO_ROOT, DATASET_PATH, cls)
        if not os.path.isdir(d):
            raise SystemExit(
                f"Missing dataset dir: {d}\n"
                f"Expected {DATASET_PATH}/real/ and {DATASET_PATH}/fake/ with images."
            )

    # 3. Call the existing trainer.
    sh([
        sys.executable, os.path.join("training", "image", "train.py"),
        "--data", DATASET_PATH,
        "--epochs", str(EPOCHS),
        "--batch", str(BATCH),
        "--lr", str(LR),
        "--output", OUTPUT_CKPT,
    ])

    # 4. Copy the checkpoint somewhere persistent (Drive) if mounted.
    if os.path.isfile(OUTPUT_CKPT):
        os.makedirs(os.path.dirname(OUTPUT_COPY) or ".", exist_ok=True)
        try:
            shutil.copy(OUTPUT_CKPT, OUTPUT_COPY)
            print(f"Copied checkpoint -> {OUTPUT_COPY}")
        except (OSError, FileNotFoundError) as e:
            print(f"Could not copy to {OUTPUT_COPY} ({e}); "
                  f"download {OUTPUT_CKPT} manually.")
    else:
        print(f"WARNING: trainer did not produce {OUTPUT_CKPT}")


if __name__ == "__main__":
    main()
