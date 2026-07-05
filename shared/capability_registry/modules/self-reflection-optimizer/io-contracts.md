# IO Contracts

## Input

```json
{
  "module": "module id, path, or human name",
  "source_case": "optional board/learning-cases/*.md path",
  "reason": "why this self-reflection run is triggered",
  "owner_policy": "auto_execute low-risk wins; owner_decision for uncertain or breaking changes"
}
```

## Output

```json
{
  "target_module": "resolved module path or id",
  "evidence_sources": ["files, tests, artifacts, logs"],
  "critique_ledger": [
    {
      "issue": "short title",
      "evidence": "file:line or artifact path",
      "impact": "practical impact",
      "fix": "specific proposal",
      "risk": "low|medium|high",
      "classification": "auto_execute|owner_decision|defer",
      "validation": "command or check"
    }
  ],
  "auto_executed": ["safe changes applied"],
  "owner_decisions": ["changes awaiting owner approval"],
  "learning_cases": ["case files appended"]
}
```

## Trigger Command

```bash
node projects/控制台/tools/self-reflection-trigger.js \
  --source board/learning-cases/ui-optimization-cases.md \
  --module ui-optimizer \
  --reason "new reusable optimization case"
```

The trigger is idempotent by the selected Markdown case entry hash (the latest `##` case by default, or `--case-title`) and queues the secretary instead of writing directly to internal queue files. It also returns the full source-file hash for auditing so unrelated file churn can be distinguished from a new reusable case.
