/**
 * PRISM — Content Script: DOM Scanner
 *
 * Watches the social media feed using a MutationObserver.
 * Extracts text and images from posts, assigns each a stable ID,
 * and dispatches scan requests to the service worker.
 *
 * Supported platforms:
 *   - Facebook  (facebook.com)
 *   - TikTok    (tiktok.com)
 *   - X/Twitter (twitter.com, x.com)
 *
 * This module exports:
 *   - initScanner()          — Start observing the feed.
 *   - stopScanner()          — Stop and clean up.
 */

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const PLATFORM = (() => {
  const host = location.hostname;
  if (host.includes("facebook.com")) return "facebook";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
  return "unknown";
})();

// ---------------------------------------------------------------------------
// Per-platform post selectors
//
// Each entry describes:
//   rootSelector   — the outermost element that represents one social post
//   textSelectors  — ordered list of CSS selectors tried in sequence for caption text
//   imageSelectors — CSS selectors for <img> elements carrying post images
//
// Selectors are chosen to be as stable as possible against minor DOM reshuffles.
// ---------------------------------------------------------------------------

const PLATFORM_CONFIG = {
  facebook: {
    // Only target feed units — NOT Messenger chat, NOT groups sidebar.
    // data-pagelet="FeedUnit_N" is Facebook's stable feed post identifier, BUT
    // it is frequently absent on the modern feed. Resilient fallback:
    // div[role="article"] scoped to WITHIN div[role="feed"] so it does not match
    // Messenger threads or sidebar articles. The EXCLUDED_REGIONS guard in
    // processPost remains the second line of defence against chat/sidebar.
    rootSelector: [
      '[data-pagelet^="FeedUnit"]',
      'div[role="feed"] div[role="article"]',
    ].join(", "),
    textSelectors: [
      '[data-ad-preview="message"]',
      "[data-testid='post_message']",
      "div[dir='auto'] > span",
    ],
    imageSelectors: [
      "img[src*='fbcdn.net']",
    ],
  },

  tiktok: {
    rootSelector: [
      "div[class*='DivItemContainer']",
      "div[data-e2e='recommend-list-item-container']",
      "div[class*='VideoFeed'] > div",
      "article",
    ].join(", "),
    textSelectors: [
      "span[class*='SpanText']",
      "[data-e2e='browse-video-desc']",
      "[class*='video-meta-caption']",
      "h1[class*='H1ShareTitle']",
    ],
    imageSelectors: [
      "img[src*='tiktokcdn.com']",
      "img[src*='tiktok.com']",
    ],
  },

  twitter: {
    rootSelector: 'article[data-testid="tweet"]',
    textSelectors: [
      '[data-testid="tweetText"]',
      "div[lang] > span",
    ],
    imageSelectors: [
      'img[src*="pbs.twimg.com/media"]',
      'img[src*="twimg.com"]',
    ],
  },

  unknown: {
    rootSelector: "article",
    textSelectors: ["p", "span", "div"],
    imageSelectors: ["img"],
  },
};

const config = PLATFORM_CONFIG[PLATFORM] || PLATFORM_CONFIG.unknown;

// Dev-mode flag: unpacked extensions have no update_url in their manifest.
// Used to surface selector breakage (0 posts on a known platform) without
// spamming the console for end users.
const DEV_MODE = (() => {
  try {
    return !("update_url" in chrome.runtime.getManifest());
  } catch (_) {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 32-bit FNV-1a hash of a string, returned as 8-char hex.
 *
 * Chosen deliberately over crypto.subtle: this runs in the content-script hot
 * path (every observed post) and must be SYNCHRONOUS — async hashing would race
 * the "already-scanned" guard and re-dispatch posts. FNV-1a is fast, allocation
 * free, and collision-resistant enough for de-duplicating feed posts.
 *
 * @param {string} str  Input string.
 * @returns {string}    8-char lowercase hex digest.
 */
function fnv1aHash(str) {
  let hash = 0x811c9dc5; // FNV offset basis (2166136261)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay within int32 math.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit, then hex-pad.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Derive a STABLE, content-based post ID from the post's text + first image URL.
 *
 * Virtualized feeds (TikTok, X, modern FB) detach and re-add the same post as
 * the user scrolls. An incrementing counter would mint a fresh ID each time,
 * causing re-dispatch and dropping cached verdicts. Hashing the content means a
 * re-added post resolves to the SAME id and can reattach its cached verdict.
 *
 * @param {Element} el  Post root element.
 * @returns {string}    Stable content-derived post ID string.
 */
function getOrAssignPostId(el) {
  if (!el.dataset.prismId) {
    const text = extractText(el);
    const firstImage = extractImageUrls(el)[0] || "";
    const fingerprint = `${PLATFORM}|${text}|${firstImage}`;
    el.dataset.prismId = `prism-${PLATFORM}-${fnv1aHash(fingerprint)}`;
  }
  return el.dataset.prismId;
}

/**
 * Extract the text caption from a post element.
 * Iterates textSelectors in priority order.
 *
 * @param {Element} root  Post root element.
 * @returns {string}      Trimmed text, or empty string if none found.
 */
function extractText(root) {
  for (const selector of config.textSelectors) {
    const el = root.querySelector(selector);
    if (el && el.innerText && el.innerText.trim().length > 0) {
      return el.innerText.trim();
    }
  }

  // Fallback: walk all text nodes within the post up to a character limit.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  let node;
  while ((node = walker.nextNode())) {
    const t = node.nodeValue.trim();
    if (t) parts.push(t);
    if (parts.join(" ").length > 2000) break;
  }
  return parts.join(" ").slice(0, 2000);
}

/**
 * Extract image source URLs from a post element.
 * Filters out tracker pixels (< 10 px) and data URIs.
 *
 * @param {Element} root  Post root element.
 * @returns {string[]}    Array of absolute image URLs (max 3).
 */
function extractImageUrls(root) {
  const urls = [];
  for (const selector of config.imageSelectors) {
    const images = root.querySelectorAll(selector);
    for (const img of images) {
      const src = img.src || img.getAttribute("src") || "";
      if (
        src &&
        !src.startsWith("data:")
      ) {
        urls.push(src);
        if (urls.length >= 3) return urls;
      }
    }
  }
  return urls;
}

/**
 * Determine whether this post has enough content to bother scanning.
 * Avoids wasting API calls on empty stubs or ads with no body.
 *
 * @param {string}   text      Extracted caption.
 * @param {string[]} imageUrls Extracted image URLs.
 * @returns {boolean}
 */
function hasScanableContent(text, imageUrls) {
  return text.length > 20 || imageUrls.length > 0;
}

// ---------------------------------------------------------------------------
// Post processing
// ---------------------------------------------------------------------------

/**
 * Identify all post root elements currently visible in the document.
 *
 * @returns {Element[]}
 */
function findAllPosts() {
  return Array.from(document.querySelectorAll(config.rootSelector));
}

/**
 * Process a single post element:
 *   1. Assign a post ID.
 *   2. Skip if already dispatched.
 *   3. Extract payload.
 *   4. Mark as pending and send to service worker.
 *
 * @param {Element} postEl  Post root element.
 */
// CSS selectors for UI regions that should never be scanned
const EXCLUDED_REGIONS = [
  '[role="complementary"]',   // right sidebar (ads, suggestions)
  '[aria-label="Chats"]',     // Messenger chat panel
  '[data-pagelet="MercuryThreadlist"]',
  '[data-pagelet^="ChatTab"]',
].join(", ");

function processPost(postEl) {
  // Skip already-processed posts.
  if (postEl.dataset.prismScanned === "true") return;

  // Skip anything inside the Messenger chat panel or sidebar.
  if (postEl.closest(EXCLUDED_REGIONS)) return;

  const postId = getOrAssignPostId(postEl);
  const text = extractText(postEl);
  const imageUrls = extractImageUrls(postEl);

  if (!hasScanableContent(text, imageUrls)) return;

  const payload = {
    platform: PLATFORM,
    text: text || null,
    image_urls: imageUrls.length > 0 ? imageUrls : null,
  };

  // Guard: if the extension was reloaded mid-session the runtime context is
  // invalidated. Detect this early and stop rather than throw an uncaught error.
  try {
    if (!chrome.runtime?.id) return;
  } catch (_) {
    stopScanner();
    return;
  }

  // Attach a "scanning" placeholder overlay while we wait.
  if (typeof window.prismOverlay !== "undefined") {
    window.prismOverlay.setScanning(postEl, postId);
  }

  // Mark immediately to prevent duplicate dispatches from rapid observer fires.
  // If sendMessage fails, reset the flag so the post can be retried.
  postEl.dataset.prismScanned = "true";

  chrome.runtime.sendMessage({
    type: "PRISM_SCAN_POST",
    postId,
    payload,
  }).catch((err) => {
    if (err.message?.includes("Extension context invalidated")) {
      stopScanner();
      return;
    }
    console.warn("[PRISM] sendMessage failed for post", postId, err.message);
    postEl.dataset.prismScanned = "false";
  });
}

// ---------------------------------------------------------------------------
// MutationObserver
// ---------------------------------------------------------------------------

let observer = null;

/**
 * Callback invoked when DOM mutations are detected.
 * Scans newly added subtrees for post root elements.
 *
 * @param {MutationRecord[]} mutations
 */
function onMutation(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      // The added node itself might be a post root.
      if (node.matches && node.matches(config.rootSelector)) {
        processPost(node);
      }

      // Or it might contain post roots as descendants.
      const descendants = node.querySelectorAll
        ? node.querySelectorAll(config.rootSelector)
        : [];
      for (const descendant of descendants) {
        processPost(descendant);
      }
    }
  }
}

/**
 * Start the scanner.
 * Processes all posts already in the DOM, then watches for new ones.
 */
function initScanner() {
  if (observer) return; // Already running.

  console.log(`[PRISM Scanner] Platform detected: ${PLATFORM}`);

  // Process all posts already visible on load.
  const initial = findAllPosts();
  console.log(`[PRISM Scanner] Initial posts found: ${initial.length}`);

  // Surface selector breakage: a known platform yielding 0 posts almost always
  // means the site changed its DOM and our rootSelector needs updating.
  if (DEV_MODE && PLATFORM !== "unknown" && initial.length === 0) {
    console.warn(
      `[PRISM Scanner] 0 initial posts on "${PLATFORM}" — selectors may be ` +
        `stale. rootSelector="${config.rootSelector}". The MutationObserver ` +
        `will still pick up posts as they render.`
    );
  }

  initial.forEach(processPost);

  // Watch for new posts added by infinite scroll / SPA navigation.
  observer = new MutationObserver(onMutation);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log("[PRISM Scanner] MutationObserver active.");
}

/**
 * Stop the scanner and disconnect the observer.
 */
function stopScanner() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log("[PRISM Scanner] Stopped.");
  }
}

// Expose on window so main.js can call initScanner / stopScanner.
window.prismScanner = { initScanner, stopScanner };
