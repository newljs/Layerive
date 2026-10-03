"""Crop the user's real screenshots; never synthesize or retouch results."""
from pathlib import Path
from PIL import Image
import json

root = Path(__file__).resolve().parents[1]
source = root.parent / 'layerive页面截图'
compare = Image.open(source / '09-删除人物帽子成功对比.png')
assets = {
    'hat-before': (1834, 275, 2368, 1239),
    'hat-after': (804, 275, 1338, 1239),
    'hat-head-before': (1940, 275, 2274, 675),
    'hat-head-after': (910, 275, 1244, 675),
}
for name, box in assets.items():
    compare.crop(box).convert('RGB').save(root / 'public' / 'art' / f'{name}.jpg', quality=96)
for name, filename in [('hat-selection', '09-删除人物帽子.png'), ('hat-result', '09-删除人物帽子成功效果.png')]:
    Image.open(source / filename).convert('RGB').save(root / 'public' / 'art' / f'{name}.jpg', quality=93)
manifest_path = root / 'public' / 'asset-manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['source'] = '../layerive页面截图'
manifest['hatCrops'] = {'source': '09-删除人物帽子成功对比.png', 'boxesLTRB': assets}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print('Prepared six real screenshot assets for the hat removal scene.')
