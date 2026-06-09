/**
 * PRISM — Right-side forensic workspace sidebar (content-script global).
 *
 * Loaded AFTER lib/verdict.js in the manifest `js` array. Registers
 * `window.prismSidebar`. Opened by ui/badge.js when a user clicks a post's
 * PRISM badge. This is a passive decision-support surface — it renders the
 * fused forensic verdict and its explanations; it never removes, hides, or
 * reports content.
 *
 * ---------------------------------------------------------------------------
 * ISOLATION APPROACH: SHADOW DOM.
 *
 * Host pages (Facebook / TikTok / X) ship aggressive, high-specificity CSS.
 * To guarantee the sidebar renders identically everywhere we attach a single
 * host <div> to document.documentElement and render the entire panel inside an
 * open shadowRoot. Styles live INSIDE that shadow root via a <style> element
 * whose text is `PRISM_SIDEBAR_CSS` below.
 *
 * `ui/sidebar.css` is the SOURCE OF TRUTH for these styles and is kept
 * EQUIVALENT to `PRISM_SIDEBAR_CSS`. (The manifest also lists sidebar.css in
 * the content_scripts `css` array, so it loads into the host page globally;
 * every rule there is scoped under `.prism-sb-root` so it cannot bleed into the
 * host. Inside the shadow root that scoping is harmless and the same string is
 * reused.) If you edit one, mirror the change in the other.
 *
 * Public API — window.prismSidebar:
 *   open(verdict, context)  context = { postId, postEl, text? }
 *   close()
 *   isOpen()
 * `open` is idempotent: there is only ever ONE host node in the DOM; calling
 * open again re-renders that single panel with the new verdict.
 * ===========================================================================
 */

(function () {
  "use strict";

  const V = window.prismVerdict;
  if (!V) {
    // verdict.js must load first. Fail loud in console, no-op the API so badge.js
    // calls never throw.
    // eslint-disable-next-line no-console
    console.error("[PRISM] sidebar.js: window.prismVerdict missing — load order?");
    window.prismSidebar = { open() {}, close() {}, isOpen() { return false; } };
    return;
  }

  const { escapeHtml, fmtPct, deriveAxes, getSources, isErrorVerdict } = V;

  const Z_INDEX = 2147483641; // one above the badge
  const PANEL_WIDTH = 380;

  // -------------------------------------------------------------------------
  // Styles injected into the shadow root. Keep EQUIVALENT to ui/sidebar.css.
  // -------------------------------------------------------------------------
  const PRISM_SIDEBAR_CSS = `
.prism-sb-root {
  --prism-fake:#e5484d; --prism-real:#30a46c; --prism-ai:#8e4ec6;
  --prism-human:#0091ff; --prism-unknown:#7a7d85; --prism-scanning:#9aa0ab;
  --prism-bg:#0d1b24; --prism-bg-panel:#11242f; --prism-bg-raised:#163140;
  --prism-border:#23404f; --prism-text:#e7eef2; --prism-text-dim:#9fb3bd;
  --prism-accent:#3fb6c9;
  all: initial;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased; color:var(--prism-text); box-sizing:border-box;
}
.prism-sb-root *,.prism-sb-root *::before,.prism-sb-root *::after{box-sizing:border-box;}
.prism-sb-scrim{position:fixed;inset:0;background:rgba(4,12,17,.32);opacity:0;transition:opacity 220ms ease;pointer-events:none;}
.prism-sb-root.prism-open .prism-sb-scrim{opacity:1;pointer-events:auto;}
.prism-sb-panel{position:fixed;top:0;right:0;height:100vh;width:${PANEL_WIDTH}px;max-width:100vw;
  background:var(--prism-bg);border-left:1px solid var(--prism-border);
  box-shadow:-16px 0 40px rgba(0,0,0,.45);display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform 260ms cubic-bezier(.22,.61,.36,1);will-change:transform;}
.prism-sb-root.prism-open .prism-sb-panel{transform:translateX(0);}
.prism-sb-header{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;
  border-bottom:1px solid var(--prism-border);
  background:linear-gradient(180deg,var(--prism-bg-panel),var(--prism-bg));flex:0 0 auto;}
.prism-sb-logo{width:30px;height:30px;border-radius:7px;flex:0 0 auto;object-fit:contain;background:var(--prism-bg-raised);}
.prism-sb-titlewrap{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;}
.prism-sb-title{font-size:15px;font-weight:700;letter-spacing:.06em;color:var(--prism-text);}
.prism-sb-subtitle{font-size:10.5px;color:var(--prism-text-dim);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.prism-sb-close{all:unset;cursor:pointer;flex:0 0 auto;width:28px;height:28px;border-radius:6px;
  display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;
  color:var(--prism-text-dim);transition:background 140ms ease,color 140ms ease;}
.prism-sb-close:hover{background:var(--prism-bg-raised);color:var(--prism-text);}
.prism-sb-close:focus-visible{outline:2px solid var(--prism-accent);outline-offset:1px;}
.prism-sb-body{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:14px;}
.prism-sb-body::-webkit-scrollbar{width:9px;}
.prism-sb-body::-webkit-scrollbar-thumb{background:var(--prism-border);border-radius:5px;}
.prism-sb-section{background:var(--prism-bg-panel);border:1px solid var(--prism-border);border-radius:10px;padding:12px;}
.prism-sb-section-title{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--prism-text-dim);margin:0 0 9px;}
.prism-sb-gauge{border-radius:10px;padding:14px;border:1px solid var(--prism-border);background:var(--prism-bg-panel);}
.prism-sb-gauge-label{font-size:14px;font-weight:800;letter-spacing:.04em;line-height:1.2;}
.prism-sb-gauge-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:10px;}
.prism-sb-bar{position:relative;flex:1 1 auto;height:10px;border-radius:6px;background:var(--prism-bg-raised);overflow:hidden;}
.prism-sb-bar-fill{position:absolute;inset:0 auto 0 0;height:100%;width:0;border-radius:6px;transition:width 420ms cubic-bezier(.22,.61,.36,1);}
.prism-sb-gauge-pct{flex:0 0 auto;text-align:right;line-height:1;}
.prism-sb-gauge-pct b{font-size:26px;font-weight:800;}
.prism-sb-gauge-pct span{display:block;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--prism-text-dim);margin-top:2px;}
.prism-sb-chips{display:flex;gap:8px;margin-top:12px;}
.prism-sb-chip{flex:1 1 0;min-width:0;border:1px solid var(--prism-border);border-radius:8px;padding:8px 10px;background:var(--prism-bg-raised);border-left-width:3px;}
.prism-sb-chip-kind{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--prism-text-dim);}
.prism-sb-chip-val{display:flex;align-items:baseline;gap:6px;margin-top:3px;}
.prism-sb-chip-state{font-size:13px;font-weight:800;letter-spacing:.03em;}
.prism-sb-chip-pct{font-size:12px;color:var(--prism-text-dim);}
.prism-sb-quote{border-left:3px solid var(--prism-accent);padding:4px 0 4px 10px;font-size:13px;line-height:1.5;color:var(--prism-text);white-space:pre-wrap;word-break:break-word;}
.prism-sb-dim{font-size:10.5px;color:var(--prism-text-dim);margin-top:8px;letter-spacing:.01em;}
.prism-sb-hl{border-radius:3px;padding:0 2px;}
.prism-sb-hl-support{background:rgba(48,164,108,.22);box-shadow:inset 0 -2px 0 rgba(48,164,108,.7);}
.prism-sb-hl-oppose{background:rgba(229,72,77,.2);box-shadow:inset 0 -2px 0 rgba(229,72,77,.6);}
.prism-sb-reason{border-left:3px solid var(--prism-unknown);background:var(--prism-bg-raised);border-radius:6px;padding:7px 10px;margin-top:7px;}
.prism-sb-reason.sev-high{border-left-color:var(--prism-fake);}
.prism-sb-reason.sev-med{border-left-color:#e0922f;}
.prism-sb-reason.sev-low{border-left-color:var(--prism-real);}
.prism-sb-reason-cat{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--prism-text-dim);}
.prism-sb-reason-detail{font-size:12.5px;line-height:1.45;margin-top:2px;}
.prism-sb-words{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}
.prism-sb-word{font-size:11.5px;border-radius:20px;padding:3px 10px;border:1px solid var(--prism-border);background:var(--prism-bg-raised);}
.prism-sb-authrow{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;}
.prism-sb-authrow b{font-size:14px;font-weight:800;}
.prism-sb-authrow span{font-size:12px;color:var(--prism-text-dim);}
.prism-sb-heatmap{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--prism-border);margin:9px 0;}
.prism-sb-signals{list-style:none;margin:0;padding:0;}
.prism-sb-signals li{position:relative;font-size:12.5px;line-height:1.45;padding-left:16px;margin-top:5px;}
.prism-sb-signals li::before{content:"›";position:absolute;left:2px;color:var(--prism-accent);font-weight:700;}
.prism-sb-source{display:block;text-decoration:none;border:1px solid var(--prism-border);border-radius:8px;padding:9px 11px;margin-top:7px;background:var(--prism-bg-raised);transition:border-color 140ms ease;}
.prism-sb-source:hover{border-color:var(--prism-accent);}
.prism-sb-source-pub{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--prism-accent);}
.prism-sb-source-title{font-size:12.5px;color:var(--prism-text);line-height:1.4;margin-top:2px;word-break:break-word;}
.prism-sb-empty{font-size:12px;color:var(--prism-text-dim);line-height:1.5;font-style:italic;}
.prism-sb-error{border:1px solid var(--prism-fake);background:rgba(229,72,77,.1);border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.45;color:var(--prism-text);}
.prism-sb-footer{flex:0 0 auto;padding:10px 14px;border-top:1px solid var(--prism-border);font-size:10px;line-height:1.45;color:var(--prism-text-dim);text-align:center;letter-spacing:.02em;background:var(--prism-bg-panel);}
`;

  // -------------------------------------------------------------------------
  // Singleton state — exactly one host node / shadow root for the page lifetime.
  // -------------------------------------------------------------------------
  let host = null;        // the document-level container div
  let shadow = null;      // its open shadowRoot
  let root = null;        // .prism-sb-root element inside the shadow
  let bodyEl = null;      // scrollable content container
  let opened = false;

  /** Build the host + shadow root once, wire the always-on listeners. */
  function ensureMounted() {
    if (host && document.documentElement.contains(host)) return;

    host = document.createElement("div");
    host.id = "prism-sidebar-host";
    // The host itself is invisible/passthrough; only the inner panel/scrim paint.
    host.style.cssText =
      `all:initial!important;position:fixed!important;top:0!important;` +
      `right:0!important;width:0!important;height:0!important;` +
      `z-index:${Z_INDEX}!important;`;

    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = PRISM_SIDEBAR_CSS;
    shadow.appendChild(style);

    root = document.createElement("div");
    root.className = "prism-sb-root";
    root.innerHTML =
      `<div class="prism-sb-scrim" data-prism-scrim></div>` +
      `<aside class="prism-sb-panel" role="dialog" aria-label="PRISM forensic workspace" tabindex="-1">` +
      `</aside>`;
    shadow.appendChild(root);

    // Backdrop / scrim click closes (non-modal: scrim does not capture scroll).
    root.querySelector("[data-prism-scrim]").addEventListener("click", close);

    document.documentElement.appendChild(host);
  }

  // -------------------------------------------------------------------------
  // Caption resolution.
  // -------------------------------------------------------------------------
  function resolveCaption(verdict, context) {
    const ctx = context || {};
    if (typeof ctx.text === "string" && ctx.text.trim()) return ctx.text;
    const stashed = ctx.postEl && ctx.postEl.dataset && ctx.postEl.dataset.prismText;
    if (typeof stashed === "string" && stashed.trim()) return stashed;
    const sum =
      verdict && verdict.modules && verdict.modules.text &&
      verdict.modules.text.explanation && verdict.modules.text.explanation.summary;
    return typeof sum === "string" ? sum : "";
  }

  // -------------------------------------------------------------------------
  // Render helpers — every interpolated string goes through escapeHtml.
  // -------------------------------------------------------------------------

  function renderGauge(axes) {
    const o = axes.overall;
    const cred = axes.credibility;
    const auth = axes.authenticity;
    const colorMap = { fake: "var(--prism-fake)", real: "var(--prism-real)", unknown: "var(--prism-unknown)" };
    const col = colorMap[o.state] || "var(--prism-unknown)";
    const fillW = typeof o.confidence === "number" ? Math.round(o.confidence * 100) : 0;

    let chips = "";
    if (cred.present) {
      chips +=
        `<div class="prism-sb-chip" style="border-left-color:${escapeHtml(cred.color)}">` +
        `<div class="prism-sb-chip-kind">Credibility</div>` +
        `<div class="prism-sb-chip-val">` +
        `<span class="prism-sb-chip-state" style="color:${escapeHtml(cred.color)}">${escapeHtml(cred.label)}</span>` +
        `<span class="prism-sb-chip-pct">${escapeHtml(cred.pct)}</span></div></div>`;
    }
    if (auth.present) {
      chips +=
        `<div class="prism-sb-chip" style="border-left-color:${escapeHtml(auth.color)}">` +
        `<div class="prism-sb-chip-kind">Authenticity</div>` +
        `<div class="prism-sb-chip-val">` +
        `<span class="prism-sb-chip-state" style="color:${escapeHtml(auth.color)}">${escapeHtml(auth.label)}</span>` +
        `<span class="prism-sb-chip-pct">${escapeHtml(auth.pct)}</span></div></div>`;
    }

    return (
      `<div class="prism-sb-gauge" style="border-color:${col}">` +
      `<div class="prism-sb-gauge-label" style="color:${col}">VERDICT: ${escapeHtml(o.label)}</div>` +
      `<div class="prism-sb-gauge-row">` +
      `<div class="prism-sb-bar"><div class="prism-sb-bar-fill" style="width:${fillW}%;background:${col}"></div></div>` +
      `<div class="prism-sb-gauge-pct"><b style="color:${col}">${escapeHtml(o.pct)}</b><span>Probability</span></div>` +
      `</div>` +
      (chips ? `<div class="prism-sb-chips">${chips}</div>` : "") +
      `</div>`
    );
  }

  function renderCaptionSection(caption, topWords) {
    const captionHtml = highlightCaption(caption, topWords);
    return (
      `<div class="prism-sb-section">` +
      `<h3 class="prism-sb-section-title">Scanned Post</h3>` +
      `<div class="prism-sb-quote">${captionHtml || '<em style="color:var(--prism-text-dim)">No caption text captured.</em>'}</div>` +
      `<div class="prism-sb-dim">Verified using LIME + Anchors</div>` +
      `</div>`
    );
  }

  /**
   * Inline-highlight LIME top_words in the caption. Words flagged "supports"
   * tint toward credibility (green), "opposes" tint muted-red. Falls back to
   * the raw escaped caption when nothing matches reliably.
   */
  function highlightCaption(caption, topWords) {
    const safe = escapeHtml(caption || "");
    if (!safe) return "";
    if (!Array.isArray(topWords) || !topWords.length) return safe;

    // Build one case-insensitive alternation of escaped, word-bounded terms.
    const entries = [];
    for (const w of topWords) {
      const word = w && typeof w.word === "string" ? w.word.trim() : "";
      if (!word) continue;
      entries.push({
        word,
        cls: (w.direction === "supports") ? "prism-sb-hl-support" : "prism-sb-hl-oppose",
      });
    }
    if (!entries.length) return safe;

    // Map escaped lowercase word -> class for lookup during replace.
    const clsByWord = new Map();
    const alts = [];
    for (const e of entries) {
      const esc = escapeHtml(e.word);
      clsByWord.set(esc.toLowerCase(), e.cls);
      alts.push(escapeRegExp(esc));
    }
    let re;
    try {
      re = new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.join("|")})(?=[^\\p{L}\\p{N}]|$)`, "giu");
    } catch (_) {
      // Older engines without Unicode property escapes — degrade gracefully.
      re = new RegExp(`(^|[^A-Za-z0-9])(${alts.join("|")})(?![A-Za-z0-9])`, "gi");
    }
    return safe.replace(re, (m, lead, hit) => {
      const cls = clsByWord.get(hit.toLowerCase()) || "prism-sb-hl-oppose";
      return `${lead}<span class="prism-sb-hl ${cls}">${hit}</span>`;
    });
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function renderTextAnalysis(verdict) {
    const t = verdict && verdict.modules && verdict.modules.text;
    const ex = (t && t.explanation) || null;
    if (!ex) return "";

    let html = `<div class="prism-sb-section"><h3 class="prism-sb-section-title">Text Analysis</h3>`;

    if (ex.summary) {
      html += `<div class="prism-sb-reason-detail" style="margin-bottom:6px">${escapeHtml(ex.summary)}</div>`;
    }

    if (Array.isArray(ex.reasons) && ex.reasons.length) {
      for (const r of ex.reasons) {
        if (!r) continue;
        const sev = String(r.severity || "").toLowerCase();
        const sevCls = sev === "high" ? "sev-high" : sev === "med" || sev === "medium" ? "sev-med" : sev === "low" ? "sev-low" : "";
        html +=
          `<div class="prism-sb-reason ${sevCls}">` +
          (r.category ? `<div class="prism-sb-reason-cat">${escapeHtml(r.category)}</div>` : "") +
          `<div class="prism-sb-reason-detail">${escapeHtml(r.detail)}</div>` +
          `</div>`;
      }
    }

    // If we have top_words but couldn't inline-highlight (no caption), show chips.
    const caption = root.__prismCaption || "";
    const hasWords = Array.isArray(ex.top_words) && ex.top_words.length;
    if (hasWords && !caption.trim()) {
      html += `<div class="prism-sb-words">`;
      for (const w of ex.top_words) {
        if (!w || !w.word) continue;
        const col = w.direction === "supports" ? "var(--prism-real)" : "var(--prism-fake)";
        html += `<span class="prism-sb-word" style="border-color:${col};color:${col}">${escapeHtml(w.word)}</span>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderMediaAnalysis(verdict, axes) {
    const modules = (verdict && verdict.modules) || {};
    const mediaMod = modules.video || modules.image || null;
    if (!mediaMod) return "";

    const auth = axes.authenticity;
    const ex = mediaMod.explanation || {};

    let html = `<div class="prism-sb-section"><h3 class="prism-sb-section-title">Image / AI Analysis</h3>`;

    html +=
      `<div class="prism-sb-authrow">` +
      `<b style="color:${escapeHtml(auth.color)}">${escapeHtml(auth.label)}</b>` +
      `<span>${escapeHtml(auth.pct)} ${auth.state === "ai" ? "AI-generated" : auth.state === "human" ? "human-made" : "confidence"}</span>` +
      `</div>`;

    // CAM / GradCAM heatmap — rendered as a data URI when present.
    if (ex.heatmap_b64 && typeof ex.heatmap_b64 === "string") {
      const b64 = ex.heatmap_b64.replace(/^data:image\/\w+;base64,/, "");
      html += `<img class="prism-sb-heatmap" alt="Manipulation heatmap" src="data:image/png;base64,${escapeHtml(b64)}">`;
    }

    if (Array.isArray(ex.signals) && ex.signals.length) {
      html += `<ul class="prism-sb-signals">`;
      for (const s of ex.signals) {
        html += `<li>${escapeHtml(s)}</li>`;
      }
      html += `</ul>`;
    }

    if (ex.note) {
      html += `<div class="prism-sb-dim">${escapeHtml(ex.note)}</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderSources(verdict) {
    const sources = getSources(verdict);
    let html = `<div class="prism-sb-section"><h3 class="prism-sb-section-title">Verified Source Links</h3>`;
    if (Array.isArray(sources) && sources.length) {
      for (const s of sources) {
        if (!s || !s.url) continue;
        html +=
          `<a class="prism-sb-source" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">` +
          (s.publisher ? `<div class="prism-sb-source-pub">${escapeHtml(s.publisher)}</div>` : "") +
          `<div class="prism-sb-source-title">${escapeHtml(s.title || s.url)}</div>` +
          `</a>`;
      }
    } else {
      html +=
        `<div class="prism-sb-empty">No matched fact-check sources yet — ` +
        `source retrieval is being wired up.</div>`;
    }
    html += `</div>`;
    return html;
  }

  // -------------------------------------------------------------------------
  // Full panel render.
  // -------------------------------------------------------------------------
  function render(verdict, context) {
    const panel = root.querySelector(".prism-sb-panel");
    if (!panel) return;

    let logoUrl = "";
    try {
      logoUrl = chrome.runtime.getURL("icons/icon128.png");
    } catch (_) { /* getURL unavailable in some test contexts */ }

    const headerHtml =
      `<div class="prism-sb-header">` +
      (logoUrl ? `<img class="prism-sb-logo" src="${escapeHtml(logoUrl)}" alt="PRISM">` : `<div class="prism-sb-logo"></div>`) +
      `<div class="prism-sb-titlewrap">` +
      `<div class="prism-sb-title">PRISM</div>` +
      `<div class="prism-sb-subtitle">Passive Shield · Visual Forensics Workspace</div>` +
      `</div>` +
      `<button class="prism-sb-close" type="button" aria-label="Close" data-prism-close>×</button>` +
      `</div>`;

    const footerHtml =
      `<div class="prism-sb-footer">Powered by PRISM · decision-support only · ` +
      `PRISM does not remove or report content.</div>`;

    let bodyHtml = `<div class="prism-sb-body" data-prism-body>`;

    // Never throw on a malformed verdict — derive defensively.
    let axes;
    try {
      axes = deriveAxes(verdict);
    } catch (_) {
      axes = null;
    }

    if (!axes) {
      bodyHtml += `<div class="prism-sb-error">PRISM could not read this verdict. The post may not have been scanned yet.</div>`;
    } else {
      if (isErrorVerdict(verdict)) {
        const msg = (verdict.explanation && verdict.explanation.error) || "Analysis unavailable.";
        bodyHtml += `<div class="prism-sb-error"><b>Scan error.</b> ${escapeHtml(msg)}</div>`;
      }

      const caption = resolveCaption(verdict, context);
      root.__prismCaption = caption;
      const topWords =
        verdict && verdict.modules && verdict.modules.text &&
        verdict.modules.text.explanation && verdict.modules.text.explanation.top_words;

      bodyHtml += renderGauge(axes);
      bodyHtml += renderCaptionSection(caption, topWords);
      bodyHtml += renderTextAnalysis(verdict);
      bodyHtml += renderMediaAnalysis(verdict, axes);
      bodyHtml += renderSources(verdict);
    }

    bodyHtml += `</div>`;

    panel.innerHTML = headerHtml + bodyHtml + footerHtml;

    // (Re)wire the close button each render (innerHTML replaced it).
    const closeBtn = panel.querySelector("[data-prism-close]");
    if (closeBtn) closeBtn.addEventListener("click", close);

    bodyEl = panel.querySelector("[data-prism-body]");
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  // -------------------------------------------------------------------------
  // Escape-key handling (only while open).
  // -------------------------------------------------------------------------
  function onKeyDown(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.stopPropagation();
      close();
    }
  }

  // -------------------------------------------------------------------------
  // Public API.
  // -------------------------------------------------------------------------

  /** Open (or re-render) the single sidebar with a fused verdict + context. */
  function open(verdict, context) {
    try {
      ensureMounted();
      render(verdict, context);

      // Force a layout read so the slide-in transition runs on first open.
      // eslint-disable-next-line no-unused-expressions
      root.offsetWidth;
      root.classList.add("prism-open");

      if (!opened) {
        document.addEventListener("keydown", onKeyDown, true);
      }
      opened = true;

      const panel = root.querySelector(".prism-sb-panel");
      if (panel) {
        try { panel.focus({ preventScroll: true }); } catch (_) { /* no-op */ }
      }
    } catch (err) {
      // Never let a render failure bubble into the host page / badge.js.
      // eslint-disable-next-line no-console
      console.error("[PRISM] sidebar open failed:", err);
    }
  }

  /** Slide out and hide the panel. Idempotent. */
  function close() {
    if (!root) return;
    root.classList.remove("prism-open");
    if (opened) {
      document.removeEventListener("keydown", onKeyDown, true);
    }
    opened = false;
  }

  /** Whether the panel is currently open. */
  function isOpen() {
    return opened;
  }

  window.prismSidebar = { open, close, isOpen };
})();
