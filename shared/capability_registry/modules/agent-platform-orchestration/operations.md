# Operations

## 查看平台和模型

```bash
cd /Users/yutu6/玉兔6工作区
bash agent-platforms.sh list --json
bash agent-platforms.sh models --json
bash agent-platforms.sh doctor yutu6-native --json
bash agent-platforms.sh doctor nexent --json
```

输出只包含 runner、模型、能力边界、健康状态和 KEY 来源类型，不读取或显示
密钥值。

## 准备 Nexent

```bash
bash agent-platforms.sh plan nexent --json
bash agent-platforms.sh prepare nexent --json
```

`prepare` 只会克隆官方 `develop` 分支到
`~/AgentPlatforms/nexent`，不会启动容器。若目录已经存在，会校验
`origin`；不会覆盖脏工作树。

## 按需启动 Nexent

```bash
bash agent-platforms.sh start nexent --confirm-heavy
```

启动前会检查 Docker、CPU、内存、磁盘和端口。Nexent 官方 Web 端口 `3000`
与玉兔6 new-api 冲突，管理器仅在部署命令执行期间把 Nexent 映射临时改成
`127.0.0.1:3100:3000`，随后恢复官方 compose 文件。Nexent 不加入
`start-all.sh`，也不加入 LaunchAgent。

停止但保留数据：

```bash
bash agent-platforms.sh stop nexent
```

## 复用玉兔6模型池

Nexent 运行在容器内，因此 OpenAI-compatible provider 的 base URL 使用：

```text
http://host.docker.internal:3000/v1
```

内部令牌只从玉兔6本地 new-api 配置读取后在 Nexent 本机界面配置。不要复制
上游厂商裸 key，不要把令牌放进命令参数、Git 或聊天。

## 发现和调用 A2A Agent

```bash
node shared/tools/a2a/a2a-client.js discover \
  --url http://127.0.0.1:5013/nb/a2a/<endpoint-id> \
  --token-file /path/to/local.env \
  --token-key NEXENT_INTERNAL_TOKEN

printf '%s' '请检查这个任务并返回结构化证据' | \
  node shared/tools/a2a/a2a-client.js run \
  --url http://127.0.0.1:5013/nb/a2a/<endpoint-id> \
  --protocol http-json \
  --token-file /path/to/local.env \
  --token-key NEXENT_INTERNAL_TOKEN
```

不支持 `--token <值>`，避免密钥进入 shell 历史和进程列表。

## 验证

```bash
node tests/agent-platforms.test.js
node tests/a2a-client.test.js
```

## 回滚

1. 停止 Nexent：`bash agent-platforms.sh stop nexent`。
2. 删除玉兔6 runner 中后来添加的具体 A2A endpoint（若有）。
3. 删除本模块、`agent-platforms.sh`、平台目录和 A2A 客户端。

回滚适配层不触碰玉兔6原生队列、模型池数据或 Nexent 持久化卷。
