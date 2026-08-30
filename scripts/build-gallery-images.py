# Compress the GPT-Image2-Skill effect images into web-friendly thumbnails
# for the in-app prompt gallery. Reads the parsed catalog, resizes each image
# to a comfortable preview size, and writes them under app/public/gallery.
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DOCS = os.path.abspath(os.path.join(ROOT, '..', 'GPT-Image2-Skill', 'docs'))
OUT_ROOT = os.path.join(ROOT, 'public', 'gallery')
MAX_EDGE = 480

with open(os.path.join(ROOT, 'src', 'gallery.raw.json'), encoding='utf-8') as f:
    catalog = json.load(f)

os.makedirs(OUT_ROOT, exist_ok=True)
converted = 0
skipped = 0
for entry in catalog['entries']:
    rel = entry['image']  # docs/<category>/<file>.png
    src = os.path.join(SKILL_DOCS, rel.replace('docs/', '', 1))
    if not os.path.exists(src):
        print(f"MISSING {rel}", file=sys.stderr)
        skipped += 1
        continue
    category = entry['category']
    os.makedirs(os.path.join(OUT_ROOT, category), exist_ok=True)
    dst = os.path.join(OUT_ROOT, category, f"{entry['number']}.jpg")
    try:
        with Image.open(src) as im:
            im = im.convert('RGB')
            im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            im.save(dst, 'JPEG', quality=82, optimize=True)
        # Rewrite the entry to the public web path.
        entry['image'] = f"/gallery/{category}/{entry['number']}.jpg"
        converted += 1
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL {rel}: {exc}", file=sys.stderr)
        skipped += 1

with open(os.path.join(ROOT, 'src', 'gallery.raw.json'), 'w', encoding='utf-8') as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)

print(f"Converted {converted} images, skipped {skipped}. Output -> {OUT_ROOT}")
