---
name: personal-contacts
description: Use when the user asks to send email or refer to saved personal contacts such as "me", "my sister", "姐姐", or "发给我"; read the local contact book before choosing recipients.
metadata:
  short-description: Local email contact book
---

# Personal Contacts

When the user asks to email a saved contact, read:

`/Users/yutu/.codex/memories/contacts.json`

Rules:

- Address the user as `主人` in conversation.
- The user's legal name is `宋承座`; use it only when a formal name is needed.
- If the user says "发给我" or "send to me", use the `owner.email` value.
- If the user says "姐姐" or "my sister", use the contact with `id: sister`.
- If the recipient is ambiguous, ask one concise clarification question before sending.
