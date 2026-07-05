---
name: user-clipboard-response
description: Use when the user asks Codex to provide "一句话", "一段话", copy-ready wording, or text to send/forward to another agent/person. Generate the requested wording and copy the exact final text directly into the macOS clipboard with pbcopy before replying.
---

# User Clipboard Response

This is a user workflow preference for copy-ready short text.

First read:

`/Users/yutu/.codex/modules/user-clipboard-response-preference/INDEX.md`

## Rule

When the user asks for a sentence, paragraph, or copy-ready handoff text, do not only display the text in chat. Generate the final payload and copy it directly to the macOS clipboard.

Use:

```bash
printf '%s' "$TEXT" | pbcopy
```

## Workflow

1. Draft the exact text the user should send.
2. Keep the clipboard payload clean: no Markdown quote marker, no explanatory preface, no status phrase such as `已复制到剪贴板`, and no extra trailing notes unless requested.
3. Copy the exact payload to the clipboard using `pbcopy`.
4. Reply with the exact copied text only, without a confirmation prefix/suffix. If `pbcopy` fails, then state the failure and provide the text in chat.

## Safety

- Do not copy secrets, tokens, private keys, cookies, or one-time codes without explicit confirmation.
- If `pbcopy` fails, state the failure and provide the text in chat.
- For "一句话", keep it genuinely short. For "一段话", prefer one compact paragraph.
