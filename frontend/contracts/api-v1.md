# 前后端接口契约 v1.0

基址为 Jetson 的 HTTP 服务（当前 http://192.168.2.16:8088）。本契约于 2026-11-04 建立；新增兼容字段可在 v1 内加入，破坏性变更使用新版本路径。机器可读接口定义见 openapi-v1.json，前端类型见 frontend/contracts/api.ts。

## 分工与数据边界

后端负责 RTSP、硬解码、YOLO11n Pose、ByteTrack、姿态去重、ROI 行为判断、健康检查及会话计时。前端仅展示、选择图层和发起人工操作；不能自行从轨迹 ID 推断员工身份、判定工作或用帧数重新计时。工作会话时长不是维修有效工时。当前 ROI 是未验收的初始区域。

相机地址及凭据仅保留 Jetson 的 .env，浏览器只连接 HTTP，不接收 RTSP 地址。纯净画面表示无本项目叠加，仍可能包含相机自身时间和水印。JPEG 最大宽1280、保持比例、最多12fps、无音频；GPU姿态目标5Hz，实际频率依设备负载。

## 接口

| 方法 | 路径 | 成功返回 | 用途 |
|---|---|---|---|
| GET | /api/v1/camera | JSON Camera | 视频连接、新鲜度、原图/预览尺寸、编码与帧率 |
| GET | /api/v1/video.mjpg | multipart/x-mixed-replace; boundary=frame | 最新纯净实时预览 |
| GET | /api/v1/video.jpg | image/jpeg | 最新纯净预览截图 |
| GET | /api/v1/observations/latest | JSON ObservationEnvelope | 最新结构化结果，无结果仍返回200、available=false |
| GET | /api/v1/observations/frame.jpg?observation_id=… | image/jpeg | 与指定结果精确对应的纯净帧 |
| GET | /api/v1/work/status | JSON WorkStatus | 后端权威状态与计时 |
| POST | /api/v1/work/actions | JSON WorkStatus | {"action":"start"、"end"、"review" 或 "confirm_camera"} |

GET 均无副作用（状态查询可能推进健康计时）。人工操作不自动重试；连接异常后先刷新状态确认结果。确认机位仅重建机位参考，不会把 ROI 改为已标定。手动开始要求当前可靠坐席在位、尚无活动会话；结束要求有活动会话；复核要求已有会话。当前不提供 ROI 写接口，后端维护 configs/behavior.yaml。

## 时间、身份及坐标

所有 JSON 含 schema_version="1.0"。纳秒字段（*_ns）为十进制字符串或 null，防止 JavaScript 精度丢失；秒及毫秒字段为数值。本机单调时钟仅用于同一 Jetson 启动期间的时差；不能作为 Unix 时间。PTS可缺失、重置，不用于工作累计。重连/PTS回退会生成新的 stream_session_id，receive_sequence 在同一流会话内有序但可能跳号；观测唯一键为 observation_id。进程重启 run_id 改变，不补计停机时间。

frame.source_width/source_height 是原图尺寸；所有 bbox_xyxy、关键点和 regions 坐标都基于原图，左上为(0,0)、x向右、y向下，框顺序[x1,y1,x2,y2]。jpeg_width/jpeg_height 为对应 JPEG 尺寸。缩放时用 JPEG宽/原图宽、JPEG高/原图高分别变换；object-fit:contain 还需加留白偏移。不要直接按页面容器尺寸缩放而忽略留白。

persons 是本次分类后保留的去重人体（没有员工身份含义）。person_track_id 可为null，可跨短时遮挡改变，不等于work session_id。keypoints 固定 COCO17 顺序：鼻、左眼、右眼、左耳、右耳、左肩、右肩、左肘、右肘、左腕、右腕、左髋、右髋、左膝、右膝、左踝、右踝。置信度0..1；低于提取阈值0.25的 x/y 为null；行为判断默认0.4，前端建议也只画>=0.4的点。upper_body_anchor 为肩中点或降级锚点，可为null。valid 是该人体记录可用标记，不是工作有效性结论。

inference.local_processing_ms 为本机推理开始到GPU同步完成；local_receive_to_result_ms 为本机解码取帧到结果完成；均不是相机曝光到结果的端到端延迟。accepted 指该观测被计时器接受；observation_valid 还要求行为非UNKNOWN。fresh 依据接收时刻、连接状态、accepted和算法错误动态计算，默认最大年龄1.5秒；fresh=false必须隐藏当前检测标注或明确显示“历史结果”，不能继续当作当前判断。

## 视频与结果同步

实时MJPEG与5Hz检测异步，不保证最新检测与正在播放的画面相同。可直接播放纯净流，并在旁边显示结果；要准确叠加，应轮询latest，取出observation_id和matching_frame_url，下载对应JPEG，校验响应X-Observation-ID，再一次性绘制JPEG和这份坐标。示例前端提供这两种模式。

后端仅缓存最近8份结果帧，不持久保存JPEG。取帧返回410 FRAME_EXPIRED时丢弃该结果，重新取latest；不能把新JPEG配旧坐标。同一observation_id不重复绘制新观测。断流后旧结果仍可查询用于复核，但fresh=false。MJPEG丢弃旧帧、不重复输出同一接收帧；连接会在无新帧约5秒后关闭，客户端按1秒、2秒、最多8秒退避重连，同时轮询camera确认状态。

截图和每个MJPEG part含X-Stream-Session-ID、X-Frame-Sequence；对应帧含X-Observation-ID。JSON/截图均no-store。图片最大宽1280，保留原图视野。算法结果帧与实时预览帧可能不同，这是预期行为。

## 工作状态

state: NOT_STARTED（等待）、START_PENDING（在位确认）、WORKING（工作会话中）、AWAY_PENDING（暂离确认）、REST（休息）、OBSERVATION_UNKNOWN（不确定）。已结束用active=false且session_end非null判断，前端显示“会话结束”，不能解释为工件完工。behavior: SEATED、NEARBY、MISSING、ABSENT、UNKNOWN。

work_seconds/rest_seconds/unknown_seconds/pending_seconds 为当前或最近一个会话的数值，不是今日总计。pending_seconds尚未结算，不能直接加到工作时间。数值可能因回溯确认而重新分类，应使用最新后端快照替换。前端可格式化显示，不能自行持续累加。session_start/end 为单调秒；展示墙钟时用 server_wall_time_ms + (session_start/end - server_monotonic_seconds)*1000，属于本机映射估计。start_pending_seconds是开工确认进度。reason提供可读原因，算法逻辑以枚举为准。

## 错误、开发与兼容

错误统一 JSON：{"schema_version":"1.0","error":{"code":"…","message":"…"}}。400 BAD_REQUEST：JSON/action/长度错误；403 ORIGIN_REJECTED：跨来源写入；404 NOT_FOUND；409 ACTION_UNAVAILABLE：状态不允许操作；410 FRAME_EXPIRED；503 FRAME_UNAVAILABLE：尚无新鲜图像。

无CORS开放；开发通过同源代理转发/api，保留浏览器Host（示例server.mjs已实现），不要把RTSP搬到前端。旧页面及/api/status、/api/frame.jpg、/stream.mjpg、/api/work-status、/api/work-action保留兼容，旧视频仍含项目叠加。v1请求无认证，沿用现有可信局域网部署。

联调顺序：Mock验证全部状态与断线→纯净预览→精确对应帧叠加→工作状态与操作。不要在无人知情时测试start/end或confirm_camera；联调可用无效action验证错误路径，正式人工操作会写证据日志并影响会话。

## 设备设置与隐私输出

`GET /api/v1/settings` 返回设备级 `revision`、`privacy.enabled`、`display`、`timing`、原图 `image_size`、`regions`、`roi_configured`、默认时长和当前相机信息。

`PUT /api/v1/settings` 提交 `expected_revision` 及要修改的字段。`privacy` 包含 `enabled`，`display` 包含 `boxes/regions/keypoints`，`timing` 包含全部五项秒数。数值必须有限，结束等待时间须大于暂离待确认和漏检缓冲时间。成功返回新配置，非法配置返回400，来源不符返回403，版本冲突或ROI截图过期返回409，保存失败返回500。客户端明确提交写入，冲突后重新读取并核对修改。

ROI使用原图像素坐标，每个多边形3至32个顶点，`seat`须完全位于`station`内。提交ROI时同时提交`image_size`以及`reference_frame: {stream_session_id, image_size}`。服务验证相机在线、来源会话和分辨率。ROI或时长发生变化会结束活动会话，原因记为`configuration_changed`，并重新确认开工。隐私与图层设置独立更新。

隐私默认开启。旧版流、v1无项目标注流、截图、检测对应帧及新增保存图片均应用设备当前隐私策略。“无项目标注”表示无检测图层。头部定位不足时扩大遮挡到人体框，无法取得可靠同帧结果时停止输出可识别画面。自动检测可能漏检，需现场验证侧脸、遮挡和多人效果。

图像响应包含`X-Config-Revision`和`X-Privacy-Applied: true|false`，检测对应帧继续包含`X-Observation-ID`。切换设置使旧缓存失效，旧对应帧返回410，MJPEG客户端需重新连接。新相机、观测和工作状态响应包含`config_revision/privacy_applied`，相机增加实际`output_fps`，观测增加当前`display`，观测信封增加`max_observation_age_ms`。历史v1快照可能缺少新增字段。

设置按设备统一管理，浏览器每秒刷新。设置页面位于`/settings`。部署面向可信局域网，可访问设备页面的用户能够调整设置。历史素材按生成时的策略保存，历史脱敏迁移需单独安排。

提交`regions`同时表示人工重新确认当前区域，即使坐标相同也生成新配置版本、重置机位参考并重新确认开工。隐私感知H.264录像在`recording-index.jsonl`保存每个分段的原媒体时间起点、配置版本和隐私标记，文件内保留相对PTS及采样间隔。

ROI截图引用同时携带取图时的`camera_changed`状态；机位待确认状态发生变化时，旧截图引用返回409，用户重新取图再确认。

## 设备实时指标

`GET /api/v1/system/metrics` 返回设备指标，共享缓存最长1秒，前端约每2秒刷新。`sampled_at_ms` 为采样墙钟毫秒，`age_ms` 使用单调时钟计算缓存年龄。前端拒绝超过5秒的样本，读失败的字段为 `null`。CPU首次取样建立基线，下一次采样后可用。

`cpu_percent` 为所有CPU核心的总体使用率，范围0到100，来自 `/proc/stat` 前八项的两次差分，将idle及iowait计为非忙碌时间。`gpu_percent` 为Jetson驱动load节点值除以10，表示采样时驱动报告的负载。`memory_used_bytes` 为MemTotal减MemAvailable，`memory_total_bytes` 为内核可用总物理内存，前端换算GiB。`temperature_celsius` 为CPU、GPU及SoC片上传感器的最高有效值，`temperature_sensor` 为对应名称。`uptime_seconds` 为设备启动至今的秒数。读取指标无需额外权限或依赖。

GPU单位依据 [NVIDIA Jetson Linux Developer Guide](https://docs.nvidia.com/jetson/archives/r39.2/DeveloperGuide/SD/PlatformPowerAndPerformance/JetsonOrinNanoSeriesJetsonOrinNxSeriesAndJetsonAgxOrinSeries.html#gpu-3d-frequency-scaling)。CPU与内存计数依据 [Linux proc文档](https://www.kernel.org/doc/html/latest/filesystems/proc.html)。

## 摄像头来源配置

设置弹层顶部提供网络／PoE（RTSP）和 USB 来源选择。初次启动兼容原有 `.env`。成功保存后使用 `configs/behavior.yaml` 中的设备配置。

- `GET /api/v1/camera/devices` 返回 USB 设备、名称及实际支持的 `yuyv`、`mjpeg`、`h264` 格式，优先返回稳定设备标识。
- `GET /api/v1/settings` 的 `camera_source` 返回脱敏后的当前来源。RTSP 密码仅写入设备文件，读取仅返回 `password_set`。RTSP URL 中的用户名和密码拆分存储，读取 URL 不包含认证信息。
- `POST /api/v1/camera/test` 提交 `expected_revision` 与 `camera_source`，后端读取有效帧后返回尺寸及有效期90秒的 `test_token`。测试不会保存或切换来源。
- `PUT /api/v1/settings` 单独提交 `expected_revision`、`camera_source`、`test_token` 执行切换。令牌绑定版本与候选配置。修改参数、版本变化或令牌过期后需要重新测试。冲突返回409，参数及连接失败返回400，持久化失败返回500。

RTSP 输入包含 `type: rtsp`、`url`、`username`、`password` 和 `codec`（`h264`／`h265`）。密码留空仅对相同地址及用户名保留已有密码。USB 输入包含 `type: usb`、`device` 和 `format`。

切换先验证候选有效帧，再原子保存配置。验证或保存失败保留原连接。切换成功后结算当前会话，清除旧帧和观测，以新的流会话继续预览，并将 ROI 标为待确认。用户需重新划定、保存区域，自动计时才恢复。USB 拔插后按保存的稳定设备标识重连。设备枚举由后端完成，浏览器无需直接访问摄像头。

## WebRTC 与配色

`GET /api/v1/camera` 的 `video` 包含媒体服务可用状态、预览参数、低带宽回退参数、错误和媒体 epoch。`POST /api/v1/video/whep/{locale}` 接收最大 128 KiB 的 `application/sdp`，返回 201、SDP answer、ETag 和同源 Location。浏览器先完成 ICE 收集再发送 offer，也可向 Location PATCH trickle ICE。每五秒 GET Location 续租，DELETE Location 释放连接，未续租三十秒后回收。最多同时三个观看客户端，包含 MJPEG 和握手中的连接。

设备设置增加 `visualization` 和 `visualization_defaults`。前者包含六项 `colors`（station、seat、person、skeleton、keypoint、anchor），值为六位十六进制颜色，以及 0–1 的 `station_fill_alpha` 与 `seat_fill_alpha`。PUT 提交完整的 visualization 组及 expected_revision，非法输入返回 400、冲突返回 409。只改变配色会使旧媒体失效并重建视频，不结算计时会话。观测响应携带同帧的 visualization，供 Canvas 标注使用。

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

WebRTC WHEP 与 MJPEG 地址支持 `profile=remote|local`。remote 默认 640×360/10 FPS/600 Kbps，local 最大 1920×1080/12 FPS/4 Mbps。浏览器按地址自动选择，localhost、回环地址和 RFC1918 局域网地址使用 local，Tailscale 地址使用 remote。高清流在原始脱敏帧上降采样，保留输入细节。

显示设置新增 station 和 seat，独立控制工位范围和在位判断区的蒙版、边界与标签。仍接受旧三字段显示配置，regions 的值同时应用于这两个开关。新配置保留 regions 兼容字段，其值为 station 或 seat 开启。

## Local material counting and training studio

`GET/PUT /api/v1/settings` adds `models: {person, material}` and the complete `materials` group. Old configurations are normalized in memory; material counting defaults to disabled. The existing `expected_revision` conflict rule applies. Material polygon changes require a fresh `reference_frame` from the current camera; polygons may not intersect, and do not inherit human-seat containment.

Studio requests use `/api/v1/models`, `/api/v1/datasets`, `/api/v1/training/jobs`, and `/api/v1/materials`. Opaque resource identifiers are returned by creation calls; metadata does not expose filesystem access paths; the optional raw training log may contain working-directory names. All errors contain a stable `studio.error.*` message key.

- Model upload: `POST /models?role=person|material&name=...`, raw `application/octet-stream`, maximum512 MiB. CPU task/shape and prediction checks precede registration. Selection is a separate settings write. `DELETE /models/{id}` requires `{expected_revision}` and refuses built-in/active/referenced weights.
- Download: `POST /models/downloads` with `{catalog_id: "yolo11n"|"yolo11m"|"yolo11l"}`; poll `GET /models/downloads`. Only bundled official URLs and SHA-256 are used.
- Dataset: `POST /datasets` with `{name,class_name}`; `GET /datasets/{id}` includes image metadata. `POST /datasets/{id}/images?group=...` uploads one raw JPEG/PNG (20 MiB / 24 MP limit). `POST /datasets/{id}/captures` with `{group_id}` shares the current protected full frame.
- Annotation: `PUT /datasets/{id}/images/{image_id}/annotations` with `{expected_revision,boxes:[[x1,y1,x2,y2]],annotated:true}`. Coordinates refer to original image pixels. Empty confirmed annotations represent negative samples. `DELETE /datasets/{id}/images/{image_id}` soft-deletes with `{expected_revision}`.
- Snapshot: `POST /datasets/{id}/snapshots` with `{expected_revision,ratios:[80,10,10]}`. Ratios are positive integer percentages totalling100. At least three positive capture groups are required; complete groups are allocated deterministically with seed42. Response contains actual split counts and snapshot SHA.
- Start: `POST /training/jobs` with `{token,expected_revision,base_model_id,snapshot_id,parameters:{epochs,lr0,batch}}`. The token is an8–128 character idempotency identifier. Device configuration revision and service heartbeat are checked before queueing. Only one active job may exist.
- Observe: `GET /training/jobs/{id}` returns state, stage, epoch, progress, metrics, checkpoint availability and bounded log tail. `control_revision` changes only for user actions; metrics may update `revision` each second.
- Control: `POST /training/jobs/{id}/actions` with `{token,expected_revision:<control_revision>,action:"stop"|"cancel"|"resume"}`. Resume retains original dataset and parameters. Browser disconnect does not send a stop action.
- Preview: `POST /training/jobs/{id}/preview` after successful training returns `{jpeg:<base64>,detections}` using a current protected still and CPU inference; it does not replace live weights. Activate explicitly through the settings model selection.
- Counts: `GET /materials/status` returns current counts or null when invalid, cumulative total, session ID, source/version metadata and unresolved review events. `GET /materials/sessions/{id}` returns durable history.
- Adjustment: `POST /materials/sessions/{id}/adjustments` with `{token,expected_total,delta,reason,event_id?}`. A review resolution uses delta0 for a return or1 for a new product. Total may not become negative. Duplicate tokens return the original result.

Paths above are relative to `/api/v1`. Training state is one of `queued/preparing/running/validating/saving/stopping/completed/paused/interrupted/failed/cancelled`. A successful job registers an inactive material model. It never auto-activates a model or resets production camera settings.
