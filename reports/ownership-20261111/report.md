# 工位会话人员绑定与暂离计时修复

2026-11-11。功能已部署到 `seeed@100.98.151.121` 的 `/home/seeed/workspace/jetson-worktime`，服务端口为 8088。

## 实现结果

- 开工绑定连续满足条件的同一轨迹，保存会话内操作员标识、运行、流会话和轨迹关联。
- 工作、附近活动和缺失按本次操作员判断。其他人员进入附近或在位区会保留原离开进度。
- 同 ID、短缺失及空间连续满足条件时自动关联。长缺失、新 ID、明显跳变或交叉竞争进入人工返回确认。
- 未知输入暂停有效离开确认时间，保留起点。状态查询只展示新鲜时间投影，避免查询频率改变结算。人工确认前接收、确认后才完成的帧会被拒绝。
- 页面增加操作员标识、离开进度、结束倒计时和人员确认面板。配对图片继续经过隐私处理，支持中文和英文。
- 确认接口在锁内校验当前工作会话、视频流、配置版本、观测、时间及目标人员。过期、重复或会话结束返回 409。
- CLI、实时服务与观测回放共用人员归属逻辑。回放可加载人工确认事件。旧日志缺少轨迹证据时标记 UNVERIFIED。

计时继续使用现场设置。稳定在位为 10 秒，短暂离为 30 秒，持续缺失结束为 31 秒。区域沿用现场配置。

本轮还复验出旧 RTSP reader 在第 50 帧附近报 `not-linked`。已复用模板中验证过的 `rtpfunnel` 多 SSRC 接入，保留原硬解码和有界取帧方式。采集窗口保持一个视频流会话。该连续采集证据形成于最后的到期返回边界补充前，最后重启后的健康状态另见 `device-evidence/delivery-health.json`。

## 验证结果

| 项目 | 状态 | 证据与范围 |
|---|---|---|
| 部署后后端回归 | PASS | 124 项，`device-evidence/tests-final-postdeploy.log` |
| 当前本地前端回归 | PASS | 26 项，`frontend-final-live-source.log` |
| 路人反复经过回放 | PASS | 旧逻辑未结束会话，新逻辑结束时间回溯到第 13 秒，工作时间为 13 秒 |
| 人工确认与计时边界 | PASS | 覆盖新 ID、交叉、短漏检、未知、迟到结果、重复确认、切流及帧率一致性 |
| 实机人员归属 API | PASS | 9 项，包括结构化字段、配对图像、无效确认 409 和跨源 403 |
| GPU 数值与 CUDA NMS | PASS | Torch 2.7.0、torchvision 0.22.0、CUDA 12.6，NMS 返回 `[0,2]` |
| 已部署服务完整 HTTP 检查 | PASS | 较早一次复跑 22/22，`device-evidence/api-postdeploy-retry/acceptance.json` |
| 最终完整 HTTP 复跑 | FAIL | 前 18 项通过，新增 MJPEG 连接被既有三观看连接上限返回 429，后续检查未完成。原始失败报告保留 |
| 最终真实流连续采集 | PASS | 264.65 秒、2400 条观测、单一流会话，无算法错误，未记录 stream_failure |
| 真实 A 离开、B 经过、A 返回演示 | NOT RUN | 最终现场采集未出现持续满足开工绑定条件的操作员，2400 条归属状态均为 UNBOUND |
| 有标注的多人归属准确率 | NOT RUN | 需要真实多人片段及人工返回确认演示 |

最终 HTTP 的观看上限属于并行开发中的媒体连接策略。本轮保留该策略，未断开已有观看者。较早完整检查通过与最终容量受限均保留证据，不能据此声明最终媒体完整复验全部通过。

本次实际演示了 Mock 页面选人并确认恢复工作，中英文均检查过。截图 `confirmation-dialog-mock.png`、`confirmation-working-mock.png`、`ownership-dashboard-mock.png` 均使用明确标注的合成画面。`live-dashboard.png` 是实际页面检查，当时额外观看连接受限，画面处于准备状态。

## 并行开发与保护

首次发布前检查发现另一开发进程更新了本地和实机源码，写入在修改前中止。随后基于更新后的实机基线重新合并，保留了 WebRTC、低带宽预览和配色功能。

本轮功能涉及 27 个源文件。模型权重、pyproject.toml、uv.lock 的哈希保持一致。配置文件由现有系统和并行操作更新，从发布前 v21 到最终采样 v22，本轮代码发布没有写入该配置，10/30/31 秒阈值保留。

并行开发在发布后继续更新了部分文件，原有人员绑定、确认接口及计时入口仍存在，最终源文件快照位于 `final-device-source/`。快照哈希见 `final-source-manifest.json`，本轮发布前后哈希见 `release-changes.json`。本地源码位于 `/Users/chenzibo/data/project/Jetson/workspace/jetson-worktime-settings/source`，包含保留的较新并行改动。

## 使用与回放

访问 `http://100.98.151.121:8088/`。开工后，页面显示当前操作员。身份连续性不满足时，在“更多操作 → 确认操作员返回”中对照配对画面选择人员。确认会从所选观测接收时间生效。

服务启动命令为以下内容。

```bash
cd /home/seeed/workspace/jetson-worktime
bash start.sh
```

设备当前已运行。观测、人员关联和结束事件位于 `outputs/behavior/<run_id>/`。

```bash
.venv/bin/python scripts/replay_behavior.py \
  --input outputs/behavior/<run_id>/observations.jsonl \
  --events outputs/behavior/<run_id>/events.jsonl \
  --config /path/to/captured-config.yaml \
  --output /tmp/ownership-replay.jsonl
```

可控回归输入和前后结果位于 `replay-before/` 与 `replay-after-delivery/`。脱敏真实观测回放位于 `device-evidence/real-observations.jsonl`、`real-replay-result.jsonl`。这些回放没有真实人员身份标注。

## 回退与限制

设备回退文件位于 `/home/seeed/workspace/jetson-worktime-ownership-20261111/`。

- `baseline-v2.tar.gz` 保存发布前源码与配置，仅在设备受限目录保留。
- `rollback-release.py` 默认检查哈希。停止服务后才能显式应用回退。
- `ownership.patch` 与 `ownership-reverse.patch` 提供本轮前后差异。

发布后已有并行改动，直接回退的哈希检查会拒绝覆盖这些文件。应在独立副本对反向补丁做三方合并、验证后再受控发布。

本版使用轨迹、空间和时间连续性进行保守关联。跨长时间离开或人员交叉时需要人工确认。ByteTrack 轨迹不能保证员工身份。现场尚未完成完整的操作员离开、路人经过及返回演示，不能将可控回放结果作为现场人员归属准确率。
