# 行为与工作会话计时 MVP

页面：`http://192.168.2.16:8088/`。本版按坐席在位行为统计工作会话，不区分电脑、装配或维修，也不判断认真程度。前端采用等待/开工/作业中/暂停/完工五阶段；“完工”仅表示工作会话结束。

## 默认逻辑

- 坐席区域连续稳定在位10秒：自动开工，回溯到稳定在位起点。
- 起身/暂离60秒以内返回：待确认区间补入工作时间。
- 超过60秒：整段暂离改记休息；人在工位附近时不会因为达到5分钟而结束。
- 有效画面持续5分钟未观察到工位人员：会话结束时间回溯到本次未观察到人的起点，尾部5分钟不算工作或会话内休息。
- 检测缺失3秒内恢复：仅在此前坐席在位时桥接短缺失。持续缺失转为“未观察到人”，不等于已经证明离岗。
- 多人无法归属、关键点不足、机位/尺寸不匹配、算法结果超过1.5秒未刷新：未知，不持续累加工作时间。画面正常播放并不意味着算法结果仍然新鲜。
- 重连生成新流会话；工作会话在最后可靠算法观测处结束，新流需重新满足10秒确认。进程重启不补计停机时间。
- 手动开始须当前坐席在位；手动结束后保持结束，直到手动再开始或人员离开后重新进入。复核标记写入日志。

## 检测与区域

沿用YOLO11 Pose + ByteTrack。上半身肩部中点优先，单肩与鼻子组合为降级依据；不使用人体框底边判断坐姿。根据框重叠与至少三个共有上半身关键点的一致性合并重复检测。置信度0.4、IoU0.4、关键点距离阈值为图像对角线3%。轨迹ID不等于员工身份；单工位内轨迹ID切换不直接重开工作会话。

`configs/behavior.yaml` 保存阈值和原图2560×1440像素坐标下的station/seat多边形。当前区域根据现有画面给出，是MVP初始区域，尚未经过现场精度验收。画面中展示区域、人体框和关键点。不能仅凭坐席锚点落入区域，就声称模型已准确识别身体实际坐下或某个工序动作。

左侧静态背景ORB匹配用于辅助发现明显机位移动；匹配充分且估计平移/旋转/缩放超过阈值时进入未知，点击“确认当前机位”重建参考。该方法不能保证发现所有机位变化；移动相机后应人工检查并调整区域。尺寸变化会直接阻止行为判断。初始区域截图与机位参考图保存在本次运行目录。

## 接口、日志与回放

- GET `/api/work-status`：当前行为/状态、会话、工作/休息/未知/待确认时长、阈值与判断原因。
- POST `/api/work-action`，JSON `{"action":"start|end|review|confirm_camera"}`：手动操作；不符合当前状态返回409，跨来源请求返回403。
- `outputs/behavior/latest.json`：当前状态；`outputs/behavior/<run_id>/observations.jsonl`：算法观测；`events.jsonl`：会话、状态切换、区间分类、手动复核及中断证据；`regions.jpg`：初始区域截图。
- `scripts/run.py` CLI共用相同分类器与状态机，观测行包含work_session，统计包含已关闭会话，独立behavior-events.jsonl保存切换。文件回放按媒体PTS计算行为时间，不按处理帧数或处理速度计时。

```bash
cd /home/seeed/workspace/jetson-worktime
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/replay_behavior.py --input outputs/behavior/<run_id>/observations.jsonl --output outputs/behavior/replayed.jsonl
```

预览启动方式不变。若服务已在8088端口运行，不要重复启动：

```bash
nohup .venv/bin/python -u scripts/preview.py > logs/preview.log 2>&1 < /dev/null &
```

测试覆盖开工回溯、59秒返回、61秒休息、长时未观察到人、附近活动、多帧率一致性、重复人体框、多人/尺寸异常、短缺失、未知、迟到/重复结果、重连、手动操作等。真实相机已观察到稳定在位自动开工及页面时间增长。59/61/300秒边界用可控时间序列验证；尚未完成有标注的真实坐下/起身/离开/返回准确率评估，不用于正式考勤或绩效。

## 会话操作员绑定与返回确认

每个新会话绑定一名内部操作员。自动开始要求同一可跟踪候选在在位区连续满足开工确认时间。之后只依据本次操作员的证据累计时间，其他人的出现不会清空离开起点。

ByteTrack ID 仅用于同一视频流内的保守连续关联。自动返回要求相同 ID、距最后可靠观测不超过 missing_grace_seconds、人体框面积比 0.5–2，且 IoU 至少 0.2 或上半身锚点位移不超过上一人体框对角线的 50%。人员交叉竞争、长缺失或新 ID 需要人工确认。持续可见的操作员在工位附近活动时保留现有附近活动规则。

输入不可靠时记未知，保存离开起点，暂停有效离开确认时间。有效画面中的其他人员不会暂停或重置原操作员的缺失确认。达到 stop_absent_seconds 后会话结束，结束时间回溯至原操作员缺失的起点。长缺失后的原人员返回可能需要人工确认，轨迹关联不能保证员工身份正确。

页面的更多操作提供“确认操作员返回”。确认面板展示隐私处理后的配对图像及候选轨迹，自动刷新。只能确认当前新鲜、在位的人员。过期观测、切流、配置变化、会话已结束或重复确认均返回 409。

状态与观测增加可选 ownership，包含 operator_id、track_id、run_id、stream_session_id、state、needs_confirmation、candidates、ignored_track_ids、away_since、absent_since、away_seconds、absent_seconds、end_remaining_seconds。内部操作员标识仅在该会话内有效。persons 增加 is_session_operator 与 ownership_zone。

POST /api/v1/work/actions 的确认请求为以下结构。

```json
{"action":"confirm_return","session_id":"当前工作会话","observation_id":"新鲜观测","stream_session_id":"当前视频流会话","config_revision":18,"track_id":7}
```

人工确认从所选观测接收时间生效，保留真实未知区间。事件记录 operator_bound、operator_association_changed、other_person_ignored、operator_return_confirmed，结束事件包含人员关联与结算区间。配置阈值继续使用设备当前设置。

观测回放使用同一人员归属入口。存在人工确认时同时提供对应事件文件。

```bash
.venv/bin/python scripts/replay_behavior.py --input outputs/behavior/<run_id>/observations.jsonl --events outputs/behavior/<run_id>/events.jsonl --output /tmp/ownership-replay.jsonl
```

旧记录缺少轨迹证据时标记 UNVERIFIED，不将其作为人员区分验收证据。回放应提供采集时对应的配置文件。真实多人交叉准确率仍需要带标注的现场片段验证。
