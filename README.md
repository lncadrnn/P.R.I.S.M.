# PRISM

**Progressive Realtime Identification of Synthetic Media and Disinformation**

A multimodal deep learning system that simultaneously detects **AI-generated text, fake images, and deepfake videos** on Filipino social media (Facebook, TikTok, X), delivered as a **browser extension + web interface** with **Explainable AI** so users understand *why* something was flagged — not just *that* it was.

> Research project for the Next Gen Start-up Competition 2026 — Mapúa University, Makati Campus (final presentation **June 18, 2026**).
> Authors: Lance Adrian D. Acal · Jericho G. Delos Reyes · Lee Adrian D. Noroña · Christian B. Valenzuela.

---

## Read this first (for vibe coding / AI help)

This README is the **single source of truth** for the project. If you're pairing with an AI assistant, writing code, or onboarding, start here. The goal of the system in one sentence:

> **Scan a social media post in real time, run text/image/video through three independent forensic modules, fuse their confidence scores into one credibility verdict, and explain the reasoning visually.**

Everything below maps to that sentence. When in doubt, keep the three modules independent and fuse late.

---

## What PRISM is

PRISM watches social media content as you scroll and flags likely disinformation. The core innovation is **three forensic modules fused into one verdict** — text, image, and video — each running independently, each producing an explainable output.

| Module | What it detects | Model | Explainability |
|---|---|---|---|
| **Text** | Taglish (Tagalog+English) AI-generated / fake news captions | Fine-tuned Filipino BERT (**DistilBERT-Tagalog**) | **LIME + Anchors** — word/phrase-level highlighting |
| **Image** | GAN- and diffusion-generated / manipulated images | **CNN-ViT hybrid** classifier | **Class Activation Maps (CAM)** — heatmaps over manipulated regions |
| **Video** | Deepfakes via spatial pixel artifacts + temporal inconsistencies (lip-sync, pixel jitter) | Frame-level forensic engine | Frame/region-level artifact highlighting |

### Late Fusion (the key design decision)
Each module is trained **independently to its own optimum**. Their confidence scores are combined **only at the final decision stage** into a single credibility verdict.

**Why late fusion (not early/intermediate):**
- Handles posts where only one modality exists (text-only, image-only).
- Prevents error propagation between heterogeneous model architectures during training.
- Each module can be debugged, retrained, and shipped independently.

> 🔑 **Architectural rule:** never couple the modules at training time. Keep them swappable behind a common verdict interface.

---

## System architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                          │
│  • Browser Extension (Manifest V3, JS) — passive real-time scan  │
│  • React Web App — manual content submission                     │
└───────────────────────────────┬─────────────────────────────────┘
                                 │  media (text / image / video)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI — AI inference layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Text Module  │  │ Image Module │  │ Video Module           │ │
│  │ DistilBERT-  │  │ CNN-ViT      │  │ Frame-level forensic   │ │
│  │ Tagalog      │  │ hybrid + CAM │  │ engine (spatial+temporal)│
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
│  Supabase — Postgres storage, auth, realtime, API routing        │
└─────────────────────────────────────────────────────────────────┘
```

**Request flow:** client extracts post media → sends to FastAPI → each present modality routed to its module → modules return `{label, confidence, explanation}` → fusion layer produces final verdict → response rendered as an explainable overlay in the extension / web UI.

---

## Tech stack

| Layer | Choice |
|---|---|
| **AI / ML** | PyTorch *or* TensorFlow |
| **NLP** | Hugging Face Transformers |
| **Vision** | OpenCV |
| **API layer** | FastAPI (AI inference serving) |
| **Backend (BaaS)** | Supabase (Postgres, auth, realtime, Edge Functions) |
| **Web UI** | React (manual submission interface) |
| **Extension** | JavaScript, **Manifest V3** |
| **Language** | Python 3.10+ (backend/AI), JavaScript (extension + web), SQL |
| **Dev tools** | VS Code, Git/GitHub, Chrome DevTools |

**Target platforms:** Facebook, TikTok, X.

---

## Suggested repository layout

> The repo is currently greenfield (only this README + the research PDF). This is the proposed structure — create directories as you build.

```
PRISM/
├── api/                      # FastAPI inference service (Python 3.10+)
│   ├── main.py               # app entry, routes /scan, /scan/text, /scan/image, /scan/video
│   ├── fusion/               # late-fusion logic — combines module confidence scores
│   ├── modules/
│   │   ├── text/             # DistilBERT-Tagalog + LIME/Anchors
│   │   ├── image/            # CNN-ViT hybrid + CAM
│   │   └── video/            # frame-level forensic engine (OpenCV)
│   ├── schemas/              # pydantic request/response models (shared verdict schema)
│   └── requirements.txt
├── models/                   # trained weights / model cards (git-ignore large files)
├── training/                 # notebooks + scripts for fine-tuning each module
│   ├── text/                 # Taglish normalization, class balancing, fine-tune
│   ├── image/                # GAN + diffusion training
│   └── video/                # frame extraction, spatial+temporal artifact training
├── extension/                # Manifest V3 browser extension (JS)
│   ├── manifest.json
│   ├── content/              # content scripts that scrape feed posts
│   ├── background/           # service worker, calls FastAPI
│   └── ui/                   # verdict overlay + XAI rendering
├── web/                      # React manual-submission web app
├── data/                     # datasets (git-ignore raw data; document sources)
├── supabase/                 # SQL migrations, Edge Functions
└── docs/                     # architecture notes, the research PDF
```

---

## Data sources & preprocessing

**Ground-truth labels** come from Filipino fact-checkers: **Vera Files** and **AFP Philippines**, supplemented by benchmark datasets (e.g., **FakeNewsNet**) for pre-training.

Preprocessing per modality:
- **Text:** Taglish normalization, class balancing.
- **Image:** augmentation across both GAN and diffusion paradigms (both must be covered).
- **Video:** frame-level extraction for spatial + temporal analysis.

**Training methodology:** transfer learning everywhere — fine-tune pre-trained models on localized data rather than training from scratch (Filipino is a low-resource language; labeled data is scarce).

---

## How success is measured

- **Detection metrics:** Precision, Recall, **F1-score** (the definitive metric), Accuracy — via a **Confusion Matrix**, compared against single-modality baselines.
- **User experience:** **System Usability Scale (SUS)** with social media users.
- **Latency:** must hold real-time thresholds on consumer hardware during active scrolling — run latency stress tests.

**Hypothesis being tested:** the multimodal system beats single-modality baselines on accuracy/recall *and* stays within real-time latency limits.

---

## Scope & limitations (keep these in mind while building)

- **Language:** Taglish only (Tagalog + English). Regional dialects (Bisaya, Ilocano) are out of scope — but the architecture must stay **modular for future dialect expansion** (add a language module without restructuring the pipeline).
- **Zero-day content:** may miss disinformation from AI models not represented in training data.
- **Performance:** real-time behavior depends on the user's device and network; may degrade on low-end hardware.
- **Privacy/security:** Manifest V3 was chosen specifically to limit extension permission abuse — respect least-privilege.
- **Ethics:** PRISM is a **decision-support tool**. It produces *credibility signals*, not censorship and not legal evidence. It never removes content.

---

## Getting started

> No code exists yet. These are the conventions to follow as you scaffold each piece.

### Backend (FastAPI)
```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # PowerShell (Windows)
pip install -r requirements.txt
uvicorn main:app --reload
```

### Browser extension (Manifest V3)
Load `extension/` as an unpacked extension via `chrome://extensions` → *Developer mode* → *Load unpacked*.

### Web app (React)
```powershell
cd web
npm install
npm run dev
```

### Supabase
Use the Supabase CLI for local dev and migrations; store keys in environment variables (never commit them).

---

## Build order (suggested roadmap)

1. **Define the shared verdict schema** (`{label, confidence, explanation}`) — every module returns this so fusion stays simple.
2. **Text module first** — most data is available, fastest to validate end-to-end.
3. **FastAPI skeleton** with `/scan/text`, then wire the extension to call it and render a verdict.
4. **Image module** (CNN-ViT + CAM), then **video module** (frame forensics).
5. **Late fusion** once ≥2 modules return real scores.
6. **XAI rendering** in the extension overlay (LIME/Anchors highlights, CAM heatmaps).
7. **Evaluation harness** (confusion matrix, F1) + **SUS** survey + latency tests.

---

## Reference

The full research paper lives at [`PRISM.pdf`](./PRISM.pdf) — read it for the literature grounding, conceptual framework, and detailed definitions behind every design choice above.
