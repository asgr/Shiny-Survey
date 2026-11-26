// Cache-busting loader: fetches a manifest of asset versions, then loads
// scripts/styles with ?v= so a deploy can never mix stale and fresh files
// (GitHub Pages serves assets with max-age=600). The manifest itself is
// fetched with no-store. Bump versions in manifest.json on every deploy
// that changes assets (see README).
"use strict";

(function () {
  const scripts = JSON.parse(document.currentScript.getAttribute("data-scripts"));
  const styles = JSON.parse(document.currentScript.getAttribute("data-styles") || "[]");
  const base = "assets/";

  function loadAll(versions) {
    for (const href of styles) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = base + href + "?v=" + (versions[href] || 0);
      document.head.append(link);
    }
    // Insert all scripts at once with async=false: browsers DOWNLOAD them
    // in parallel but EXECUTE in insertion order (whatwg "ordered async").
    // A sequential await-load chain would serialize the network too.
    let failed = false;
    for (const src of scripts) {
      const s = document.createElement("script");
      s.src = base + src + "?v=" + (versions[src] || 0);
      s.async = false;
      s.onerror = () => {
        if (failed) return;
        failed = true;
        showError(new Error("Failed to load " + src));
      };
      document.body.append(s);
    }
    function showError(err) {
      const box = document.getElementById("content") || document.body;
      const div = document.createElement("div");
      div.className = "card";
      div.textContent =
        "Could not load the survey app (" + err.message + "). Please reload the page.";
      box.append(div);
    }
  }

  fetch(base + "manifest.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then(loadAll)
    .catch(() => loadAll({})); // manifest unavailable: load unversioned
})();