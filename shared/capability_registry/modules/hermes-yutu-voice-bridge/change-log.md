# Change Log

## 2026-05-07

Added Codex-side Feishu image preview helper.

Changes:

- Added `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_feishu_image.py`.
- The helper uploads a local PNG/JPG to the configured Hermes/Yutu Feishu chat without printing credentials.
- Intended for Simulaid `玉豚` sub-agent image previews, where the worker should send generated art to the user directly instead of relying on parent/worker progress-report loops.

## 2026-04-25 / 2026-04-26

Built local Hermes/Yutu voice and handoff workflow.

Major changes:

- Enabled voice wake service with local microphone capture.
- Added wake phrases for `玉兔玉兔` and `Hermes听令`.
- Added startup message `重启完成`.
- Added thinking cue `好的主人，让我想一下` with 0.5 second delay.
- Changed the received-command cue to `好的主人` so wake commands do not always sound like they require deep thinking.
- Added ASR wake variants `语图语图`, `预图预图`, and `玉图玉图` after logs showed wake attempts after TTS were transcribed as `预图 预图`.
- Added TTS voice profile system and active cute voice profile.
- Added Markdown/emoji sanitization before speech.
- Added local fast reply for simple time/date questions.
- Changed time answers to natural Chinese 12-hour format.
- Increased silence duration to 1.4 seconds.
- Added Feishu voice reply records labeled `语音回复记录`.
- Added Feishu voice task confirmation card labeled `Command Required: Voice Task`.
- Added pending task storage under `/Users/yutu/.hermes/voice-wake/pending-tasks`.
- Extended codex-handoff plugin to handle voice task card actions.
- Added Codex handoff confirmation cards for local coding tasks.
- Added optional APK return behavior after Codex handoff.
- Added persistent contact notes in Codex contacts memory.
- Added ASR hotword/correction persistence plugin.
- Fixed ASR context save path bug.
- Fixed voice preference save bug that could overwrite ASR context.
- Added Feishu manual correction pattern `纠错：错词=>正确词`.
- Added Feishu manual hotword pattern `热词：词1、词2`.
- Added repeated-term ASR auto-learning with 3-count promotion threshold.
- Added Brave Search plugin and guidance for current/latest web queries.
- Fixed Feishu voice/Codex confirmation cards so after approve/cancel the original card is replaced with an already-confirmed or canceled status card.
- Fixed email task routing so voice commands like `发送给我的邮箱` count as task-forward intents instead of ordinary Hermes chat.
- Injected saved contact mapping for email-like voice tasks: `主人/我的邮箱` and `姐姐`.
- Removed visible correction/hotword instructions from Feishu voice records and voice task cards while keeping the backend correction mechanism available.
- Changed Feishu voice reply records to a table-style format for easier reading.
- Created desktop migration package at `/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`.

Primary validation used:

- Python `py_compile`.
- JSON validation with `python3 -m json.tool`.
- YAML safe load.
- LaunchAgent status checks.
- Feishu test message/card.
- Brave Search smoke test without printing secrets.

## 2026-04-27

Fixed Codex handoff follow-through for Feishu document requests.

Changes:

- Added document/file return detection to `codex-handoff`.
- Added `deliver_document` support to the handoff tool schema.
- After a confirmed Codex run, Hermes now looks for newly generated or modified `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, or `.pptx` files and sends them back to the same Feishu chat.
- Added latest handoff status persistence at `/Users/yutu/.hermes/codex-handoff/latest-status.json` so Hermes can answer whether Codex completed the most recent task.
- Updated handoff guidance injected into Hermes so document return requests set `deliver_document`.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py`

Added confirmed scheduled Codex handoff.

Changes:

- Added `codex_handoff_schedule` to create delayed, timed, recurring, or repeat-limited Codex tasks after Feishu confirmation.
- Added Feishu card action `codex_schedule_action` and card title `Command Required: Codex Scheduled Handoff`.
- Scheduled tasks create Hermes cron jobs and generated runner scripts under `/Users/yutu/.hermes/scripts/codex-handoff`.
- Each due run starts local Codex CLI and delivers the result back through Hermes cron to the original Feishu chat.
- Scheduled run logs are stored under `/Users/yutu/.hermes/codex-handoff/scheduled-runs`.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`
- Generated runner script self-test with Python compile.

## 2026-04-29

Clarified local Hermes modification boundary.

Changes:

- Recorded that Hermes Agent runs on the same Mac mini Codex can access.
- Clarified that Codex can modify Hermes/Yutu files when requested.
- Reinforced that edits should use this module's file map and validation workflow, with extra caution around Feishu gateway internals and secrets.

Added serial queue for immediate Codex handoff tasks.

Changes:

- `codex-handoff` no longer starts immediate approved Codex tasks concurrently.
- Approved Codex handoff cards and direct `/codex` requests are enqueued first.
- The queue sends a Feishu acknowledgement with `队列编号` and how many tasks are ahead.
- Only one immediate Codex CLI task runs at a time.
- Queue audit JSON is written under `/Users/yutu/.hermes/codex-handoff/queue`.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py`
- Local async smoke test enqueued three fake tasks and verified strict serial order.

Reduced duplicate queue/start messages for immediate Codex handoff.

Changes:

- If a Codex handoff is first in queue and starts immediately, Hermes now sends one combined message instead of separate queue and start messages.
- If a Codex handoff has tasks ahead, Hermes still sends a queued acknowledgement first and a start notice later when it is picked up.

Review notes:

- Queue audit files exist, but automatic replay after Hermes gateway restart is not implemented yet.
- Feishu cancel button for queued-but-not-running Codex tasks is not implemented yet.
- The queue still applies only to immediate Codex handoff tasks; ordinary Hermes chat is not globally serialized.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py`
- Local async smoke test verified serial order and that only waiting tasks receive separate queued notices.

Shortened queue/start notices.

Changes:

- Waiting notice now uses compact shape like `排队中｜前2个｜队列abcd1234`.
- Start notice now uses compact shape like `Codex开始｜队列abcd1234｜任务efgh5678`.
- Queue audit JSON stores `task_summary`; generated summaries are capped at 10 characters for future task-ahead displays.

Added Feishu-send voice notice and faster speech.

Changes:

- After successful Feishu sends, Mac mini can speak `主人，飞书来消息了`.
- The hook exists in the Feishu gateway adapter for normal Hermes Feishu output and in the voice bridge sync sender.
- Background `语音回复记录` messages are skipped by default to avoid extra chatter during voice conversations.
- Added `voice_speed_multiplier: 1.25`; active Edge voice now resolves from `+6%` to about `+33%`.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/voice-wake/hermes_voice_wake.py /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`
- JSON validation for `/Users/yutu/.hermes/voice-wake/config.json`.
- Local helper check confirmed ordinary messages trigger notice and `语音回复记录` does not.

Added persistent punctuation pause normalization for speech.

Cause:

- The speech sanitizer compressed newlines, list formatting, and whitespace before TTS.
- Combined with the 1.25 speed multiplier, short phrases could sound connected even when the intended text had sentence boundaries.

Changes:

- Added `spoken_punctuation_pause_enabled`.
- Newlines are converted into `spoken_sentence_pause`.
- `主人` and `好的主人` automatically get a phrase pause if punctuation is missing.
- Missing final punctuation is filled with `spoken_sentence_pause`.

Validation:

- `主人飞书来消息了` now normalizes to `主人，飞书来消息了。`.
- `好的主人让我想一下` now normalizes to `好的主人，让我想一下。`.
- Multi-line speech text now gets sentence pauses between lines.

Added ordinary Feishu message queueing and longer text batching.

Cause:

- Ordinary Feishu follow-up messages could still interrupt an active Hermes run.
- Pending text could be replaced by the newest fragment, so quick messages like `a`, `b`, `c` might lose the middle fragment.
- Feishu users often send a thought as several messages, and the old 0.6 second text batch delay was too short.

Changes:

- Set `/Users/yutu/.hermes/config.yaml` `display.busy_input_mode` to `queue`.
- Set `HERMES_FEISHU_TEXT_BATCH_DELAY_SECONDS: 1.5`.
- Set `HERMES_FEISHU_TEXT_BATCH_SPLIT_DELAY_SECONDS: 2.5`.
- Updated `/Users/yutu/.hermes/hermes-agent/gateway/run.py` so queue mode appends ordinary busy-session text with newlines instead of interrupting or overwriting.
- Added a fallback queue path if a message reaches the gateway runner while the session is already active.
- Updated `/Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py` so outbound voice notice only runs from a connected gateway adapter.
- Updated `tests/gateway/test_busy_session_ack.py` to cover queue-mode text append and compact Chinese ack wording.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/hermes-agent/gateway/run.py /Users/yutu/.hermes/hermes-agent/gateway/platforms/base.py /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`
- Config YAML load check for `/Users/yutu/.hermes/config.yaml`.
- Local merge smoke test verified `a`, `b`, `c` becomes `a\nb\nc`.
- `/Users/yutu/.hermes/hermes-agent/venv/bin/python -m pytest /Users/yutu/.hermes/hermes-agent/tests/gateway/test_busy_session_ack.py -q` passed: 8 tests.
- `/Users/yutu/.hermes/hermes-agent/venv/bin/python -m pytest /Users/yutu/.hermes/hermes-agent/tests/gateway/test_feishu.py -q` passed: 189 tests.

Review notes:

- Ordinary Feishu pending queue is still in memory and is not replayed after a gateway restart.

Muted voice notice for queue status messages.

Cause:

- Compact queue acknowledgements like `排队中｜等当前回复完成` are status noise, not content the user needs a spoken "飞书来消息了" notice for.

Changes:

- Added `排队中` to `/Users/yutu/.hermes/voice-wake/config.json` `feishu_send_voice_notice_skip_prefixes`.
- This covers ordinary busy queue notices and Codex queue notices that share the `排队中` prefix.

Validation:

- JSON validation passed for `/Users/yutu/.hermes/voice-wake/config.json`.
- Local smoke test confirmed `排队中｜等当前回复完成` does not trigger Feishu-send voice notice.
- Local smoke test confirmed ordinary Feishu text still triggers Feishu-send voice notice.

Restored normal Yutu voice speed and persisted the notification prefix rule.

Changes:

- Set `/Users/yutu/.hermes/voice-wake/config.json` `voice_speed_multiplier` back to `1.0`.
- Set the active Edge Xiaoyi voice profile rate back to `+0%`.
- Updated the voice instruction and voice preferences so spoken replies start with `主人`.
- Updated startup, wake acknowledgement, thinking cue, local fast time/date replies, task-forward replies, stop/listen-miss messages, and Hermes error replies so they also start with `主人`.
- Added the durable Codex-triggered reminder format: `主人，前情提要：...` followed by the result.
- Recorded the same rule in the Codex module/skill docs so future sessions that call 玉兔 inherit the format.

Validation:

- JSON validation passed for `/Users/yutu/.hermes/voice-wake/config.json` and `/Users/yutu/.hermes/voice-wake/voice-preferences.json`.

Improved Codex handoff queue reliability.

Cause:

- Immediate Codex handoff queue audit files existed, but queued work was not recovered after Hermes gateway restart.
- A user could not cancel a queued-but-not-running Codex task with a simple Feishu command.
- Queue state needed a compact human-readable status command.

Changes:

- Added plugin startup hook support in Hermes gateway:
  - `/Users/yutu/.hermes/hermes-agent/hermes_cli/plugins.py` now recognizes `gateway_startup`.
  - `/Users/yutu/.hermes/hermes-agent/gateway/run.py` invokes `gateway_startup` after adapters are connected.
- Updated `/Users/yutu/.hermes/plugins/codex-handoff/__init__.py`:
  - Recovers `queued` and previous-process `running` queue audit files at Hermes gateway startup.
  - Rehydrates recovered items with live gateway/adapter context.
  - Skips queue items marked `canceled` before they start.
  - Adds `/codex-cancel <queue-id-or-short-id>` for queued-but-not-running tasks.
  - Adds `/codex-queue` for compact queue status.
  - Queue waiting notice now includes a short cancel command.

Validation:

- `python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py /Users/yutu/.hermes/hermes-agent/gateway/run.py /Users/yutu/.hermes/hermes-agent/hermes_cli/plugins.py`
- Local smoke test verified queue cancel writes `canceled`.
- Local smoke test verified recovered queued items are rehydrated and executed by the queue worker.
- Local smoke test verified `/codex-queue` renders compact status.

Review notes:

- This does not cancel a Codex process that has already started running; it only cancels queued work before the worker begins it.
- Recovery depends on queue audit files containing platform, chat id, project path, and task.

Restored Yutu adjusted voice and listener startup.

Cause:

- Voice config still pointed to `edge_xiaoyi`, but recent logs showed intermittent fallback to macOS `say` with `No module named 'edge_tts'`.
- The voice listener LaunchAgent was not running, and its plist had `RunAtLoad` set to `false`, so after reload/login it could remain stopped.

Changes:

- Verified `/Users/yutu/.hermes/hermes-agent/venv/bin/python` can import `edge_tts`.
- Tested `edge_xiaoyi` with `hermes_voice_wake.py --preview-profile edge_xiaoyi`; it completed without fallback.
- Changed `/Users/yutu/Library/LaunchAgents/com.yutu.hermes.voicewake.plist` `RunAtLoad` to `true`.
- Reloaded the voice listener LaunchAgent.

Validation:

- `python3 -m json.tool /Users/yutu/.hermes/voice-wake/config.json >/dev/null`
- `/Users/yutu/.hermes/hermes-agent/venv/bin/python -m py_compile /Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`
- `launchctl print gui/$(id -u)/com.yutu.hermes.voicewake` shows `state = running`.
- Voice log shows startup TTS succeeded and microphone initialized as `HyperX Cloud III Wireless`.
