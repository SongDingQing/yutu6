# Operations

## 启动与检查

```bash
cd /Users/yutu6/玉兔6工作区
bash start-all.sh start
bash start-all.sh status
```

## 安装登录启动

```bash
bash projects/控制台/tools/install-unified-startup-launchd.sh
launchctl print gui/$(id -u)/com.yutu6.startup
```

## 验证

```bash
bash start-all.sh validate
node tests/yutu6-startup.test.js
curl -fsS http://127.0.0.1:41218/api/health
curl -fsS http://127.0.0.1:3000/api/status
curl -fsS http://127.0.0.1:8642/health
```

状态和日志不包含密钥值。`status.json` 只记录组件 id、PID、端口健康和容器状态。

## 回滚

```bash
bash projects/控制台/tools/install-unified-startup-launchd.sh --unload
```

此操作只移除统一协调器，保留各组件自身的 LaunchAgent 与容器重启策略。
