/**
 * PRISM — Manifest V3 Service Worker
 *
 * Responsibilities:
 *  - Receive SCAN_POST messages from content scripts
 *  - Deduplicate requests using a SHA-256 hash of post content
 *  - Call the PRISM FastAPI backend at http://127.0.0.1:8000/scan
 *  - Cache results in chrome.storage.session (cleared on browser restart)
 *  - Forward verdicts back to the originating tab via chrome.tabs.sendMessage
 */

// Default backend target. Overridable at runtime via chrome.storage.local
// under the key "prismApiBase" (e.g. to point at a LAN dev box). The scan
// endpoint is always derived as `${base}/scan/extension`.
const DEFAULT_API_BASE = "http://127.0.0.1:8000";

/**
 * Resolve the scan endpoint, honouring a chrome.storage.local override.
 *
 * @returns {Promise<string>} Fully-qualified /scan/extension URL.
 */
async function getScanEndpoint() {
  let base = DEFAULT_API_BASE;
  try {
    const { prismApiBase } = await chrome.storage.local.get("prismApiBase");
    if (typeof prismApiBase === "string" && prismApiBase.trim()) {
      base = prismApiBase.trim().replace(/\/+$/, ""); // strip trailing slashes
    }
  } catch (_) {
    // storage unavailable — fall back to default.
  }
  return `${base}/scan/extension`;
}

// In-memory deduplication map: hash -> Promise<verdict>
// This prevents concurrent duplicate requests for the same post within a session.
const inFlight = new Map();

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a short hex fingerprint of the post payload so we can cache/dedupe.
 * Uses the Web Crypto API, which is available in MV3 service workers.
 *
 * @param {Object} payload  The post payload sent to the API.
 * @returns {Promise<string>} Hex string (first 16 bytes of SHA-256).
 */
async function hashPayload(payload) {
  const text = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Cache helpers (chrome.storage.session)
// ---------------------------------------------------------------------------

/**
 * Retrieve a cached verdict from session storage.
 *
 * @param {string} key  Hash key.
 * @returns {Promise<Object|null>} Cached verdict or null.
 */
async function getCached(key) {
  return new Promise((resolve) => {
    chrome.storage.session.get(`prism_${key}`, (result) => {
      const value = result[`prism_${key}`];
      resolve(value !== undefined ? value : null);
    });
  });
}

/**
 * Store a verdict in session storage.
 *
 * @param {string} key     Hash key.
 * @param {Object} verdict Verdict object to cache.
 * @returns {Promise<void>}
 */
async function setCached(key, verdict) {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [`prism_${key}`]: verdict }, resolve);
  });
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * POST payload to /scan and return the structured verdict.
 * Handles network errors gracefully — returns a null-verdict on failure.
 *
 * @param {Object} payload  { text?, image_urls?, platform }
 * @returns {Promise<Object>} Verdict matching the shared schema.
 */
async function callPrismAPI(payload) {
  try {
    const endpoint = await getScanEndpoint();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `[PRISM] API responded with status ${response.status} for payload:`,
        payload
      );
      return buildErrorVerdict(`API error: HTTP ${response.status}`);
    }

    const verdict = await response.json();
    return verdict;
  } catch (error) {
    console.warn("[PRISM] API call failed:", error.message);
    return buildErrorVerdict(`Network error: ${error.message}`);
  }
}

/**
 * Build a placeholder verdict when the API is unreachable.
 *
 * @param {string} reason  Human-readable reason.
 * @returns {Object} Verdict-shaped error object.
 */
function buildErrorVerdict(reason) {
  return {
    label: "unknown",
    confidence: 0,
    modules: { text: null, image: null, video: null },
    explanation: {
      error: reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Main scan handler
// ---------------------------------------------------------------------------

/**
 * Handle a SCAN_POST message from a content script.
 * Uses the cache and in-flight map to avoid redundant API calls.
 *
 * @param {Object} message   { type, payload, postId }
 * @param {Object} sender    Message sender (contains tab info).
 * @returns {Promise<Object>} Verdict to send back.
 */
async function handleScanPost(message, sender) {
  const { payload, postId } = message;

  // Compute a stable key for this post's content.
  const key = await hashPayload(payload);

  // 1. Check session cache first.
  const cached = await getCached(key);
  if (cached) {
    return { verdict: cached, postId, fromCache: true };
  }

  // 2. Check if an identical request is already in-flight.
  if (inFlight.has(key)) {
    const verdict = await inFlight.get(key);
    return { verdict, postId, fromCache: false };
  }

  // 3. Issue a new request.
  const requestPromise = callPrismAPI(payload);
  inFlight.set(key, requestPromise);

  try {
    const verdict = await requestPromise;
    await setCached(key, verdict);
    return { verdict, postId, fromCache: false };
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "PRISM_SCAN_POST") {
    return false; // Let other handlers process unrecognised messages.
  }

  if (!sender.tab || !sender.tab.id) {
    console.warn("[PRISM] Received message from unknown sender — ignoring.");
    return false;
  }

  const tabId = sender.tab.id;

  // Single delivery path: verdicts are ALWAYS broadcast to the originating tab
  // via chrome.tabs.sendMessage, keyed by postId. The content script's
  // PRISM_VERDICT listener (main.js) maps postId → element and renders. We do
  // not use sendResponse — the request/response channel is dead weight here.
  handleScanPost(message, sender)
    .then((result) => {
      chrome.tabs.sendMessage(tabId, {
        type: "PRISM_VERDICT",
        postId: result.postId,
        verdict: result.verdict,
        fromCache: result.fromCache,
      });
    })
    .catch((err) => {
      console.error("[PRISM] Unexpected error in handleScanPost:", err);
      chrome.tabs.sendMessage(tabId, {
        type: "PRISM_VERDICT",
        postId: message.postId,
        verdict: buildErrorVerdict(err.message),
        fromCache: false,
      });
    });

  // Return false: we are not using sendResponse, so there is no need to keep
  // the message channel open.
  return false;
});

// ---------------------------------------------------------------------------
// Startup log
// ---------------------------------------------------------------------------

getScanEndpoint().then((endpoint) =>
  console.log("[PRISM] Service worker started. API target:", endpoint)
);
