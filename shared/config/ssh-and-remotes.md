# 玉兔6 · 全局 SSH 与 Git 远程配置

> 玉兔6 长期全局配置(非密)。**私钥真值不在此、不进 git** —— 只记公钥、host、路径与用途。
> 私钥真值存两处:`~/.ssh/`(运行)+ 桌面密钥库 `MacMini-Secrets-PRIVATE-.../ssh/`(备份,和其他密钥一起)。

## SSH 密钥

| 用途 | 私钥文件 | Host | 状态 |
|---|---|---|---|
| **玉兔6 ↔ Gitee**(clone 改版 Hermes 等) | `~/.ssh/id_ed25519_gitee_yutu6` | gitee.com | ✅ 老板确认已全局配置;IT 工程师只使用 SSH remote,不回显私钥 |
| 玉兔6 ↔ GitHub(YuanXiao/Simulaid) | `~/.ssh/id_ed25519_github_yutu6` | github.com | ✅ 已使用通用 GitHub 身份 |

### Gitee 公钥(可公开)
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL0UYxxaCCA34DkUEpG8/APdL+0jLtiRP86FYJk3q99e yutu6-gitee
```
指纹:`SHA256:20xwGMRKrjA0Z6BbrMbUFVOo+xBg/bOVzlimAr307X8`(ed25519,无 passphrase)

### ~/.ssh/config 段(由 place-gitee-key.sh 自动写入)
```
Host gitee.com
  HostName gitee.com
  User git
  IdentityFile ~/.ssh/id_ed25519_gitee_yutu6
  IdentitiesOnly yes
```

## Git 远程(玉兔6 项目)

| 仓库 | 远程地址 | 落点 | 备注 |
|---|---|---|---|
| 玉兔6工作区 | `git@gitee.com:songdingqing/yutu6.git`(公开页 `https://gitee.com/songdingqing/yutu6`,分支 `main`) | `/Users/yutu6/玉兔6工作区` | IT 工程师通过 `projects/控制台/tools/version-manager.js` 维护四段版本号、commit、push 和安全回滚;不写密钥 |
| 改版 Hermes | `git@gitee.com:songdingqing/lunar-forest-hermes.git`(分支 `master`,commit `e8d5efa`) | `~/.hermes/hermes-agent` | ✅ 全量改版源码(5 核心文件在根)+ `yutu6-hermes-migration/`(plugins/voice-wake);已确认未推任何密钥。直接 clone,不需 patch |
| YuanXiao | `git@github.com:SongDingQing/YuanXiao.git` | `~/Projects/YuanXiao` | 私有 |
| Simulaid | `git@github.com:SongDingQing/Simulaid.git` | `~/TuanjieProjects/Simulaid` | 私有;团结游戏项目 |
> **团结(Unity)游戏项目统一父目录:`~/TuanjieProjects/`**(ASCII 路径,避免团结/Unity 构建安卓/iOS 时 Gradle/Xcode 对非英文路径报错)。以后所有团结游戏项目都 clone 到这里,如 `~/TuanjieProjects/<项目名>`。

## 放置 / 启用步骤
1. 当前任务以“老板确认 Gitee SSH 已全局配置”为准。
2. 验证只跑 `ssh -T git@gitee.com` 或 `git push` 结果,不打印私钥、不读取密钥文件。
3. 若未来迁机或重配,再跑 `bash projects/_迁移/scripts/place-gitee-key.sh`(装 `~/.ssh` + 备份密钥库 + 写 config + 清暂存)。
4. 把上面 Hermes 的 Gitee 地址告诉总管 → 写进 `clone-repos.sh` 并更新 `runners.yaml` 的 Hermes source。
