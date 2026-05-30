/**
 * PRISM — Content Script: Verdict Overlay
 *
 * Provides two public functions:
 *   createVerdictOverlay(element, verdict)  — attach a final verdict badge
 *   setScanning(element, postId)            — attach a "scanning…" placeholder badge
 *
 * The badge is injected as a child of the post element.
 * It uses `position: absolute` so it sits in the top-right corner without
 * disrupting the document flow.  The post element receives `position: relative`
 * only if it is currently `static`, which is the minimal intervention needed.
 *
 * Hover reveals a tooltip with the confidence score and explanation highlights.
 */

// ---------------------------------------------------------------------------
// Badge creation helpers
// ---------------------------------------------------------------------------

const PRISM_ATTR = "data-prism-badge"; // Presence marks an element as already badged.

/**
 * Determine the badge CSS class from a verdict label.
 *
 * @param {string} label  "fake" | "real" | "unknown"
 * @returns {string}      CSS class suffix.
 */
function labelToClass(label) {
  switch ((label || "").toLowerCase()) {
    case "fake":
    case "false":
      return "fake";
    case "real":
    case "true":
      return "real";
    default:
      return "unknown";
  }
}

/**
 * Format a 0–1 confidence score as a percentage string.
 *
 * @param {number} confidence
 * @returns {string}  e.g. "87%"
 */
function fmtConfidence(confidence) {
  if (typeof confidence !== "number" || isNaN(confidence)) return "—";
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Build the tooltip HTML from the verdict explanation object.
 * Handles word/phrase highlights (text module) and generic explanations.
 *
 * @param {Object} verdict
 * @returns {string}  Inner HTML for the tooltip content area.
 */
function buildTooltipContent(verdict) {
  const { label, confidence, explanation } = verdict;
  const lines = [];

  lines.push(
    `<div class="prism-tooltip-row prism-tooltip-label">` +
      `<span class="prism-tip-key">Verdict:</span> ` +
      `<span class="prism-tip-val prism-tip-${labelToClass(label)}">${(label || "unknown").toUpperCase()}</span>` +
      `</div>`
  );

  lines.push(
    `<div class="prism-tooltip-row">` +
      `<span class="prism-tip-key">Confidence:</span> ` +
      `<span class="prism-tip-val">${fmtConfidence(confidence)}</span>` +
      `</div>`
  );

  if (explanation) {
    // Error state
    if (explanation.error) {
      lines.push(
        `<div class="prism-tooltip-row prism-tooltip-error">${escapeHtml(String(explanation.error))}</div>`
      );
    }

    // LIME / Anchors word highlights: [{ word, weight }]
    if (
      Array.isArray(explanation.highlights) &&
      explanation.highlights.length > 0
    ) {
      lines.push(`<div class="prism-tooltip-row prism-tip-key">Key words:</div>`);
      // Determine chip color relative to the verdict label:
      // For a "fake" verdict, positive weight pushed toward fake (red chip).
      // For a "real" verdict, positive weight pushed toward real (green chip).
      // Any other label falls back to the fake-direction heuristic.
      const isFakeVerdict = labelToClass(label) === "fake";
      const chips = explanation.highlights
        .slice(0, 8)
        .map((h) => {
          const pushesTowardFake = isFakeVerdict ? h.weight > 0 : h.weight < 0;
          const cls = pushesTowardFake ? "prism-chip-fake" : "prism-chip-real";
          const word = h.word || h.phrase || "";
          return `<span class="prism-chip ${cls}">${escapeHtml(word)}</span>`;
        })
        .join("");
      lines.push(`<div class="prism-tooltip-chips">${chips}</div>`);
    }

    // Anchors rule description
    if (explanation.anchor_rule) {
      lines.push(
        `<div class="prism-tooltip-row">` +
          `<span class="prism-tip-key">Anchor rule:</span> ` +
          `<span class="prism-tip-val">${escapeHtml(String(explanation.anchor_rule))}</span>` +
          `</div>`
      );
    }

    // Modality breakdown
    if (explanation.modality_scores) {
      const { text, image, video } = explanation.modality_scores;
      const parts = [];
      if (text != null) parts.push(`Text: ${fmtConfidence(text)}`);
      if (image != null) parts.push(`Image: ${fmtConfidence(image)}`);
      if (video != null) parts.push(`Video: ${fmtConfidence(video)}`);
      if (parts.length > 0) {
        lines.push(
          `<div class="prism-tooltip-row prism-tip-key">Modalities: </div>` +
            `<div class="prism-tooltip-row">${parts.join(" · ")}</div>`
        );
      }
    }
  }

  lines.push(
    `<div class="prism-tooltip-footer">Powered by PRISM · decision-support only</div>`
  );

  return lines.join("\n");
}

/**
 * Minimal HTML escaping to safely insert user-derived strings into innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// DOM injection
// ---------------------------------------------------------------------------

/**
 * Ensure the post element can be used as a positioning context.
 * Only sets `position: relative` if the element is currently `static`.
 *
 * @param {Element} el
 */
function ensureRelativePosition(el) {
  const computed = getComputedStyle(el).position;
  if (computed === "static") {
    el.style.position = "relative";
  }
}

/**
 * Remove any existing PRISM badge from the element so we can replace it.
 *
 * @param {Element} el
 */
function removeExistingBadge(el) {
  const existing = el.querySelector("[data-prism-badge]");
  if (existing) existing.remove();
}

/**
 * Create the full badge DOM node (wrapper + label + tooltip).
 *
 * @param {string}  labelClass   "fake" | "real" | "unknown" | "scanning"
 * @param {string}  badgeText    Short text shown on the badge (e.g. "FAKE 87%").
 * @param {string}  tooltipHtml  Inner HTML for the tooltip body.
 * @returns {Element}            The badge wrapper element.
 */
function buildBadgeElement(labelClass, badgeText, tooltipHtml) {
  const wrapper = document.createElement("div");
  wrapper.className = `prism-badge prism-badge-${labelClass}`;
  wrapper.setAttribute(PRISM_ATTR, "true");

  // Main badge pill
  const pill = document.createElement("span");
  pill.className = "prism-badge-pill";
  pill.innerHTML =
    `<span class="prism-badge-icon"></span>` +
    `<span class="prism-badge-text">${escapeHtml(badgeText)}</span>`;

  // Tooltip panel (shown on hover via CSS)
  const tooltip = document.createElement("div");
  tooltip.className = "prism-tooltip";
  tooltip.innerHTML = tooltipHtml;

  wrapper.appendChild(pill);
  wrapper.appendChild(tooltip);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach a "Scanning…" placeholder badge to a post element.
 * This is replaced by the real verdict when the API responds.
 *
 * @param {Element} postEl  Post root element.
 * @param {string}  postId  Stable post ID (used for later lookup).
 */
function setScanning(postEl, postId) {
  if (!postEl) return;
  ensureRelativePosition(postEl);
  removeExistingBadge(postEl);

  const badge = buildBadgeElement(
    "scanning",
    "PRISM …",
    `<div class="prism-tooltip-row">Scanning post…</div>`
  );
  badge.dataset.prismPostId = postId;

  postEl.appendChild(badge);
}

/**
 * Replace (or create) the verdict badge on a post element.
 * Must be idempotent — calling it twice on the same element replaces the old badge.
 *
 * @param {Element} element  Post root element.
 * @param {Object}  verdict  Shared verdict schema: { label, confidence, explanation }.
 */
function createVerdictOverlay(element, verdict) {
  if (!element) return;

  ensureRelativePosition(element);
  removeExistingBadge(element);

  const cls = labelToClass(verdict.label);
  const pct = fmtConfidence(verdict.confidence);

  const badgeText =
    cls === "unknown"
      ? "PRISM"
      : `${verdict.label.toUpperCase()} ${pct}`;

  const tooltipHtml = buildTooltipContent(verdict);
  const badge = buildBadgeElement(cls, badgeText, tooltipHtml);

  element.appendChild(badge);
}

// ---------------------------------------------------------------------------
// Expose on window for scanner.js and main.js
// ---------------------------------------------------------------------------

window.prismOverlay = { createVerdictOverlay, setScanning };
