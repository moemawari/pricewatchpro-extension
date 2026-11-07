#!/usr/bin/env python3
"""Build the Firefox version of the extension from the Chrome one.

    python3 build_firefox.py      ->  PriceWatchPro-firefox-<version>.zip

Same code, same files; only manifest.json differs, generated from the Chrome manifest so the two
never drift apart:
  * background: Firefox runs MV3 background code as an event page ("scripts"), not a service
    worker. background.js uses nothing service-worker-specific (fetch + chrome.runtime only).
  * browser_specific_settings.gecko: the add-on id addons.mozilla.org needs, Firefox 140+ (the
    first desktop version with Firefox's built-in data-consent screen), and
    data_collection_permissions. The extension sends the item number of the Walmart / Best Buy /
    Home Depot product page you are on to pricewatchpro.com to look up its price history, which
    is Mozilla's "browsingActivity" category. Nothing else is collected.
To try it: Firefox -> about:debugging -> This Firefox -> Load Temporary Add-on -> pick the zip.
"""

import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ["background.js", "content.js", "shared.js", "popup.html", "popup.js", "panel.css",
         "icons/icon16.png", "icons/icon48.png", "icons/icon128.png"]
GECKO_ID = "extension@pricewatchpro.com"


def firefox_manifest(chrome: dict) -> dict:
    m = json.loads(json.dumps(chrome))  # deep copy
    m["background"] = {"scripts": ["background.js"]}
    m["browser_specific_settings"] = {
        "gecko": {
            "id": GECKO_ID,
            "strict_min_version": "140.0",
            "data_collection_permissions": {"required": ["browsingActivity"]},
        }
    }
    return m


def main() -> None:
    chrome = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    manifest = firefox_manifest(chrome)
    out = HERE / f"PriceWatchPro-firefox-{chrome['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for f in FILES:
            z.write(HERE / f, f)
    print(f"wrote {out.name} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
