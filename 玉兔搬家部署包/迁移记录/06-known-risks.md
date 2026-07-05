# Known Risks And Future Improvements

## ASR Accuracy

Risk:

- Whisper/local STT can still misrecognize Chinese terms, names, and mixed English.

Current mitigation:

- Manual correction: `纠错：错词=>正确词`.
- Manual hotwords: `热词：词1、词2`.
- Auto-promotion after repeated terms.

Future improvement:

- Add an explicit Feishu correction card on every voice record.
- Add ASR n-best candidates if the STT stack supports it.
- Add local language-model post-correction before Feishu record creation.

## Voice Latency

Risk:

- Hermes LLM replies can be slow.
- TTS generation may add delay.

Current mitigation:

- Thinking cue after 0.5 seconds.
- Local fast reply for time/date.

Future improvement:

- Add more local intent handlers.
- Cache more short TTS phrases.
- Stream partial replies if the stack supports it.

## Feishu Card State

Risk:

- Button click backend may succeed while client card display does not update.

Current mitigation:

- Feishu callback now returns replacement cards for voice task and Codex handoff actions.

Future improvement:

- Add explicit audit message after every confirm/cancel.

## Secrets

Risk:

- Migration can accidentally expose `.env`, OAuth tokens, or Feishu credentials.

Current mitigation:

- Migration docs only point to secret locations and do not copy secret values.

Future improvement:

- Create a redacted config export script.

## Future Agent Migration

Risk:

- A future agent may not know to read local module docs.

Current mitigation:

- `module-registry` skill exists.
- `/Users/yutu/.codex/modules/registry.json` is machine-readable.
- `module_lookup.py` can route by natural language.

Future improvement:

- Add a startup hook or global instruction file if the future runtime supports it.
