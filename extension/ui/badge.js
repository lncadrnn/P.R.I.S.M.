/**
 * PRISM — Two-segment verdict badge + hover tooltip (content-script global).
 *
 * Loaded AFTER lib/verdict.js in the manifest `js` array. Registers
 * `window.prismBadge`. Depends on `window.prismVerdict` (TOKENS, escapeHtml,
 * fmtPct, deriveAxes, isErrorVerdict) and OPTIONALLY on `window.prismSidebar`
 * (for the click-to-open-panel behaviour — guarded, never assumed present).
 *
 * ---------------------------------------------------------------------------
 * What this renders, anchored top-right INSIDE each scanned post element:
 *
 *   ┌───────────────────────────┐
 *   │ ● FAKE 94% │ ◆ AI 98% │     ← merged two-segment pill
 *   └───────────────────────────┘
 *     red half      purple half
 *
 *   LEFT  segment = CREDIBILITY  axis (● dot)     FAKE→red   / REAL→green
 *   RIGHT segment = AUTHENTICITY axis (◆ diamond) AI→purple  / HUMAN→blue
 *
 * Rules:
 *   - An absent axis (present:false) hides its segment entirely.
 *   - Both absent → a single neutral gray "PRISM" pill.
 *   - Error verdict → a muted gray "PRISM ⚠" pill; tooltip shows the error.
 *   - Hover → dark breakdown card below/left of the badge.
 *   - Click → window.prismSidebar.open(verdict, { postId, postEl }).
 *
 * All injected nodes use `prism-`-prefixed classes and the badge root is reset
 * with `all: initial` (re-asserted in badge.css) so host-page CSS cannot
 * distort it. Nothing here ever throws on a malformed verdict — it degrades to
 * the gray PRISM pill.
 * ===========================================================================
 */

(function () {
  "use strict";

  // The badge root carries this high z-index (just below the int32 max the
  // sidebar reserves) and is marked with data-prism-badge so the scanner can
  // skip it and remove() can find it.
  const BADGE_ATTR = "data-prism-badge";

  // Small glyphs used in the segments. Kept as constants so markup stays tidy.
  const ICON_DOT = "●";      // ● credibility
  const ICON_DIAMOND = "◆";  // ◆ authenticity
  const ICON_WARN = "⚠";     // ⚠ error

  // Facebook posts have ⋯ (more) and ✕ (hide) buttons in the top-right header.
  // We shift the badge left of those (via the .prism-badge--fb class) so it
  // doesn't sit on top of them.
  const IS_FACEBOOK = (function () {
    try { return location.hostname.indexOf("facebook.com") !== -1; }
    catch (_) { return false; }
  })();

  // Threads posts have a single ⋯ (more) button in the top-right corner. We
  // shift the badge left of it (via the .prism-badge--threads class).
  const IS_THREADS = (function () {
    try {
      const h = location.hostname;
      return h.indexOf("threads.net") !== -1 || h.indexOf("threads.com") !== -1;
    } catch (_) { return false; }
  })();

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------

  /** Convenience accessor for the shared verdict helpers (guaranteed loaded). */
  function V() {
    return window.prismVerdict || {};
  }

  /**
   * Ensure the host post element can anchor an absolutely-positioned badge.
   * Minimal intervention: only set position:relative when the computed
   * position is `static` (the default), leaving any author-set value alone.
   */
  function ensureAnchored(postEl) {
    if (!postEl || !postEl.nodeType) return;
    try {
      const pos = window.getComputedStyle(postEl).position;
      if (pos === "static") postEl.style.position = "relative";
    } catch (_) {
      // getComputedStyle can throw on detached nodes — ignore, badge still works.
    }
  }

  /** Find an existing PRISM badge already attached to this post element. */
  function findBadge(postEl) {
    if (!postEl || !postEl.querySelector) return null;
    return postEl.querySelector(`:scope > [${BADGE_ATTR}]`) ||
           postEl.querySelector(`[${BADGE_ATTR}]`);
  }

  /**
   * Create the badge root <div>. The root is reset via `all: initial` in
   * badge.css; we still set the marker attribute, base class, and the click
   * handler scaffolding here.
   */
  function makeRoot() {
    const root = document.createElement("div");
    let cls = "prism-badge";
    if (IS_FACEBOOK) cls += " prism-badge--fb";
    else if (IS_THREADS) cls += " prism-badge--threads";
    root.className = cls;
    root.setAttribute(BADGE_ATTR, "true");
    root.setAttribute("role", "button");
    root.setAttribute("tabindex", "0");
    return root;
  }

  /**
   * Wire the click → sidebar behaviour onto a badge root. Stops the event from
   * reaching the host post (so Facebook/TikTok/X don't navigate). Listens in
   * the capture phase to win against the host's own delegated handlers.
   */
  function wireClick(root, verdict, postId, postEl) {
    const open = function (e) {
      e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
      const sb = window.prismSidebar;
      if (sb && typeof sb.open === "function") {
        try {
          sb.open(verdict, { postId: postId, postEl: postEl });
        } catch (_) {
          // Sidebar failures must never bubble back into the host page.
        }
      }
    };
    root.addEventListener("click", open, true);
    // Keyboard parity for the role="button" root.
    root.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") open(e);
    }, true);
  }

  // -------------------------------------------------------------------------
  // Floating tooltip
  //
  // The hover card is a SINGLE shared node appended to <body> and positioned
  // `fixed` by JS — NOT a child of each badge. Social feeds (X especially) wrap
  // posts in `overflow:hidden` containers that would CLIP an absolutely-
  // positioned child tooltip. A fixed, body-level node escapes all ancestor
  // clipping, and we clamp it to the viewport so it is never cut off at a screen
  // edge. One shared node also means no per-badge cleanup (no leaked tooltip
  // nodes from virtualized feeds). Each badge stores only its tooltip HTML.
  // -------------------------------------------------------------------------

  let sharedTip = null;     // the single reused .prism-bt node
  let activeRoot = null;    // badge root the tip is currently shown for
  let hideTimer = null;
  let reflowWired = false;

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hideTip, 140);
  }

  function hideTip() {
    cancelHide();
    if (sharedTip) sharedTip.classList.remove("prism-bt--show");
    activeRoot = null;
  }

  function getSharedTip() {
    if (sharedTip && sharedTip.isConnected) return sharedTip;
    const tip = document.createElement("div");
    tip.className = "prism-bt";
    tip.setAttribute("data-prism-tip", "true");
    // Keep the tip open while the pointer is on it (so it can be scrolled).
    tip.addEventListener("mouseenter", cancelHide);
    tip.addEventListener("mouseleave", scheduleHide);
    (document.body || document.documentElement).appendChild(tip);
    sharedTip = tip;
    wireReflow();
    return tip;
  }

  /** Keep a visible tip glued to its badge as the page scrolls / resizes. */
  function wireReflow() {
    if (reflowWired) return;
    reflowWired = true;
    const onReflow = function () {
      if (!activeRoot) return;
      if (!activeRoot.isConnected) { hideTip(); return; }
      positionTip(activeRoot, sharedTip);
    };
    // Capture phase so inner scroll containers (feeds) are caught too.
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow, true);
  }

  /** Place the fixed tip near the badge, clamped fully inside the viewport. */
  function positionTip(root, tip) {
    let r;
    try { r = root.getBoundingClientRect(); } catch (_) { return; }
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const m = 8;     // viewport margin
    const gap = 8;   // gap between badge and tip
    const tw = tip.offsetWidth || 300;
    const th = tip.offsetHeight || 0;

    // Horizontal: align the tip's right edge to the badge's right edge, then
    // clamp so neither side leaves the viewport.
    let left = r.right - tw;
    if (left + tw > vw - m) left = vw - m - tw;
    if (left < m) left = m;

    // Vertical: prefer below the badge; flip above if it would overflow the
    // bottom; clamp into view either way.
    let top = r.bottom + gap;
    if (top + th > vh - m) {
      const above = r.top - gap - th;
      top = above >= m ? above : Math.max(m, vh - m - th);
    }
    if (top < m) top = m;

    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }

  /** Show the shared tip for a badge root, filled from its stored HTML. */
  function showTipFor(root) {
    const html = root && root.__prismTipHtml;
    if (!html) return;
    cancelHide();
    const tip = getSharedTip();
    tip.innerHTML = html;
    tip.scrollTop = 0;
    activeRoot = root;
    // Measure (visibility:hidden retains layout) then place, then reveal.
    positionTip(root, tip);
    tip.classList.add("prism-bt--show");
  }

  /**
   * Store a badge's tooltip HTML on the root and wire hover/focus to drive the
   * shared tip. Replaces the old "tooltip as a child of the badge" approach.
   */
  function attachTip(root, tipEl) {
    if (!root || !tipEl) return;
    root.__prismTipHtml = tipEl.innerHTML;
    root.addEventListener("mouseenter", function () { showTipFor(root); });
    root.addEventListener("mouseleave", scheduleHide);
    root.addEventListener("focusin", function () { showTipFor(root); });
    root.addEventListener("focusout", scheduleHide);
  }

  // -------------------------------------------------------------------------
  // Tooltip markup builders — all values pass through escapeHtml before they
  // touch innerHTML.
  // -------------------------------------------------------------------------

  /** Map a severity string to a stable CSS modifier class. */
  function sevClass(severity) {
    const s = String(severity || "").toLowerCase();
    if (s === "high") return "prism-bt-sev--high";
    if (s === "med" || s === "medium") return "prism-bt-sev--med";
    return "prism-bt-sev--low";
  }

  /**
   * Build the CREDIBILITY tooltip section from the text module explanation.
   * Shows: headline · summary · up to 3 reasons · up to 8 top-word chips.
   */
  function credibilitySection(axis) {
    const esc = V().escapeHtml;
    const mod = axis.module || {};
    const exp = (mod && mod.explanation) || {};
    const labelWord = axis.label === "FAKE" ? "FAKE" : axis.label === "REAL" ? "REAL" : "UNKNOWN";

    let html = `<div class="prism-bt-section">`;
    html += `<div class="prism-bt-head" style="color:${axis.color}">`;
    html += `Credibility: ${esc(labelWord)} — ${esc(axis.pct)}</div>`;

    if (exp.summary) {
      html += `<p class="prism-bt-summary">${esc(exp.summary)}</p>`;
    }

    // Up to 3 reasons, color-coded by severity via a left border.
    const reasons = Array.isArray(exp.reasons) ? exp.reasons.slice(0, 3) : [];
    if (reasons.length) {
      html += `<div class="prism-bt-label">Why</div>`;
      html += `<ul class="prism-bt-reasons">`;
      reasons.forEach(function (r) {
        const cat = r && r.category ? `<span class="prism-bt-cat">${esc(r.category)}</span> ` : "";
        const detail = r && r.detail ? esc(r.detail) : "";
        html += `<li class="prism-bt-reason ${sevClass(r && r.severity)}">${cat}${detail}</li>`;
      });
      html += `</ul>`;
    }

    // Up to 8 top-word chips. "supports" → tinted toward the verdict color,
    // "opposes" → muted.
    const words = Array.isArray(exp.top_words) ? exp.top_words.slice(0, 8) : [];
    if (words.length) {
      html += `<div class="prism-bt-label">Key words</div>`;
      html += `<div class="prism-bt-chips">`;
      words.forEach(function (w) {
        const supports = String(w && w.direction || "").toLowerCase() === "supports";
        const cls = supports ? "prism-bt-chip--supports" : "prism-bt-chip--opposes";
        // Tint supporting chips toward the verdict color via an inline border.
        const style = supports ? ` style="border-color:${axis.color};color:${axis.color}"` : "";
        html += `<span class="prism-bt-chip ${cls}"${style}>${esc(w && w.word)}</span>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Build the AUTHENTICITY tooltip section from the image/video module
   * explanation. Shows: headline · up to 4 signals · dim note · heatmap hint.
   */
  function authenticitySection(axis) {
    const esc = V().escapeHtml;
    const mod = axis.module || {};
    const exp = (mod && mod.explanation) || {};
    const labelWord =
      axis.label === "AI" ? "AI-generated" :
      axis.label === "HUMAN" ? "Human-made" : "UNKNOWN";

    let html = `<div class="prism-bt-section">`;
    html += `<div class="prism-bt-head" style="color:${axis.color}">`;
    html += `Authenticity: ${esc(labelWord)} — ${esc(axis.pct)}</div>`;

    if (exp.method) {
      html += `<p class="prism-bt-summary"><span class="prism-bt-cat">${esc(exp.method)}</span></p>`;
    }

    const signals = Array.isArray(exp.signals) ? exp.signals.slice(0, 4) : [];
    if (signals.length) {
      html += `<div class="prism-bt-label">Signals</div>`;
      html += `<ul class="prism-bt-reasons">`;
      signals.forEach(function (s) {
        html += `<li class="prism-bt-reason prism-bt-sev--low">${esc(s)}</li>`;
      });
      html += `</ul>`;
    }

    if (exp.note) {
      html += `<p class="prism-bt-note">${esc(exp.note)}</p>`;
    }

    // The heatmap itself lives in the sidebar; here we only hint at it.
    if (exp.heatmap_b64) {
      html += `<p class="prism-bt-note">View heatmap in panel</p>`;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Assemble the full hover tooltip for the present axes. Returns an element
   * (not a string) so the caller can append it directly.
   */
  function buildTooltip(axes) {
    const tip = document.createElement("div");
    tip.className = "prism-bt";

    let html = "";
    if (axes.credibility && axes.credibility.present) {
      html += credibilitySection(axes.credibility);
    }
    if (axes.authenticity && axes.authenticity.present) {
      html += authenticitySection(axes.authenticity);
    }
    if (!html) {
      // No axis present — tooltip still explains what PRISM is.
      html += `<div class="prism-bt-section"><div class="prism-bt-head" style="color:var(--prism-unknown)">PRISM</div>` +
              `<p class="prism-bt-summary">No analysable content detected in this post.</p></div>`;
    }
    html += `<div class="prism-bt-foot">Click for full forensic panel · decision-support only</div>`;
    tip.innerHTML = html;
    return tip;
  }

  /** Build a single-axis pill segment element. */
  function buildSegment(axis, icon) {
    const esc = V().escapeHtml;
    const seg = document.createElement("span");
    seg.className = `prism-badge-seg prism-badge-seg--${axis.kind}`;
    // The state color drives this segment's accent (dot/diamond + subtle tint).
    seg.style.setProperty("--prism-seg-color", axis.color);
    seg.innerHTML =
      `<span class="prism-badge-ico" style="color:${axis.color}">${icon}</span>` +
      `<span class="prism-badge-lbl">${esc(axis.label)}</span>` +
      `<span class="prism-badge-pct">${esc(axis.pct)}</span>`;
    return seg;
  }

  /** Build a neutral gray pill (both axes absent, or fallback). */
  function buildNeutralPill(text, isWarn) {
    const esc = V().escapeHtml;
    const pill = document.createElement("span");
    pill.className = "prism-badge-seg prism-badge-seg--neutral";
    const icon = isWarn ? ICON_WARN : ICON_DOT;
    pill.innerHTML =
      `<span class="prism-badge-ico" style="color:var(--prism-unknown)">${icon}</span>` +
      `<span class="prism-badge-lbl">${esc(text || "PRISM")}</span>`;
    return pill;
  }

  /** Build the error tooltip (muted, shows only the error string). */
  function buildErrorTooltip(errMsg) {
    const esc = V().escapeHtml;
    const tip = document.createElement("div");
    tip.className = "prism-bt";
    tip.innerHTML =
      `<div class="prism-bt-section"><div class="prism-bt-head" style="color:var(--prism-unknown)">` +
      `PRISM ${ICON_WARN}</div>` +
      `<p class="prism-bt-summary">${esc(errMsg || "Scan unavailable.")}</p></div>` +
      `<div class="prism-bt-foot">Click for full forensic panel · decision-support only</div>`;
    return tip;
  }

  /**
   * Build the "still scanning" tooltip. Explains WHAT PRISM is checking and
   * WHY it takes a moment, tailored to the modalities present in the post so
   * the user understands the wait (e.g. video frame analysis is the slow path).
   *
   * @param {Object} [context]  Optional scan context from the scanner:
   *   { hasText:boolean, hasImage:boolean, isVideo:boolean, platform:string }
   */
  function buildScanningTooltip(context) {
    const esc = V().escapeHtml;
    const ctx = context || {};
    const hasText = !!ctx.hasText;
    const hasImage = !!ctx.hasImage;
    const isVideo = !!ctx.isVideo;

    // One reason row per modality currently being analysed. Wording explains
    // the actual forensic work, not just "loading".
    const checks = [];
    if (hasText) {
      checks.push({
        cat: "Caption",
        detail: "checking Taglish wording against Filipino disinformation patterns and running the LIME explanation.",
      });
    }
    if (isVideo) {
      checks.push({
        cat: "Video",
        detail: "extracting key frames and analysing them for AI-generated / deepfake artifacts — this is the slowest check.",
      });
    } else if (hasImage) {
      checks.push({
        cat: "Image",
        detail: "scanning for AI-generated content and manipulated regions.",
      });
    }

    let html = `<div class="prism-bt-section">`;
    html += `<div class="prism-bt-head" style="color:var(--prism-scanning)">`;
    html += `PRISM is thoroughly checking this post…</div>`;
    html += `<p class="prism-bt-summary">Each modality runs its own forensic model, then the results are fused into one verdict. This usually takes a few seconds.</p>`;

    if (checks.length) {
      html += `<div class="prism-bt-label">In progress</div>`;
      html += `<ul class="prism-bt-reasons">`;
      checks.forEach(function (c) {
        html +=
          `<li class="prism-bt-reason prism-bt-sev--low">` +
          `<span class="prism-bt-cat">${esc(c.cat)}</span> ${esc(c.detail)}</li>`;
      });
      html += `</ul>`;
    }

    html += `</div>`;
    html += `<div class="prism-bt-foot">Hang tight — decision-support only</div>`;

    const tip = document.createElement("div");
    tip.className = "prism-bt";
    tip.innerHTML = html;
    return tip;
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Attach a pulsing placeholder pill ("● PRISM …") while the post is being
   * scanned. Idempotent — replaces any prior badge on the element.
   *
   * @param {Element} postEl   Host post container.
   * @param {string}  postId   Stable id the scanner assigned to this post.
   * @param {Object}  [context]  What's being analysed, for the hover tooltip:
   *   { hasText, hasImage, isVideo, platform }. Optional — a generic message
   *   is shown when omitted.
   */
  function setScanning(postEl, postId, context) {
    if (!postEl || !postEl.appendChild) return;
    remove(postEl);
    ensureAnchored(postEl);

    const root = makeRoot();
    root.classList.add("prism-badge--scanning");
    root.dataset.prismPostId = postId == null ? "" : String(postId);

    const pill = document.createElement("span");
    pill.className = "prism-badge-seg prism-badge-seg--neutral prism-badge-pulse";
    pill.innerHTML =
      `<span class="prism-badge-ico" style="color:var(--prism-scanning)">${ICON_DOT}</span>` +
      `<span class="prism-badge-lbl">PRISM</span>` +
      `<span class="prism-badge-dots">…</span>`;
    root.appendChild(pill);

    // Hover/focus reveals WHAT is being checked and WHY it takes a moment.
    // Same shared floating tooltip the verdict badges use.
    try {
      attachTip(root, buildScanningTooltip(context));
    } catch (_) {
      // A missing tooltip must never block the placeholder from rendering.
    }

    postEl.appendChild(root);
    return root;
  }

  /**
   * Replace the placeholder (or a prior badge) with the real two-segment
   * badge derived from `verdict`. Idempotent. Never throws on bad input.
   *
   * @param {Element} postEl   Host post container.
   * @param {Object}  verdict  Fused ScanResponse from the backend.
   * @param {string}  postId   Stable id from the scanner.
   */
  function render(postEl, verdict, postId) {
    if (!postEl || !postEl.appendChild) return;
    remove(postEl);
    ensureAnchored(postEl);

    const root = makeRoot();
    root.dataset.prismPostId = postId == null ? "" : String(postId);

    let tooltip;

    try {
      const verdictHelpers = V();

      // Error verdict → muted gray "PRISM ⚠" pill, tooltip shows the error.
      if (typeof verdictHelpers.isErrorVerdict === "function" && verdictHelpers.isErrorVerdict(verdict)) {
        root.classList.add("prism-badge--error");
        root.appendChild(buildNeutralPill("PRISM", true));
        const errMsg = verdict && verdict.explanation && verdict.explanation.error;
        tooltip = buildErrorTooltip(errMsg);
      } else {
        const axes = verdictHelpers.deriveAxes(verdict) || {};
        const cred = axes.credibility || { present: false };
        const auth = axes.authenticity || { present: false };

        if (!cred.present && !auth.present) {
          // Nothing analysable — single neutral PRISM pill.
          root.classList.add("prism-badge--neutral");
          root.appendChild(buildNeutralPill("PRISM", false));
        } else {
          // One or two real segments, divider only when both are present.
          if (cred.present) root.appendChild(buildSegment(cred, ICON_DOT));
          if (cred.present && auth.present) {
            const div = document.createElement("span");
            div.className = "prism-badge-divider";
            root.appendChild(div);
          }
          if (auth.present) root.appendChild(buildSegment(auth, ICON_DIAMOND));
        }
        tooltip = buildTooltip(axes);
      }
    } catch (_) {
      // Any unexpected failure degrades to the gray PRISM pill.
      root.innerHTML = "";
      root.classList.add("prism-badge--neutral");
      root.appendChild(buildNeutralPill("PRISM", false));
      tooltip = buildErrorTooltip("Verdict could not be rendered.");
    }

    attachTip(root, tooltip);

    wireClick(root, verdict, postId, postEl);
    postEl.appendChild(root);
    return root;
  }

  /**
   * Remove any PRISM badge from this post element. Safe to call when none
   * exists (no-op).
   *
   * @param {Element} postEl  Host post container.
   */
  function remove(postEl) {
    if (!postEl || !postEl.querySelectorAll) return;
    const nodes = postEl.querySelectorAll(`[${BADGE_ATTR}]`);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      // If the badge whose tip is currently shown is being removed, hide it.
      if (n === activeRoot) hideTip();
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
  }

  window.prismBadge = {
    setScanning: setScanning,
    render: render,
    remove: remove,
  };
})();
