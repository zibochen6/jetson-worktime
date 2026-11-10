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
