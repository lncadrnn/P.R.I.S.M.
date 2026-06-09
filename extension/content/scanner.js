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
    if (host.indexOf("threads.net") !== -1 || host.indexOf("threads.com") !== -1) return "threads";
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
      // Modern Facebook (Comet) does NOT wrap feed posts in role="article" —
      // role="article" is used for Messenger chats and other chrome. The reliable
      // marker of a real post is its CAPTION container, tagged with a Comet
      // rendering attribute. We match those markers, then walk UP to the post
      // card in processPost (resolveFacebookPost) to badge / extract / dedupe.
      // Verified via the on-page selector probe.
      rootSelector: [
        '[data-ad-rendering-role="story_message"]',
        '[data-ad-comet-preview="message"]',
        '[data-ad-preview="message"]',
        '[data-testid="post_message"]',
      ].join(", "),
      // Caption text is taken directly from the matched marker; these remain as
      // a fallback for the resolved card.
      textSelectors: [
        '[data-ad-comet-preview="message"]',
        '[data-testid="post_message"]',
        'div[dir="auto"]',
      ],
      imageSelectors: ['img[src*="fbcdn.net"]'],
      excluded: [
        '[role="complementary"]',                  // right sidebar (ads, contacts)
        '[role="banner"]',                          // top nav bar
        '[role="navigation"]',                      // left nav rail
        '[aria-label="Chats" i]',                   // Messenger dock
        '[data-pagelet="MercuryThreadlist"]',       // Messenger thread list
        '[data-pagelet^="ChatTab"]',                // open chat tabs
        '[role="dialog"][aria-label*="Create" i]',  // composer modal only
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

    threads: {
      // Threads (Meta, Instagram-built) is a text-first scroll feed much like
      // X/Twitter. Each feed post is wrapped in a `data-pressable-container`
      // (the clickable post box). Reposts/quoted posts nest a second pressable
      // container, so processPost skips nested ones (badges only the outer post).
      // Threads markup is heavily obfuscated; we lean on this stable data-attr
      // plus role="article" as a fallback, then the longest-text caption walk.
      rootSelector: [
        'div[data-pressable-container="true"]',
        'div[role="article"]',
      ].join(", "),
      textSelectors: [
        'div[data-pressable-container="true"] span[dir="auto"]',
        'span[dir="auto"]',
        'div[dir="auto"]',
      ],
      // Threads media is served from the Instagram / fbcdn CDNs.
      imageSelectors: [
        'img[src*="cdninstagram"]',
        'img[src*="fbcdn.net"]',
      ],
      excluded: [
        '[role="banner"]',                          // top bar
        '[role="navigation"]',                      // nav rail / tab bar
        '[aria-label*="Search" i]',                 // search column
        '[role="dialog"]',                          // composer / overlays
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

  // Markers that identify ONE post's caption on Facebook (Comet).
  const FB_MARKER_SELECTOR =
    '[data-ad-rendering-role="story_message"],[data-ad-comet-preview="message"],' +
    '[data-ad-preview="message"],[data-testid="post_message"]';

  // The post header's ⋯ menu button (and friends). The FULL post card is the
  // smallest single-post ancestor that contains this — its top edge is the post
  // header, so anchoring the badge there (top:8) lands it in the header row
  // consistently, instead of mid-post on the caption.
  const FB_ACTIONS_SELECTOR = '[aria-label*="Actions for" i],[aria-haspopup="menu"]';

  /**
   * Given a Facebook caption marker, walk UP to the full post CARD (header +
   * body) — the element we badge, dedupe, and read media from. We return the
   * first single-post ancestor that ALSO contains the header ⋯ button so the
   * badge aligns to the header on EVERY post. If none is found before hitting
   * the multi-post feed/column, we fall back to the last single-post ancestor.
   *
   * @param {Element} markerEl  The matched caption marker.
   * @returns {Element}         The post card (or the marker itself as fallback).
   */
  function resolveFacebookPost(markerEl) {
    let node = markerEl;
    let lastSingle = markerEl;
    for (let i = 0; i < 20 && node && node.parentElement; i++) {
      const parent = node.parentElement;
      let width = 0;
      try { width = parent.getBoundingClientRect().width; } catch (_) { width = 0; }
      let markerCount = 1;
      try { markerCount = parent.querySelectorAll(FB_MARKER_SELECTOR).length; } catch (_) { markerCount = 1; }
      const role = parent.getAttribute ? parent.getAttribute("role") : null;
      // Reached the multi-post container / page column → stop, use last good.
      if (markerCount > 1 || width > 900 || role === "main" || parent === document.body) {
        break;
      }
      node = parent;
      lastSingle = node;
      // First single-post ancestor that includes the header ⋯ button is the
      // full card (header + body). Anchor there for consistent placement.
      let hasActions = false;
      try { hasActions = !!node.querySelector(FB_ACTIONS_SELECTOR); } catch (_) { hasActions = false; }
      if (hasActions) return node;
    }
    return lastSingle || markerEl;
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
    if (!postEl || postEl.nodeType !== 1) return "skip";

    // Never scan our own injected widgets.
    if (postEl.hasAttribute && postEl.hasAttribute("data-prism-badge")) return "self";

    // On Facebook the matched element is the post's CAPTION marker; resolve the
    // surrounding post card (what we badge / dedupe / read media from). On other
    // platforms the matched element IS the post.
    let cardEl = postEl;
    let captionText = null;
    if (PLATFORM === "facebook") {
      cardEl = resolveFacebookPost(postEl) || postEl;
      captionText = ((postEl.innerText || postEl.textContent || "").replace(/\s+/g, " ")).trim();
      // Skip comments/replies (different markup, but be safe).
      if (cardEl.closest && cardEl.closest('[aria-label="Comment" i], [aria-label="Comments" i]')) {
        return "comment";
      }
    } else if (PLATFORM === "threads") {
      // A reposted / quoted Threads post nests its OWN pressable container inside
      // the outer feed post. Badge only the outermost: skip any candidate whose
      // parent already lives inside another pressable container.
      if (postEl.parentElement && postEl.parentElement.closest &&
          postEl.parentElement.closest('div[data-pressable-container="true"]')) {
        return "nested";
      }
    }

    // Already dispatched in this lifecycle (guard lives on the card).
    if (cardEl.dataset.prismScanned === "true") return "already";

    // Disqualify candidates inside excluded regions (chat, sidebar, composer…).
    if (config.excluded && cardEl.closest && cardEl.closest(config.excluded)) return "excluded";

    const isVideo = isVideoPost(cardEl);
    const text = (captionText != null && captionText.length) ? captionText : extractText(cardEl);

    // For video posts the poster frame is the media we forward; otherwise the
    // post's own images.
    let mediaUrls;
    if (isVideo) {
      const poster = extractPosterUrl(cardEl);
      mediaUrls = poster ? [poster] : [];
    } else {
      mediaUrls = extractImageUrls(cardEl);
    }

    if (!hasScanableContent(text, mediaUrls)) return "empty";

    // The badge anchors to the resolved element (the video player box on
    // TikTok; the post card on Facebook; the post element elsewhere). The id is
    // stamped on the anchor so main.js's verdict lookup renders in the right
    // place.
    const anchorEl = (PLATFORM === "tiktok") ? resolveBadgeAnchor(cardEl) : cardEl;
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
      return "dead";
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

    // Mark BEFORE sending so rapid observer fires don't double-dispatch
    // (guard lives on the card so multiple markers don't double-dispatch one post).
    cardEl.dataset.prismScanned = "true";

    if (DEV_MODE) {
      // eslint-disable-next-line no-console
      console.log("[PRISM] scanning " + PLATFORM + " post " + postId +
        " (text:" + (text ? text.length : 0) + " media:" + mediaUrls.length + ")");
    }

    let sendResult;
    try {
      sendResult = chrome.runtime.sendMessage({
        type: "PRISM_SCAN_POST",
        postId: postId,
        payload: payload,
      });
    } catch (err) {
      // Synchronous throw → context invalidated.
      cardEl.dataset.prismScanned = "false";
      stopScanner();
      return "dead";
    }

    // sendMessage returns a Promise in MV3; reset the guard on failure.
    if (sendResult && typeof sendResult.catch === "function") {
      sendResult.catch(function (err) {
        const msg = (err && err.message) || "";
        if (msg.indexOf("Extension context invalidated") !== -1) {
          stopScanner();
          return;
        }
        cardEl.dataset.prismScanned = "false";
      });
    }
    return "dispatched";
  }

  // -------------------------------------------------------------------------
  // Debounced full rescan — the resilient catch-all.
  //
  // The MutationObserver only sees NEWLY-ADDED article nodes, but Facebook (and
  // others) render an empty post shell first and fill in text/media LAZILY. By
  // the time the content arrives the shell was already seen-and-skipped, and the
  // fill adds child nodes (not articles) so the post is never retried. A
  // debounced sweep of ALL current candidates fixes this: processPost is
  // idempotent (skips already-scanned), and a post that was "empty" earlier gets
  // picked up once its content loads.
  // -------------------------------------------------------------------------

  let rescanTimer = null;
  let fbProbeRuns = 0; // limit probe logging to a few runs while stuck

  /** Run the FB selector probe a few times so the output is easy to capture. */
  function maybeProbe() {
    if (PLATFORM !== "facebook" || fbProbeRuns >= 3) return;
    fbProbeRuns++;
    try { probeFacebook(); }
    catch (e) { /* eslint-disable-next-line no-console */ console.log("[PRISM] probe error: " + (e && e.message)); }
  }

  /**
   * DEV: probe a battery of candidate selectors and report, for each, how many
   * elements match and the longest text sample among them. Reveals which
   * selector actually captures Facebook's real posts (high count + real text)
   * vs. empty decoy articles — so we can fix the rootSelector precisely.
   */
  function probeFacebook() {
    const SELECTORS = [
      'div[role="feed"]',
      'div[role="feed"] > div',
      'div[role="feed"] > div > div',
      'div[role="article"]',
      'div[role="main"]',
      'div[role="main"] [aria-posinset]',
      '[aria-posinset]',
      '[data-pagelet^="FeedUnit"]',
      '[data-pagelet]',
      'div[data-ad-comet-preview="message"]',
      '[data-ad-preview="message"]',
      '[data-ad-rendering-role="story_message"]',
    ];
    const report = {};
    for (let i = 0; i < SELECTORS.length; i++) {
      const sel = SELECTORS[i];
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch (_) { continue; }
      let best = "";
      for (let j = 0; j < nodes.length && j < 30; j++) {
        const t = ((nodes[j].innerText || nodes[j].textContent || "").replace(/\s+/g, " ")).trim();
        if (t.length > best.length) best = t;
      }
      report[sel] = { count: nodes.length, sample: best.slice(0, 70) };
    }
    // eslint-disable-next-line no-console
    console.log("[PRISM] FB selector probe:\n" + JSON.stringify(report, null, 2));
  }

  function rescanAll() {
    if (!runtimeAlive()) { stopScanner(); return; }
    const posts = findAllPosts();
    if (!DEV_MODE) {
      for (let i = 0; i < posts.length; i++) processPost(posts[i]);
      return;
    }
    const tally = {};
    for (let i = 0; i < posts.length; i++) {
      const r = processPost(posts[i]) || "skip";
      tally[r] = (tally[r] || 0) + 1;
    }
    // Log only when something actionable happened (avoid spam when everything
    // is already scanned). Surfaces WHY posts are skipped if badges never show.
    if (tally.dispatched || tally.excluded || tally.nested || tally.empty || tally.comment) {
      // JSON.stringify so the data survives copy/paste (console shows bare
      // objects as "Object" when copied as text).
      // eslint-disable-next-line no-console
      console.log("[PRISM] rescan " + PLATFORM + ": " + posts.length + " candidates → " + JSON.stringify(tally));
    }
    // If we matched candidates but dispatched no real post, probe selectors
    // (a few times) so we can see which selector actually captures the posts.
    if (!tally.dispatched) maybeProbe();
  }

  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(rescanAll, 400);
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

    // FB/X: any DOM change may have added a post OR filled an existing shell
    // with its lazy content. A debounced full rescan handles both robustly;
    // the targeted pass below still gives an immediate scan for cleanly-added
    // post nodes so freshly-rendered posts badge without waiting the debounce.
    scheduleRescan();

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
      if (DEV_MODE) {
        // eslint-disable-next-line no-console
        console.log(
          '[PRISM] init on "' + PLATFORM + '": ' + initial.length +
            ' candidate post(s) (rootSelector="' + config.rootSelector + '"). ' +
            "The MutationObserver will pick up more as they render."
        );
      }
      for (let i = 0; i < initial.length; i++) processPost(initial[i]);

      // Posts whose content loads shortly AFTER document_idle won't trigger a
      // useful mutation (the shell already exists). A couple of delayed sweeps
      // catch them, and a scroll listener catches posts that fill as they near
      // the viewport.
      setTimeout(rescanAll, 1200);
      setTimeout(rescanAll, 3000);
      window.addEventListener("scroll", scheduleRescan, true);

      // DEV: run the selector probe after the feed has had time to render, so
      // we diagnose against a populated DOM (not the initial empty shell).
      if (DEV_MODE && PLATFORM === "facebook") {
        setTimeout(maybeProbe, 3500);
        setTimeout(maybeProbe, 7000);
      }
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
    clearTimeout(rescanTimer);
    rescanTimer = null;
    try { window.removeEventListener("scroll", scheduleRescan, true); } catch (_) { /* ignore */ }
    if (PLATFORM === "tiktok") ttTeardown();
  }

  window.prismScanner = {
    initScanner: initScanner,
    stopScanner: stopScanner,
  };
})();
