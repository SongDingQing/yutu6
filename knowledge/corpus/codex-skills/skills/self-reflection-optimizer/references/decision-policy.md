# 自省优化决策策略

## 自动执行条件

Use `auto_execute` only when evidence is concrete, the change is local and reversible, public contracts do not change, and validation can run locally.

## 主人拍板条件

Use `owner_decision` for changes to APIs, queues, persistent formats, permissions, authentication, cost, product direction, deletion, migration, or external services.

## 案例沉淀格式

Every reusable case records source, scenario, symptom, root cause, fix, validation, and reusable principle. Opinions without evidence do not enter the case library.
