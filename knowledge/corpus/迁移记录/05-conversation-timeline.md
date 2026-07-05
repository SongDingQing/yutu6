# Conversation Timeline Summary

This is a human-readable summary, not a verbatim chat transcript.

## Initial Goal

主人 wanted Hermes and Codex to cooperate:

- Hermes talks to the user through Feishu and voice.
- Hermes identifies local coding tasks.
- User confirms through Feishu cards.
- Codex performs local code changes after confirmation.

## Major Decisions

- Use Feishu cards for user confirmation.
- Do not let voice commands directly execute sensitive actions.
- Keep voice replies visible in Feishu.
- Store ASR corrections and hotwords persistently.
- Use Brave Search for live web information.
- Create a Codex module registry so future sessions can find the right docs quickly.

## Implemented Milestones

1. Codex handoff plugin installed in Hermes.
2. Feishu confirmation card flow created for Codex handoff.
3. Voice wake service created and persisted as a LaunchAgent.
4. Wake phrases configured.
5. TTS voice profile system configured.
6. Voice startup and thinking cue configured.
7. Silence duration adjusted to 1.4 seconds.
8. Time replies changed to natural Chinese 12-hour format.
9. Voice reply records mirrored to Feishu.
10. Voice task confirmation cards added.
11. Confirm/cancel button handling fixed.
12. Card status update fixed after click.
13. ASR correction/hotword plugin created and fixed.
14. Manual Feishu correction format added.
15. Repeated ASR term auto-learning added.
16. Brave Search plugin created and tested.
17. Codex module registry created.
18. Human-readable module READMEs added.

## Current State

The system is active and persisted. The main registry is:

`/Users/yutu/.codex/modules/INDEX.md`

The current module is:

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/INDEX.md`

The migration folder is:

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`
