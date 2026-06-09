# PRISM

**Progressive Realtime Identification of Synthetic Media and Disinformation**

A multimodal deep learning system that simultaneously detects AI-generated text, fake images, and deepfake videos on Filipino social media (Facebook, TikTok, X), delivered as a browser extension and web interface with Explainable AI outputs.

> Research project for the Next Gen Start-up Competition 2026 - Mapúa University - Makati Campus (June 18, 2026).
> Authors: Lance Adrian D. Acal · Jericho G. Delos Reyes · Lee Adrian D. Noroña · Christian B. Valenzuela.

---

## Overview

PRISM scans social media content in real time and flags disinformation. Three independent forensic modules - text, image, and video - each produce a confidence score and an explainable output. These are combined at the final stage into a single credibility verdict via **late fusion**.

| Module | What it detects | Model | Explainability |
|---|---|---|---|
| **Text** | Taglish (Tagalog + English) AI-generated / fake news captions | Fine-tuned Filipino BERT (DistilBERT-Tagalog) | LIME + Anchors - word/phrase-level highlighting |
| **Image** | GAN- and diffusion-generated / manipulated images | CNN-ViT hybrid classifier | Class Activation Maps (CAM) - heatmaps over manipulated regions |
| **Video** | Deepfakes via spatial pixel artifacts + temporal inconsistencies | Frame-level forensic engine | Frame/region-level artifact highlighting |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                          │
│  • Browser Extension (Manifest V3, JS) - passive real-time scan  │
│  • React Web App - manual content submission                     │
└───────────────────────────────┬─────────────────────────────────┘
                                 │  media (text / image / video)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI - AI inference layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Text Module  │  │ Image Module │  │ Video Module           │ │
│  │ DistilBERT-  │  │ CNN-ViT      │  │ Frame-level forensic   │ │
│  │ Tagalog      │  │ hybrid + CAM │  │ engine (spatial+temp.) │ │
│  │ + LIME/Anchors│ └──────────────┘  └────────────────────────┘ │
│  └──────┬───────┘         │                      │               │
│         └─────────────────┴──────────────────────┘               │
│                           ▼                                      │
│                  LATE FUSION (combine confidence scores)         │
│                           ▼                                      │
│              Unified credibility verdict + XAI payload           │
└───────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase - Postgres storage, auth, realtime, Edge Functions     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| AI / ML | PyTorch / TensorFlow |
| NLP | Hugging Face Transformers |
| Vision | OpenCV |
| API layer | FastAPI |
| Backend | Supabase (Postgres, auth, realtime, Edge Functions) |
| Web UI | React |
| Extension | JavaScript, Manifest V3 |
| Language | Python 3.10+, JavaScript, SQL |

---

## Repository Layout

```
PRISM/
├── api/                      # FastAPI inference service
│   ├── main.py
│   ├── fusion/               # late-fusion logic
│   ├── modules/
│   │   ├── text/             # DistilBERT-Tagalog + LIME/Anchors
│   │   ├── image/            # CNN-ViT hybrid + CAM
│   │   └── video/            # frame-level forensic engine
│   ├── schemas/              # shared verdict schema (pydantic)
│   └── requirements.txt
├── models/                   # trained weights (git-ignored)
├── training/                 # fine-tuning notebooks and scripts
│   ├── text/
│   ├── image/
│   └── video/
├── extension/                # Manifest V3 browser extension
│   ├── manifest.json
│   ├── content/
│   ├── background/
│   └── ui/
├── web/                      # React web app
├── data/                     # datasets (git-ignored)
├── supabase/                 # SQL migrations, Edge Functions
└── docs/                     # PRISM.pdf and architecture notes
```

---

## Getting Started

### Backend (FastAPI)

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

### Browser Extension

Load `extension/` as an unpacked extension: `chrome://extensions` → Developer mode → Load unpacked.

### Web App (React)

```powershell
cd web
npm install
npm run dev
```

### Supabase

Use the Supabase CLI for local dev and migrations. Store all keys in environment variables - never commit them.

---

## Evaluation

- **Detection:** Precision, Recall, F1-score, Accuracy - via Confusion Matrix, compared against single-modality baselines.
- **Usability:** System Usability Scale (SUS) with social media users.
- **Latency:** real-time thresholds on consumer hardware during active scrolling.

---

## Scope & Limitations

- Language scope is Taglish (Tagalog + English). Regional dialects (Bisaya, Ilocano) are not covered in v1.
- May miss zero-day synthetic media from AI models absent from training data.
- Real-time performance depends on the user's device and network.
- PRISM is a decision-support tool. Verdicts are credibility signals, not legal evidence. The system never removes content.

---

## Reference

Full research paper: [`docs/PRISM.pdf`](./docs/PRISM.pdf)
