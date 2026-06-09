/**
 * PRISM — Content Script: DOM Scanner (content-script global).
 *
 * Loaded FOURTH in the manifest `js` array (after lib/verdict.js, ui/badge.js,
 * ui/sidebar.js). Registers `window.prismScanner = { initScanner, stopScanner }`.
 *
 * ---------------------------------------------------------------------------
 * RESPONSIBILITY
 *   Find social-media "posts" in the live DOM, extract their analysable
 *   content (caption text + image / video-poster URLs), assign each a STABLE
 *   content-derived id, paint a "scanning…" placeholder badge, and dispatch a
 *   PRISM_SCAN_POST message to the service worker. main.js receives the
 *   PRISM_VERDICT broadcast and renders the final badge.
 *
 * DESIGN NOTES (carried over from the prior, retired scanner — the ARCHITECTURE
 * was sound, the SELECTORS were stale and have been re-derived here):
 *   - MutationObserver on document.body for infinite scroll.
 *   - Content-hash post ids (FNV-1a) so virtualized feeds that detach/reattach
 *     the same post reuse the cached verdict instead of re-dispatching.
 *   - A `data-prism-scanned` guard prevents duplicate dispatch from rapid
 *     observer fires; it is reset on dispatch failure so the post can retry.
 *   - SPA navigation (history pushState/replaceState/popstate) restarts the
 *     scanner on real pathname changes.
 *   - "Extension context invalidated" (extension reloaded) is detected via the
 *     absence of `chrome.runtime?.id` and the scanner stops cleanly.
 *
 * NEW vs. the retired version:
 *   - Hardened, re-derived per-platform selectors.
 *   - VIDEO posts (TikTok, FB Reels, X video) send the poster/thumbnail image
 *     URL in `image_urls` (the backend image module scans it as the
 *     AI-authenticity proxy) plus the caption as `text`.
 *   - TikTok scans the SINGLE most-visible video only (IntersectionObserver),
 *     re-badging as the user scrolls — not every off-screen feed item.
 *   - Caption is stashed into `el.dataset.prismText` for badge.js / sidebar.js.
 * ===========================================================================
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Platform detection
  // -------------------------------------------------------------------------

  const PLATFORM = (function () {
    const host = location.hostname;
    if (host.indexOf("facebook.com") !== -1) return "facebook";
    if (host.indexOf("tiktok.com") !== -1) return "tiktok";
    if (host.indexOf("twitter.com") !== -1 || host.indexOf("x.com") !== -1) return "twitter";
    return "unknown";
  })();

  // Dev-mode flag: unpacked extensions have no `update_url` in their manifest.
  // Used to surface selector breakage (0 posts on a known platform) without
  // spamming end users' consoles.
  const DEV_MODE = (function () {
    try {
      return !("update_url" in chrome.runtime.getManifest());
    } catch (_) {
      return false;
    }
  })();

  // Minimum caption length (chars) to treat a text-only post as scanable.
  const MIN_TEXT_LEN = 15;
  // Images smaller than this (rendered px, either dimension) are treated as
  // avatars / reaction glyphs / tracker pixels and ignored.
  const MIN_IMAGE_PX = 40;
  // Hard cap on image URLs we forward (the backend also caps at 3).
  const MAX_IMAGE_URLS = 3;

  // -------------------------------------------------------------------------
  // Per-platform configuration
  //
  //   rootSelector   — outermost element representing ONE post (comma-joined).
  //   textSelectors  — ordered caption selectors; first non-trivial hit wins,
  //                    with a longest-meaningful-text-node fallback.
  //   imageSelectors — <img> selectors carrying real post media.
  //   excluded       — ancestors that disqualify a candidate (chat, sidebar…).
  //
  // Selectors deliberately favour semantic / data-* attributes over generated
  // class names, which churn constantly on these SPAs.
  // -------------------------------------------------------------------------

  const PLATFORM_CONFIG = {
    facebook: {
      // Feed posts live inside div[role="feed"] as role="article"; the legacy
      // FeedUnit pagelet is matched when present. The `excluded` ancestors
      // below are the real defence against Messenger / sidebar / composer.
      rootSelector: [
        'div[role="feed"] div[role="article"]',
        '[data-pagelet^="FeedUnit"]',
      ].join(", "),
      textSelectors: [
        '[data-ad-preview="message"]',
        '[data-testid="post_message"]',
        'div[dir="auto"]',
      ],
      imageSelectors: ['img[src*="fbcdn.net"]'],
      excluded: [
        '[role="complementary"]',              // right sidebar (ads, suggestions)
        '[role="banner"]',                       // top nav
        '[aria-label="Chats"]',                  // Messenger dock
        '[data-pagelet="MercuryThreadlist"]',    // Messenger thread list
        '[data-pagelet^="ChatTab"]',             // open chat tabs
        '[aria-label="Stories"]',                // story rail
        '[role="dialog"] [contenteditable]',     // composer dialog
        'form[method="POST"]',                   // composer
      ].join(", "),
    },

    tiktok: {
      // One "post" is a video player container. We do NOT badge every feed
      // item — IntersectionObserver picks the single most-visible one (see
      // the TikTok active-video machinery below). These selectors are used to
      // (a) collect candidate containers and (b) find the player/poster.
      rootSelector: [
        'div[data-e2e="recommend-list-item-container"]',
        'div[class*="DivItemContainer"]',
        'div[class*="DivVideoFeed"] > div',
        "article",
      ].join(", "),
      textSelectors: [
        '[data-e2e="browse-video-desc"]',
        '[data-e2e="video-desc"]',
        'h1[class*="ShareTitle"]',
        'span[class*="SpanText"]',
      ],
      imageSelectors: [
        'img[src*="tiktokcdn"]',
        'img[src*="tiktok.com"]',
      ],
      excluded: [
        '[data-e2e="comment-list"]',
        '[class*="DivCommentListContainer"]',
        '[class*="DivSidebar"]',
      ].join(", "),
    },

    twitter: {
      rootSelector: 'article[data-testid="tweet"]',
      textSelectors: ['[data-testid="tweetText"]', "div[lang]"],
      imageSelectors: ['img[src*="pbs.twimg.com/media"]'],
      excluded: [
        '[data-testid="sidebarColumn"]',         // right sidebar
        '[aria-label="Timeline: Trending now"]',
      ].join(", "),
    },

    unknown: {
      rootSelector: "article",
      textSelectors: ["p", "span", "div"],
      imageSelectors: ["img"],
      excluded: "",
    },
  };

  const config = PLATFORM_CONFIG[PLATFORM] || PLATFORM_CONFIG.unknown;

  // -------------------------------------------------------------------------
  // Runtime-context guard
  // -------------------------------------------------------------------------

  /**
   * True while the extension runtime is still valid. After the extension is
   * reloaded/updated the injected script keeps running but `chrome.runtime.id`
   * disappears and every API call throws "Extension context invalidated".
   */
  function runtimeAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Hashing — fast SYNCHRONOUS FNV-1a (32-bit) → 8-char hex.
  //
  // Deliberately not crypto.subtle: this runs in the hot path for every
  // observed post and MUST be synchronous, or the async gap would race the
  // `data-prism-scanned` guard and re-dispatch the same post. FNV-1a is fast,
  // allocation-free, and collision-resistant enough to de-dupe feed posts.
  // -------------------------------------------------------------------------

  function fnv1aHash(str) {
    let hash = 0x811c9dc5; // FNV offset basis (2166136261)
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime, 32-bit safe via imul
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  // -------------------------------------------------------------------------
  // Content extraction
  // -------------------------------------------------------------------------

  /**
   * Extract the caption text from a post element. Tries the platform's ordered
   * selectors first; for the broad `div[dir="auto"]` family it scans ALL
   * matches and keeps the LONGEST meaningful one (the real caption, not a
   * one-word menu/label). Falls back to a bounded text-node walk.
   *
   * @param {Element} root  Post root element.
   * @returns {string}      Trimmed caption, or "".
   */
  function extractText(root) {
    if (!root || !root.querySelectorAll) return "";

    let best = "";
    for (let i = 0; i < config.textSelectors.length; i++) {
      const selector = config.textSelectors[i];
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        // Ignore text that lives inside our own injected badge.
        if (el.closest && el.closest("[data-prism-badge]")) continue;
        const txt = (el.innerText || el.textContent || "").trim();
        if (txt.length > best.length) best = txt;
      }
      // For a precise, high-confidence selector (the first ones) a single hit
      // is enough; only keep scanning the generic ones for the longest text.
      if (best && i === 0 && selector.indexOf("dir=") === -1) break;
    }
    if (best) return best.slice(0, 4000);

    // Fallback: bounded text-node walk over the post subtree.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || "").trim();
      if (t) parts.push(t);
      if (parts.join(" ").length > 2000) break;
    }
    return parts.join(" ").slice(0, 2000);
  }

  /**
   * Is this <img> a real post image (vs. an avatar / emoji / reaction glyph)?
   * Rejects data URIs and anything rendered below MIN_IMAGE_PX in either axis.
   * Falls back to the natural / attribute dimensions when layout size is 0
   * (lazy-loaded or off-screen images report 0 client size).
   */
  function isMeaningfulImage(img) {
    const src = img.src || img.getAttribute("src") || "";
    if (!src || src.indexOf("data:") === 0) return false;

    let w = img.clientWidth || img.naturalWidth || 0;
    let h = img.clientHeight || img.naturalHeight || 0;
    if (!w) w = parseInt(img.getAttribute("width") || "0", 10) || 0;
    if (!h) h = parseInt(img.getAttribute("height") || "0", 10) || 0;

    // If we genuinely cannot measure it, give it the benefit of the doubt
    // (lazy images), but still drop obvious avatar URLs.
    if (w && w < MIN_IMAGE_PX) return false;
    if (h && h < MIN_IMAGE_PX) return false;
    return true;
  }

  /**
   * Collect post image URLs (max MAX_IMAGE_URLS), de-duplicated, skipping
   * avatars / emoji / tracker pixels.
   *
   * @param {Element} root  Post root element.
   * @returns {string[]}
   */
  function extractImageUrls(root) {
    if (!root || !root.querySelectorAll) return [];
    const urls = [];
    const seen = Object.create(null);
    for (let i = 0; i < config.imageSelectors.length; i++) {
      let images;
      try {
        images = root.querySelectorAll(config.imageSelectors[i]);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < images.length; j++) {
        const img = images[j];
        if (!isMeaningfulImage(img)) continue;
        const src = img.src || img.getAttribute("src") || "";
        if (seen[src]) continue;
        seen[src] = true;
        urls.push(src);
        if (urls.length >= MAX_IMAGE_URLS) return urls;
      }
    }
    return urls;
  }

  /**
   * Extract the poster / thumbnail URL for a VIDEO post. For the backend this
   * stands in as the AI-authenticity proxy frame. Order:
   *   1. <video poster="…">
   *   2. a meaningful cover <img> (platform image selectors / generic)
   *
   * @param {Element} root  Post root element.
   * @returns {string|null}
   */
  function extractPosterUrl(root) {
    if (!root || !root.querySelector) return null;

    const video = root.querySelector("video[poster]");
    if (video) {
      const poster = video.getAttribute("poster");
      if (poster && poster.indexOf("data:") !== 0) return poster;
    }

    // Cover image fallback — platform selectors first, then any sizable img.
    const fromConfig = extractImageUrls(root);
    if (fromConfig.length) return fromConfig[0];

    const imgs = root.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      if (isMeaningfulImage(imgs[i])) {
        return imgs[i].src || imgs[i].getAttribute("src");
      }
    }
    return null;
  }

  /** Does this post element contain a <video> (i.e. is it a video post)? */
  function isVideoPost(root) {
    return !!(root && root.querySelector && root.querySelector("video"));
  }

  /**
   * Enough content to justify a scan? Skip empty stubs / link cards with no
   * body. Scanable when the caption clears MIN_TEXT_LEN OR there is any media.
   */
  function hasScanableContent(text, mediaUrls) {
    return (text && text.length >= MIN_TEXT_LEN) || (mediaUrls && mediaUrls.length > 0);
  }

  // -------------------------------------------------------------------------
  // Post identity
  // -------------------------------------------------------------------------

  /**
   * Assign (once) and return a STABLE content-derived id for a post element.
   * Fingerprint = `platform|caption|firstMediaUrl`, hashed with FNV-1a. A
   * re-attached virtualized post resolves to the SAME id, letting the service
   * worker serve the cached verdict instead of re-dispatching.
   *
   * @param {Element} el          Post root element.
   * @param {string}  text        Already-extracted caption (avoids re-walk).
   * @param {string}  firstMedia  First image / poster URL (or "").
   * @returns {string}            Stable post id.
   */
  function getOrAssignPostId(el, text, firstMedia) {
    if (el.dataset.prismId) return el.dataset.prismId;
    const fingerprint = PLATFORM + "|" + (text || "") + "|" + (firstMedia || "");
    el.dataset.prismId = "prism-" + PLATFORM + "-" + fnv1aHash(fingerprint);
    return el.dataset.prismId;
  }

  /**
   * Resolve WHICH element the badge should anchor to. Content (caption, media)
   * is always read from the post container, but on TikTok the post container is
   * the full-width feed COLUMN — anchoring the badge there puts it in the
   * screen's top-right corner. We instead anchor to the <video> player box so
   * the badge sits on the video's top-right. Other platforms badge the post
   * element itself.
   *
   * @param {Element} postEl  Post container the scanner found.
   * @returns {Element}       Element to stamp the id on and attach the badge to.
   */
  function resolveBadgeAnchor(postEl) {
    if (PLATFORM !== "tiktok" || !postEl || !postEl.querySelector) return postEl;
    let video = null;
    try { video = postEl.querySelector("video"); } catch (_) { video = null; }
    if (!video) return postEl;
    const wrapper = video.parentElement;
    return (wrapper && wrapper.nodeType === 1 && wrapper !== postEl) ? wrapper : postEl;
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  /**
   * Process ONE post element end-to-end: extract → guard → placeholder badge →
   * dispatch to the service worker. Idempotent via the `data-prism-scanned`
   * guard. On dispatch failure the guard is reset so a later observer pass can
   * retry the same element.
   *
   * @param {Element} postEl  Post root element.
   */
  function processPost(postEl) {
    if (!postEl || postEl.nodeType !== 1) return;

    // Never scan our own injected widgets.
    if (postEl.hasAttribute && postEl.hasAttribute("data-prism-badge")) return;

    // Already dispatched in this lifecycle.
    if (postEl.dataset.prismScanned === "true") return;

    // Disqualify candidates inside excluded regions (chat, sidebar, composer…).
    if (config.excluded && postEl.closest && postEl.closest(config.excluded)) return;

    const isVideo = isVideoPost(postEl);
    const text = extractText(postEl);

    // For video posts the poster frame is the media we forward; otherwise the
    // post's own images.
    let mediaUrls;
    if (isVideo) {
      const poster = extractPosterUrl(postEl);
      mediaUrls = poster ? [poster] : [];
    } else {
      mediaUrls = extractImageUrls(postEl);
    }

    if (!hasScanableContent(text, mediaUrls)) return;

    // Content is read from postEl, but the badge anchors to the resolved
    // element (the video player box on TikTok; postEl elsewhere). The id is
    // stamped on the anchor so main.js's verdict lookup renders in the right
    // place.
    const anchorEl = resolveBadgeAnchor(postEl);
    const postId = getOrAssignPostId(anchorEl, text, mediaUrls[0] || "");

    // Stash the caption where badge.js / sidebar.js read it (on the anchor,
    // which is the element passed to setScanning/render and the sidebar).
    anchorEl.dataset.prismText = text || "";

    const payload = {
      text: text || null,
      image_urls: mediaUrls.length ? mediaUrls : null,
      platform: PLATFORM,
    };

    // Runtime gone (extension reloaded) → stop cleanly rather than throw.
    if (!runtimeAlive()) {
      stopScanner();
      return;
    }

    // Paint the pending placeholder before we await anything.
    try {
      if (window.prismBadge && typeof window.prismBadge.setScanning === "function") {
        window.prismBadge.setScanning(anchorEl, postId, {
          hasText: !!(text && text.trim()),
          hasImage: !isVideo && mediaUrls.length > 0,
          isVideo: isVideo,
          platform: PLATFORM,
        });
      }
    } catch (_) {
      // Badge failures must never abort the scan dispatch.
    }

    // Mark BEFORE sending so rapid observer fires don't double-dispatch.
    postEl.dataset.prismScanned = "true";

    let sendResult;
    try {
      sendResult = chrome.runtime.sendMessage({
        type: "PRISM_SCAN_POST",
        postId: postId,
        payload: payload,
      });
    } catch (err) {
      // Synchronous throw → context invalidated.
      postEl.dataset.prismScanned = "false";
      stopScanner();
      return;
    }

    // sendMessage returns a Promise in MV3; reset the guard on failure.
    if (sendResult && typeof sendResult.catch === "function") {
      sendResult.catch(function (err) {
        const msg = (err && err.message) || "";
        if (msg.indexOf("Extension context invalidated") !== -1) {
          stopScanner();
          return;
        }
        postEl.dataset.prismScanned = "false";
      });
    }
  }

  // -------------------------------------------------------------------------
  // Feed discovery
  // -------------------------------------------------------------------------

  /** All post-root candidates currently in the document. */
  function findAllPosts() {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(config.rootSelector));
    } catch (_) {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // TikTok: active-video tracking
  //
  // On the FYP only ONE video is meaningfully on screen at a time, and the feed
  // is virtualized + the "current" video changes on scroll WITHOUT a full
  // navigation. We therefore do NOT badge every feed item; instead an
  // IntersectionObserver tracks how visible each candidate container is and we
  // (re)scan the single most-visible one, debounced, as it settles into view.
  // -------------------------------------------------------------------------

  let ttIo = null;                 // IntersectionObserver
  const ttRatios = new Map();      // element -> last intersectionRatio
  const ttObserved = new WeakSet();// elements already handed to the IO
  let ttActive = null;             // currently-badged active element
  let ttSettleTimer = null;

  /** Pick the most-visible observed TikTok container above a visibility floor. */
  function ttPickMostVisible() {
    let bestEl = null;
    let bestRatio = 0;
    ttRatios.forEach(function (ratio, el) {
      if (!el.isConnected) return;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestEl = el;
      }
    });
    // Require it to be at least half on-screen to count as "the" active video.
    return bestRatio >= 0.5 ? bestEl : null;
  }

  /** Debounced reaction to viewport changes — scan the new active video once. */
  function ttOnVisibilityChange() {
    clearTimeout(ttSettleTimer);
    ttSettleTimer = setTimeout(function () {
      const active = ttPickMostVisible();
      if (!active || active === ttActive) return;
      // Switching to a new active video: clear the previous badge so only ONE
      // shows at a time, and reset its guard so it can re-badge (from cache)
      // if the user scrolls back to it.
      if (ttActive && ttActive.isConnected) {
        try {
          if (window.prismBadge && typeof window.prismBadge.remove === "function") {
            window.prismBadge.remove(resolveBadgeAnchor(ttActive));
          }
        } catch (_) { /* ignore */ }
        ttActive.dataset.prismScanned = "false";
      }
      ttActive = active;
      // The active container is the post to scan; the badge anchors to its
      // nested <video> player box (see resolveBadgeAnchor).
      processPost(active);
    }, 250);
  }

  /** Register any not-yet-observed TikTok candidates with the IO. */
  function ttRegisterCandidates() {
    if (!ttIo) return;
    const posts = findAllPosts();
    for (let i = 0; i < posts.length; i++) {
      const el = posts[i];
      if (ttObserved.has(el)) continue;
      ttObserved.add(el);
      try {
        ttIo.observe(el);
      } catch (_) {
        /* detached node — ignore */
      }
    }
  }

  function ttInit() {
    if (ttIo) return;
    ttIo = new IntersectionObserver(
      function (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.isIntersecting || e.intersectionRatio > 0) {
            ttRatios.set(e.target, e.intersectionRatio);
          } else {
            ttRatios.delete(e.target);
          }
        }
        ttOnVisibilityChange();
      },
      // Multiple thresholds → smooth ratio updates as a video scrolls in/out.
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    ttRegisterCandidates();
  }

  function ttTeardown() {
    if (ttIo) {
      ttIo.disconnect();
      ttIo = null;
    }
    ttRatios.clear();
    ttActive = null;
    clearTimeout(ttSettleTimer);
    ttSettleTimer = null;
  }

  // -------------------------------------------------------------------------
  // MutationObserver — infinite scroll / late-rendered posts
  // -------------------------------------------------------------------------

  let observer = null;

  function onMutation(mutations) {
    if (!runtimeAlive()) {
      stopScanner();
      return;
    }

    // On TikTok we don't scan per-mutation; we only register new candidates
    // with the IntersectionObserver, which decides what is "active".
    if (PLATFORM === "tiktok") {
      ttRegisterCandidates();
      return;
    }

    for (let m = 0; m < mutations.length; m++) {
      const added = mutations[m].addedNodes;
      for (let n = 0; n < added.length; n++) {
        const node = added[n];
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches(config.rootSelector)) {
          processPost(node);
        }
        if (node.querySelectorAll) {
          let descendants;
          try {
            descendants = node.querySelectorAll(config.rootSelector);
          } catch (_) {
            continue;
          }
          for (let d = 0; d < descendants.length; d++) {
            processPost(descendants[d]);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start scanning. Processes posts already in the DOM, wires the
   * MutationObserver, and (TikTok) the IntersectionObserver. Idempotent — a
   * second call while running is a no-op.
   */
  function initScanner() {
    if (observer) return;
    if (PLATFORM === "unknown") return; // not a target site

    if (PLATFORM === "tiktok") {
      ttInit();
      // ttInit registers candidates; the IO callback drives the first scan.
    } else {
      const initial = findAllPosts();
      if (DEV_MODE && initial.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          '[PRISM] 0 initial posts on "' + PLATFORM + '" — selectors may be ' +
            'stale (rootSelector="' + config.rootSelector + '"). The ' +
            "MutationObserver will still pick up posts as they render."
        );
      }
      for (let i = 0; i < initial.length; i++) processPost(initial[i]);
    }

    observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Stop scanning and release every observer / timer. Idempotent. */
  function stopScanner() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (PLATFORM === "tiktok") ttTeardown();
  }

  window.prismScanner = {
    initScanner: initScanner,
    stopScanner: stopScanner,
  };
})();
