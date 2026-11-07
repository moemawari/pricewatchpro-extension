/*
 * Toolbar popup. Serves two purposes:
 *  1. A fallback when the injected panel is dismissed or fails to render
 *     (retailer CSP, a redesign, an ad blocker interfering).
 *  2. The place users look first after installing, so it also has to explain
 *     itself when the current tab is not a supported product page.
 */

function render(html) {
  document.getElementById("content").innerHTML = html;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showUnsupported() {
  render(
    '<p class="muted">Open a product page on Walmart, Best Buy or Home Depot to see its price history.</p>' +
      '<a class="cta" href="https://www.pricewatchpro.com" target="_blank" rel="noopener">Browse deals on PriceWatchPro</a>'
  );
}

function showResult(data) {
  if (!data || !data.tracked) {
    render(
      '<p class="muted">We\'re not tracking this item yet. Search PriceWatchPro to start a price history for it.</p>' +
        '<a class="cta" href="https://www.pricewatchpro.com" target="_blank" rel="noopener">Open PriceWatchPro</a>'
    );
    return;
  }

  const summary = data.summary
    ? `<p class="summary">${escapeHtml(data.summary)}</p>`
    : "";

  render(
    `<p class="name">${escapeHtml(data.name)}</p>
     <div class="row">
       <div><div class="label">Current</div><div class="price">${pwpMoney(data.currentPrice)}</div></div>
       <div><div class="label">Lowest</div><div class="stat low">${pwpMoney(data.lowest)}</div></div>
       <div><div class="label">Highest</div><div class="stat high">${pwpMoney(data.highest)}</div></div>
     </div>
     ${summary}
     <a class="cta" href="${escapeHtml(data.url)}" target="_blank" rel="noopener">Full history &amp; price alerts</a>`
  );
}

function doLookup(parsed) {
  chrome.runtime.sendMessage(
    { type: "PWP_LOOKUP", seller: parsed.seller, itemId: parsed.itemId },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        const detail = response && response.error ? response.error : "";
        render(
          '<p class="muted">Could not reach PriceWatchPro just now. Please try again in a moment.</p>' +
            (detail ? `<p class="muted" style="font-size:11px;color:#adb5bd;word-break:break-all;">${escapeHtml(detail)}</p>` : "") +
            '<a class="cta" href="https://www.pricewatchpro.com" target="_blank" rel="noopener">Open PriceWatchPro</a>'
        );
        return;
      }
      showResult(response.data);
    }
  );
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) {
    showUnsupported();
    return;
  }

  const parsed = pwpParseProductUrl(tab.url);
  if (parsed && parsed.itemId) {
    doLookup(parsed);
    return;
  }

  // The URL alone did not yield an id — on Best Buy's /product/ pages the
  // numeric SKU only exists in the DOM. Ask the content script, which can
  // see it. If no content script is present (unsupported page, or it failed
  // to inject) we fall back to the generic prompt.
  chrome.tabs.sendMessage(tab.id, { type: "PWP_GET_TARGET" }, (target) => {
    if (chrome.runtime.lastError || !target || !target.itemId) {
      showUnsupported();
      return;
    }
    doLookup(target);
  });
});
