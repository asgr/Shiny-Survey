#!/usr/bin/env python3
"""Regenerate docs/assets/manifest.json with a content hash per asset.

Run before committing any change under docs/assets/ (see README):
    python3 scripts/bump_manifest.py
boot.js appends ?v=<hash> to asset URLs, so changed files bypass the
GitHub Pages cache immediately and no deploy can mix stale/fresh scripts.
"""
import hashlib
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "docs" / "assets"

def main():
    manifest = {}
    for f in sorted(ASSETS.iterdir()):
        if f.name in ("manifest.json", "boot.js") or not f.is_file():
            continue
        manifest[f.name] = hashlib.sha256(f.read_bytes()).hexdigest()[:10]
    (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote manifest with {len(manifest)} assets")

if __name__ == "__main__":
    main()