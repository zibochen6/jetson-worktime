# 环境与验收报告

生成时间：2026-11-02T14:30:21.533732+08:00

- gpu: PASS
- cuda_nms: PASS
- video: PASS
- pose_tracking: PASS
- rtsp: NOT RUN
- sync_repeat: PASS

详细版本、来源、哈希及已知限制见 environment.json。

设备：Jetson Orin NX 16GB；Ubuntu 22.04.5；JetPack 元包 6.2.1；L4T core 36.4.3，GStreamer 36.4.7。CUDA 12.6，cuDNN 9.3；TensorRT 10.3 Python 绑定可用（未运行 engine）。

Python 3.10.12，uv 0.13.6。

模块版本与来源：
- torch: 2.7.0 — /home/seeed/workspace/jetson-worktime/.venv/lib/python3.10/site-packages/torch/__init__.py
- torchvision: 0.22.0 — /home/seeed/workspace/jetson-worktime/.venv/lib/python3.10/site-packages/torchvision/__init__.py
- numpy: 1.26.4 — /home/seeed/workspace/jetson-worktime/.venv/lib/python3.10/site-packages/numpy/__init__.py
- cv2: 4.11.0 — /home/seeed/workspace/jetson-worktime/.venv/lib/python3.10/site-packages/cv2/__init__.py
- gi: 3.42.1 — /usr/lib/python3/dist-packages/gi/__init__.py
- tensorrt: 10.3.0 — /usr/lib/python3.10/dist-packages/tensorrt/__init__.py
- ultralytics: 8.3.161 — /home/seeed/workspace/jetson-worktime/.venv/lib/python3.10/site-packages/ultralytics/__init__.py

验收证据见对应 smoke JSON；静态人物视频仅验证 ID 持续性。真实 RTSP 未测试。

输出：outputs/decoded.png、outputs/annotated.jpg、outputs/annotated.mp4、outputs/observations.jsonl、outputs/statistics.json。wheel 详情与来源见 wheel-metadata.json、sources.md。

## M1 GStreamer 与包来源复核

GStreamer 框架为 1.20.3；nvidia-jetpack 6.2.1+b38、L4T core 36.4.3、nvidia-l4t-gstreamer 36.4.7，均按真实版本保留。APT来源为NVIDIA官方r36.4仓库，完整策略与实加载插件路径见m1/environment.json。插件自身版本字段不等同于GStreamer框架版本。
