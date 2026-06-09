# PRISM Browser Extension

A Manifest V3 extension that **passively scans social media posts** on Facebook,
TikTok, X/Twitter, and Threads, and overlays a forensic verdict — without ever
removing, hiding, or reporting content. PRISM is decision-support only.

## What it shows

Every scanned post gets a **two-segment PRISM badge** in its top-right corner:

```
┌────────────────────────────┐
│ ● FAKE 94%  │  ◆ AI 98%  │
└────────────────────────────┘
  credibility     authenticity
```

PRISM reports **two independent axes**:

| Axis | Question | Source module | Colors |
|---|---|---|---|
| **Credibility** (●) | Is the *claim* true? (real news vs disinformation) | `text` | FAKE → red · REAL → green |
| **Authenticity** (◆) | Is the *media* real? (human-made vs AI/deepfake) | `image` / `video` | AI → purple · HUMAN → blue |

These are orthogonal — a real photo can carry a false claim, and an AI image can
illustrate a true one. An axis with no data for a post is hidden.

**Badge states:**

| State | Appearance | Meaning |
|---|---|---|
| Scanning | `● PRISM …` (pulsing) | Post found; forensic models running |
| Verdict | Two colored segments | Scan complete; axes derived |
| Neutral | Single gray `PRISM` pill | No analysable content in this post |
| Error | Gray `PRISM ⚠` pill | API unreachable or scan failed |

### Hover tooltip

Hovering (or focusing) any badge opens a **shared floating card** that escapes
`overflow:hidden` feed containers by sitting at `position:fixed` on `<body>`.
One node is reused by all badges — no leaked nodes from virtualized feeds.

- **Scanning state** — explains which modalities are being checked (caption NLP,
  image AI-detection, video frame extraction) and why the wait is normal.
- **Verdict state** — per-axis detail: confidence %, LIME key-word chips (colored
  by direction), disinformation-pattern reasons (severity-coded), image forensic
  signals, and a note to open the panel for the full heatmap.
- **Error state** — surfaces the API error string.

### Click → Visual Forensics Workspace

Clicking any badge slides in a **Shadow DOM sidebar** from the right. Shadow DOM
prevents host-page CSS from distorting the forensic UI. The panel shows:

- Verdict gauge (confidence dial)
- Scanned caption with LIME-highlighted words
- Text analysis breakdown (patterns, reasons)
- CAM / GradCAM heatmap for AI-generated media
- Verified source links (wire-ready)

## Architecture

```
extension/
├── manifest.json               MV3, least-privilege (activeTab, scripting, storage)
├── lib/verdict.js              window.prismVerdict — shared two-axis contract + tokens
├── ui/
│   ├── badge.js / badge.css    window.prismBadge   — two-segment pill + shared hover tooltip
│   └── sidebar.js / sidebar.css  window.prismSidebar — right forensic panel (Shadow DOM)
├── content/
│   ├── scanner.js              window.prismScanner — DOM scan + MutationObserver
│   └── main.js                 entry point: wires verdict → badge, SPA nav handling
├── background/service-worker.js  calls the API, dedupes + caches verdicts
└── icons/                      icon16/48/128.png
```

Content scripts load in `js`-array order and communicate via `window` globals.
The flow per post:

```
scanner.js  ──PRISM_SCAN_POST──▶  service-worker.js  ──POST /scan/extension──▶  PRISM API
   │                                      │
   │                                      ▼
main.js  ◀──PRISM_VERDICT──  chrome.tabs.sendMessage  ◀──  fused ScanResponse
   │
   ▼
badge.render()  ──hover──▶  shared tooltip
badge.render()  ──click──▶  sidebar.open()
```

### Per-platform scanning

| Platform | Selector / approach | Notes |
|---|---|---|
| **Facebook** | Feed posts + Reels; Messenger, sidebar, composer, and story rails excluded | Badge shifts left to avoid the ⋯ menu button |
| **TikTok** | Only the **most-visible video** (IntersectionObserver, 0.5 threshold) is badged | One badge follows the FYP as you scroll |
| **X / Twitter** | `article[data-testid="tweet"]` | Straightforward single-post selector |
| **Threads** | `div[data-pressable-container="true"]` + nesting guard (skips quoted posts) | Badge shifts left to avoid the ⋯ menu button; fallback to `div[role="article"]` |

For **video posts** (Reels, TikTok), PRISM sends the video **poster/thumbnail** to
the image (AI) module and the caption to the text module. Full per-frame video
forensics are wired in the backend and active when the video model is loaded.

### Content extraction

- **Text** — ordered selector list → longest meaningful text (avoids one-word
  menu labels). TreeWalker fallback. Minimum 15 chars required.
- **Images** — platform selectors first, then generic `<img>`. Filtered by
  minimum size (40 px) to exclude avatars and glyphs. Max 3 URLs per post.
- **Video** — prefers `<video poster="">` URL, else first meaningful image URL.

### Stability notes

- Each post is assigned a stable **FNV-1a hash** of `platform + caption + first-media-url`.
  Virtualized feeds that detach and reattach the same post node reuse the cached
  verdict instead of re-scanning.
- The service worker **dedupes in-flight requests** — concurrent scans of the
  same content fire one API call.
- Verdicts are cached in `chrome.storage.session` (cleared on browser restart).

> ⚠️ Social-platform DOMs change frequently. The TikTok `class*=` selectors are
> the most fragile (the `data-e2e` anchors are more durable). If 0 posts are
> detected on a known platform, an unpacked build logs a console warning so
> selector breakage is obvious.

## Install (load unpacked)

1. Start the PRISM API (see [`../api`](../api)) — it must be reachable at
   `http://127.0.0.1:8000`:
   ```powershell
   cd ..\api
   .\.venv\Scripts\python.exe main.py
   ```
   Confirm `http://127.0.0.1:8000/health` returns `{"status":"ok"}`.
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select this `extension/` folder.
4. Open Facebook, TikTok, X, or Threads and scroll. Badges appear top-right on posts.

### Pointing at a different backend

The API base defaults to `http://127.0.0.1:8000`. Override it:

```js
// Run in the service-worker DevTools console
chrome.storage.local.set({ prismApiBase: "http://192.168.1.50:8000" });
```

The scan endpoint is always derived as `${base}/scan/extension`.

## Backend contract

Request (`POST /scan/extension`):
```json
{ "text": "caption text or null",
  "image_urls": ["https://…jpg"],
  "platform": "facebook|tiktok|twitter|threads" }
```

Response (fused `ScanResponse`):
```json
{ "label": "fake|real|unknown",
  "confidence": 0.0,
  "modules": {
    "text":  { "label", "confidence", "explanation": { "summary", "reasons", "top_words", "sources" } } | null,
    "image": { "label", "confidence", "explanation": { "method", "signals", "heatmap_b64", "note" } }    | null,
    "video": { ... } | null
  },
  "explanation": { "fusion_score", "modules_used", "weights_applied" } }
```

`modules.text` drives the **Credibility** axis; `modules.image` / `modules.video`
drive the **Authenticity** axis. Each module's `confidence` is `P(fake)` /
`P(AI-generated)`.

## Privacy & security

- **Least privilege:** only `activeTab`, `scripting`, `storage`, and host access
  to the four supported domains. No `<all_urls>`, no `tabs`, no browsing history.
- Verdicts are cached in `chrome.storage.session` (cleared on browser restart).
- The API performs SSRF-guarded, size-capped server-side image fetches (blocks
  loopback, private ranges, reserved / multicast addresses).
- **PRISM never removes, hides, downranks, or reports content.** It only adds an
  informational overlay.
