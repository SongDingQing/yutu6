# 玉兔6 密钥防泄机制（多层可验证约束）

目标：把 yutu6 主仓迁到 GitHub 并**持续**保证任何密钥/凭据不进入 git（工作树、暂存区、提交、历史、远端）。
思路：**一个检测引擎 + 五层约束**，层层独立、失效不共振，覆盖从"人写代码"到"内容落到 GitHub"的每一个环节。

## 检测引擎

`security/secret-scan.js`（零依赖 Node）是所有层共用的**唯一**引擎，避免各处规则漂移。五个检测器：

| 检测器 | 规则 | 级别 |
|---|---|---|
| forbidden-path | `.meow_art/`、`secrets-consolidate`、`*.env`(任意)、`new-api/*.env`、`backups/`、`*.pem/*.key/*.keystore`、`.netrc/.pgpass/.npmrc/.git-credentials`、`kubeconfig`、`service-account*.json`、`id_rsa/ed25519`、`MacMini-Secrets`、`.claude/worktrees/` 等禁区路径（与 `.gitignore` 逐条对齐，有漂移断言测试守护） | error（阻断） |
| fingerprint | 已知密钥的 SHA256 前12位指纹（`secret-inventory.json`，**只存哈希不存原文**）。改文件名/改字段名也能抓；对候选 token 还做 base64/hex 解码后再比对，防"换个编码就泄露" | error |
| token-shape | `sk-`、Stripe `sk_live_`、SendGrid `SG.`、`ghp_`、`github_pat_`、GitLab `glpat/gldt-`、Slack/Discord webhook、`hf_`、`npm_`、`dckr_pat_`、PyPI、Telegram、AWS `AKIA`、阿里 `LTAI`、腾讯 `AKID`、Twilio `AC/SK`、Mailgun `key-`、Google `AIza`、Azure `AccountKey=`、JWT、PEM、SSH、智谱 `hex.秘串`、企微/钉钉 webhook 等成形 token | error |
| content-struct | 连接串内嵌口令(`postgres://u:p@`、`mongodb+srv://`、`redis://`、JDBC…)、URL userinfo、`.npmrc` 裸 `_auth`、docker `auth`、kubeconfig `client-key-data`、XML `<password>`、HTTP `Basic/Bearer` 头、GCP `service_account` 文件特征 | error |
| keyname-assignment | `api_key/password/client_secret/aws_secret/otp_secret/hmac_key... = <疑似实值>`，含中文键名(`密码=`)、CLI(`--password`)、YAML 多行块标量(`password: |`)（排除占位符、`process.env`/`args.x` 引用、代码表达式） | error |
| high-entropy | 高熵长串（≥28 位、香农熵≥4.3），排除哈希/路径/标识符 | **warn（仅提示，不阻断）** |

设计取舍：本仓库智能体日志天然含大量 task-id、"token 用量"等词，熵检测按 error 会淹没真信号，故降为 warn；**阻断交给五个精确检测器**，误报率低、可信度高。二进制/含 NUL 文件不再整体跳过（用 latin1 跑精确检测器）；模板 `*.example` 文件仍跑指纹+token 形态（成形密钥无论在不在模板都不该有）；超大文件前 2MB 全扫、剩余精确粗扫。命中一律**掩码回显**（首尾各留 4 字符），绝不打印密钥原文。

**这套规则经过对抗式红队验证**：8 个红队智能体从云厂商 token、凭据配置文件格式、赋值语法、低熵规避、指纹变形、二进制/大文件六个角度构造真实密钥样本、**实测**扫描器是否漏检，共 87 个样本；修补后所有真实世界格式的样本均被拦截，同时对本仓库 624 个已跟踪文件保持 0 误报。见 `tests/secret-hygiene.test.js` 的多向量防空转夹具表。

误报处理：确证是误报 → 在 `security/scan-allowlist.json` 登记 `{path, line_sha12, reason}`。行内容一旦改动，哈希失效、白名单自动作废（防止"白名单越攒越松"）。

## 五层约束

```
 写代码 ─▶ [L0 .gitignore] ─▶ git commit ─▶ [L1 pre-commit] ─▶ [L2 引擎软约束]
                                                                      │
        GitHub ◀─ [L4 CI secret-scan] ◀─ git push ◀─ [L3 pre-push] ◀─┘
                        ▲
                        └── [L2.5 测试硬约束 tests/secret-hygiene] 每次 node tests/run.js
```

- **L0 软约束·忽略** `.gitignore`：禁区路径根本进不了暂存区。软 —— 只挡"不小心 add"，`git add -f` 可强绕。
- **L1 硬约束·本地提交钩子** `.githooks/pre-commit`：提交前扫暂存区，error 即拒。挡"手滑提交密钥"。
- **L2 软约束·逻辑链** `version-progress-hook.js` 的 `secretScanStaged`：引擎真完成**自动提交**前扫暂存区，命中即撤暂存、回滚版本号、不提交。这是"智能体自动发版"链路里的软约束（委托同一引擎，引擎不可用则退回内置正则兜底）。
- **L2.5 硬约束·测试** `tests/secret-hygiene.test.js`（已注册进 `tests/run.js`）：每次跑测试都扫 HEAD 全量已跟踪文件，error 即测试失败。**钩子能被 `--no-verify` 绕过，测试不会** —— 这层把"密钥不进 git"钉成和功能正确性同级的回归红线，还含"扫描器自检"用例防止引擎被改坏成空转。
- **L3 硬约束·本地推送钩子** `.githooks/pre-push`：推送前逐提交扫"将新增到远端的内容"。即便某次 commit 绕过了 L1，推送前仍复查。
- **L4 硬约束·CI** `.github/workflows/secret-scan.yml`：**在 GitHub 上生效**，每次 push/PR 复扫，error 即红叉。这是本地全被绕过（`--no-verify`/未启用 hooksPath）时唯一的服务器端闸门，务必在 GitHub 仓库 Settings→Branches 里把它设为分支保护的**必需检查**。
  > 注意：GitHub Actions 只在 GitHub 远端跑；旧的 gitee 远端**不执行**本 workflow。玉兔6 主仓迁 GitHub 后本层才是活的。gitee 若仍在用，需另配 Gitee-Go 流水线调同一扫描器，否则 gitee 侧无服务器端复查。

## 启用（新克隆一次性）

```bash
git config core.hooksPath .githooks    # 启用 L1/L3 本地钩子
node tests/run.js                        # 跑一次含 L2.5 的测试
```
> 钩子路径是**本地配置**，不随仓库自动生效。README 顶部与 onboarding 需提示每台机器执行一次。CI(L4) 无需本地配置，克隆即随仓库生效。

## 手动核查命令

```bash
node security/secret-scan.js --staged     # 暂存区（= pre-commit）
node security/secret-scan.js --tracked    # HEAD 全量（= 测试/CI）
node security/secret-scan.js --range A..B  # 提交范围（= pre-push）
node security/secret-scan.js --history     # 全历史每个 blob（迁移前全量核查）
node security/secret-scan.js --paths a b   # 指定工作树文件
```

## 指纹清单维护

新增了密钥（改了保险库 `~/.config/yutu6-secrets/secrets.env` 或某个 `.env`）后，重跑指纹提取脚本刷新 `secret-inventory.json`（只写哈希）。清单越全，"换名字重现"越难逃逸。

## 应急预案（万一密钥已进 git / 已推远端）

1. **立即轮换**：作废并重签该密钥（这是唯一彻底止血 —— git 一旦推出去就应视作已泄露，即便随后删除，也可能已被爬取/缓存/索引）。
2. **清历史**：`git filter-repo --path <泄露路径> --invert-paths`（或 `--replace-text`），重写所有含该 blob 的提交。
3. **强推**：`git push --force`（迁移窗口内独占操作，先确认无并发写者）。
4. **补指纹**：把泄露值的 SHA256 前12位加进 `secret-inventory.json`，防止它换名字再溜进来。
5. **复盘**：在 `memory/experience.md` 记教训，必要时补检测规则。

## 已知历史事实（迁移基线，2026-07-05 全量扫描 + 红队验证）

- 本机 gitee 主仓 41 个提交：**唯一** error 级暴露 = 123 个 `shared/tools/meowa/.meow_art/*/meta.json`（含 meowa `api_key`，指纹 `7ee58f13547c`），均由单个提交 `9a761a4` 引入。
- `secrets-consolidate.txt`、`new-api/*.env`、保险库 `~/.config/yutu6-secrets/secrets.env` —— **从未被 git 跟踪**，不在任何提交里。
- **迁移到 GitHub 采用"全新基线"**：GitHub 上是一个由当前干净工作树（已从索引移除 `.meow_art`）打的**单根提交**，历史里**从不存在**那个 key。gitee 保留完整 41 提交历史作**私有存档**（历史里仍含旧 key —— 该 key 已由老板轮换作废，且指纹已入清单作 tripwire）。
- 结论：**推到 GitHub 的内容零密钥**（迁移前 `--tracked` 与将推送的基线树均 0 error 验证）。
