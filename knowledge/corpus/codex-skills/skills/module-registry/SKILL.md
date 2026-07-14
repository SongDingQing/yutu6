---
name: module-registry
description: Use when a request refers to persistent local modules, prior configuration, Yutu6 automation, Hermes, Feishu, voice workflows, or asks whether an ability is already installed. Consult the workspace capability registry before broad searches.
---

# Module Registry

The repository capability registry is the source of truth:

- `shared/capability_registry/INDEX.md`
- `shared/capability_registry/registry.json`

## Workflow

1. Resolve `YUTU6_ROOT` from the current repository.
2. Read the registry and match request keywords.
3. Open only the matched module's `INDEX.md` and declared `read_order`.
4. Inspect implementation files after the module identifies ownership.
5. If a project-specific capability is required, verify that its project pack is installed; do not borrow another project's commands.

## Rules

- Do not store or print secrets, tokens, cookies, or credentials.
- New persistent customizations require a module entry and small searchable documentation.
- System modules use relative repository paths. User-specific absolute paths belong only in private local configuration.
- Keep detailed project procedures in project packs, not in the generic system registry.
