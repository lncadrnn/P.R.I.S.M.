# PRISM — Training

Training infrastructure for the three independent forensic modules (text, image,
video). Modules are trained **independently** — no cross-module coupling. Each
trainer writes a `state_dict` checkpoint to `models/<module>_detector.pt`, which
the matching inference module loads.

| Module | Backbone | Checkpoint | Where to train |
|---|---|---|---|
| Text  | XLM-RoBERTa-base (`iceman2434/...`) | `models/text_detector.pt`  | **Local CPU** (Ryzen 7 5700G) |
| Image | CNN (EfficientNet) + ViT hybrid     | `models/image_detector.pt` | Colab / Kaggle GPU |
| Video | EfficientNet-B0 + temporal pooling  | `models/video_detector.pt` | Colab / Kaggle GPU |

All commands below assume you run them **from the repo root** (`D:\VSC Projects\PRISM`).

## Setup

```bash
# CPU (local, text): install the CPU torch wheel first
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r training/requirements.txt
```

On Colab/Kaggle, CUDA torch is pre-installed — skip the CPU index URL and just
`pip install -r training/requirements.txt`.

---

## Text module (local CPU)

### 1. Prepare data

FakeNewsNet ships under `FakeNewsNet/dataset/` (4 CSVs). Convert it into the
`data/text/{real,fake}.csv` layout the dataset expects:

```bash
python training/text/prepare_data.py
```

This uses news **titles** as `text`. Read the printed warnings: FakeNewsNet is
**English, title-only** — good for *pre-training* the head only. The in-domain
Taglish fine-tune still needs a Filipino labeled set (Vera Files / AFP
Philippines fact-checks) dropped into the same `data/text/{real,fake}.csv`
layout.

### 2. Train (CPU-right-sized)

```bash
python training/text/train.py ^
    --data data/text ^
    --epochs 4 --warmup-epochs 1 ^
    --batch 8 --max-length 128 ^
    --max-samples 8000 ^
    --output models/text_detector.pt
```

- `--max-length 128`, `--batch 8`, and `--max-samples` keep a CPU run tractable.
- `torch.set_num_threads` auto-sets to `os.cpu_count()` (16 on the 5700G);
  override with `--threads`.
- The default backbone is the production `MODEL_ID`, so the checkpoint loads in
  inference. For faster experimentation you may pass
  `--model-id jcblaise/roberta-tagalog-base` (or `xlm-roberta-base`), but a
  checkpoint trained on a non-default backbone is **not** loadable by the current
  inference `TextDetector` — use it for pre-training only.

The best-val-F1 checkpoint is saved to `models/text_detector.pt` — exactly the
path `api/modules/text/detector.py` loads.

---

## Image module (Colab / Kaggle GPU)

CPU image training is impractical; run it on free GPU.

### Datasets

Cover **both** generative paradigms (GAN + diffusion):

- **GAN / real:** ForenSynths (StyleGAN, ProGAN, BigGAN, etc.) or any
  StyleGAN-generated set paired with real photos (e.g. FFHQ / LSUN reals).
- **Diffusion:** a GenImage subset (Stable Diffusion / Midjourney generations).

### Target layout

```
data/image/
├── real/    ← authentic photos (.jpg/.jpeg/.png/.webp)
└── fake/    ← GAN-generated AND diffusion-generated images (mix both)
```

### Train

```bash
python training/image/train.py --data data/image --epochs 20 --batch 32 \
    --output models/image_detector.pt
```

Or paste `training/image/train_image_colab.py` into a Colab cell (see its header).

---

## Video module (Colab / Kaggle GPU)

### Datasets

- **FaceForensics++** (c23 compression subset) — real vs manipulated face clips.
- **DFDC preview** — Deepfake Detection Challenge preview set.

### Target layout

```
data/video/
├── real/    ← authentic clips (.mp4/.avi/.mov/.mkv/.webm/.flv)
└── fake/    ← deepfake / manipulated clips
```

Each clip is sampled to 32 evenly-spaced frames at load time.

### Train

```bash
python training/video/train.py --data data/video --epochs 20 --batch 8 \
    --output models/video_detector.pt
```

Or paste `training/video/train_video_colab.py` into a Colab cell (see its header).

---

## Notes

- **Do not commit** datasets or `models/*.pt` weights — see `.gitignore`.
- `num_workers=0` on Windows (the trainers handle this automatically).
- Two-phase methodology everywhere: Phase 1 freezes the backbone and trains the
  head; Phase 2 unfreezes and fine-tunes end-to-end at 0.1x LR.
