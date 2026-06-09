# PRISM Browser Extension

A Manifest V3 extension that **passively scans social media posts** on Facebook,
TikTok, and X (Twitter) and overlays a forensic verdict — without ever removing,
hiding, or reporting content. PRISM is decision-support only.

## What it shows

Every scanned post gets a **two-segment PRISM badge** in its top-right corner:

```
┌───────────────────────────┐
│ ● FAKE 94% │ ◆ AI 98% │
└───────────────────────────┘
  credibility    authenticity
```

PRISM reports **two independent axes**:

| Axis | Question | Source module | Colors |
|---|---|---|---|
| **Credibility** | Is the *claim* true? (real news vs disinformation) | `text` | 🔴 FAKE / 🟢 REAL |
| **Authenticity** | Is the *media* real? (human-made vs AI/deepfake) | `image` / `video` | 🟣 AI / 🔵 HUMAN |

These are orthogonal — a real photo can carry a false claim, and an AI image can
illustrate a true one. An axis with no data for a post is hidden.

- **Hover** the badge → full explainable-AI breakdown (confidence %, LIME key
  words, Filipino disinformation pattern reasons, image forensic signals).
- **Click** the badge → the **Visual Forensics Workspace** slides in from the
  right: verdict gauge, the scanned text with LIME highlights, text analysis,
  the CAM/GradCAM heatmap for AI media, and (wire-ready) verified source links.

## Architecture

```
extension/
├── manifest.json              MV3, least-privilege (activeTab, scripting, storage)
├── lib/verdict.js             window.prismVerdict — shared two-axis contract + tokens
├── ui/
│   ├── badge.js / badge.css   window.prismBadge   — two-segment pill + hover tooltip
│   └── sidebar.js / sidebar.css  window.prismSidebar — right forensic panel (Shadow DOM)
├── content/
│   ├── scanner.js             window.prismScanner — DOM scan + MutationObserver
│   └── main.js                entry point: wires verdict → badge, SPA nav handling
├── background/service-worker.js  calls the API, dedupes + caches verdicts
└── icons/                     generated from web/public/prism_logo.png
```

Content scripts load **in `js`-array order** and communicate via `window` globals
(not ES modules). The flow per post:

```
scanner.js  ──PRISM_SCAN_POST──▶  service-worker.js  ──POST /scan/extension──▶  PRISM API
   │                                      │
   │                                      ▼
main.js  ◀──PRISM_VERDICT── (chrome.tabs.sendMessage)  ── fused ScanResponse
   │
   ▼
badge.render()  ──click──▶  sidebar.open()
```

### Per-platform scanning

- **Facebook** — feed posts (`div[role="feed"] div[role="article"]`,
  `[data-pagelet^="FeedUnit"]`) and **Reels**; Messenger, the right sidebar, the
  composer, and story rails are excluded by ancestor guards.
- **TikTok** — only the **active (most-visible) video** is badged, tracked with an
  `IntersectionObserver` so exactly one badge follows the FYP as you scroll;
  opened/searched videos are badged too.
- **X / Twitter** — `article[data-testid="tweet"]`.

For **video** posts (Reels, TikTok), PRISM sends the video **poster/thumbnail** to
the image (AI) module and the caption to the text module. Full per-frame video
forensics is wired in the backend but deferred to the dedicated video model.

> ⚠️ Social-platform DOMs change often. The TikTok `class*=` selectors are the
> most fragile (the `data-e2e` anchors are durable). If 0 posts are detected on a
> known platform, an unpacked build logs a console warning so selector breakage
> is obvious.

## Install (load unpacked)

1. Start the PRISM API (see [`../api`](../api)) — it must be reachable at
   `http://127.0.0.1:8000`:
   ```powershell
   cd ..\api
   .\.venv\Scripts\python.exe main.py
   ```
   Confirm `http://127.0.0.1:8000/health` returns `{"status":"ok",...}`.
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select this `extension/` folder.
4. Open Facebook / TikTok / X and scroll. Badges appear top-right on posts.

### Pointing at a different backend

The API base defaults to `http://127.0.0.1:8000`. Override it from the service
worker console (or any extension page):

```js
chrome.storage.local.set({ prismApiBase: "http://192.168.1.50:8000" });
```

The scan endpoint is always derived as `${base}/scan/extension`.

## Backend contract

Request (`POST /scan/extension`):
```json
{ "text": "caption text or null",
  "image_urls": ["https://...jpg"],
  "platform": "facebook|tiktok|twitter" }
```
Response (fused `ScanResponse`):
```json
{ "label": "fake|real|unknown",
  "confidence": 0.0,
  "modules": { "text": {…}|null, "image": {…}|null, "video": {…}|null },
  "explanation": { "fusion_score": 0.0, "modules_used": [], "sources": [] } }
```
`modules.text` → credibility axis; `modules.image`/`modules.video` → authenticity
axis. Each module verdict's `confidence` is `P(fake)` / `P(AI-generated)`.

## Privacy & security

- **Least privilege**: only `activeTab`, `scripting`, `storage`, and host access
  to the three supported domains. No broad `<all_urls>`, no `tabs`, no history.
- Verdicts are cached in `chrome.storage.session` (cleared on browser restart).
- The API performs SSRF-guarded, size-capped server-side image fetches.
- **PRISM never removes, hides, downranks, or reports content.** It only adds an
  informational overlay.
