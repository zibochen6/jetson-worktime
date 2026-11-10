# 前端交接清单

设备服务和独立前端服务器共用 `frontend/public/index.html`。首页包含真实视频、会话状态、计时、设备指标及展示模式，设置通过首页弹层复用 `/settings?embedded=1`。

## 接口与资源

| 接口 | 用途 |
|---|---|
| `/stream.mjpg?lang=zh-CN` 或 `lang=en` | 当前语言的带标注直播 |
| `/api/v1/video.mjpg`、`/api/v1/video.jpg` | 按设备隐私策略输出的无项目图层视频和截图 |
| `/api/v1/observations/latest` | 最新检测观测与对应帧地址 |
| `/api/v1/work/status` | 会话状态与各类时长 |
| `/api/v1/work/actions` | 明确提交的人工操作 |
| `/api/v1/settings` | 设备配置读取与带版本的保存 |
| `/api/v1/system/metrics` | Jetson 实时硬件指标 |

契约主文件位于 `docs/api-v1.md` 和 `docs/openapi-v1.json`。修改后运行以下命令刷新前端副本，并更新 `frontend/contracts/api.ts` 及相关测试。

```bash
.venv/bin/python scripts/export_frontend_contracts.py
```

前端资源、开发与素材维护方式见 [前端说明](../frontend/README.md)。

## 本机联调

使用 Node.js 20+。

```bash
cd frontend
npm run mock
# 访问 http://127.0.0.1:5173
```

接入设备时启动代理模式。

```bash
API_BASE_URL=http://<设备IP>:8088 npm run dev
npm test
```

## 数据与交接约定

- 计时直接显示后端数值，统计范围为当前会话或最近结束会话。
- 状态和错误原因采用接口中的消息键与共享语言目录。
- 对应帧叠加校验观测 ID，过期时重新获取结果及图像。
- 配置保存携带版本，ROI 保存携带截图来源与原图尺寸。
- 人工操作、ROI 及计时规则写入通过用户明确提交，写入回归使用 Mock。
- 素材源文件、Mock、契约副本和测试随前端代码维护。
- 设备凭据、虚拟环境、模型、安装包和现场素材由各自的本地资源目录管理。

设备端使用项目根目录 `start.sh` 启动服务。
