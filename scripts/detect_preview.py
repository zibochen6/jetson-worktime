"""Read the current privacy-processed camera feed and preview a Detect model.
Run with the project's Python environment. No production settings are changed.
"""
import argparse
import errno
import json
import math
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT/'data/training/detect_pack_yolo11n_20261112/run/weights/best.pt'


def packet_boxes(result):
    if result.boxes is None:
        return []
    return [dict(xyxy=[round(float(x), 2) for x in row[:4]],
                 confidence=round(float(row[4]), 4), class_id=int(row[5]))
            for row in result.boxes.data.cpu().tolist()]


class Preview:
    def __init__(self, args):
        self.args = args
        self.condition = threading.Condition()
        self.stop = threading.Event()
        self.frame = None
        self.error = '正在连接摄像头'
        self.sequence = 0
        self.last_viewer = time.monotonic()
        self.names = {}
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path):
        return self.opener.open(self.args.camera_service.rstrip('/')+path, timeout=3)

    def run(self):
        import cv2
        import numpy as np
        import torch
        from ultralytics import YOLO
        model = None
        previous = None
        last_mode_check = 0
        mode = None
        while not self.stop.is_set():
            started = time.monotonic()
            try:
                if started-self.last_viewer > 15:
                    model = None
                    self.stop.wait(.5)
                    continue
                if started-last_mode_check > 1:
                    with self.request('/api/v1/work/status') as response:
                        mode = json.load(response).get('operating_mode')
                    last_mode_check = started
                if mode != 'business':
                    model = None
                    torch.cuda.empty_cache()
                    raise RuntimeError('业务训练期间暂停预览')
                # This endpoint contains no ROI or business overlays and retains
                # the production privacy policy. Never open a second RTSP session.
                with self.request('/api/v1/video.jpg') as response:
                    key = tuple(response.headers.get(k) for k in
                                ('X-Stream-Session-ID', 'X-Frame-Sequence', 'X-Config-Revision'))
                    data = response.read(8*1024*1024)
                    privacy = response.headers.get('X-Privacy-Applied', 'unknown')
                if key == previous and any(key):
                    self.stop.wait(.02)
                    continue
                image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    raise RuntimeError('摄像头图片无效')
                if model is None:
                    model = YOLO(str(self.args.model))
                    if model.task != 'detect':
                        raise RuntimeError('请选择目标检测 Detect 权重')
                    self.names = {str(k):str(v) for k,v in model.names.items()}
                tick = time.monotonic()
                result = model.predict(image, device=0, imgsz=self.args.imgsz,
                                       conf=.05, iou=.5, max_det=100, verbose=False)[0]
                inference_ms = (time.monotonic()-tick)*1000
                with self.condition:
                    self.sequence += 1
                    self.frame = dict(image=image, boxes=packet_boxes(result),
                                      inference_ms=round(inference_ms, 1), privacy=privacy,
                                      received=time.monotonic(), sequence=self.sequence)
                    self.error = None
                    self.condition.notify_all()
                previous = key
            except Exception as exc:
                # Do not expose camera credentials or upstream URLs in errors.
                with self.condition:
                    self.frame = None
                    self.error = '摄像头或模型暂不可用（'+type(exc).__name__+'），正在重试'
                    if mode and mode != 'business':
                        self.error = '训练或模型切换中，预览暂停'
                    self.condition.notify_all()
                print('Preview retry:', type(exc).__name__, flush=True)
                self.stop.wait(1)
            self.stop.wait(max(0, 1/self.args.fps-(time.monotonic()-started)))


def serve(args):
    preview = Preview(args)
    page = (ROOT/'frontend/public/detect-preview.html').read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, data, content_type, headers=None):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            for k,v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            import cv2
            parsed = urlsplit(self.path)
            self.connection.settimeout(3)
            preview.last_viewer = time.monotonic()
            try:
                if parsed.path == '/':
                    self.send(200, page, 'text/html; charset=utf-8')
                elif parsed.path == '/api/status':
                    with preview.condition:
                        frame = preview.frame
                        value = dict(service='jetson-detection-preview', model=args.model.name, names=preview.names, imgsz=args.imgsz,
                                     fps_limit=args.fps, error=preview.error,
                                     frame_age_ms=round((time.monotonic()-frame['received'])*1000) if frame else None)
                    self.send(200, json.dumps(value, ensure_ascii=False).encode(), 'application/json')
                elif parsed.path == '/frame.jpg':
                    query = parse_qs(parsed.query)
                    try:
                        after = int(query.get('after', ['-1'])[0])
                        width = int(query.get('width', ['1280'])[0])
                    except ValueError:
                        self.send(400, b'Invalid parameter', 'text/plain'); return
                    if width not in (640, 1280):
                        self.send(400, b'Invalid width', 'text/plain'); return
                    with preview.condition:
                        preview.condition.wait_for(lambda: preview.stop.is_set() or
                            preview.error or (preview.frame and preview.frame['sequence'] != after), timeout=2)
                        frame = preview.frame
                        if not frame or time.monotonic()-frame['received'] > 2:
                            self.send(503, b'Camera frame unavailable', 'text/plain'); return
                        if frame['sequence'] == after:
                            self.send(204, b'', 'text/plain'); return
                    image = frame['image']; h,w = image.shape[:2]
                    scale = min(1, width/w)
                    if scale < 1:
                        image = cv2.resize(image, (round(w*scale), round(h*scale)), interpolation=cv2.INTER_AREA)
                    ok,jpeg = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85 if width==1280 else 60])
                    if not ok:
                        self.send(503, b'Encode error', 'text/plain'); return
                    meta = {k:v for k,v in frame.items() if k not in ('image','received','boxes')}
                    meta.update(width=w, height=h, boxes=frame['boxes'])
                    self.send(200, jpeg.tobytes(), 'image/jpeg', {'X-Detection-Meta':json.dumps(meta, separators=(',',':'))})
                else:
                    self.send(404, b'Not found', 'text/plain')
            except (OSError, TimeoutError):
                self.close_connection = True

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        host = '127.0.0.1' if args.host in ('0.0.0.0', '') else args.host
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(f'http://{host}:{args.port}/api/status', timeout=3) as response:
                status = json.load(response)
            ours = status.get('service') == 'jetson-detection-preview'
        except (OSError, ValueError):
            ours = False
        if not ours:
            raise SystemExit(f'端口 {args.port} 已被其他程序占用。请用 --port 指定其他端口。') from None
        print(f'检测测试服务已在运行，无需重复启动。\n'
              f'本机访问：http://localhost:{args.port}/\n'
              f'其他电脑：使用 Jetson 的 IP 地址和端口 {args.port}\n'
              f'当前模型：{status.get("model")}，推理尺寸：{status.get("imgsz")}\n'
              '如需更换模型或参数，请先停止正在运行的测试服务。', flush=True)
        return
    server.daemon_threads = True
    def shutdown(*_):
        preview.stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    threading.Thread(target=preview.run, daemon=True).start()
    print(f'Detection preview: http://0.0.0.0:{args.port}/ | model: {args.model.name}', flush=True)
    try:
        server.serve_forever()
    finally:
        preview.stop.set()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    parser.add_argument('--camera-service', default='http://127.0.0.1:8088')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8090)
    parser.add_argument('--imgsz', type=int, default=640, choices=(640,960,1280))
    parser.add_argument('--fps', type=float, default=6)
    args = parser.parse_args()
    if not args.model.is_file():
        parser.error('Model file does not exist: '+str(args.model))
    if not math.isfinite(args.fps) or not 1 <= args.fps <= 12:
        parser.error('--fps must be between 1 and 12')
    serve(args)


if __name__ == '__main__':
    main()
