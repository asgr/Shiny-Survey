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
    // Sequential execution order matters: later scripts use earlier ones.
    let chain = Promise.resolve();
    for (const src of scripts) {
      chain = chain.then(
        () =>
          new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = base + src + "?v=" + (versions[src] || 0);
            s.onload = resolve;
            s.onerror = () => reject(new Error("Failed to load " + src));
            document.body.append(s);
          })
      );
    }
    chain.catch((err) => {
      const box = document.getElementById("content") || document.body;
      const div = document.createElement("div");
      div.className = "card";
      div.textContent =
        "Could not load the survey app (" + err.message + "). Please reload the page.";
      box.append(div);
    });
  }

  fetch(base + "manifest.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then(loadAll)
    .catch(() => loadAll({})); // manifest unavailable: load unversioned
})();