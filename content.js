/*
 * Injects the PriceWatchPro price-history panel into a retailer product page.
 *
 * Design notes:
 *  - The panel is appended as a fixed-position card rather than spliced into
 *    the retailer's own DOM. Retailers rewrite their markup constantly, and
 *    a selector-based insertion breaks silently every time they ship a
 *    redesign. A self-contained overlay only depends on <body> existing.
 *  - The chart is drawn as inline SVG built by hand. Pulling in Chart.js
 *    would mean bundling a library into every page load for a sparkline,
 *    and remote script loading is not allowed under MV3 anyway.
 *  - Retailers are single-page apps: the URL can change without a reload,
 *    so we watch for navigation instead of running once at load.
 */

(function () {
  const PANEL_ID = "pwp-price-panel";
  let lastKey = null;

  /**
   * Best Buy's newer /product/<slug>/<bsin> URLs carry an alphanumeric BSIN
   * (e.g. JJGHGSC4GZ), not the numeric SKU our catalogue is keyed on, and
   * their canonical tag points back at the same SKU-less URL. The numeric
   * SKU is only available from the page itself, so fall back to reading it
   * out of the DOM.
   *
   * Sources are ordered most-structured first: a parsed meta tag beats a
   * regex over markup, which is liable to pick up an unrelated number if
   * Best Buy reshuffles their templates.
   */
  function findSkuInDom() {
    // 1. Analytics payload — a real JSON object with a labelled field.
    const meta = document.querySelector('meta[name="analytics-metadata"]');
    if (meta) {
      try {
        const parsed = JSON.parse(meta.getAttribute("content") || "{}");
        const sku = parsed && parsed.product && parsed.product.skuId;
        if (/^\d{5,}$/.test(String(sku))) return String(sku);
      } catch (e) {
        /* fall through to the next source */
      }
    }

    // 2. Schema.org markup, when present.
    const itemProp = document.querySelector('meta[itemprop="sku"], [itemprop="sku"]');
    if (itemProp) {
      const val = itemProp.getAttribute("content") || itemProp.textContent || "";
      const m = val.match(/\d{5,}/);
      if (m) return m[0];
    }

    // 3. Best Buy links the Q&A form by SKU: /site/questions/submission/6671016
    const qa = document.querySelector('a[href*="/site/questions/submission/"]');
    if (qa) {
      const m = (qa.getAttribute("href") || "").match(/\/submission\/(\d{5,})/);
      if (m) return m[1];
    }

    // 4. Last resort: the "SKU: 6671016" line Best Buy renders near the title.
    //    Scoped to <head> + the first slice of body text so we are not
    //    regexing a megabyte of markup on every page view.
    const text = (document.body ? document.body.innerText.slice(0, 4000) : "");
    const m = text.match(/SKU:?\s*(\d{5,})/i);
    if (m) return m[1];

    return null;
  }

  /**
   * Resolves the retailer + item id for the current page, using the URL when
   * it carries the id and the DOM when it does not.
   */
  function resolveTarget() {
    const parsed = pwpParseProductUrl(window.location.href);
    if (parsed && parsed.itemId) return parsed;

    const host = window.location.hostname.replace(/^www\./, "");
    if (host.endsWith("bestbuy.com") && /\/product\//.test(window.location.pathname)) {
      const sku = findSkuInDom();
      if (sku) return { seller: "bestbuy", itemId: sku };
    }
    return null;
  }

  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  function buildSparkline(history) {
    if (!history || history.length < 2) return "";
    const w = 260;
    const h = 70;
    const pad = 4;
    const prices = history.map((p) => Number(p.p));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    const step = (w - pad * 2) / (history.length - 1);

    const points = prices.map((price, i) => {
      const x = pad + i * step;
      const y = h - pad - ((price - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const line = points.join(" ");
    const area = `${pad},${h - pad} ${line} ${(pad + (history.length - 1) * step).toFixed(1)},${h - pad}`;

    return `
      <svg class="pwp-spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" aria-hidden="true">
        <polygon points="${area}" fill="rgba(11,61,145,.12)"></polygon>
        <polyline points="${line}" fill="none" stroke="#0b3d91" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round"></polyline>
      </svg>`;
  }

  function renderError(message) {
    removePanel();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "pwp-panel";
    panel.innerHTML = `
      <div class="pwp-head">
        <span class="pwp-brand">PriceWatchPro</span>
        <button class="pwp-close" aria-label="Close">×</button>
      </div>
      <div class="pwp-body">
        <p class="pwp-muted">${message}</p>
        <a class="pwp-cta" href="https://www.pricewatchpro.com" target="_blank" rel="noopener">Open PriceWatchPro</a>
      </div>`;
    document.body.appendChild(panel);
    const close = panel.querySelector(".pwp-close");
    if (close) close.addEventListener("click", () => panel.remove());
  }

  function renderPanel(data, link) {
    removePanel();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "pwp-panel";

    if (!data || !data.tracked) {
      // When the seller supports on-demand tracking, offer to add the product
      // right here instead of sending the user away to search for it.
      const canTrack = data && data.trackable;
      panel.innerHTML = `
        <div class="pwp-head">
          <span class="pwp-brand">PriceWatchPro</span>
          <button class="pwp-close" aria-label="Close">×</button>
        </div>
        <div class="pwp-body">
          <p class="pwp-muted">${
            canTrack
              ? "We're not tracking this item yet. Add it and we'll start recording its price from today."
              : "We're not tracking this item yet. Search for it on PriceWatchPro to start a price history."
          }</p>
          ${
            canTrack
              ? '<button class="pwp-cta pwp-track-btn" type="button">Track this item</button>'
              : '<a class="pwp-cta" href="https://www.pricewatchpro.com" target="_blank" rel="noopener">Open PriceWatchPro</a>'
          }
        </div>`;
    } else {
      const current = Number(data.currentPrice);
      const lowest = data.lowest === null || data.lowest === undefined ? null : Number(data.lowest);
      const atLow = lowest !== null && current <= lowest + 0.005;
      const points = (data.history || []).length;

      panel.innerHTML = `
        <div class="pwp-head">
          <span class="pwp-brand">PriceWatchPro</span>
          <button class="pwp-close" aria-label="Close">×</button>
        </div>
        <div class="pwp-body">
          ${atLow ? '<div class="pwp-badge-low">At its lowest tracked price</div>' : ""}
          <div class="pwp-row">
            <div>
              <div class="pwp-label">Current</div>
              <div class="pwp-price">${pwpMoney(data.currentPrice)}</div>
            </div>
            <div>
              <div class="pwp-label">Lowest</div>
              <div class="pwp-stat pwp-low">${pwpMoney(data.lowest)}</div>
            </div>
            <div>
              <div class="pwp-label">Highest</div>
              <div class="pwp-stat pwp-high">${pwpMoney(data.highest)}</div>
            </div>
          </div>
          ${buildSparkline(data.history)}
          <div class="pwp-meta">${points} tracked price${points === 1 ? "" : "s"}</div>
          <a class="pwp-cta" href="${link}" target="_blank" rel="noopener">See full price history &amp; set an alert</a>
        </div>`;
    }

    document.body.appendChild(panel);
    const close = panel.querySelector(".pwp-close");
    if (close) close.addEventListener("click", () => panel.remove());

    const trackBtn = panel.querySelector(".pwp-track-btn");
    if (trackBtn) {
      trackBtn.addEventListener("click", () => {
        const target = resolveTarget();
        if (!target) return;
        // The retailer API call happens server-side and can take a second or
        // two, so the button reports progress rather than appearing dead.
        trackBtn.disabled = true;
        trackBtn.textContent = "Adding…";
        chrome.runtime.sendMessage(
          { type: "PWP_TRACK", seller: target.seller, itemId: target.itemId },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
              console.warn("[PriceWatchPro] Track failed:", response && response.error);
              trackBtn.disabled = false;
              trackBtn.textContent = "Try again";
              return;
            }
            if (!response.data || !response.data.tracked) {
              // The retailer's API had nothing for this SKU — say so plainly
              // rather than leaving a button that silently does nothing.
              renderError("Couldn't add this item — the retailer's API didn't return it.");
              return;
            }
            renderPanel(response.data, response.data.url || "https://www.pricewatchpro.com");
          }
        );
      });
    }
  }

  function run(attempt) {
    const parsed = resolveTarget();
    if (!parsed) {
      // Best Buy renders the SKU into the DOM after hydration, so a first
      // miss is expected rather than final. Retry a couple of times before
      // concluding this is not a product page.
      const tries = attempt || 0;
      if (tries < 3) {
        setTimeout(() => run(tries + 1), 800 * (tries + 1));
        return;
      }
      console.log("[PriceWatchPro] Not a recognised product URL:", window.location.href);
      removePanel();
      lastKey = null;
      return;
    }
    const key = `${parsed.seller}:${parsed.itemId}`;
    if (key === lastKey) return; // Same product, panel already rendered.
    lastKey = key;
    console.log("[PriceWatchPro] Looking up", key);

    chrome.runtime.sendMessage(
      { type: "PWP_LOOKUP", seller: parsed.seller, itemId: parsed.itemId },
      (response) => {
        // Failures are surfaced rather than swallowed. A silent no-op is
        // indistinguishable from "extension is broken" — which makes the
        // most common setup problem (API not deployed yet) impossible to
        // diagnose without reading the source.
        if (chrome.runtime.lastError) {
          console.warn("[PriceWatchPro] Messaging failed:", chrome.runtime.lastError.message);
          renderError("Extension could not reach its background worker. Try reloading the page.");
          return;
        }
        if (!response) {
          console.warn("[PriceWatchPro] No response from background worker.");
          renderError("No response from the extension background worker. Try reloading the page.");
          return;
        }
        if (!response.ok) {
          console.warn("[PriceWatchPro] Lookup failed:", response.error);
          const detail = String(response.error || "");
          let hint = "Couldn't reach the PriceWatchPro price API.";
          if (detail.indexOf("HTTP 404") !== -1) {
            hint = "The price API endpoint isn't live yet (404). The site needs to be redeployed with the extension endpoint.";
          } else if (detail.indexOf("Network error") !== -1) {
            hint = "Network error reaching pricewatchpro.com — the request never completed.";
          } else if (detail.indexOf("not JSON") !== -1) {
            hint = "The API replied with something other than JSON (a proxy or error page may be answering).";
          }
          // The raw detail goes in the panel too, so a problem can be reported
          // without needing to open DevTools.
          renderError(`${hint}<br><span style="font-size:11px;color:#adb5bd;word-break:break-all;">${detail}</span>`);
          return;
        }
        const data = response.data;
        console.log("[PriceWatchPro] Lookup result:", data && data.tracked ? "tracked" : "not tracked");
        const link = data && data.url ? data.url : "https://www.pricewatchpro.com";
        renderPanel(data, link);
      }
    );
  }

  // The popup only sees the tab's URL, which is not enough on Best Buy's
  // /product/ pages. Let it ask the content script, which can read the DOM.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "PWP_GET_TARGET") {
      sendResponse(resolveTarget());
    }
    return false;
  });

  // Retailer pages are SPAs: patch history methods and listen for popstate so
  // the panel follows in-page navigation instead of going stale.
  const fire = () => setTimeout(run, 400);
  ["pushState", "replaceState"].forEach((fn) => {
    const original = history[fn];
    history[fn] = function () {
      const result = original.apply(this, arguments);
      fire();
      return result;
    };
  });
  window.addEventListener("popstate", fire);

  run();
})();
