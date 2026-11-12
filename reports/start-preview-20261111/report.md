# 坐下不开工与预览卡顿修复报告

2026-11-11。部署位置：`/home/seeed/workspace/jetson-worktime`；访问 http://100.98.151.121:8088/ 。本机源码已同步到 `/Users/chenzibo/data/project/Jetson/workspace/jetson-worktime-settings/source`。未提交或推送。

## 原因与修改

录屏约 117 秒的 988 条观测全部被 `reason.moved` 拦截，配置为 v25。用户确认录屏前调整过机位，模型已经识别到前景人员。保持原人员绑定、10 秒连续在位、暂离 30 秒与结束 31 秒的规则。

- 首页增加开工确认进度、阻塞原因、上次确认中断原因及查看截图并确认区域的入口。机位待确认时标注“区域待确认”。更多操作的机位确认打开已有 ROI 编辑器。
- 实时视频先提交；JPEG 双语叠加放入独立的最新帧单槽，观测 JSONL 使用容量 256 的独立有界写入队列。存储失败停止业务累计并明确报告，正常退出排空队列。
- 修复限帧时提前丢弃新帧的问题：在发送时机到来前保留最新帧，不重复旧帧。
- 视频健康不再依赖单次结构化结果请求，减少请求超时引起的视频关闭重连。仍由服务器的算法观测新鲜度控制预览与计时。
- 新增接收、推理、JPEG、编码提交、发送和浏览器显示回调诊断。配置变更时，在发布前重新核对流、版本和隐私策略，保留精确帧配对。

## 自动验证

| 检查 | 结果 | 证据 |
|---|---|---|
| 后端回归 | PASS，130 项 | evidence/backend-production.log |
| 前端回归 | PASS，28 项 | frontend-tests.log |
| 独立端口接口 | PASS，22 项 | evidence/api-isolated/acceptance.json |
| 主服务接口 | PASS，22 项 | evidence/api-production/acceptance.json |
| Torch GPU / NumPy / CUDA NMS | PASS | evidence/gpu.json |
| 录屏阻塞复现 | PASS，988 次全部阻塞 | recording-replay.json |
| 使用已确认区域回放录屏观测 | PASS，确认 10 秒后开工，离开后结束 | recording-replay.json |
| 10 分钟真实 RTSP 算法健康 | PASS | evidence/soak-summary.json |
| 设备本地编码预览 45 秒 | PASS，438 包，无 >500ms 接收间隔 | evidence/local-encoded-preview.json |
| 发布后真人坐下、起身、路人经过 | NOT RUN，用户不方便演示 | 用户回复 |
| 原工位浏览器流畅度验收 | NOT RUN | 当前相机已经换景 |
| 临时桌面画面的 ROI 标定 | NOT RUN，保留原工位配置 | live-ui.png |

回放使用录屏对应的真实人体观测。对照组保留当时机位阻塞条件；验证组采用后来已确认的 v30 区域。会话开始回溯至录屏约 20.51 秒，实际开工判定须在连续满足 10 秒后才产生；约 67.87 秒为离开后回溯的结束时间。这是观测回放，不是重跑录屏 UI 的人体模型，也不是发布后真人验收。

## 10 分钟实测

持续 600.6 秒，600 次健康采样，7109 条完整观测。健康请求错误 0，新鲜观测比例 100.0%。

| 指标 | P50 | P95 | 最大 |
|---|---:|---:|---:|
| 输出 FPS（1 秒采样） | 11.88 | 11.99 | 12.08 |
| 推理耗时 ms | 63.9 | 79.1 | 360.6 |
| 接收至结果完成 ms | 92.3 | 151.1 | 422.3 |
| 结果间隔 ms | 83.3 | 105.5 | 396.6 |
| 观测年龄 ms（1 秒采样） | 205.2 | 264.8 | 436.5 |

处理结果间隔 >500ms 为 0；存储队列峰值 1，写入错误 0。进程 CPU P50 174.0%（多核进程可超过 100%）。RSS 范围 1439.7–1523.0 MiB，首末 +42.8 MiB，末 5 分钟首末约 +14.5 MiB，仍需更长时间检查趋势。以上耗时均为本机处理指标，不是相机曝光到结果的端到端延迟。

设备本地 RTSP 编码预览采样 45 秒：438 包，接收间隔 P95 170.0ms、最大 318.3ms，>500ms 为 0。公网浏览器会话期间的发送指标累计有 14 次 >500ms 长间隔，包含连接中断和发布器重建，不能宣称公网零卡顿。自动化浏览器自身动画回调约 1–2 Hz，故其显示回调统计保留为诊断证据，不作为工位本地浏览器验收。

## 源码保护与回退

独立副本、HTTP 8098 与媒体端口偏移 100 验证后发布。合并前逐文件核对实机及本机哈希，本轮修改 22 个文件，未发现需要覆盖的并行改动。`configs/behavior.yaml`、`pyproject.toml`、`uv.lock` 哈希保持一致。未修改模型、驱动、依赖或功耗模式。

回退文件在设备 `/home/seeed/workspace/jetson-worktime-start-preview-20261111/release-before`；完整私有备份仅保留设备，未导出凭据。回退脚本先核对已发布文件哈希，发现后续开发改动会拒绝覆盖：

```bash
python3 /home/seeed/workspace/jetson-worktime-start-preview-20261111/rollback.py --check
# 确实需要回退时，脚本会停止本服务、还原本轮源码并重新启动：
python3 /home/seeed/workspace/jetson-worktime-start-preview-20261111/rollback.py --apply
```

## 复跑与现场下一步

```bash
cd /home/seeed/workspace/jetson-worktime
./start.sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/smoke_api.py --base http://127.0.0.1:8088 --output reports/start-preview-api
```

相机恢复到目标工位后，先在首页查看新截图并核对区域，再保存区域、建立机位参考；随后真人坐下至少 15 秒，起身离开，让旁人经过并检查原会话离开进度。当前临时桌面场景不能替代该项验收。源码接口补充见 `docs/start-preview-diagnostics.md`。

## 交付时连接状态

发布、10 分钟采样和证据下载完成后，设备在 Tailscale 中显示离线，最终 SSH 和 HTTP 检查超时。不能确认交付此刻服务仍在运行。设备上的原始测试、采样及回退文件已保留在 `/home/seeed/workspace/jetson-worktime-start-preview-20261111`；最终 Markdown/JSON 报告未能同步回设备，该项记为 NOT RUN。本机完整报告和证据已经保存。恢复设备联网后可执行本报告旁的 `sync_reports.sh` 仅同步报告；如设备重启，进入项目运行 `./start.sh`。
