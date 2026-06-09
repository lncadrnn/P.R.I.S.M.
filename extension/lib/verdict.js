/**
 * PRISM — Shared verdict contract & helpers (content-script global).
 *
 * Loaded FIRST in the manifest `js` array. Registers `window.prismVerdict`.
 * Every other content-script module (badge.js, sidebar.js, scanner.js,
 * main.js) depends on the API defined here. Do not change a signature without
 * updating those callers.
 *
 * ---------------------------------------------------------------------------
 * The backend `/scan/extension` endpoint returns a fused ScanResponse:
 *
 *   {
 *     label: "fake" | "real" | "unknown",      // fused, top-level
 *     confidence: 0..1,                          // fused P(fake)
 *     modules: {
 *       text:  VerdictResponse | null,           // CREDIBILITY axis
 *       image: VerdictResponse | null,           // AUTHENTICITY axis (AI img)
 *       video: VerdictResponse | null,           // AUTHENTICITY axis (deepfake)
 *     },
 *     explanation: { fusion_score, modules_used, weights_applied, error? }
 *   }
 *
 * where each VerdictResponse is:
 *   { label, confidence, explanation: {...} }   // confidence = P(fake) = P(AI)
 *
 * PRISM presents TWO independent axes in the UI:
 *
 *   1. CREDIBILITY  — is the CLAIM true? (Real news vs disinformation)
 *                     Source: modules.text. confidence = P(fake).
 *   2. AUTHENTICITY — is the MEDIA real? (Human-made vs AI-generated/deepfake)
 *                     Source: modules.image (poster/photo) or modules.video.
 *                     confidence = P(AI-generated).
 *
 * These are orthogonal: a real photo can carry a false claim, and an AI image
 * can illustrate a true one. The badge shows both; absent axes are hidden.
 * ===========================================================================
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Design tokens — single source of truth for both badge.js and sidebar.js.
  // Mirrored in badge.css / sidebar.css as CSS custom properties on the
  // widget roots. Keep the two in sync.
  // -------------------------------------------------------------------------
  const TOKENS = {
    // Credibility (claim truthfulness)
    fake: "#e5484d",     // red    — non-credible / disinformation
    real: "#30a46c",     // green  — credible / validated
    // Authenticity (media provenance)
    ai: "#8e4ec6",       // purple — AI-generated / synthetic / deepfake
    human: "#0091ff",    // blue   — human-made / camera-authentic
    // States
    unknown: "#7a7d85",  // gray   — inconclusive / not analysed
    scanning: "#9aa0ab", // dim    — pending
    // Surfaces (dark forensic theme, matches prism_logo.png)
    bg: "#0d1b24",
    bgPanel: "#11242f",
    bgRaised: "#163140",
    border: "#23404f",
    text: "#e7eef2",
    textDim: "#9fb3bd",
    accent: "#3fb6c9",   // PRISM teal
  };

  // -------------------------------------------------------------------------
  // String / number helpers
  // -------------------------------------------------------------------------

  /** Minimal HTML escaping for safe innerHTML insertion of derived strings. */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Format a 0..1 score as an integer percentage string ("94%"). */
  function fmtPct(x) {
    if (typeof x !== "number" || isNaN(x)) return "—";
    return `${Math.round(x * 100)}%`;
  }

  // -------------------------------------------------------------------------
  // Axis derivation — the core contract consumed by the UI.
  // -------------------------------------------------------------------------

  /**
   * @typedef {Object} Axis
   * @property {boolean} present   Was this axis actually analysed?
   * @property {string}  kind      "credibility" | "authenticity"
   * @property {string}  state     credibility: "fake"|"real"|"unknown"
   *                               authenticity: "ai"|"human"|"unknown"
   * @property {string}  label     Display word: "FAKE"|"REAL"|"AI"|"HUMAN"
   * @property {number}  confidence  Probability backing `label`, 0..1.
   *                               (P(fake) for fake/REAL flips; P(AI) for AI/HUMAN)
   * @property {string}  pct        confidence as "94%"
   * @property {string}  color      Token color for this state.
   * @property {Object}  module     Raw VerdictResponse this came from (or null).
   */

  /**
   * Build the credibility axis from modules.text.
   * confidence on the module = P(fake). When the verdict is REAL we surface the
   * probability of REAL (1 - P(fake)) so the % always backs the shown label.
   */
  function buildCredibility(textModule) {
    if (!textModule || !["real", "fake"].includes((textModule.label || "").toLowerCase())) {
      return {
        present: false, kind: "credibility", state: "unknown",
        label: "UNKNOWN", confidence: 0, pct: "—",
        color: TOKENS.unknown, module: textModule || null,
      };
    }
    const isFake = textModule.label.toLowerCase() === "fake";
    const pFake = Number(textModule.confidence) || 0;
    const backing = isFake ? pFake : 1 - pFake;
    return {
      present: true,
      kind: "credibility",
      state: isFake ? "fake" : "real",
      label: isFake ? "FAKE" : "REAL",
      confidence: backing,
      pct: fmtPct(backing),
      color: isFake ? TOKENS.fake : TOKENS.real,
      module: textModule,
    };
  }

  /**
   * Build the authenticity axis. Prefers the video module (deepfake) when
   * present, else the image module (AI image / poster frame).
   * Module label "fake" === AI-generated; "real" === human/camera.
   * confidence = P(AI-generated).
   */
  function buildAuthenticity(imageModule, videoModule) {
    const mod = videoModule || imageModule || null;
    if (!mod || !["real", "fake"].includes((mod.label || "").toLowerCase())) {
      return {
        present: false, kind: "authenticity", state: "unknown",
        label: "UNKNOWN", confidence: 0, pct: "—",
        color: TOKENS.unknown, module: mod,
        source: videoModule ? "video" : imageModule ? "image" : null,
      };
    }
    const isAI = mod.label.toLowerCase() === "fake";
    const pAI = Number(mod.confidence) || 0;
    const backing = isAI ? pAI : 1 - pAI;
    return {
      present: true,
      kind: "authenticity",
      state: isAI ? "ai" : "human",
      label: isAI ? "AI" : "HUMAN",
      confidence: backing,
      pct: fmtPct(backing),
      color: isAI ? TOKENS.ai : TOKENS.human,
      module: mod,
      source: videoModule ? "video" : "image",
    };
  }

  /**
   * Derive the two display axes plus an overall summary from a fused verdict.
   *
   * @param {Object} verdict  Fused ScanResponse from /scan/extension.
   * @returns {{
   *   credibility: Axis,
   *   authenticity: Axis,
   *   overall: { state:string, label:string, pct:string, confidence:number },
   *   error: string|null,
   *   raw: Object,
   * }}
   */
  function deriveAxes(verdict) {
    const v = verdict || {};
    const modules = v.modules || {};
    const credibility = buildCredibility(modules.text);
    const authenticity = buildAuthenticity(modules.image, modules.video);

    const topError =
      (v.explanation && v.explanation.error) ||
      (modules.text && modules.text.explanation && modules.text.explanation.error) ||
      null;

    // Overall = the fused top-level call, used for the gauge headline.
    const fusedLabel = (v.label || "unknown").toLowerCase();
    const fusedConf = Number(v.confidence) || 0;
    let overall;
    if (fusedLabel === "fake") {
      overall = { state: "fake", label: "FAKE & NON-CREDIBLE", pct: fmtPct(fusedConf), confidence: fusedConf };
    } else if (fusedLabel === "real") {
      overall = { state: "real", label: "LIKELY CREDIBLE", pct: fmtPct(1 - fusedConf), confidence: 1 - fusedConf };
    } else {
      overall = { state: "unknown", label: "INCONCLUSIVE", pct: "—", confidence: 0 };
    }

    return { credibility, authenticity, overall, error: topError, raw: v };
  }

  /** Pull the wire-ready source links list (may be empty / absent). */
  function getSources(verdict) {
    const v = verdict || {};
    const fromTop = v.explanation && Array.isArray(v.explanation.sources) ? v.explanation.sources : null;
    const t = (v.modules && v.modules.text && v.modules.text.explanation) || {};
    const fromText = Array.isArray(t.sources) ? t.sources : null;
    return fromTop || fromText || [];
  }

  /** True when the verdict is a network/loading error rather than a real scan. */
  function isErrorVerdict(verdict) {
    const v = verdict || {};
    return (v.label === "unknown") && !!(v.explanation && v.explanation.error);
  }

  window.prismVerdict = {
    TOKENS,
    escapeHtml,
    fmtPct,
    deriveAxes,
    getSources,
    isErrorVerdict,
  };
})();
