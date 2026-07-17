# 洞察员冷热分离维护报告

维护时间:2026-07-05T10:44:44.448Z

## 范围
- 仅处理 `board/insights/` 数据与维护脚本,并接入控制台洞察员落盘路径。
- 不安装依赖;维护脚本只使用 Node.js 内置模块。
- Starlaid/星桥排除;未读取或写入密钥、token、cookie、验证码。

## 批次定义与热区策略
- 一批 = 一个 `<!-- insight-scout-run:... -->` marker 开始的洞察员单次运行输出。
- 热区保留最近 4 批;热区上限 100KB,超过时继续下沉最旧热批,至少保留 1 批。
- 冷区按批次日期归入 `references/archive-YYYYMM.md`。

## 前后体积
- `insights.md`:602829 -> 10146 bytes。
- `seen-repos.json`:仍为瘦身 schema,只含 `_note`、`updated_at`、`repos`;当前 repos=362,重复=0。

## 批次对账
- 维护前热区文件内批次:87。
- 维护后热区批次:4。
- 本轮新归档批次:82。
- 本轮已在归档中存在而跳过重复写入的批次:1。
- 对账:82 + 1 + 4 = 87。

## 归档文件
- `archive-202606.md`:批次 82 个,标题 158 个,901541 bytes。
- `archive-202607.md`:批次 9 个,标题 14 个,20606 bytes。
- 索引已更新:`archive-index.md`。

## 备份收敛
- 根目录 `insights.md` 快照保留 3 份,旧 1 份移动到 `references/backups/`。
- 根目录 `seen-repos.json` 快照保留 3 份,旧 1 份移动到 `references/backups/`。
- manifest 已更新:`references/backups/backup-manifest.json`。

## 并发与错误处理
- `scripts/maintain-insights.js` 使用 `.archive.lock` 目录锁。
- 归档、热区、索引、manifest、JSON 都通过临时文件 + rename 原子替换。
- 若读取 `insights.md` 失败,脚本抛错退出,不会删除或移动任何批次。

## 验证
- `node --check board/insights/scripts/maintain-insights.js` exit 0。
- `node board/insights/scripts/maintain-insights.js --workspace .` exit 0。
- `node board/insights/scripts/maintain-insights.js --workspace . --verify` exit 0,`errors=[]`。
- `node tests/insight-scout-repos.test.js` exit 0。
