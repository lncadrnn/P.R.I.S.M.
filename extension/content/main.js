/**
 * PRISM — Content Script Entry Point
 *
 * Execution order (guaranteed by manifest "js" array order):
 *   1. ui/overlay.js   — registers window.prismOverlay
 *   2. content/scanner.js — registers window.prismScanner
 *   3. content/main.js (this file) — wires everything together
 *
 * Responsibilities:
 *   - Verify dependencies loaded correctly.
 *   - Start the DOM scanner.
 *   - Listen for PRISM_VERDICT messages from the service worker.
 *   - Map incoming verdicts back to their post elements and render the overlay.
 *   - Handle SPA navigation (History API pushState/replaceState) to restart
 *     the scanner when the feed URL changes without a full page reload.
 */

// ---------------------------------------------------------------------------
// Dependency guard
// ---------------------------------------------------------------------------

(function initPRISM() {
  "use strict";

  if (typeof window.prismOverlay === "undefined") {
    console.error(
      "[PRISM] overlay.js did not load — badge rendering will not work."
    );
  }

  if (typeof window.prismScanner === "undefined") {
    console.error(
      "[PRISM] scanner.js did not load — post detection will not work."
    );
    return;
  }

  const { createVerdictOverlay } = window.prismOverlay;
  const { initScanner, stopScanner } = window.prismScanner;

  // ---------------------------------------------------------------------------
  // Verdict → DOM lookup
  //
  // When a verdict arrives we need to find the post element that matches
  // the postId.  The scanner stamped each element with data-prism-id.
  // ---------------------------------------------------------------------------

  /**
   * Find the post element that owns a given postId.
   *
   * @param {string} postId
   * @returns {Element|null}
   */
  function findPostElement(postId) {
    return document.querySelector(`[data-prism-id="${postId}"]`) || null;
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  /**
   * Handle PRISM_VERDICT messages forwarded by the service worker.
   *
   * @param {Object} message
   */
  function onMessage(message) {
    if (message.type !== "PRISM_VERDICT") return;

    const { postId, verdict } = message;

    if (!postId || !verdict) {
      console.warn("[PRISM] Received malformed PRISM_VERDICT message:", message);
      return;
    }

    const postEl = findPostElement(postId);
    if (!postEl) {
      // The post may have been scrolled out of the DOM (virtualised list).
      // This is expected on TikTok and Twitter — silently ignore.
      return;
    }

    // Render the verdict badge, replacing the scanning placeholder.
    createVerdictOverlay(postEl, verdict);
  }

  chrome.runtime.onMessage.addListener(onMessage);

  // ---------------------------------------------------------------------------
  // SPA navigation support
  //
  // Facebook, TikTok, and X are single-page apps.  When the user navigates
  // (e.g. FB feed → profile → back to feed) the DOM is rebuilt but the
  // content script is NOT re-injected.  We patch history methods and listen
  // for popstate to restart the scanner when the URL changes.
  // ---------------------------------------------------------------------------

  let currentUrl = location.href;

  function handleNavigation() {
    const newUrl = location.href;
    if (newUrl !== currentUrl) {
      currentUrl = newUrl;
      console.log("[PRISM] SPA navigation detected, restarting scanner.");
      stopScanner();
      // Give the SPA a short moment to paint the new feed before we observe.
      setTimeout(() => initScanner(), 800);
    }
  }

  // Patch pushState / replaceState — these fire no native events.
  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _pushState(...args);
    handleNavigation();
  };

  history.replaceState = function (...args) {
    _replaceState(...args);
    handleNavigation();
  };

  // popstate fires for browser back/forward.
  window.addEventListener("popstate", handleNavigation);

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  console.log("[PRISM] Content script initialised.");
  initScanner();
})();
