#!/usr/bin/env bash
# 玉兔6 · 飞书通知(三类交互)。
# 类型(--type):
#   text     提问/对话 —— 纯文本消息(默认,向后兼容)
#   progress 任务进展 —— interactive 卡片(蓝头 + markdown 正文 + 可选图片/单链接按钮)
#   decision 需决策   —— interactive 卡片(橙头 + 正文 + 多个 URL 按钮)。拍板 Q12 后按钮 URL 由调用方
#            指向控制台 /api/decision/<cardId>/<approve|reject>?t=<token>,点按钮即拍板(不再只是跳转链接);
#            已知边界:控制台只绑 127.0.0.1,手机点按钮暂不可达(LAN/桥接排后),届时改 config.json baseUrl。
# 兼容旧用法:
#   bash notify-feishu.sh "标题" "正文"
#   bash notify-feishu.sh --title "标题" --body "..." [--image 本地图] [--button-label "打开"] [--button-url URL]
# 决策多按钮:
#   bash notify-feishu.sh --type decision --title "..." --body "..." --buttons "同意|http://...;;拒绝|http://..."
# 调试:FEISHU_DRY_RUN=1 → 只打印将要发送的 msg_type+content,不联网、不需凭据。
# 凭据从环境或 ~/.hermes/.env 读,全程不回显。
set -uo pipefail

TYPE="text"
TITLE=""
BODY=""
IMAGE=""
BUTTON_LABEL=""
BUTTON_URL=""
BUTTONS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --type)         TYPE="${2:-text}"; shift 2 ;;
    --title)        TITLE="${2:-}"; shift 2 ;;
    --body)         BODY="${2:-}"; shift 2 ;;
    --image)        IMAGE="${2:-}"; shift 2 ;;
    --button-label) BUTTON_LABEL="${2:-}"; shift 2 ;;
    --button-url)   BUTTON_URL="${2:-}"; shift 2 ;;
    --buttons)      BUTTONS="${2:-}"; shift 2 ;;
    -h|--help)
      echo 'usage: notify-feishu.sh [--type text|progress|decision] --title "..." --body "..." [--image <local>] [--button-label L --button-url U] [--buttons "L1|U1;;L2|U2"]' >&2
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

TYPE="$TYPE" TITLE="$TITLE" BODY="$BODY" IMAGE="$IMAGE" BUTTON_LABEL="$BUTTON_LABEL" BUTTON_URL="$BUTTON_URL" BUTTONS="$BUTTONS" ENV_FILE="$ENV_FILE" DRY="${FEISHU_DRY_RUN:-}" python3 - <<'PY' 2>/dev/null || { echo "feishu notify failed" >&2; exit 0; }
import json
import os
import re
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

def parse_buttons(spec, single_label="", single_url=""):
    out = []
    spec = str(spec or "").strip()
    if spec:
        for chunk in spec.split(";;"):
            chunk = chunk.strip()
            if not chunk or "|" not in chunk:
                continue
            label, url = chunk.split("|", 1)
            url = url.strip()
            if url:
                out.append((compact_label(label), url[:500]))
    if not out and str(single_url or "").strip():
        out.append((compact_label(single_label), str(single_url).strip()[:500]))
    return out[:5]

# ── 纯文本(text / 提问对话)──
def build_text(title, body, image, label, url):
    parts = [compact_title(title), compact_body(body, 600, 3)]
    if str(image or "").strip():
        parts.append(f"图片: {str(image).strip()}")
    if str(url or "").strip():
        parts.append(f"链接({compact_label(label)}): {str(url).strip()}")
    text = "\n".join(p for p in parts if p).strip()[:1800] or "玉兔6 通知"
    return "text", json.dumps({"text": text}, ensure_ascii=False)

# ── interactive 卡片(progress / decision)──
def build_card(kind, title, body, image, buttons):
    template = "orange" if kind == "decision" else "blue"
    prefix = "🟠 需决策 · " if kind == "decision" else "🔵 进展 · "
    elements = [{"tag": "div", "text": {"tag": "lark_md", "content": compact_body(body, 800, 8) or "（无内容）"}}]
    if str(image or "").strip():
        elements.append({"tag": "note", "elements": [{"tag": "plain_text", "content": f"图片: {str(image).strip()[:300]}"}]})
    if buttons:
        elements.append({
            "tag": "action",
            "actions": [
                {"tag": "button",
                 "text": {"tag": "plain_text", "content": lab},
                 "url": url,
                 "type": ("primary" if (kind == "decision" and i == 0) else "default")}
                for i, (lab, url) in enumerate(buttons)
            ],
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
buttons = parse_buttons(os.environ.get("BUTTONS"), os.environ.get("BUTTON_LABEL"), os.environ.get("BUTTON_URL"))

if kind in ("progress", "decision"):
    msg_type, content = build_card(kind, title, body, image, buttons)
else:
    msg_type, content = build_text(title, body, image, os.environ.get("BUTTON_LABEL"), os.environ.get("BUTTON_URL"))

# 干跑:只打印 payload,不联网
if os.environ.get("DRY"):
    print("DRY_RUN " + json.dumps({"msg_type": msg_type, "content": content}, ensure_ascii=False))
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

require_ok(post_json(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {"receive_id": chat_id, "msg_type": msg_type, "content": content},
    {"Authorization": f"Bearer {token}"},
), "send message")
print("ok")
PY
