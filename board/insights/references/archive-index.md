# 洞察员 references 索引

更新时间:2026-07-05T10:44:44.448Z

## 默认读取顺序
- 热区:`../insights.md` 只保留最近 4 个 insight-scout 运行批次,并受 100KB 上限保护。
- 去重:`../seen-repos.json` 只保留 `repos` URL 列表,用于下一批去重与追加。
- 冷区:需要历史上下文时,先按关键词/URL/slot 用 `rg` 检索本目录,再只读命中的归档小节。

## 归档分卷
- `archive-202606.md`:批次 82 个,标题 158 个,901541 bytes。
- `archive-202607.md`:批次 9 个,标题 14 个,20606 bytes。

## 外移元数据
- `borrowed-watch.json`:watch 配置 + borrowed_libraries 元数据;从 seen-repos 热库外移,按需读取。

## 备份收敛
- 根目录每个基准文件只保留最近 3 份 `.bak/.pre`;旧快照见 `backups/backup-manifest.json` 与 `backups/`。

## 并发与回滚
- 维护脚本使用 `../.archive.lock` 目录锁;写归档、索引、热区和 JSON 均先写临时文件再 rename。
- 若读取 `insights.md` 失败,脚本直接报错退出,不会删除或移动任何批次。
