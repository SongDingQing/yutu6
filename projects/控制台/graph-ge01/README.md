# GE-01 standalone graph compiler

本目录是 `yutu-graph@1` 的 GE-01 离线/影子实现。它没有生产接线。

## 独立复现

```sh
make -C projects/控制台/graph-ge01 clean all
projects/控制台/graph-ge01/build/yutu-graph compile \
  shared/routing/flows/review-loop.yaml /tmp/review-loop.manifest.json
projects/控制台/graph-ge01/build/yutu-graph validate \
  /tmp/review-loop.manifest.json
projects/控制台/graph-ge01/tests/run.sh
```

编译结果必须与 `golden/review-loop.manifest.json` 逐字节相同。

## 离线 review-loop

```sh
projects/控制台/graph-ge01/build/yutu-graph review-loop \
  projects/控制台/graph-ge01/fixtures/review-revisions \
  /tmp/review-loop-receipt.json
```

输入是按文件名排序的完整 YAML 修订，`DONE` 是本地结束标记。默认 500ms poll、最多 3 次、5 秒超时、8MiB 应用跟踪内存上限。

## 真实路由影子投影

```sh
chmod a-w projects/控制台/graph-ge01/snapshots/project-route-20260716T092650889Z.json
projects/控制台/graph-ge01/build/yutu-graph shadow \
  projects/控制台/graph-ge01/snapshots/project-route-20260716T092650889Z.json \
  projects/控制台/artifacts/graph-ge01-cr-1784715913317-d7f047c7/shadow-logs-20260722T000000Z
```

临时 `yutu-shadow-*` 命名空间自动清理；只有显式白名单的任务日志目录可保留报告。测试会比较生产冻结 eventlog 与快照的写前/写后 hash、mtime、mode，并把结果与固定 golden 逐字节比较。

完整合同和回退边界见 `CONTRACT.md`。本目录不实现或启用 GE-02。
