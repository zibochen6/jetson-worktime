# 开工确认与视频质量

`/api/v1/work/status`（兼容 `/api/work-status`）保留原字段，新增：

- `start_confirmation`：`state` 为 WAITING / CONFIRMING / BLOCKED / ACTIVE；包含 elapsed_seconds、required_seconds、candidate_track_id、blocker_code、blocker_params，以及带单调时间和原因的 last_reset。
- `runtime_quality`：接收、推理结果、JPEG 发布间隔及各处理阶段耗时，单位毫秒。每项样本窗口最多 2048；count 和 over_500ms 为本进程累计值，百分位和 max 仅描述窗口。
- `persistence`：观测写入队列深度、容量、完成条数与错误。队列容量 256；写入失败或溢出停止业务累计并明确报告，不静默丢弃后继续计时。

`/api/v1/camera` 的 `video.runtime_quality` 包含视频编码提交耗时与每种语言、清晰度的发送间隔。这里的“发送”指向 GStreamer 提交，不证明浏览器已经显示。

浏览器支持 requestVideoFrameCallback 时，播放器文字显示显示间隔 P95 与大于 500 毫秒的停顿次数；同一统计可从视频元素的 `data-display-quality` 读取。后台标签页暂停期间不做显示质量判断。不支持该接口的浏览器不生成这些指标。它们均不是相机曝光到显示的端到端延迟。

GPU 推理后首先提交已按本帧隐私策略处理的视频，再由最新帧单槽处理 JPEG 与双语叠加。观测 JSONL 独立有界写入并在正常退出时排空。配置或流会话变化时丢弃正在编码的旧结果，精确帧接口继续保持图片与结果一一对应。

机位变化后，首页进入“需要确认机位”，人体锚点标为“区域待确认”。使用首页“查看画面并确认检测区域”或更多操作中的机位确认，打开已有 ROI 编辑器，核对新画面后保存；不会根据旧录像自动确认当前机位。持续在位 10 秒和会话人员绑定规则保持不变。

视频就绪采用相机接口的 `algorithm_fresh` 与 `algorithm_observation_age_ms`，不因单次结构化观测请求超时而反复重连。旧后端缺少这些字段时沿用旧逻辑。算法新鲜度仍由服务器单调时间判断，过期时关闭预览并停止工作累计。独立验证实例可设置 `WORKTIME_PORT=8098 WORKTIME_MEDIA_PORT_OFFSET=100`，所有媒体端口随偏移共同隔离；生产默认偏移为 0。
