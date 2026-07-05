# Troubleshooting

## 玉兔 Says She Has No Internet

Likely causes:

- `brave-search` plugin not enabled or gateway not restarted.
- `BRAVE_SEARCH_API_KEY` missing from environment.
- Hermes model ignored tool guidance.

Check:

```bash
rg -n "brave-search" /Users/yutu/.hermes/config.yaml
cat /Users/yutu/.hermes/gateway_state.json
```

Run Brave smoke test from `operations.md`. Do not print API keys.

Fix:

- Ensure `plugins.enabled` includes `brave-search`.
- Restart `ai.hermes.gateway`.

## Feishu Voice Record Arrives But No Card

Likely causes:

- `voice_task_confirmation_card_enabled` is false.
- Feishu card API failed.
- The phrase did not match task intent.

Check:

- Voice log for `voice_task_forward`.
- Pending task files under `/Users/yutu/.hermes/voice-wake/pending-tasks`.
- Feishu sync config in `config.json`.

Fix:

- Verify `feishu_sync_enabled: true`.
- Verify `voice_task_confirmation_card_enabled: true`.
- Restart voice listener.

## 玉兔 Asks For A Saved Email Address

Likely causes:

- The voice command used `邮箱` instead of `邮件`, and older routing only matched `邮件`.
- Hermes model memory and Codex contact memory are separate unless the plugin injects saved contacts.

Expected:

- `发给我` / `我的邮箱` maps to `songchengzuo@hotmail.com`.
- `姐姐` maps to `scc12251988@hotmail.com`.
- Email-like voice tasks should create a `Command Required: Voice Task` card instead of ordinary Hermes chat.

Fix:

- Ensure `邮箱`, `发到邮箱`, and `发给我的邮箱` are in config and ASR hotwords.
- Ensure `is_voice_task_forward_intent()` treats both `邮件` and `邮箱` as email targets.
- Restart voice listener and gateway after changing routing or injected contact guidance.

## Card Appears But Button Does Nothing

Likely causes:

- Hermes gateway plugin not restarted.
- `codex-handoff` plugin not enabled.
- Feishu callback not connected.

Check:

```bash
cat /Users/yutu/.hermes/gateway_state.json
rg -n "codex-handoff" /Users/yutu/.hermes/config.yaml
tail -80 /Users/yutu/.hermes/logs/gateway.log
```

Fix:

- Restart `ai.hermes.gateway`.

## Card Button Works But Card Still Shows Pending

Likely cause:

- Feishu callback handled the button asynchronously but did not return a replacement `CallBackCard`.

Owner:

- `/Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`
- Method: `_on_card_action_trigger()`
- Helper: `_build_resolved_local_command_card_response()`

Expected:

- Voice task approve updates card to `语音任务已确认授权`.
- Voice task cancel updates card to `语音任务已取消`.
- Codex handoff approve updates card to `Codex 任务已确认授权`.
- Codex handoff cancel updates card to `Codex 任务已取消`.

Fix:

- Ensure custom card actions with `voice_task_action` or `codex_handoff_action` return a resolved callback card while still scheduling `_handle_card_action_event(data)`.
- Restart `ai.hermes.gateway`.

## Codex Finished But Hermes Says It Did Not

Likely causes:

- Older handoff flow sent only a direct Feishu message and did not write a durable completion status for Hermes to read later.
- The task requested a document/file back, but older handoff flow only returned text unless the artifact was an APK.

Expected:

- Latest status is stored at `/Users/yutu/.hermes/codex-handoff/latest-status.json`.
- Run logs live under `/Users/yutu/.hermes/codex-handoff/runs/<run_id>/`.
- For document return requests, supported artifacts are `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, and `.pptx`.

Check:

```bash
python3 -m json.tool /Users/yutu/.hermes/codex-handoff/latest-status.json
find /Users/yutu/.hermes/codex-handoff/runs -maxdepth 2 -name status.json -print
```

Fix:

- Ensure `codex-handoff` plugin is current and Hermes gateway has been restarted.
- If the user wants a file back, make sure the task or tool call sets `deliver_document: true` or contains wording like `发文档回来` / `上传文件` / `发送报告`.

## Scheduled Codex Task Does Not Run

Likely causes:

- Hermes gateway is not running, so cron ticks are not firing.
- The schedule was not confirmed from the Feishu card.
- The generated runner script is missing or failed.
- The project path no longer exists.

Expected:

- Confirmation card title: `Command Required: Codex Scheduled Handoff`.
- After confirmation, Hermes creates a cron job in `/Users/yutu/.hermes/cron/jobs.json`.
- Runner script exists under `/Users/yutu/.hermes/scripts/codex-handoff`.
- Per-run logs are under `/Users/yutu/.hermes/codex-handoff/scheduled-runs`.

Check:

```bash
/Users/yutu/.hermes/hermes-agent/venv/bin/hermes cron status
/Users/yutu/.hermes/hermes-agent/venv/bin/hermes cron list --all
find /Users/yutu/.hermes/codex-handoff/scheduled-runs -maxdepth 3 -name status.json -print
```

Fix:

- Restart `ai.hermes.gateway`.
- Recreate the schedule from Feishu if the pending confirmation was lost.
- Inspect the scheduled run `stderr.log` under the matching run directory.

## ASR Corrections Do Not Stick

Likely causes:

- Manual correction message did not match parser pattern.
- `voice-asr-context` plugin not enabled.
- JSON invalid after manual edit.

Use exact forms:

```text
纠错：错词=>正确词
热词：词1、词2
```

Check:

```bash
python3 -m json.tool /Users/yutu/.hermes/voice-wake/asr-context.json >/dev/null
rg -n "voice-asr-context" /Users/yutu/.hermes/config.yaml
```

## Speech Cuts Off Too Early

Config:

- `silence_duration` in `/Users/yutu/.hermes/voice-wake/config.json`

Current known value:

- 1.4 seconds

Adjust:

- Increase toward 1.8 if natural pauses still cut off.
- Decrease toward 1.1 if replies feel too slow.

Restart voice listener after change.

## False Wake Or Random Replies

Relevant config:

- `min_recording_peak_rms`
- `wake_only_min_recording_peak_rms`
- `silence_threshold`
- `wake_phrases_as_hotwords`
- `asr_hotwords`

Notes:

- Wake phrases are intentionally not used as ASR hotwords to reduce hallucinated wake detections.
- Quiet recordings below threshold are discarded.

## Wake Fails Right After 玉兔 Speaks

Likely causes:

- The listener is still running, but ASR hears `玉兔玉兔` as a nearby variant.
- Observed examples include `预图 预图`, `语图语图`, and `玉图玉图`.

Check:

```bash
tail -80 /Users/yutu/.hermes/voice-wake/logs/voice-wake.log
```

Expected:

- If the log shows `heard: 预图 预图 ...` with no follow-up command/reply, add that duplicated variant to `wake_phrases`.

Fix:

- Keep variants specific and duplicated to avoid false wakes.
- Restart `com.yutu.hermes.voicewake`.

## Time Format Wrong

Owner:

- `format_chinese_12h_time()` in voice bridge.
- Voice preference rule in `voice-preferences.json`.

Expected:

- `晚上8点`
- `凌晨1点`
- `晚上12点20分`
- `中午12点20分`

Restart voice listener after changes.
