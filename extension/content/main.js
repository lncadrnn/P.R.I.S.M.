/**
 * PRISM — Content Script Entry Point (content-script global).
 *
 * Loaded LAST in the manifest `js` array. Wires the pieces that the earlier
 * modules registered:
 *   1. lib/verdict.js     → window.prismVerdict
 *   2. ui/badge.js        → window.prismBadge
 *   3. ui/sidebar.js      → window.prismSidebar
 *   4. content/scanner.js → window.prismScanner
 *   5. content/main.js    (this file)
 *
 * RESPONSIBILITIES
 *   - Guard that the dependencies actually loaded.
 *   - Listen for PRISM_VERDICT broadcasts from the service worker, map the
 *     postId back to its element, and render the final badge. If the element
 *     scrolled out of a virtualized feed, silently ignore.
 *   - Start the scanner and restart it on real SPA navigations (Facebook /
 *     TikTok / X rebuild the feed without re-injecting the content script).
 * ===========================================================================
 */

(function initPRISM() {
  "use strict";

  // -------------------------------------------------------------------------
  // Dependency guard
  // -------------------------------------------------------------------------

  if (!window.prismVerdict) {
    // eslint-disable-next-line no-console
    console.warn("[PRISM] verdict.js did not load — verdict parsing may fail.");
  }
  if (!window.prismBadge) {
    // eslint-disable-next-line no-console
    console.warn("[PRISM] badge.js did not load — badges will not render.");
  }
  if (!window.prismScanner) {
    // eslint-disable-next-line no-console
    console.error("[PRISM] scanner.js did not load — post detection disabled.");
    return; // Nothing to wire without the scanner.
  }

  const initScanner = window.prismScanner.initScanner;
  const stopScanner = window.prismScanner.stopScanner;

  // -------------------------------------------------------------------------
  // Verdict → DOM mapping
  // -------------------------------------------------------------------------

  /** Locate the post element the scanner stamped with this postId. */
  function findPostElement(postId) {
    if (!postId) return null;
    try {
      // postId is our own FNV-derived token (prism-<platform>-<hex>) — safe to
      // interpolate into a selector.
      return document.querySelector('[data-prism-id="' + postId + '"]');
    } catch (_) {
      return null;
    }
  }

  /** Handle a PRISM_VERDICT broadcast forwarded by the service worker. */
  function onMessage(message) {
    if (!message || message.type !== "PRISM_VERDICT") return;

    const postId = message.postId;
    const verdict = message.verdict;
    if (!postId || !verdict) return;

    const postEl = findPostElement(postId);
    if (!postEl) {
      // The post scrolled out of a virtualized list (expected on TikTok / X).
      // The verdict is cached in the service worker, so a re-attached post
      // with the same content-id will get it back. Nothing to do here.
      return;
    }

    try {
      if (window.prismBadge && typeof window.prismBadge.render === "function") {
        window.prismBadge.render(postEl, verdict, postId);
      }
    } catch (_) {
      // A render failure must never bubble into the host page.
    }
  }

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch (_) {
    // Runtime gone immediately (extension reloaded) — bail out quietly.
    return;
  }

  // -------------------------------------------------------------------------
  // SPA navigation handling
  //
  // We track ONLY location.pathname. These SPAs mutate query string + hash
  // constantly (scroll state, modals, story rails) without rebuilding the
  // feed; restarting on those would be wasteful and would drop in-flight
  // scans. A genuine feed swap (feed → profile → feed) always changes the
  // path. The TikTok scanner additionally handles in-place video changes via
  // its own IntersectionObserver, so a path change is the right trigger here
  // for all supported platforms.
  // -------------------------------------------------------------------------

  let currentPath = location.pathname;
  let navDebounce = null;
  let restartTimer = null;

  function restartScanner() {
    clearTimeout(restartTimer);
    stopScanner();
    // Give the SPA a beat to paint the new feed before re-observing.
    restartTimer = setTimeout(function () {
      try {
        initScanner();
      } catch (_) {
        /* runtime gone — ignore */
      }
    }, 800);
  }

  function handleNavigation() {
    clearTimeout(navDebounce);
    // A single user navigation can fire pushState + replaceState + popstate in
    // quick succession; debounce so we restart at most once.
    navDebounce = setTimeout(function () {
      const newPath = location.pathname;
      if (newPath !== currentPath) {
        currentPath = newPath;
        restartScanner();
      }
    }, 300);
  }

  // pushState / replaceState fire no native event — patch them. Bind to the
  // original implementations so we don't break the host app's routing.
  try {
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function () {
      const r = _push.apply(history, arguments);
      handleNavigation();
      return r;
    };
    history.replaceState = function () {
      const r = _replace.apply(history, arguments);
      handleNavigation();
      return r;
    };
    window.addEventListener("popstate", handleNavigation);
  } catch (_) {
    // If history patching fails the MutationObserver still covers most cases.
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  try {
    initScanner();
  } catch (_) {
    /* runtime gone — ignore */
  }
})();
