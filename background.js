/*
 * MV3 service worker.
 *
 * All network calls go through here rather than directly from the content
 * script. Since Chrome 85 content scripts inherit the *page's* origin for
 * CORS purposes, so a fetch fired from walmart.com would be judged as a
 * cross-origin request from walmart.com to pricewatchpro.com and blocked
 * unless the server opts in. Fetches from the service worker are covered by
 * the extension's host_permissions instead, which is the supported path and
 * keeps working even if server CORS headers change.
 */

const PWP_API_BASE = "https://www.pricewatchpro.com/api/extension";

/** In-memory response cache. Cleared whenever the worker is torn down, which is fine —
 *  it exists to stop repeat lookups while a user tabs around one product. */
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function lookup(seller, itemId) {
  const key = `${seller}:${itemId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  const url = `${PWP_API_BASE}/${encodeURIComponent(seller)}/lookup?itemId=${encodeURIComponent(itemId)}`;

  let res;
  try {
    res = await fetch(url, { method: "GET", credentials: "omit" });
  } catch (networkError) {
    // A thrown fetch (rather than a non-2xx response) means the request never
    // completed: DNS, TLS, offline, or the request being blocked before it
    // reached the server. Distinguishing this from an HTTP error matters —
    // they have completely different fixes.
    throw new Error(`Network error reaching ${url} — ${networkError.message}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (parseError) {
    // A 200 that isn't JSON usually means something in front of the app
    // (Cloudflare, a proxy, an error page) answered instead of the endpoint.
    throw new Error(`Response from ${url} was not JSON — ${parseError.message}`);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Asks the site to start tracking a product it does not have yet. The server
 * fetches it from the retailer's API and stores it, then returns the same
 * shape as a lookup.
 *
 * Deliberately not cached here: the whole point of the call is to change
 * server state, and the caller re-renders from the response.
 */
async function track(seller, itemId) {
  const url = `${PWP_API_BASE}/${encodeURIComponent(seller)}/track?itemId=${encodeURIComponent(itemId)}`;
  let res;
  try {
    res = await fetch(url, { method: "POST", credentials: "omit" });
  } catch (networkError) {
    throw new Error(`Network error reaching ${url} — ${networkError.message}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  const data = await res.json();
  // Replace any cached "not tracked" answer so the panel does not revert.
  cache.set(`${seller}:${itemId}`, { at: Date.now(), data });
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "PWP_LOOKUP") {
    lookup(message.seller, message.itemId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true; // keeps the message channel open for the async response
  }

  if (message.type === "PWP_TRACK") {
    track(message.seller, message.itemId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  return false;
});
