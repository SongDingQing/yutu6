#!/usr/bin/env python3
"""Lightweight filesystem lock helper for cross-project wrapper skills.

Usage:
  route_lock.py acquire simulaid.quark-upload --task "upload apk" --ttl 7200
  route_lock.py status simulaid.quark-upload
  route_lock.py release simulaid.quark-upload
"""
import argparse, json, os, shutil, sys, time
from pathlib import Path

ROOT = Path(os.environ.get('CODEX_ROUTE_LOCK_ROOT', '/tmp/codex-skill-locks'))


def lock_path(name: str) -> Path:
    safe = ''.join(c if c.isalnum() or c in '._-' else '_' for c in name)
    return ROOT / f'{safe}.lock'


def read_owner(path: Path):
    try:
        return json.loads((path / 'owner.json').read_text())
    except Exception:
        return None


def acquire(args):
    ROOT.mkdir(parents=True, exist_ok=True)
    path = lock_path(args.name)
    now = time.time()
    owner = {
        'name': args.name,
        'owner': args.owner or os.environ.get('CODEX_AGENT_LABEL') or os.environ.get('USER') or 'unknown',
        'task': args.task,
        'pid': os.getpid(),
        'started_at_epoch': now,
        'started_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
        'ttl_seconds': args.ttl,
    }
    try:
        path.mkdir()
    except FileExistsError:
        existing = read_owner(path)
        print(json.dumps({'acquired': False, 'lock': str(path), 'existing': existing}, ensure_ascii=False, indent=2))
        return 2
    (path / 'owner.json').write_text(json.dumps(owner, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'acquired': True, 'lock': str(path), 'owner': owner}, ensure_ascii=False, indent=2))
    return 0


def status(args):
    path = lock_path(args.name)
    owner = read_owner(path)
    if not path.exists():
        print(json.dumps({'locked': False, 'lock': str(path)}, ensure_ascii=False, indent=2))
        return 0
    stale = False
    if owner and owner.get('ttl_seconds'):
        stale = time.time() - float(owner.get('started_at_epoch', 0)) > float(owner['ttl_seconds'])
    print(json.dumps({'locked': True, 'stale_by_ttl': stale, 'lock': str(path), 'owner': owner}, ensure_ascii=False, indent=2))
    return 0


def release(args):
    path = lock_path(args.name)
    if path.exists():
        shutil.rmtree(path)
        print(json.dumps({'released': True, 'lock': str(path)}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({'released': False, 'reason': 'not_locked', 'lock': str(path)}, ensure_ascii=False, indent=2))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('acquire')
    a.add_argument('name')
    a.add_argument('--task', default='')
    a.add_argument('--ttl', type=int, default=7200)
    a.add_argument('--owner', default='')
    a.set_defaults(fn=acquire)
    s = sub.add_parser('status')
    s.add_argument('name')
    s.set_defaults(fn=status)
    r = sub.add_parser('release')
    r.add_argument('name')
    r.set_defaults(fn=release)
    args = ap.parse_args()
    raise SystemExit(args.fn(args))

if __name__ == '__main__':
    main()
