# 维护资料与历史归档

本目录保留环境版本、依赖来源和安装包元数据。历史报告、调试输出、旧界面、导出模型和构建残留按批次归档到设备上的 `../jetson-worktime-archives/`。

每批归档包含以下文件。

- `history.tar.gz` 保存文件原相对路径与内容。
- `history.tar.gz.sha256` 保存归档包校验值。
- `manifest.json` 记录原路径、大小、SHA256、处理用途和测试素材迁移映射。
- `removed.jsonl` 逐项记录已经移除的路径。
- `before.json`、`result.json` 记录进程、会话、保护文件校验值与目录体积。
- `RESTORE.md` 提供该批次的恢复命令。

历史资料通过归档清单中的原相对路径查找。恢复时先校验压缩包并解压到独立恢复目录，再选择需要的文件拷回项目。

## 本次整理记录

2026年11月10日完成，归档目录为 `/home/seeed/workspace/jetson-worktime-archives/20261110-133341`。逐项清单见该目录的 `manifest.json`、`removed.jsonl` 和 `retained-files.txt`，验收结果见 `cleanup-complete.json`。

项目逻辑体积约从 4.15 GB 降至 2.12 GB。历史归档约 584 MB。当前运行数据持续写入，体积随时间变化。

恢复命令见归档目录的 `RESTORE.md`。
