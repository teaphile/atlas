"""Build a clean distributable, including the compiled frontend but no secrets/cache/dependencies.
Run from any directory after building: python scripts/package_release.py
"""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT.parent / "ATLAS-project.zip"
EXCLUDED = {".git", "node_modules", ".venv", ".runtime", "__pycache__", ".pytest_cache", ".ruff_cache", ".cache", ".arena"}

def included(path):
    rel = path.relative_to(ROOT)
    if not path.is_file() or path.is_symlink() or any(p in EXCLUDED for p in rel.parts):
        return False
    if path.name.startswith('.env') and path.name != '.env.example':
        return False
    if path.suffix in {'.zip', '.pyc', '.tsbuildinfo', '.sqlite', '.sqlite3'} or '.sqlite' in path.name:
        return False
    return path.name not in {'release-file-manifest.json', 'last-failure.png', 'private-failure.png'}

def main():
    if not (ROOT / 'frontend/dist/index.html').exists():
        raise SystemExit('Build frontend first; the archive intentionally includes its production bundle.')
    files = sorted(p for p in ROOT.rglob('*') if included(p))
    manifest = [{'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
    metadata = ROOT / 'docs/release-file-manifest.json'
    metadata.write_text(json.dumps({'project':'ATLAS 1.0.0','note':'Source + compiled UI; excludes runtime data, secrets, dependencies and the two reviewed source trees.','files':manifest},indent=2))
    with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for p in files + [metadata]:
            archive.write(p, 'atlas/' + str(p.relative_to(ROOT)))
    with zipfile.ZipFile(DEST) as archive:
        assert archive.testzip() is None
        assert 'atlas/backend/atlas_app/main.py' in archive.namelist()
        assert 'atlas/frontend/dist/index.html' in archive.namelist()
        assert 'atlas/.env.example' in archive.namelist()
    digest = hashlib.sha256(DEST.read_bytes()).hexdigest()
    DEST.with_suffix('.zip.sha256').write_text(f'{digest}  {DEST.name}\n')
    print(f'{DEST}: {len(files)+1} files, {DEST.stat().st_size:,} bytes, SHA256 {digest}')

if __name__ == '__main__':
    main()
