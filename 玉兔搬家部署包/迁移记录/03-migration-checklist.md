# Migration Checklist

如果未来迁移到更好的 agent，按这个清单检查。

## A. 先备份

备份这些目录或文件：

- `/Users/yutu/.hermes`
- `/Users/yutu/.codex/modules`
- `/Users/yutu/.codex/skills`
- `/Users/yutu/.codex/memories`
- `/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`

敏感文件需要主人确认后再迁移：

- `/Users/yutu/.hermes/.env`
- `/Users/yutu/.codex/auth.json`
- 任何 OAuth token 或邮箱授权文件

## B. 服务层

确认新 agent 能接入或替代：

- 本地麦克风监听。
- 本地或云端 STT。
- TTS 播放。
- 飞书消息发送。
- 飞书交互卡片回调。
- 本地代码修改能力。
- Brave Search 或其他搜索工具。

## C. Hermes 兼容层

确认是否继续使用 Hermes。

如果继续使用：

- 保留 Hermes gateway。
- 保留 Feishu app 配置。
- 保留本地插件目录。
- 保留 voice wake LaunchAgent。

如果替换 Hermes：

- 新 agent 需要实现同等输入输出契约。
- 至少支持飞书确认卡片和语音记录。
- 需要读取 `asr-context.json` 的热词和纠错。
- 需要支持 Codex 或等价本地编码工具。

## D. 飞书

确认：

- 新 agent 能发送文本消息。
- 新 agent 能发送交互卡片。
- 点击卡片后能显示已确认/已取消。
- 点击确认不会绕过用户授权。

## E. 语音

确认：

- 唤醒词。
- 静音截断时长。
- 噪音阈值。
- TTS 声音。
- 启动提示。
- 思考提示。
- 语音记录同步。

## F. Codex / 本地编码

确认：

- 本地项目路径由用户确认。
- 执行前有飞书授权。
- 完成后有可读总结。
- APK 输出路径能被发现和发送。

## G. 验收测试

至少跑这些场景：

1. “玉兔玉兔，现在几点”
2. “玉兔玉兔，帮我搜索最新 AI 大模型消息”
3. “玉兔玉兔，给姐姐发邮件”
4. 在飞书点确认和取消，卡片状态必须变化。
5. 飞书回复 `纠错：错词=>正确词`
6. 飞书回复 `热词：测试热词`
7. 发起一个 Codex handoff 测试任务，但不要让它改真实项目。
