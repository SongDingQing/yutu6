# Project Expansion Profiles

This reference gives the global router a compact fallback map. Keep long project details in the actual project skills, modules, and route docs.

## Simulaid

Canonical expander: `simulaid-command-expander`.

Use for Simulaid runtime, UI, balance, content, assets, tests, builds, releases, bug fixes, architecture review, and named wrappers. The visible block should be `Simulaid 指令补齐稿：`.

## YuanXiao / Yutu / Hermes / ChangE / Legend

Canonical expander: `yuanxiao-command-expander`.

Use for YuanXiao Android control plane, ChangE self-update, Yutu/Hermes queues, Feishu cards, voice, notifications, task handoff, local modules, helper scripts, and workflow memory. The visible block should be `元宵指令补齐稿：`.

## Zongzi

Canonical expander: `zongzi-command-expander`.

Use for Zongzi assistant, Zongzi Codex, Zongzi web/control plane, server-side user data, Codex interface reuse, deployment, and admin workflows. The visible block should be `粽子指令补齐稿：`.

## Unknown Game Project

Emit `全局指令补齐稿：` and add a game-development lens:

- target project/root;
- gameplay goal;
- architecture/system ownership;
- data/save compatibility;
- UI/platform constraints;
- asset/style needs;
- validation and regression plan.

If project identity is unclear, ask one short question before editing.

## Unknown Agent Project

Emit `全局指令补齐稿：` and add an agent-control-plane lens:

- message source and sink;
- queue/session model;
- confirmation or authorization flow;
- notification and voice side effects;
- persistence/logging;
- secrets boundary;
- failure recovery.

If the action can trigger external communication or destructive automation, keep the confirmation boundary explicit.
