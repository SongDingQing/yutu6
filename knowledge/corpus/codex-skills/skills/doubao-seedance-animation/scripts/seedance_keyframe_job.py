#!/usr/bin/env python3
"""Prepare or submit a Volcengine Doubao Seedance keyframe animation job.

The script is intentionally conservative:
- It never prints API keys.
- Dry-run is the default useful mode for creating a sanitized job spec.
- Network submission requires --submit and current endpoint/model configuration.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = Path('/Users/yutu/.codex/private/simulaid-seedance-config.env')
DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks'
DEFAULT_STATUS_ENDPOINT = DEFAULT_ENDPOINT + '/{task_id}'


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def keychain_secret(service: str, account: str) -> str | None:
    try:
        result = subprocess.run(
            ['security', 'find-generic-password', '-w', '-s', service, '-a', account],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except FileNotFoundError:
        return None
    secret = result.stdout.strip()
    return secret or None


def resolve_secret(config: dict[str, str]) -> str | None:
    env_secret = os.environ.get('VOLCENGINE_ARK_API_KEY')
    if env_secret:
        return env_secret
    service = config.get('VOLCENGINE_ARK_KEYCHAIN_SERVICE', 'simulaid-volcengine-seedance')
    account = config.get('VOLCENGINE_ARK_KEYCHAIN_ACCOUNT', 'ark-api-key')
    return keychain_secret(service, account)


def data_url(path: Path) -> str:
    suffix = path.suffix.lower()
    mime = 'image/png'
    if suffix in {'.jpg', '.jpeg'}:
        mime = 'image/jpeg'
    elif suffix == '.webp':
        mime = 'image/webp'
    data = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'data:{mime};base64,{data}'


def make_content(args: argparse.Namespace) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{'type': 'text', 'text': args.prompt}]
    for idx, url in enumerate(args.keyframe_url or []):
        role = 'first_frame' if idx == 0 else f'keyframe_{idx + 1}'
        content.append({'type': 'image_url', 'image_url': {'url': url, 'role': role}})
    for idx, raw_path in enumerate(args.keyframe or []):
        path = Path(raw_path).expanduser().resolve()
        if not path.exists():
            raise SystemExit(f'Keyframe not found: {path}')
        role = 'first_frame' if not args.keyframe_url and idx == 0 else f'keyframe_file_{idx + 1}'
        if args.allow_data_url:
            url = data_url(path)
        else:
            url = f'file://{path}'
        content.append({'type': 'image_url', 'image_url': {'url': url, 'role': role}})
    return content


def make_payload(args: argparse.Namespace, config: dict[str, str]) -> dict[str, Any]:
    model = args.model or config.get('SIMULAID_SEEDANCE_MODEL') or 'Doubao-Seedance-2.0'
    payload: dict[str, Any] = {
        'model': model,
        'content': make_content(args),
        'metadata': {
            'simulaid_asset': True,
            'fps': args.fps,
            'duration_seconds': args.duration,
            'target_frames': args.frames,
            'target_size': args.size,
            'loop': args.loop,
            'sprite_sheet_cols': args.sheet_cols,
            'sprite_sheet_rows': args.sheet_rows,
        },
    }
    if args.ratio:
        payload['metadata']['ratio'] = args.ratio
    if args.negative_prompt:
        payload['negative_prompt'] = args.negative_prompt
    return payload


def sanitized(payload: dict[str, Any]) -> dict[str, Any]:
    clone = json.loads(json.dumps(payload, ensure_ascii=False))
    for item in clone.get('content', []):
        image = item.get('image_url') if isinstance(item, dict) else None
        if isinstance(image, dict):
            url = image.get('url')
            if isinstance(url, str) and url.startswith('data:'):
                image['url'] = f'<data-url omitted; {len(url)} chars>'
    return clone


def post_json(endpoint: str, payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        endpoint,
        data=body,
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        raise SystemExit(f'Volcengine request failed: HTTP {exc.code}\n{detail}') from exc


def poll_status(endpoint_template: str, task_id: str, api_key: str, interval: float, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        endpoint = endpoint_template.format(task_id=task_id)
        req = urllib.request.Request(endpoint, headers={'Authorization': f'Bearer {api_key}'})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', errors='replace')
            raise SystemExit(f'Volcengine status failed: HTTP {exc.code}\n{detail}') from exc
        status = str(data.get('status') or data.get('task_status') or '').lower()
        if status in {'succeeded', 'success', 'completed', 'failed', 'error', 'cancelled', 'canceled'}:
            return data
        if time.monotonic() >= deadline:
            return data
        time.sleep(interval)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(DEFAULT_CONFIG))
    parser.add_argument('--check-key', action='store_true', help='Verify that a key exists without printing it.')
    parser.add_argument('--dry-run', action='store_true', help='Print sanitized payload and exit.')
    parser.add_argument('--submit', action='store_true', help='Submit to Volcengine. Use only when user explicitly asked generation.')
    parser.add_argument('--poll', action='store_true', help='Poll task status after submission if a task id is returned.')
    parser.add_argument('--endpoint', default=None)
    parser.add_argument('--status-endpoint', default=None)
    parser.add_argument('--model', default=None)
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--negative-prompt', default=None)
    parser.add_argument('--keyframe', action='append', help='Local keyframe path. By default emitted as file:// in dry-run.')
    parser.add_argument('--keyframe-url', action='append', help='Remote keyframe URL supported by the API.')
    parser.add_argument('--allow-data-url', action='store_true', help='Embed local keyframes as data URLs. Only use if endpoint supports it.')
    parser.add_argument('--duration', type=float, default=1.0)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--frames', type=int, default=30)
    parser.add_argument('--sheet-cols', type=int, default=6)
    parser.add_argument('--sheet-rows', type=int, default=5)
    parser.add_argument('--size', default='1024x1024')
    parser.add_argument('--ratio', default=None)
    parser.add_argument('--loop', action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument('--output-json', default=None)
    parser.add_argument('--poll-interval', type=float, default=10.0)
    parser.add_argument('--poll-timeout', type=float, default=900.0)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    config = load_env_file(Path(args.config).expanduser())
    secret = resolve_secret(config)

    if args.check_key:
        print('key_present=' + ('yes' if bool(secret) else 'no'))

    payload = make_payload(args, config)
    safe = sanitized(payload)

    if args.output_json:
        Path(args.output_json).expanduser().write_text(json.dumps(safe, ensure_ascii=False, indent=2))

    if args.dry_run or not args.submit:
        print(json.dumps(safe, ensure_ascii=False, indent=2))
        return 0

    if not secret:
        raise SystemExit('Missing VOLCENGINE_ARK_API_KEY or Keychain secret; refusing to submit.')

    endpoint = args.endpoint or config.get('VOLCENGINE_ARK_VIDEO_TASK_ENDPOINT') or DEFAULT_ENDPOINT
    status_endpoint = args.status_endpoint or config.get('VOLCENGINE_ARK_VIDEO_STATUS_ENDPOINT') or DEFAULT_STATUS_ENDPOINT
    result = post_json(endpoint, payload, secret)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.poll:
        task_id = result.get('id') or result.get('task_id') or result.get('data', {}).get('id') or result.get('data', {}).get('task_id')
        if not task_id:
            print('No task id found; cannot poll.', file=sys.stderr)
            return 2
        status = poll_status(status_endpoint, str(task_id), secret, args.poll_interval, args.poll_timeout)
        print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
