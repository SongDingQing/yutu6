# 元宵 / 嫦娥 控制面(项目档案)

> 提炼自迁移记录 08 §5。与演示笔记 `yuanxiao.md` 互补,这篇是真实项目知识。仓库:`SongDingQing/YuanXiao`(私有,需授权 clone)。

## 身份
- **元宵**:手机端控制面(= 汤圆)。
- **嫦娥**:服务器 / 控制中枢身份。
- **煮元宵 / 煮汤圆**:一条龙 = 优化→构建→校验→部署→自更新→下行→Git 同步→提醒。

## 重要规则
1. 默认做**原生 Android**,不做 WebView 包壳。
2. APK 默认在 **Mac mini** 编译。
3. 服务端按 **Ubuntu** 运行环境思考。
4. Android UI 只订阅 canonical task state,前端不各处重复推断任务状态。
5. 文件 / patch / release / downlink 都要有 ledger / receipt(sha/来源/状态/保留期)。
6. 真实审批用 **typed card**,不用聊天"是否继续"阻塞。
7. 受保护的 Codex 会话不被后台直接 resume 打扰;默认进队列,显式允许才直连。

## 关键能力组件
`runner_adapters`(统一执行器)· `capability_registry`(谁能做什么+权限)· `workflow_nodes`(可恢复节点)· `typed_cards`(approval/artifact/trace/health/security)· `artifact_receipt.jsonl`(产物回执)· task/attempt/artifact id(串起队列/下行/审批/重试)。

## 新机待办
登录 GitHub 后 clone → 配置 Android/JDK/Gradle → 重配服务端与密钥。详见 `wiki/migration/migration-notes.md`。

## 相关实体
元宵 · 汤圆 · 嫦娥 · YuanXiao · 原生Android · Mac mini · Ubuntu · typed card · artifact receipt · canonical task state
