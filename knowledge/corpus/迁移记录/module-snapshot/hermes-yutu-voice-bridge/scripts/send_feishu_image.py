#!/usr/bin/env python3
"""Send a local image preview to the configured Hermes/Yutu Feishu chat.

Reads existing non-printed credentials from /Users/yutu/.hermes/.env and
chat target from /Users/yutu/.hermes/voice-wake/config.json or env.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import uuid
from pathlib import Path

import requests

ENV_PATH = Path('/Users/yutu/.hermes/.env')
CONFIG_PATH = Path('/Users/yutu/.hermes/voice-wake/config.json')
_TOKEN_CACHE: dict[str, object] = {'token': '', 'expires_at': 0.0}


def load_env(path: Path = ENV_PATH) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config(path: Path = CONFIG_PATH) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def base_url(domain: str) -> str:
    normalized = (domain or 'feishu').strip()
    if normalized.startswith(('http://', 'https://')):
        return normalized.rstrip('/')
    if normalized.lower() == 'lark':
        return 'https://open.larksuite.com'
    return 'https://open.feishu.cn'


def infer_receive_id_type(receive_id: str, cfg: dict) -> str:
    configured = str(cfg.get('feishu_sync_receive_id_type') or '').strip()
    if configured:
        return configured
    if receive_id.startswith('ou_'):
        return 'open_id'
    if receive_id.startswith('on_'):
        return 'union_id'
    if receive_id.startswith('u_'):
        return 'user_id'
    return 'chat_id'


def feishu_target(cfg: dict, env: dict[str, str]) -> str:
    return str(
        cfg.get('feishu_sync_chat_id')
        or os.environ.get('HERMES_VOICE_FEISHU_CHAT_ID')
        or env.get('HERMES_VOICE_FEISHU_CHAT_ID')
        or os.environ.get('FEISHU_VOICE_CHAT_ID')
        or env.get('FEISHU_VOICE_CHAT_ID')
        or os.environ.get('FEISHU_HOME_CHANNEL')
        or env.get('FEISHU_HOME_CHANNEL')
        or ''
    ).strip()


def tenant_token(env: dict[str, str]) -> str:
    cached = str(_TOKEN_CACHE.get('token') or '')
    if cached and float(_TOKEN_CACHE.get('expires_at') or 0) > time.time() + 60:
        return cached
    app_id = os.environ.get('FEISHU_APP_ID') or env.get('FEISHU_APP_ID') or ''
    app_secret = os.environ.get('FEISHU_APP_SECRET') or env.get('FEISHU_APP_SECRET') or ''
    if not app_id or not app_secret:
        raise RuntimeError('missing FEISHU_APP_ID or FEISHU_APP_SECRET')
    domain = os.environ.get('FEISHU_DOMAIN') or env.get('FEISHU_DOMAIN') or 'feishu'
    resp = requests.post(
        f'{base_url(domain)}/open-apis/auth/v3/tenant_access_token/internal',
        json={'app_id': app_id, 'app_secret': app_secret},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    token = str(data.get('tenant_access_token') or '')
    if not token:
        raise RuntimeError(f"Feishu token response code={data.get('code')} msg={data.get('msg')}")
    expires_in = int(data.get('expire') or 7000)
    _TOKEN_CACHE['token'] = token
    _TOKEN_CACHE['expires_at'] = time.time() + max(300, expires_in - 120)
    return token


def send_message(token: str, domain: str, receive_id: str, receive_id_type: str, msg_type: str, content: str) -> None:
    resp = requests.post(
        f'{base_url(domain)}/open-apis/im/v1/messages',
        params={'receive_id_type': receive_id_type},
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        data=json.dumps({
            'receive_id': receive_id,
            'msg_type': msg_type,
            'content': content,
            'uuid': str(uuid.uuid4()),
        }, ensure_ascii=False).encode('utf-8'),
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    if int(data.get('code') or 0) != 0:
        raise RuntimeError(f"Feishu send response code={data.get('code')} msg={data.get('msg')}")


def upload_image(token: str, domain: str, image_path: Path) -> str:
    mime = mimetypes.guess_type(str(image_path))[0] or 'image/png'
    with image_path.open('rb') as handle:
        resp = requests.post(
            f'{base_url(domain)}/open-apis/im/v1/images',
            headers={'Authorization': f'Bearer {token}'},
            data={'image_type': 'message'},
            files={'image': (image_path.name, handle, mime)},
            timeout=30,
        )
    resp.raise_for_status()
    data = resp.json()
    if int(data.get('code') or 0) != 0:
        raise RuntimeError(f"Feishu image upload response code={data.get('code')} msg={data.get('msg')}")
    image_key = str((data.get('data') or {}).get('image_key') or data.get('image_key') or '')
    if not image_key:
        raise RuntimeError('Feishu image upload missing image_key')
    return image_key


def main() -> int:
    parser = argparse.ArgumentParser(description='Send local image to configured Feishu chat')
    parser.add_argument('image_path')
    parser.add_argument('--caption', default='')
    args = parser.parse_args()

    image_path = Path(args.image_path).expanduser().resolve()
    if not image_path.exists():
        print(f'blocked: image not found: {image_path}', file=sys.stderr)
        return 2

    cfg = load_config()
    env = load_env()
    if not bool(cfg.get('feishu_sync_enabled', False)):
        print('blocked: feishu_sync_enabled is false', file=sys.stderr)
        return 2
    receive_id = feishu_target(cfg, env)
    if not receive_id:
        print('blocked: Feishu target is not configured', file=sys.stderr)
        return 2
    receive_id_type = infer_receive_id_type(receive_id, cfg)
    domain = os.environ.get('FEISHU_DOMAIN') or env.get('FEISHU_DOMAIN') or 'feishu'
    token = tenant_token(env)

    caption = str(args.caption or '').strip()
    if caption:
        send_message(token, domain, receive_id, receive_id_type, 'text', json.dumps({'text': caption}, ensure_ascii=False))
    image_key = upload_image(token, domain, image_path)
    send_message(token, domain, receive_id, receive_id_type, 'image', json.dumps({'image_key': image_key}, ensure_ascii=False))
    print(f'ok: sent {image_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
