# 独立模型检测测试

在 Jetson 项目根目录启动：

```bash
./test_detection.sh
```

重复运行脚本时会识别已启动的检测测试服务并提示访问地址，不会再报端口占用错误。若端口被其他程序占用，可使用 `--port 8091`。

默认网页为 `http://192.168.2.16:8090/`。Tailscale 使用 `http://100.98.151.121:8090/`，自动选择较低带宽画面。局域网默认 1280×720，画面等比例显示；高清与流畅可手动切换。

默认权重为 `data/training/detect_pack_yolo11n_20261112/run/weights/best.pt`。显示 box、not_packed、packed、part，可调置信度、隐藏类别、暂停、截图和全屏。标签随同一帧的结果绘制，过期或断线时清除画面并重连。

输入复用 8088 服务 `/api/v1/video.jpg` 的无业务标注图片，沿用设备隐私处理，不会绘制工位区域或在位区域。8088 服务及摄像头须保持在线。推理使用 GPU，默认上限 6 FPS；无人查看 15 秒后暂停测试推理。此工具不累计产量、不切换生产模型。

设备已启动独立后台服务，关闭 SSH 不影响它：

```bash
systemctl --user status worktime-detect-preview
systemctl --user stop worktime-detect-preview
systemctl --user start worktime-detect-preview
```

这是临时测试服务，设备重启后不会自动启动。重启后需要后台启动时：

```bash
systemd-run --user --unit=worktime-detect-preview --property=WorkingDirectory=/home/seeed/workspace/jetson-worktime --property=Restart=on-failure /home/seeed/workspace/jetson-worktime/test_detection.sh
```

换模型或提高推理尺寸时，先停止已运行的测试服务，再启动：

```bash
./test_detection.sh --model /path/to/detect-model.pt --imgsz 1280 --fps 4
```

支持尺寸 640、960、1280。目标很小时可尝试增大推理尺寸，实际帧率取决于模型、GPU负载和网络。页面的“推理耗时”仅为模型处理时间。

实机验证：四类模型加载、验证集样本输出7个框、640预览对应原图坐标、非法参数拒绝；浏览器验证实时播放、暂停恢复、清晰度切换、类别显隐和1920视口无滚动。当前现场机位未见产品，需将摄像头对准桌面后检验真实检测效果。
