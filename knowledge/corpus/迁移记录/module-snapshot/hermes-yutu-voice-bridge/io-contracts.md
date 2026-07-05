# Input And Output Contracts

## Voice Wake Input

Input source: microphone audio.

Expected wake phrases:

- `玉兔玉兔`
- common ASR variants listed in `/Users/yutu/.hermes/voice-wake/config.json`
- `Hermes听令`

Known ASR wake variants include `语图语图`, `预图预图`, and `玉图玉图`.

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
- `语音回复记录` is skipped by the Feishu-send voice notice rule to avoid extra chatter during voice conversations.

## Feishu Send Voice Notice

Input:

- Hermes/Yutu successfully sends a Feishu message through the gateway adapter or the voice bridge sync function.

Output:

- Mac mini speaks `主人，飞书来消息了` after the send succeeds.
- Notices are rate-limited by `feishu_send_voice_notice_min_interval_seconds`.
- Messages beginning with configured prefixes, currently `【语音回复记录】` or `排队中`, do not trigger the notice.

Voice speed:

- `voice_speed_multiplier` applies to supported voice engines.
- Current value is `1.0`, so supported voices use normal speed. The active Edge Xiaoyi profile is also set to `+0%`.

Persistent spoken notification format:

- Any Codex-triggered Yutu/Hermes spoken message or Feishu reminder must begin with `主人，前情提要：...`.
- Include one short context sentence before the result so the user can still understand the message even if the first few audio syllables are missed.
- Example: `主人，前情提要：刚刚在处理 Simulaid 构建。玉龙 v0.28.34：模拟纪元已发送。`

Spoken punctuation pauses:

- `spoken_punctuation_pause_enabled` is enabled.
- Newlines are converted into sentence pauses before TTS.
- `主人` and `好的主人` get an inserted phrase pause if the generated text forgot punctuation.
- Missing final punctuation is filled with `spoken_sentence_pause`.

Local fast replies:

- Time/date fast replies also begin with `主人`, for example `主人，现在晚上8点。`

## Feishu Ordinary Message Queue

Input:

- User sends ordinary Feishu text while Hermes/Yutu is already processing the same session.
- User sends several short Feishu text messages close together before processing starts.

Output:

- Active Hermes/Yutu work is not interrupted for ordinary text follow-ups when `display.busy_input_mode: queue`.
- Follow-up text is appended with newlines and processed as the next turn after the current reply finishes.
- Feishu receives a compact acknowledgement: `排队中｜等当前回复完成`.
- Acknowledgements are debounced so fast repeated messages do not spam the chat.
- Feishu text burst dispatch waits for `HERMES_FEISHU_TEXT_BATCH_DELAY_SECONDS`; current value is `1.5`.
- Large/split text chunks can wait for `HERMES_FEISHU_TEXT_BATCH_SPLIT_DELAY_SECONDS`; current value is `2.5`.

Important limitation:

- The ordinary pending-message queue is in memory. It avoids live interruption and overwrite, but queued ordinary chat is not replayed after a gateway process restart.

## Feishu Voice Reply Record

Input:

- User voice text after correction mapping.
- Spoken reply text after Markdown and emoji sanitization.

Output message shape:

```text
【语音回复记录】

| 项目 | 内容 |
| --- | --- |
| 时间 | YYYY-MM-DD HH:MM:SS |
| 用户语音 | ... |
| 玉兔回复 | ... |
```

## Voice Task Card

Input trigger examples:

- `给姐姐发邮件`
- `帮我发邮件给...`
- `发送给我的邮箱`
- `发到我邮箱`
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
- Saved contacts are injected for email-like tasks:
  - `主人` / `发给我` / `我的邮箱` -> `songchengzuo@hotmail.com`
  - `姐姐` -> `scc12251988@hotmail.com`
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
- Optional `deliver_document`

Output:

- Feishu card title: `Command Required: Codex Handoff`
- Codex is queued only after user confirms.
- Immediate Codex handoff tasks are serial: one task runs at a time.
- If the task can start immediately, the queue acknowledgement and start notice are combined into one Feishu message.
- If other Codex tasks are already running or waiting, Feishu receives a queue acknowledgement with `队列编号` and the number of tasks ahead; it receives a separate start notice only when the task is actually picked up.
- Queue/start Feishu notices should stay very short, using short ids where possible.
- If queue messages ever display tasks ahead, each task summary must be no longer than 10 characters.
- Queue audit JSON is written under `/Users/yutu/.hermes/codex-handoff/queue`.
- Queue audit statuses are `queued`, `running`, `completed`, `failed`, `timeout`, or `canceled`.
- On Hermes gateway startup, queue audit files with `queued` or `running` are rehydrated and queued again when enough platform/chat/task data is available.
- A queued-but-not-running item can be canceled from Feishu with `/codex-cancel <queue-id-or-short-id>`.
- The current queue can be shown from Feishu with `/codex-queue`.
- If the task asks to send/upload/return a document/file/report, Hermes tries to send matching document artifacts back to the same Feishu chat after Codex completes.
- Latest Codex run status is written to `/Users/yutu/.hermes/codex-handoff/latest-status.json` so Hermes can answer whether Codex completed a recent task.

Document artifact types:

- `.md`
- `.txt`
- `.pdf`
- `.docx`
- `.xlsx`
- `.pptx`

## Codex Scheduled Handoff Card

Input trigger:

- Feishu or voice request asking Codex to run later, repeatedly, on an interval, at a fixed time, or a limited number of times.

Required information:

- Absolute `project_path`
- Concrete `task`
- `schedule`

Schedule formats:

- `30m` runs once after 30 minutes.
- `2h` runs once after 2 hours.
- `every 2h` runs repeatedly every 2 hours.
- `0 9 * * *` runs by cron expression.
- ISO timestamp runs once at that time.

Optional:

- `repeat`; omitted, `0`, or `-1` means forever for recurring schedules; one-shot schedules default to one run.
- `verification`
- `deliver_apk`
- `deliver_document`

Output:

- Feishu card title: `Command Required: Codex Scheduled Handoff`.
- User confirmation creates a Hermes cron job.
- Each due run starts local Codex CLI through a generated runner script.
- Results are delivered back to the origin Feishu chat by Hermes cron.
- Runner scripts live under `/Users/yutu/.hermes/scripts/codex-handoff`.
- Scheduled run logs live under `/Users/yutu/.hermes/codex-handoff/scheduled-runs`.

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
