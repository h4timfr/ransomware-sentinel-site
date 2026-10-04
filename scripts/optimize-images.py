"""
Convert application screenshots into the responsive WebP files the site uses.

    python -m pip install pillow
    python scripts/optimize-images.py PATH\\TO\\captured-pngs

The PNGs are full-window captures of the real application (see README:
"Screenshots"). Only the screenshots listed in SHOTS are published. Each is
written at several widths to src/assets/img/shots/, with a manifest the build
reads to produce srcset/width/height. Run it again only when the screenshots
change; its output is committed.
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "img" / "shots"
WIDTHS = (640, 1080, 1600)
QUALITY = 82

SHOTS = [
    # Curated: each answers a different question on the site. Captured from the
    # released version under a neutral demo profile; see README "Screenshots".
    "02-setup-locations",
    "08-dashboard-protection-active",
    "09-protected-locations",
    "13-activity",
    "16-incident-detail",
    "17-demo-complete",
    "18-diagnostics",
]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    source = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    manifest = {}
    total = 0
    for name in SHOTS:
        image = Image.open(source / f"{name}.png").convert("RGB")
        widths = [w for w in WIDTHS if w < image.width] + [min(image.width, WIDTHS[-1])]
        widths = sorted(set(widths))
        for width in widths:
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.Resampling.LANCZOS)
            target = OUT / f"{name}-{width}.webp"
            resized.save(target, "WEBP", quality=QUALITY, method=6)
            total += target.stat().st_size
        manifest[name] = {"width": image.width, "height": image.height, "widths": widths}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest)} screenshots ({total / 1024:.0f} KB of WebP) to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
