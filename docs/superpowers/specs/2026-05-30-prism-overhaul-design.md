# PRISM Overhaul — Design Spec

**Date:** 2026-05-30
**Status:** Approved, in implementation
**Scope:** All 4 phases. Pretrained text model now + custom training pipeline for later.

## Problem

A parallel 5-subsystem audit found the product is functionally broken despite a sound architecture:

- **Text model returns random predictions** — `model.py` loads `jcblaise/roberta-tagalog-large` (base LM) with an untrained 2-class head. Docstrings falsely claim it's the fine-tuned `iceman2434/xlm-roberta-base-fake-news-detection-tl`.
- **Image model returns random predictions** — untrained CNN-ViT fusion head; GradCAM explains noise.
- **Model load-path bug** — `../../../models/` resolves outside the repo, so no checkpoint can ever load.
- **Extension shows no explanation** — `overlay.js` reads the old schema (`highlights`, `anchor_rule`); the new `summary`/`reasons`/`top_words` (nested under `modules.text.explanation`) are never read.
- **UI looks unpolished** — faux-bold (Inter 800 not imported), monochrome blue with no hierarchy, no focus rings, dropzone not keyboard-operable.
- **FakeNewsNet** — committed into repo (violates CLAUDE.md), English-only, ships no article bodies (titles + tweet IDs only).

Architecture itself is good: swappable modules, correct fusion math, least-privilege MV3 manifest, real training scripts.

## Phase 1 — Make it real & honest (no GPU)

1. **Text model:** Point `MODEL_ID` to `iceman2434/xlm-roberta-base-fake-news-detection-tl`. It ships a trained 2-class head — load it directly (do NOT add a fresh head). Reconcile docstrings. Runs on CPU.
2. **Load-path fix:** Define a single `PROJECT_ROOT` and resolve `models/<m>_detector.pt` from it. Inference must read exactly what training writes.
3. **Honesty guard:** When a module has no real weights (image), surface `label="unknown"` / a `demo_untrained` flag instead of a fabricated confidence. The UI must never show high confidence from a random head.
4. **Backend hardening:** lock CORS to extension + web origins; SSRF guard on `/scan/extension` image fetch (http(s) only, block private/loopback ranges); cap upload + remote-fetch bytes (413 on overflow); wrap each `predict()` in try/except so one failed modality degrades to `None`; global exception handler; move `import httpx` to module top; add `pattern`/bounds to `ScanResponse`.
5. **.gitignore:** add `/FakeNewsNet/`, `/data/`, `/models/`, `*.pt`, `*.pth`, `*.safetensors`, `*.bin`; `git rm --cached -r FakeNewsNet`.

## Phase 2 — UI overhaul (no GPU)

6. Load Inter 800 in `index.html` (kills faux-bold).
7. Visual hierarchy: neutral gray pills/eyebrows/tags/step-numbers; reserve the blue gradient for the one primary CTA + wordmark + active verdict color; one secondary accent (violet) for the XAI identity; flatten the triple radial-gradient hero blobs.
8. Accessibility: global `:focus-visible` ring; keyboard-operable dropzone (`role`/`tabIndex`/`onKeyDown`); `htmlFor`/`id` label associations; `aria-live` on the verdict region + scroll-into-view; non-color verdict cues (warning-triangle for FAKE, check for REAL; dual-signal LIME).
9. Fix LIME light-mode colors (use `color-mix` tokens, not hardcoded dark RGB); env-driven API/docs links; remove/guard the missing `PRISM.pdf` link.

## Phase 3 — Extension overhaul (no GPU)

10. Rewrite `buildTooltipContent` to the new contract: render `summary` paragraph, `reasons` as severity rows, `top_words` as direction-colored chips — reading from `verdict.modules.text.explanation` (and image explanation), matching the actual `/scan/extension` envelope.
11. Harden selectors: FB `div[role=article]` scoped within `div[role=feed]` (keep Messenger/sidebar exclusion) as fallback; dev-mode warning when a known platform yields 0 posts.
12. Content-derived post IDs (share the SHA-256 hash with the service worker) so virtualized re-adds reuse cached verdicts.
13. SPA lifecycle: debounce navigation, compare pathname only, replace fixed 800ms with content-ready wait, clean up listeners.
14. Send already-loaded image bytes via canvas/`createImageBitmap` instead of signed CDN URLs (avoids 403s on expiring URLs); collapse the dual verdict-delivery path.

## Phase 4 — Custom training (text=local CPU, image/video=Colab)

15. `training/text/prepare_data.py` — convert FakeNewsNet's 4 CSVs → `data/text/{real,fake}.csv` with a `text` column (title-based for now; document that the in-domain Taglish fine-tune needs Vera Files / AFP labels). Class-balance + dedup.
16. Right-size the local CPU text fine-tune: base-size backbone, capped samples, `max_length` 128–256, set torch threads to core count.
17. Fix the image trainer's val-transform aliasing bug (two dataset instances, not `.dataset.transform` mutation).
18. Colab/Kaggle notebooks wrapping the existing `train.py` for image + video (mount dataset, install deps, write `.pt` back).
19. `training/requirements.txt` (CPU torch wheel + pandas/datasets/accelerate/opencv); dataset-download README with target folder layout.

## Execution model

- Phase 1 done by the lead (surgical, contract-locking, needs verification).
- Phases 2/3/4 fanned out to parallel agents — disjoint directories (`web/`, `extension/`, `training/`), no file collisions, no worktree isolation needed.
- Verification: `vite build` for web; Python import/instantiation smoke test for backend; manual review for extension.

## Out of scope (v1)

- Regional dialect support (architecture stays modular for it).
- Content removal/reporting (PRISM is decision-support only).
- Deploying a hosted HTTPS backend (extension stays localhost-dev for now; API base made configurable).
