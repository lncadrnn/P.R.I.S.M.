/**
 * PRISM — Manifest V3 Service Worker (background, module type).
 *
 * RESPONSIBILITIES
 *   - Receive PRISM_SCAN_POST messages from the content scripts.
 *   - Deduplicate + cache: key each request by a SHA-256 (crypto.subtle) of its
 *     payload. Verdicts are cached in chrome.storage.session (cleared on
 *     browser restart). Concurrent identical requests are coalesced via an
 *     in-flight Map so we hit the backend at most once per distinct payload.
 *   - POST to the PRISM backend `${base}/scan/extension`, where `base` defaults
 *     to http://127.0.0.1:8000 and is overridable via chrome.storage.local key
 *     `prismApiBase`.
 *   - Broadcast the fused verdict back to the ORIGINATING TAB via
 *     chrome.tabs.sendMessage({type:"PRISM_VERDICT", postId, verdict,
 *     fromCache}). We do NOT use sendResponse — delivery is one-way, keyed by
 *     postId, and main.js maps postId → element.
 *   - Network / HTTP failures degrade to a graceful error verdict (label
 *     "unknown") rather than throwing — the badge renders a muted "PRISM ⚠".
 * ===========================================================================
 */

// Default backend target. Overridable at runtime via chrome.storage.local
// under "prismApiBase" (e.g. to point at a LAN dev box). The scan endpoint is
// always derived as `${base}/scan/extension`.
const DEFAULT_API_BASE = "http://127.0.0.1:8000";

// In-memory coalescing map: cacheKey -> Promise<verdict>. Prevents concurrent
// duplicate backend calls for the same payload within a worker lifetime.
const inFlight = new Map();

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the scan endpoint, honouring a chrome.storage.local override.
 *
 * @returns {Promise<string>} Fully-qualified `${base}/scan/extension` URL.
 */
async function getScanEndpoint() {
  let base = DEFAULT_API_BASE;
  try {
    const { prismApiBase } = await chrome.storage.local.get("prismApiBase");
    if (typeof prismApiBase === "string" && prismApiBase.trim()) {
      base = prismApiBase.trim().replace(/\/+$/, ""); // strip trailing slashes
    }
  } catch (_) {
    // storage unavailable — fall back to the default.
  }
  return base + "/scan/extension";
}

// ---------------------------------------------------------------------------
// Hashing — SHA-256 of the payload, available in MV3 service workers.
// ---------------------------------------------------------------------------

/**
 * Compute a stable hex cache key for a payload. We hash the canonical fields
 * (text + image_urls + platform) so identical content maps to one key.
 *
 * @param {Object} payload  { text, image_urls, platform }
 * @returns {Promise<string>} 32-char hex (first 16 bytes of SHA-256).
 */
async function hashPayload(payload) {
  const text = JSON.stringify({
    text: payload && payload.text != null ? payload.text : null,
    image_urls: payload && payload.image_urls ? payload.image_urls : null,
    platform: payload && payload.platform ? payload.platform : null,
  });
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes
    .slice(0, 16)
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Session cache (chrome.storage.session — service-worker-restart safe)
// ---------------------------------------------------------------------------

/** Retrieve a cached verdict, or null. */
async function getCached(key) {
  const storageKey = "prism_" + key;
  try {
    const result = await chrome.storage.session.get(storageKey);
    const value = result[storageKey];
    return value !== undefined ? value : null;
  } catch (_) {
    return null;
  }
}

/** Store a verdict in the session cache. Best-effort. */
async function setCached(key, verdict) {
  const storageKey = "prism_" + key;
  try {
    await chrome.storage.session.set({ [storageKey]: verdict });
  } catch (_) {
    // Cache write failures are non-fatal — the verdict was still delivered.
  }
}

// ---------------------------------------------------------------------------
// Backend call
// ---------------------------------------------------------------------------

/**
 * Build a schema-shaped error verdict for network / HTTP failures. Matches the
 * fused ScanResponse so the badge / sidebar render it as a muted error state.
 *
 * @param {string} reason  Human-readable error string.
 * @returns {Object}
 */
function buildErrorVerdict(reason) {
  return {
    label: "unknown",
    confidence: 0,
    modules: { text: null, image: null, video: null },
    explanation: { error: reason },
  };
}

/**
 * POST the payload to /scan/extension and return the fused verdict. Never
 * throws — network and non-2xx responses resolve to an error verdict.
 *
 * @param {Object} payload  { text, image_urls, platform }
 * @returns {Promise<Object>} Fused ScanResponse (or an error verdict).
 */
async function callPrismAPI(payload) {
  let endpoint;
  try {
    endpoint = await getScanEndpoint();
  } catch (err) {
    return buildErrorVerdict("Could not resolve API endpoint.");
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return buildErrorVerdict("API error: HTTP " + response.status);
    }

    const verdict = await response.json();
    // Defensive: a malformed body still resolves to a usable error verdict.
    if (!verdict || typeof verdict !== "object") {
      return buildErrorVerdict("API returned a malformed response.");
    }
    return verdict;
  } catch (error) {
    const msg = (error && error.message) || "unreachable";
    return buildErrorVerdict("Network error: " + msg);
  }
}

// ---------------------------------------------------------------------------
// Scan handler — cache → coalesce → fetch
// ---------------------------------------------------------------------------

/**
 * Resolve a verdict for a scan request, using the session cache first, then
 * coalescing concurrent identical requests, then issuing one backend call.
 *
 * @param {Object} message  { type, postId, payload }
 * @returns {Promise<{verdict:Object, postId:string, fromCache:boolean}>}
 */
async function handleScanPost(message) {
  const payload = message.payload;
  const postId = message.postId;

  let key;
  try {
    key = await hashPayload(payload);
  } catch (_) {
    // If hashing somehow fails, fall back to a one-off uncached call.
    const verdict = await callPrismAPI(payload);
    return { verdict: verdict, postId: postId, fromCache: false };
  }

  // 1. Session cache.
  const cached = await getCached(key);
  if (cached) {
    return { verdict: cached, postId: postId, fromCache: true };
  }

  // 2. Coalesce with any identical in-flight request.
  if (inFlight.has(key)) {
    const verdict = await inFlight.get(key);
    return { verdict: verdict, postId: postId, fromCache: false };
  }

  // 3. Issue a fresh request; register it for coalescing.
  const requestPromise = callPrismAPI(payload);
  inFlight.set(key, requestPromise);
  try {
    const verdict = await requestPromise;
    // Only cache real scans, never the transient error verdicts (so a failed
    // post retries instead of being pinned to an error).
    if (!(verdict && verdict.explanation && verdict.explanation.error)) {
      await setCached(key, verdict);
    }
    return { verdict: verdict, postId: postId, fromCache: false };
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!message || message.type !== "PRISM_SCAN_POST") {
    return false; // not ours — let other handlers run
  }
  if (!sender || !sender.tab || sender.tab.id == null) {
    // Without an originating tab there is nowhere to broadcast the verdict.
    return false;
  }

  const tabId = sender.tab.id;

  // Single delivery path: ALWAYS broadcast via chrome.tabs.sendMessage keyed by
  // postId. main.js maps postId → element and renders. sendResponse is unused.
  handleScanPost(message)
    .then(function (result) {
      chrome.tabs
        .sendMessage(tabId, {
          type: "PRISM_VERDICT",
          postId: result.postId,
          verdict: result.verdict,
          fromCache: result.fromCache,
        })
        .catch(function () {
          // Tab closed / navigated away before delivery — nothing to do.
        });
    })
    .catch(function (err) {
      const msg = (err && err.message) || "internal error";
      chrome.tabs
        .sendMessage(tabId, {
          type: "PRISM_VERDICT",
          postId: message.postId,
          verdict: buildErrorVerdict(msg),
          fromCache: false,
        })
        .catch(function () {
          /* tab gone — ignore */
        });
    });

  // We do not use sendResponse, so we do not keep the channel open.
  return false;
});
