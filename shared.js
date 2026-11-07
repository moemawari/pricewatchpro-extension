/*
 * Shared helpers used by both the content script and the popup.
 *
 * Loaded as a plain script (not a module) because MV3 content scripts
 * cannot use ES module imports without extra bundling, and this project
 * deliberately has no build step — the folder can be loaded straight into
 * Chrome via "Load unpacked".
 */

const PWP_BASE = "https://www.pricewatchpro.com";

/**
 * Works out which retailer a URL belongs to and pulls the retailer's own
 * item id out of it. That id — not our internal product id — is what the
 * lookup API keys on, because it is the only identifier visible on the
 * page the user is standing on.
 *
 * URL shapes handled:
 *   walmart.com/ip/<slug>/<itemId>      and  /ip/<itemId>
 *   bestbuy.com/site/<slug>/<sku>.p     and  /product/<slug>/<sku>
 *   homedepot.com/p/<slug>/<storeSku>
 */
function pwpParseProductUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  if (host.endsWith("walmart.com")) {
    // The item id is the last all-digit segment of the path. Walmart puts
    // the slug before it, and sometimes omits the slug entirely.
    const digits = path.split("/").filter((s) => /^\d{4,}$/.test(s));
    if (digits.length) {
      return { seller: "walmart", itemId: digits[digits.length - 1] };
    }
    return null;
  }

  if (host.endsWith("bestbuy.com")) {
    // /site/<slug>/<sku>.p  -> sku is the digits before ".p"
    const dotP = path.match(/\/(\d{5,})\.p/);
    if (dotP) {
      return { seller: "bestbuy", itemId: dotP[1] };
    }
    // Newer /product/<slug>/<alphanumeric> pages expose the SKU in a query
    // param or in the page itself; fall back to any long digit run.
    const skuParam = url.searchParams.get("skuId");
    if (skuParam && /^\d{5,}$/.test(skuParam)) {
      return { seller: "bestbuy", itemId: skuParam };
    }
    const digits = path.split("/").filter((s) => /^\d{5,}$/.test(s));
    if (digits.length) {
      return { seller: "bestbuy", itemId: digits[digits.length - 1] };
    }
    return null;
  }

  if (host.endsWith("homedepot.com")) {
    // /p/<slug>/<storeSku> — the store SKU is the trailing digit run.
    const digits = path.split("/").filter((s) => /^\d{6,}$/.test(s));
    if (digits.length) {
      return { seller: "homedepot", itemId: digits[digits.length - 1] };
    }
    return null;
  }

  return null;
}

/** Formats a number as USD without pulling in a formatting library. */
function pwpMoney(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return "$" + n.toFixed(2);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pwpParseProductUrl, pwpMoney, PWP_BASE };
}
