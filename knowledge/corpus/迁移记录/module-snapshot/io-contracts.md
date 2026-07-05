# Input And Output Contracts

## Voice Wake Input

Input source: microphone audio.

Expected wake phrases:

- `玉兔玉兔`
- common ASR variants listed in `/Users/yutu/.hermes/voice-wake/config.json`
- `Hermes听令`

Output:

- Wake-only phrase speaks `我在`.
- Full command is transcribed and routed to fast reply, task card, or Hermes API.

## Local Fast Replies

Input:

- Time/date questions detected in `local_fast_reply()`.

Output:

- Time uses natural Chinese 12-hour format:
  - `晚上8点`
  - `凌晨1点`
  - `晚上12点20分`
  - `下午6点`
  - `中午12点20分`
  - `下午1点`
  - `早上8点`

Side effect:

- Meaningful reply is mirrored to Feishu as `语音回复记录`.

## Feishu Voice Reply Record

Input:

- User voice text after correction mapping.
- Spoken reply text after Markdown and emoji sanitization.

Output message shape:

```text
【语音回复记录】
时间：YYYY-MM-DD HH:MM:SS
用户语音：...
玉兔回复：...
纠错提示：如果识别错了，请回复 `纠错：错词=>正确词`；要加热词请回复 `热词：词1、词2`。
```

## Voice Task Card

Input trigger examples:

- `给姐姐发邮件`
- `帮我发邮件给...`
- `交给 Codex`
- coding handoff-like voice requests

Output:

- Feishu interactive card title: `Command Required: Voice Task`
- Buttons:
  - `确认处理`
  - `取消`
- Pending JSON saved under `/Users/yutu/.hermes/voice-wake/pending-tasks`.

On approve:

- Plugin replays confirmed task into Hermes as a Feishu request.
- Hermes should not ask for confirmation again.
- If details are missing, Hermes should ask one concise follow-up.

On cancel:

- Pending JSON is deleted.
- Feishu receives cancellation notice.

## Codex Handoff Card

Input trigger:

- Feishu request requiring local code edits, Unity work, tests, build, APK, or repo review.

Required information:

- Absolute `project_path`
- Concrete `task`
- Optional `verification`
- Optional `deliver_apk`

Output:

- Feishu card title: `Command Required: Codex Handoff`
- Codex starts only after user confirms.

## ASR Manual Correction

Input from Feishu:

```text
纠错：错词=>正确词
```

or:

```text
热词：词1、词2
```

Output:

- Updates `/Users/yutu/.hermes/voice-wake/asr-context.json`.
- Corrected target terms are also added to hotwords.
- Feishu receives a small confirmation message.

## Brave Search

Input tool:

```json
{"query": "OpenAI news", "count": 5}
```

Output:

```json
{
  "status": "ok",
  "query": "...",
  "results": [
    {"title": "...", "url": "...", "description": "...", "age": "..."}
  ]
}
```

Use for:

- latest/current/recent information
- news
- web verification
- prices/schedules/product info that may change

Do not claim no web access unless the tool fails.
