#!/usr/bin/env bash
# 玉兔6 · 飞书通知(三类交互)。
# 类型(--type):
#   text     提问/对话 —— 纯文本消息(默认,向后兼容)
#   progress 任务进展 —— interactive 卡片(蓝头 + markdown 正文 + 可选图片/单链接按钮)
#   decision 需决策   —— interactive 卡片(橙头 + 正文 + 原生 value 回调按钮/可选 URL 按钮)。
#            玉兔6决策按钮由 Hermes 飞书长连接接收 value 后调用本机控制台,点击时不打开浏览器。
# 兼容旧用法:
#   bash notify-feishu.sh "标题" "正文"
#   bash notify-feishu.sh --title "标题" --body "..." [--image 本地图] [--file 本地文件] [--button-label "打开"] [--button-url URL]
# 决策多按钮:
#   bash notify-feishu.sh --type decision --title "..." --body "..." --buttons "同意|http://...;;拒绝|http://..."
#   bash notify-feishu.sh --type decision --title "..." --body "..." --actions-json '[{"label":"同意","value":{"action":"approve"},"type":"primary"}]'
# 调试:FEISHU_DRY_RUN=1 → 只打印将要发送的 msg_type+content,不联网、不需凭据。
# 凭据从环境或 ~/.hermes/.env 读,全程不回显。
set -uo pipefail

TYPE="text"
TITLE=""
BODY=""
IMAGE=""
FILE=""
UUID_SEED=""
BUTTON_LABEL=""
BUTTON_URL=""
BUTTONS=""
ACTIONS_JSON=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --type)         TYPE="${2:-text}"; shift 2 ;;
    --title)        TITLE="${2:-}"; shift 2 ;;
    --body)         BODY="${2:-}"; shift 2 ;;
    --image)        IMAGE="${2:-}"; shift 2 ;;
    --file)         FILE="${2:-}"; shift 2 ;;
    --uuid)         UUID_SEED="${2:-}"; shift 2 ;;
    --button-label) BUTTON_LABEL="${2:-}"; shift 2 ;;
    --button-url)   BUTTON_URL="${2:-}"; shift 2 ;;
    --buttons)      BUTTONS="${2:-}"; shift 2 ;;
    --actions-json) ACTIONS_JSON="${2:-}"; shift 2 ;;
    -h|--help)
      echo 'usage: notify-feishu.sh [--type text|progress|decision] --title "..." --body "..." [--image <local>] [--file <local>] [--uuid <idempotency-seed>] [--button-label L --button-url U] [--buttons "L1|U1;;L2|U2"] [--actions-json JSON]' >&2
      exit 0
      ;;
    *)
      if [ -z "$TITLE" ]; then TITLE="$1";
      elif [ -z "$BODY" ]; then BODY="$1";
      else BODY="${BODY}
$1"; fi
      shift
      ;;
  esac
done

TITLE="${TITLE:-玉兔6 通知}"
ENV_FILE="${HERMES_ENV:-$HOME/.hermes/.env}"
# 干跑无需凭据;真发才校验
if [ -z "${FEISHU_DRY_RUN:-}" ] && [ ! -f "$ENV_FILE" ] && [ -z "${FEISHU_APP_ID:-}" ]; then
  echo "no env" >&2
  exit 0
fi

TYPE="$TYPE" TITLE="$TITLE" BODY="$BODY" IMAGE="$IMAGE" FILE="$FILE" UUID_SEED="$UUID_SEED" BUTTON_LABEL="$BUTTON_LABEL" BUTTON_URL="$BUTTON_URL" BUTTONS="$BUTTONS" ACTIONS_JSON="$ACTIONS_JSON" ENV_FILE="$ENV_FILE" DRY="${FEISHU_DRY_RUN:-}" python3 - <<'PY' 2>/dev/null || { echo "feishu notify failed" >&2; exit 0; }
import hashlib
import json
import os
import re
import uuid
import urllib.request

def load_env():
    env = dict(os.environ)
    env_file = env.get("ENV_FILE") or ""
    if env_file and os.path.exists(env_file):
        with open(env_file, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env

def post_json(url, payload, headers=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def post_multipart_file(url, token, file_path):
    if not os.path.isfile(file_path):
        raise RuntimeError("attachment missing")
    if os.path.getsize(file_path) > 30 * 1024 * 1024:
        raise RuntimeError("attachment too large")
    boundary = "----yutu6-" + uuid.uuid4().hex
    file_name = os.path.basename(file_path).replace('"', "_")
    with open(file_path, "rb") as handle:
        file_bytes = handle.read()
    chunks = []
    def field(name, value):
        chunks.append((
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"{name}\"\r\n\r\n"
            f"{value}\r\n"
        ).encode("utf-8"))
    field("file_type", "stream")
    field("file_name", file_name)
    chunks.append((
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8"))
    chunks.append(file_bytes)
    chunks.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def require_ok(payload, label):
    if int(payload.get("code", 0) or 0) != 0:
        raise RuntimeError(label)
    return payload

def compact_title(text):
    return re.sub(r"\s+", " ", str(text or "玉兔6 通知")).strip()[:80] or "玉兔6 通知"

def compact_body(text, limit=600, max_lines=6):
    raw = str(text or "").replace("\\n", "\n")
    lines = [re.sub(r"[ \t]+", " ", x).strip() for x in raw.splitlines()]
    lines = [x for x in lines if x]
    body = "\n".join(lines[:max_lines]) if lines else "（无内容）"
    return body[:limit]

def compact_label(text, fallback="打开"):
    return re.sub(r"\s+", " ", str(text or fallback)).strip()[:30] or fallback

def parse_actions(actions_json, legacy_spec, single_label="", single_url=""):
    out = []
    raw_actions = str(actions_json or "").strip()
    if raw_actions:
        parsed = json.loads(raw_actions)
        if not isinstance(parsed, list):
            raise RuntimeError("actions json must be a list")
        for item in parsed:
            if not isinstance(item, dict):
                continue
            label = compact_label(item.get("label"))
            button_type = str(item.get("type") or "default").strip().lower()
            if button_type not in {"default", "primary", "danger"}:
                button_type = "default"
            value = item.get("value")
            url = str(item.get("url") or "").strip()
            if isinstance(value, dict) and value:
                out.append({"label": label, "value": value, "type": button_type})
            elif url:
                out.append({"label": label, "url": url[:500], "type": button_type})
    spec = str(legacy_spec or "").strip()
    if spec:
        for chunk in spec.split(";;"):
            chunk = chunk.strip()
            if not chunk or "|" not in chunk:
                continue
            label, url = chunk.split("|", 1)
            url = url.strip()
            if url:
                out.append({"label": compact_label(label), "url": url[:500], "type": "default"})
    if not out and str(single_url or "").strip():
        out.append({
            "label": compact_label(single_label),
            "url": str(single_url).strip()[:500],
            "type": "default",
        })
    return out[:5]

def message_uuid(seed, suffix):
    seed = str(seed or "").strip()
    if not seed:
        return None
    raw = hashlib.sha256((seed + "\n" + suffix).encode("utf-8")).hexdigest()[:32]
    return f"{raw[:8]}-{raw[8:12]}-4{raw[13:16]}-a{raw[17:20]}-{raw[20:32]}"

# ── 纯文本(text / 提问对话)──
def build_text(title, body, image, file_path, label, url):
    parts = [compact_title(title), compact_body(body, 600, 3)]
    if str(image or "").strip():
        parts.append(f"图片: {str(image).strip()}")
    if str(file_path or "").strip():
        parts.append(f"附件: {os.path.basename(str(file_path).strip())}")
    if str(url or "").strip():
        parts.append(f"链接({compact_label(label)}): {str(url).strip()}")
    text = "\n".join(p for p in parts if p).strip()[:1800] or "玉兔6 通知"
    return "text", json.dumps({"text": text}, ensure_ascii=False)

# ── interactive 卡片(progress / decision)──
def build_card(kind, title, body, image, file_path, buttons):
    template = "orange" if kind == "decision" else "blue"
    prefix = "🟠 需决策 · " if kind == "decision" else "🔵 进展 · "
    elements = [{"tag": "div", "text": {"tag": "lark_md", "content": compact_body(body, 800, 8) or "（无内容）"}}]
    if str(image or "").strip():
        elements.append({"tag": "note", "elements": [{"tag": "plain_text", "content": f"图片: {str(image).strip()[:300]}"}]})
    if str(file_path or "").strip():
        elements.append({"tag": "note", "elements": [{"tag": "plain_text", "content": f"附件: {os.path.basename(str(file_path).strip())[:180]}"}]})
    if buttons:
        actions = []
        for i, button in enumerate(buttons):
            action = {
                "tag": "button",
                "text": {"tag": "plain_text", "content": button["label"]},
                "type": button.get("type") or ("primary" if (kind == "decision" and i == 0) else "default"),
            }
            if isinstance(button.get("value"), dict):
                action["value"] = button["value"]
            else:
                action["url"] = button["url"]
            actions.append(action)
        elements.append({
            "tag": "action",
            "actions": actions,
        })
    card = {
        "config": {"wide_screen_mode": True},
        "header": {"title": {"tag": "plain_text", "content": (prefix + compact_title(title))[:100]}, "template": template},
        "elements": elements,
    }
    return "interactive", json.dumps(card, ensure_ascii=False)

kind = (os.environ.get("TYPE") or "text").strip().lower()
title = os.environ.get("TITLE")
body = os.environ.get("BODY")
image = os.environ.get("IMAGE")
file_path = os.environ.get("FILE")
buttons = parse_actions(
    os.environ.get("ACTIONS_JSON"),
    os.environ.get("BUTTONS"),
    os.environ.get("BUTTON_LABEL"),
    os.environ.get("BUTTON_URL"),
)

if kind in ("progress", "decision"):
    msg_type, content = build_card(kind, title, body, image, file_path, buttons)
else:
    msg_type, content = build_text(title, body, image, file_path, os.environ.get("BUTTON_LABEL"), os.environ.get("BUTTON_URL"))

# 干跑:只打印 payload,不联网
if os.environ.get("DRY"):
    file_meta = None
    if str(file_path or "").strip():
        file_meta = {
            "name": os.path.basename(str(file_path).strip()),
            "exists": os.path.isfile(str(file_path).strip()),
        }
    print("DRY_RUN " + json.dumps({"msg_type": msg_type, "content": content, "file": file_meta}, ensure_ascii=False))
    raise SystemExit(0)

env = load_env()
app_id = env.get("FEISHU_APP_ID")
app_secret = env.get("FEISHU_APP_SECRET") or env.get("FEISHU_SECRET")
chat_id = env.get("FEISHU_HOME_CHANNEL") or env.get("HOME_CHANNEL") or env.get("FEISHU_HOME_CHAT_ID")
if not (app_id and app_secret and chat_id):
    raise SystemExit(0)

token_payload = require_ok(post_json(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {"app_id": app_id, "app_secret": app_secret},
), "tenant token")
token = token_payload.get("tenant_access_token")
if not token:
    raise SystemExit(0)

file_key = None
if str(file_path or "").strip():
    uploaded = require_ok(post_multipart_file(
        "https://open.feishu.cn/open-apis/im/v1/files",
        token,
        str(file_path).strip(),
    ), "upload file")
    file_key = ((uploaded.get("data") or {}).get("file_key"))
    if not file_key:
        raise RuntimeError("file key missing")

message_payload = {"receive_id": chat_id, "msg_type": msg_type, "content": content}
card_uuid = message_uuid(os.environ.get("UUID_SEED"), "summary")
if card_uuid:
    message_payload["uuid"] = card_uuid
require_ok(post_json(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    message_payload,
    {"Authorization": f"Bearer {token}"},
), "send message")

if file_key:
    file_payload = {
        "receive_id": chat_id,
        "msg_type": "file",
        "content": json.dumps({"file_key": file_key}, ensure_ascii=False),
    }
    file_uuid = message_uuid(os.environ.get("UUID_SEED"), "attachment")
    if file_uuid:
        file_payload["uuid"] = file_uuid
    require_ok(post_json(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        file_payload,
        {"Authorization": f"Bearer {token}"},
    ), "send file")
print("ok")
PY
