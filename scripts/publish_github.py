"""User-operated publication helper. Never reads, asks for, or stores credentials.

Authenticate with `gh auth login` locally first. No publication occurs before
an explicit PUBLISH confirmation. This script itself was not used to push this
handover: no authenticated destination was available in the build workspace.
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = {'.runtime', '.venv', 'node_modules', '__pycache__', '.ssh', '.aws', '.kube'}


def run(*args, capture=False, check=True):
    return subprocess.run(args, cwd=ROOT, text=True, check=check,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', help='YOUR_ACCOUNT/repository-name')
    visibility = parser.add_mutually_exclusive_group(required=True)
    visibility.add_argument('--public', action='store_true')
    visibility.add_argument('--private', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', args.repository):
        parser.error('Use an explicit owner/repository, not a URL or option.')
    if not shutil.which('git') or not shutil.which('gh'):
        raise SystemExit('Install Git and the official GitHub CLI, then run gh auth login locally.')
    if run('gh', 'auth', 'status', check=False).returncode:
        raise SystemExit('Authenticate locally with gh auth login first. Never paste tokens into chat.')
    root = run('git', 'rev-parse', '--show-toplevel', capture=True, check=False)
    if root.returncode == 0 and Path(root.stdout.strip()).resolve() != ROOT:
        raise SystemExit('Refusing to publish an unrelated parent Git repository. Use a standalone project directory.')
    if root.returncode != 0:
        run('git', 'init', '-b', 'main')
    if run('git', 'branch', '--show-current', capture=True).stdout.strip() != 'main':
        raise SystemExit('Select/review the main branch first; this helper never force-renames branches.')
    if run('git', 'remote', 'get-url', 'origin', capture=True, check=False).returncode == 0:
        raise SystemExit('An origin already exists. Inspect it and use your normal git push workflow; no remote was changed.')
    tracked = run('git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', capture=True).stdout.split('\0')
    unsafe = []
    for name in filter(None, tracked):
        p = Path(name)
        if (any(part in BLOCKED for part in p.parts)
                or (p.name.startswith('.env') and p.name != '.env.example')
                or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3'}
                or '.sqlite' in p.name):
            unsafe.append(name)
    if unsafe:
        raise SystemExit('Refusing common sensitive/runtime paths; review/remove them from Git first:\n'+'\n'.join(unsafe))
    run('git', 'status', '--short')
    mode = 'public' if args.public else 'private'
    print(f'\nDestination: https://github.com/{args.repository} ({mode})')
    print('Review all files and existing Git history yourself. The path check is NOT a secret scanner.')
    print('Provider/data licenses are separate from the original-code MIT license.')
    try:
        answer = input('Type PUBLISH to commit pending changes and create/push this repository: ')
    except EOFError:
        raise SystemExit('No interactive confirmation; nothing was published.') from None
    if answer != 'PUBLISH':
        raise SystemExit('Cancelled; nothing was published.')
    run('git', 'add', '--all', '--', '.')
    if run('git', 'diff', '--cached', '--quiet', check=False).returncode:
        run('git', 'commit', '-m', 'Release ATLAS 2.0 Earth Intelligence')
    if run('git', 'rev-parse', '--verify', 'HEAD', capture=True, check=False).returncode:
        raise SystemExit('No commit exists. Configure your Git identity and commit the reviewed source first.')
    run('gh', 'repo', 'create', args.repository, '--'+mode, '--source', '.', '--remote', 'origin', '--push')
    print(f'GitHub CLI reported success. Verify https://github.com/{args.repository} and its CI results.')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f'Command failed with status {exc.returncode}; publication is not asserted. Inspect Git/gh state before retrying.', file=sys.stderr)
        raise SystemExit(exc.returncode) from None
