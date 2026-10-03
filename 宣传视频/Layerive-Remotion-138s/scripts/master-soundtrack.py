"""Two-pass loudness mastering for the original score (requires FFmpeg)."""
from pathlib import Path
import json
import re
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / 'public' / 'soundtrack.wav'
dest = root / 'public' / 'music-master.wav'
target = 'loudnorm=I=-17:TP=-1.5:LRA=9'
probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(source), '-af', target + ':print_format=json', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace', check=True)
stats = json.loads(re.findall(r'\{[^{}]+\}', probe.stderr)[-1])
measured = ':'.join(f'{name}={stats[key]}' for name, key in [
    ('measured_I', 'input_i'), ('measured_TP', 'input_tp'),
    ('measured_LRA', 'input_lra'), ('measured_thresh', 'input_thresh'),
    ('offset', 'target_offset')])
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-af', target + ':' + measured + ':linear=true', '-ar', '48000', '-ac', '2', str(dest)], check=True)
check = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(dest), '-af', target + ':print_format=json', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace', check=True)
final = json.loads(re.findall(r'\{[^{}]+\}', check.stderr)[-1])
print(json.dumps({'integratedLUFS': final['input_i'], 'truePeakDBTP': final['input_tp'], 'loudnessRangeLU': final['input_lra']}, indent=2))

