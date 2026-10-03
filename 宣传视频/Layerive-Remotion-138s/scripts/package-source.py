from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
destination = root.parent
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'Layerive-Remotion工程-138s.zip'
files = ['package.json', 'package-lock.json', 'tsconfig.json', 'remotion.config.ts', 'README.md', 'creative-brief.md', '.gitignore']
with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=6) as z:
    for name in files:
        z.write(root / name, 'Layerive-Remotion-138s/' + name)
    for folder in ['src', 'public', 'scripts']:
        for file in sorted((root / folder).rglob('*')):
            if file.is_file():
                z.write(file, 'Layerive-Remotion-138s/' + file.relative_to(root).as_posix())
with ZipFile(archive) as z:
    assert z.testzip() is None
    print(f'{archive}: {len(z.namelist())} files, {archive.stat().st_size / 1024**2:.1f} MB; ZIP integrity passed')
