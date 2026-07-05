# 玉兔6 本地知识库(最小原型)

`wiki/`(原文,人可读可编辑)→ `kb.sqlite`(向量 + 全文 + 图谱)→ 检索。
嵌入式单文件、零常驻服务。

## 依赖

- Python 3.9+
- **sqlite-vec**(向量):`pip install sqlite-vec`
  若 pip 源没有,从 https://github.com/asg017/sqlite-vec/releases 下 loadable 扩展。
- **Ollama**(embedding):`ollama serve` 且 `ollama pull nomic-embed-text`
- 可选(图谱抽取 / 直接作答):任一 chat 模型,如 `ollama pull qwen2.5`,并设 `XJ_CHAT_MODEL=qwen2.5`

## 用法

1. 把笔记 `.md` 放进 `../wiki/`(已带两个示例)。
2. 写入库:`python3 ingest.py`
3. 检索:`python3 query.py "Morgan 喜欢吃什么"`
   加 `--answer` 让本地模型直接作答:`python3 query.py "给家里订餐厅" --answer`

## 环境变量(可选)

| 变量 | 默认 | 说明 |
|---|---|---|
| `OLLAMA_HOST` | http://localhost:11434 | Ollama 地址 |
| `XJ_EMBED_MODEL` | nomic-embed-text | embedding 模型(768 维) |
| `XJ_CHAT_MODEL` | (空) | 设了才开"图谱抽取";query 作答默认 qwen2.5 |

## 说明

- 换 embedding 模型 → 维度可能变,需删 `kb.sqlite` 重建(并改 `schema.sql` 里 `FLOAT[768]`)。
- 图谱抽取靠 chat 模型,有噪声;改 `wiki/` 原文重跑即可修正(被否决的关系置 `status='deprecated'`)。
- 多端共享:`kb.sqlite` 留在 mini,由 bridge 包成 API(见设计文档 §9);别让手机直接持库。
- `kb.sqlite` 纳入快照 + 冷备(玉兔2);`wiki/` 进 git。
