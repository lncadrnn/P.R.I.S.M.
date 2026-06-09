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
    root.className = "prism-badge";
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

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Attach a pulsing placeholder pill ("● PRISM …") while the post is being
   * scanned. Idempotent — replaces any prior badge on the element.
   *
   * @param {Element} postEl  Host post container.
   * @param {string}  postId  Stable id the scanner assigned to this post.
   */
  function setScanning(postEl, postId) {
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

    if (tooltip) root.appendChild(tooltip);

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
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
  }

  window.prismBadge = {
    setScanning: setScanning,
    render: render,
    remove: remove,
  };
})();
