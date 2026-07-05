# Live Paths And Data Inventory

This file lists where the live system data lives. It does not include secret values.

## Hermes Runtime

Hermes root:

`/Users/yutu/.hermes`

Hermes agent:

`/Users/yutu/.hermes/hermes-agent`

Hermes config:

`/Users/yutu/.hermes/config.yaml`

Hermes environment secrets:

`/Users/yutu/.hermes/.env`

Do not print or copy `.env` without主人 confirmation.

## Voice Wake

Voice bridge:

`/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Voice config:

`/Users/yutu/.hermes/voice-wake/config.json`

ASR context:

`/Users/yutu/.hermes/voice-wake/asr-context.json`

Voice preferences:

`/Users/yutu/.hermes/voice-wake/voice-preferences.json`

ASR learning state:

`/Users/yutu/.hermes/voice-wake/asr-learning.json`

Pending voice tasks:

`/Users/yutu/.hermes/voice-wake/pending-tasks`

Voice logs:

`/Users/yutu/.hermes/voice-wake/logs/voice-wake.log`

## Hermes Plugins

Codex handoff:

`/Users/yutu/.hermes/plugins/codex-handoff`

Voice ASR context:

`/Users/yutu/.hermes/plugins/voice-asr-context`

Brave Search:

`/Users/yutu/.hermes/plugins/brave-search`

## Codex Local Knowledge

Module registry:

`/Users/yutu/.codex/modules`

Important skills:

- `/Users/yutu/.codex/skills/module-registry`
- `/Users/yutu/.codex/skills/hermes-yutu-voice-bridge`
- `/Users/yutu/.codex/skills/personal-contacts`

Contacts memory:

`/Users/yutu/.codex/memories/contacts.json`

This may contain personal email addresses. Migrate only with主人 approval.

## LaunchAgents

Voice listener:

`/Users/yutu/Library/LaunchAgents/com.yutu.hermes.voicewake.plist`

Hermes gateway:

`ai.hermes.gateway`

Hermes dashboard:

`ai.hermes.dashboard`

## Logs

Gateway log:

`/Users/yutu/.hermes/logs/gateway.log`

Voice log:

`/Users/yutu/.hermes/voice-wake/logs/voice-wake.log`

Gateway state:

`/Users/yutu/.hermes/gateway_state.json`

## What To Copy For Migration

Usually copy:

- `/Users/yutu/.codex/modules`
- `/Users/yutu/.codex/skills/module-registry`
- `/Users/yutu/.codex/skills/hermes-yutu-voice-bridge`
- `/Users/yutu/.hermes/plugins/codex-handoff`
- `/Users/yutu/.hermes/plugins/voice-asr-context`
- `/Users/yutu/.hermes/plugins/brave-search`
- `/Users/yutu/.hermes/voice-wake`

Copy only after confirmation:

- `/Users/yutu/.hermes/.env`
- `/Users/yutu/.codex/auth.json`
- `/Users/yutu/.codex/memories/contacts.json`
