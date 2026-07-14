# SSH 与 Git 远端

通用发行版不携带任何个人公钥、私钥路径或固定仓库账号。

## 部署前检查

```bash
ssh -T git@github.com
git remote -v
```

GitHub 登录和 SSH 授权由用户完成。私钥只保存在 `~/.ssh/`，不得复制到工作区。

## 远端规则

- 新克隆使用 Git 自动创建的 `origin`。
- 版本发布器只使用现有远端；远端缺失时停止并提示配置。
- 若确需自动添加远端，用户必须显式设置 `YUTU6_RELEASE_REMOTE_URL`。
- 项目仓库地址属于对应项目能力包，不写入系统配置。
- 禁止把含用户名、密码或 token 的 HTTP URL 写入仓库。
