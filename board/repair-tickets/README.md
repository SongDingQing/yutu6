# 维修工单

这里放秘书写给「维修员」的半自动工单。维修员是系统外特权 Codex,用于处理普通队列够不到的本机运维、授权、重启、部署和紧急救火。

## 创建

```bash
node projects/控制台/secretary-tools.js repair-ticket-add \
  --title "控制台服务需要重启" \
  --problem "秘书/队列无法自己重启宿主进程" \
  --evidence "projects/控制台/artifacts/server-run.log:..." \
  --expectation "维修员重启并验证 /workspace 200"
```

创建后会:
- 写入 `board/repair-tickets/<id>.md`;
- 在事件流写 `repair.ticket.created`;
- 在公告板加一张 `source=维修工单` 的提示卡。

## 消费

v1 不做常驻自动接单。主人或独立 Codex 打开对应工单后,用特权会话处理:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/<id>.md)"
```

## 完成

```bash
node projects/控制台/secretary-tools.js repair-ticket-complete --id <id> --result "已处理; 验证..."
```

该命令会追加处理结果,并在本机 Hermes/玉兔提醒脚本存在时尝试飞书通知主人。

## 红线

- 高危/不可逆操作必须先给主人确认。
- 密钥/token/cookie/私钥/验证码不回显、不写日志。
- Starlaid 排除。
- 维修员 v1 独立运行,不常驻监听,不依赖系统队列 worker。
