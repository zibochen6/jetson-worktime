# 工时统计系统

Jetson 单工位摄像头应用，提供实时监控、姿态与区域判断、工作会话计时、隐私打码和设备指标。前端使用原生 HTML、CSS、JavaScript，后端使用 Python、GStreamer、PyTorch 和 YOLO Pose。

## 一键启动

```bash
cd /home/seeed/workspace/jetson-worktime
./start.sh
```

脚本后台启动服务，检查已有进程与端口，并显示访问地址、PID及实际日志位置。通过同一局域网的浏览器访问 `http://<设备IP>:8088/`。新启动默认日志为 `logs/preview.log`。

首页的“设置”弹层顶部提供摄像头接入，支持网络／PoE（RTSP）和 USB，另有 ROI、计时阈值、隐私和检测图层。语言及展示模式按浏览器保存，设备设置由所有访问者共享。首次启动从 `.env` 的 `RTSP_URL` 和 `configs/station.m1.yaml` 读取相机来源。前端测试连接后点击“保存并切换摄像头”，成功的来源保存在受限权限的 `configs/behavior.yaml`，后续启动优先加载。切换后需重新划定并保存检测区域。密码留空仅对相同地址和用户名保留原密码。

## 目录

| 目录或文件 | 用途 |
|---|---|
| `start.sh` | 后台启动入口 |
| `src/jetson_worktime/` | 视频、推理、隐私、计时、配置和系统指标 |
| `scripts/` | HTTP 服务入口、环境同步、诊断、离线回放与验证工具 |
| `frontend/` | 统一首页、设置、素材源文件、Mock、接口副本和前端测试 |
| `configs/` | 当前设备配置及离线示例配置 |
| `models/` | 当前使用的 `yolo11n-pose.pt` 权重 |
| `tests/` | 后端测试及 `fixtures/media/` 本地测试视频 |
| `docs/` | 接口、前端交接、计时和采集回放说明 |
| `.venv/`、`vendor/` | Python 环境、核验过的安装包及依赖源码 |
| `logs/`、`outputs/` | 运行日志、会话事件、观测、状态及机位参考 |
| `reports/` | 环境与依赖来源摘要、历史归档索引 |

## 开发与验证

后端依赖 Python 3.10 和 Jetson 的 GI/GStreamer、CUDA 等组件。版本及来源见 [环境摘要](reports/environment.md)。环境重建使用 `scripts/bootstrap_env.sh` 或 `scripts/sync_env.sh`，依赖本地 Wheel、`vendor/wheels/SHA256SUMS`、`pyproject.toml` 和 `uv.lock`。

```bash
# 后端回归
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v

# 依赖诊断与 GPU 验证
.venv/bin/python scripts/doctor.py
.venv/bin/python scripts/smoke_gpu.py

# 离线视频与姿态验证
.venv/bin/python scripts/smoke_video.py tests/fixtures/media/test.mp4
.venv/bin/python scripts/smoke_pose.py
```

前端使用 Node.js 20+，可独立运行 Mock 和测试。

```bash
cd frontend
npm run mock
npm test
```

Mock 默认地址为 `http://127.0.0.1:5173`。前端开发、设备代理和素材维护见 [前端说明](frontend/README.md)，接口见 [API 契约](docs/api-v1.md)，数据边界见 [交接清单](docs/frontend-handoff.md)。

## 现场配置与数据

`configs/behavior.yaml` 保存设备级 ROI、时长、隐私及图层配置。ROI 或时长保存后会结算当前活动会话，再重新确认开工。工作、休息、待确认、未知时长由后端结算，统计范围为当前会话或最近结束会话。具体规则见 [计时说明](docs/behavior-mvp.md)。

设置弹层的“检测参数”提供人体置信度和关键点置信度，可用滑块或数字输入调整，点击“保存并应用”后全设备生效。人体默认 0.10，可调 0.10–1.00。关键点默认 0.40，可调 0.25–1.00，旧设备继承已有关键点阈值。提高阈值会减少低分结果，也可能漏掉远处、侧身或遮挡人员。参数实际变化时结算当前会话、清理旧观测并重新确认开工，重复保存相同值保持当前会话和版本。

人体阈值影响计时和人体标注，关键点阈值影响在位判断与姿态显示。隐私马赛克继续使用筛选前的保守候选，独立的 `privacy_keypoint_confidence` 在旧配置首次加载时继承原关键点阈值，此后业务参数调整保持其值。配置读取与观测响应中的 `detection` 记录当前业务阈值，事件和检测日志也包含该信息。

直播保持完整画面比例，界面提供截图、暂停、全屏及五阶段状态流程。输出按当前隐私配置处理，标注支持中英文。GPU、CPU、内存、芯片温度和设备运行时长约每两秒刷新。

会话绑定一名操作员，路人经过保留原离开计时。长时间失联、轨迹变化或交叉后，可通过“更多操作 → 确认操作员返回”选择当前人员。具体规则与接口见 `docs/behavior-mvp.md`。

会话记录按运行 ID 写入 `outputs/behavior/`。该目录还保存 `latest.json` 和机位参考文件。采集、录制与离线回放见 [命令行说明](docs/M1.md)。

## 历史归档

历史输出、旧报告、旧界面、导出模型及构建残留归档到设备项目外的 `../jetson-worktime-archives/`。每批归档包含原路径、大小、SHA256、处理清单及恢复说明，入口见 [归档索引](reports/README.md)。

当前运行记录与环境依赖继续保存在项目内。测试视频、模型、安装包、虚拟环境和设备凭据作为本地资源管理。

## 远程视频

Jetson 上运行 `./scripts/install_video_transport.sh` 安装固定版本的 MediaMTX 和 GStreamer RTSP 发布组件，然后运行 `./start.sh`。媒体服务由应用启动并监督，日志为 `logs/mediamtx.log`。安装包的固定 SHA256 写在安装脚本中。

首页优先使用 WebRTC，输出 H.264 Baseline，Tailscale 访问默认 640×360、最高 10 FPS、600 Kbps。localhost、回环地址及私有局域网地址自动使用高清档，最大 1920×1080、12 FPS、4 Mbps，保持原图比例且不超出输入分辨率。媒体通过 UDP/TCP 8189 连接，信令仍使用网页端口 8088。Tailscale 访问规则需允许观看设备访问 Jetson 的这两个端口。信令、RTSP 发布及媒体管理仅监听本机。断流或不支持 WebRTC 时回退到 640×360、最高 5 FPS 的 MJPEG，后台页面释放连接。网络 RTT、视频缓冲和本地处理耗时分别展示。

设置中的“标注配色”支持区域、人物框、骨架、关键点与判断点分别选色，以及两个区域的蒙版不透明度。0% 为完全透明，100% 为完全不透明。配色保存在设备，点击保存后所有浏览器使用同一配置。只调整配色会重建媒体连接，当前计时会话继续运行。

工位范围和在位判断区可分别控制显示，分别作用于蒙版、边界与区域名称。旧版本单一 regions 开关会迁移为两个相同状态的开关。
