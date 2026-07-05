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
