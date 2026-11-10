"""Single camera, shared GPU worker, settings UI and versioned media API."""
import atexit
import json
import os
import re
import signal
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'src'))
import yaml
from jetson_worktime.api import work_status
from jetson_worktime.behavior_service import BehaviorService
from jetson_worktime.localization import LANGUAGES, LocalizedError
from jetson_worktime.settings import SettingsConflict
from jetson_worktime.system_metrics import SystemMetrics
from jetson_worktime.video import VideoReader
from jetson_worktime.camera_sources import CameraSources, normalize_source, usb_devices

os.chdir(ROOT)
behavior = BehaviorService(ROOT)
system_metrics = SystemMetrics()
atexit.register(behavior.close)
if (ROOT/'.env').exists():
    for line in (ROOT/'.env').read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() == 'RTSP_URL':
            os.environ.setdefault('RTSP_URL', value.strip().strip('\"\''))
source = yaml.safe_load((ROOT/'configs/station.m1.yaml').read_text())['source']
url = os.environ.get(source.get('rtsp_env', 'RTSP_URL'))
try:
    fallback_source = behavior.config.get('camera_source') or normalize_source(
        dict(type='rtsp', url=url or 'rtsp://unconfigured', codec=source['codec']))
except ValueError:
    fallback_source = normalize_source(dict(type='rtsp', url='rtsp://unconfigured', codec='h264'))
cameras = CameraSources(behavior, fallback_source, VideoReader)
state_lock = threading.Lock()
state = dict(status='connecting', timestamp=0, sequence=0, width=None, height=None,
             jpeg_width=None, jpeg_height=None, source_fps=None,
             stream_session_id=None, receive_sequence=None, pts_ns=None)


def capture():
    while not behavior.stop.is_set():
        started = time.monotonic()
        failed = False
        with cameras.lock:
            try:
                if cameras.reader is None:
                    cameras.reader = cameras.open(cameras.current())
                reader = cameras.reader
                packet = reader.read()
                if packet is None:
                    raise RuntimeError('stream ended')
                frame, pts, received = packet
                meta = reader.last_meta.copy()
                height, width = frame.shape[:2]
                fps = reader.stream_info
                with state_lock:
                    state.update(status='online', timestamp=time.monotonic(), sequence=state['sequence']+1,
                                 width=width, height=height, jpeg_width=min(1280, width),
                                 jpeg_height=round(height*min(1280, width)/width),
                                 source_fps=(fps.get('fps_numerator') or 0)/(fps.get('fps_denominator') or 1),
                                 stream_session_id=meta['session_id'], receive_sequence=meta['receive_sequence'],
                                 pts_ns=str(pts) if pts is not None else None)
                behavior.submit(frame, pts, received, meta)
                cameras.last_error = None
            except Exception as exc:
                failed = True
                behavior.disconnected()
                cameras.last_error = 'source.connectionFailed'
                with state_lock:
                    state.update(status='reconnecting')
                with behavior.lock:
                    try:
                        behavior.log(dict(event='stream_failure', exception_type=type(exc).__name__))
                    except OSError:
                        pass
                if cameras.reader:
                    cameras.reader.close()
                    cameras.reader = None
        behavior.stop.wait(2 if failed else max(0, 1/12 - (time.monotonic()-started)))
    with cameras.lock:
        if cameras.reader:
            cameras.reader.close()
            cameras.reader = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_bytes(self, data, content_type, status=200, headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(data)

    def json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), 'application/json; charset=utf-8', status)

    def error(self, status, code, message):
        self.json(dict(schema_version='1.0', error=dict(
            code=code, message=str(message),
            message_key=getattr(message, 'message_key', 'error.'+code),
            message_params=getattr(message, 'message_params', {}))), status)

    def camera(self):
        with state_lock:
            info = state.copy()
        timestamp = info.pop('timestamp')
        age = (time.monotonic()-timestamp)*1000 if timestamp else None
        info['age_ms'] = age
        if age is None or age >= 5000:
            info['status'] = 'connecting' if info['status'] == 'connecting' else 'reconnecting'
        with behavior.lock:
            times = behavior.publish_times
            output_fps = (len(times)-1)/(times[-1]-times[0]) if len(times) > 1 and time.monotonic()-times[-1] < 5 else 0
            info.update(config_revision=behavior.config['revision'], privacy_applied=behavior.config['privacy']['enabled'],
                        output_fps=round(output_fps, 2), algorithm_error=behavior.error,
                        regions_match=behavior.config['image_size'] == [info['width'], info['height']],
                        camera_changed=behavior.camera_changed)
        active_source = cameras.current()
        return dict(schema_version='1.0', codec=active_source.get('codec', active_source.get('format')),
                    source_type=active_source['type'], device_name=active_source.get('device', 'RTSP'),
                    connection_error=cameras.last_error,
                    decoder='software' if active_source.get('format') in ('yuyv', 'mjpeg') else 'nvv4l2decoder',
                    preview_max_fps=12, preview_has_project_overlay=False, **info)

    @staticmethod
    def media_headers(media):
        return {'X-Stream-Session-ID': media['meta']['session_id'],
                'X-Frame-Sequence': media['meta']['receive_sequence'],
                'X-Config-Revision': media['revision'],
                'X-Privacy-Applied': str(media['privacy_applied']).lower()}

    def stream(self, raw=False, locale='zh-CN'):
        with behavior.lock:
            revision = behavior.config['revision']
        previous = -1
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        if not raw:
            self.send_header('Content-Language', locale)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.connection.settimeout(1)
        try:
            self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 131072)
            while not behavior.stop.is_set():
                with behavior.media_condition:
                    ready = behavior.media_condition.wait_for(
                        lambda: behavior.stop.is_set() or behavior.config['revision'] != revision or
                        (behavior.media is not None and behavior.media['sequence'] != previous), timeout=5)
                    if not ready or behavior.stop.is_set() or behavior.config['revision'] != revision:
                        break
                    media = behavior.media
                    if media is None or (time.monotonic_ns()-media['received'])/1e9 >= behavior.config['max_observation_age']:
                        break
                    data = media['jpeg'] if raw else media['annotated_locales'][locale]
                    headers = self.media_headers(media)
                    if not raw:
                        headers['Content-Language'] = locale
                    header = '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '+str(len(data))+'\r\n'
                    header += ''.join(key+': '+str(value)+'\r\n' for key, value in headers.items())+'\r\n'
                    # Writes are serialized with policy changes. Slow clients have bounded waits.
                    self.wfile.write(header.encode()+data+b'\r\n')
                    self.wfile.flush()
                    previous = media['sequence']
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            self.close_connection = True

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        locale = 'zh-CN'
        if path in ('/stream.mjpg', '/api/frame.jpg'):
            values = parse_qs(parsed.query, keep_blank_values=True).get('lang', ['zh-CN'])
            if len(values) != 1 or values[0] not in LANGUAGES:
                self.error(400, 'BAD_REQUEST', LocalizedError('error.language'))
                return
            locale = values[0]
        assets = {'/overlay-style.json': ('overlay-style.json', 'application/json; charset=utf-8'),
                  '/overlay.js': ('overlay.js', 'text/javascript; charset=utf-8'),
                  '/i18n.js': ('i18n.js', 'text/javascript; charset=utf-8'),
                  '/locales.json': ('locales.json', 'application/json; charset=utf-8'),
                  '/pipeline.js': ('pipeline.js', 'text/javascript; charset=utf-8'),
                  '/settings': ('settings.html', 'text/html; charset=utf-8'),
                  '/settings.html': ('settings.html', 'text/html; charset=utf-8'),
                  '/settings.js': ('settings.js', 'text/javascript; charset=utf-8'),
                  '/settings.css': ('settings.css', 'text/css; charset=utf-8'),
                  '/roi-editor.js': ('roi-editor.js', 'text/javascript; charset=utf-8'),
                  '/api.js': ('api.js', 'text/javascript; charset=utf-8'),
                  '/main.js': ('main.js', 'text/javascript; charset=utf-8'),
                  '/main.css': ('main.css', 'text/css; charset=utf-8')}
        if path == '/':
            self.send_bytes((ROOT/'frontend/public/index.html').read_bytes(), 'text/html; charset=utf-8')
        elif path in assets:
            filename, content_type = assets[path]
            self.send_bytes((ROOT/'frontend/public'/filename).read_bytes(), content_type)
        elif path == '/dev-info':
            self.json({'mode': 'device'})
        elif path == '/api/v1/system/metrics':
            self.json(system_metrics.snapshot())
        elif path == '/api/v1/camera/devices':
            self.json(usb_devices())
        elif path == '/api/v1/settings':
            result = behavior.settings()
            result['camera_source'] = cameras.public()
            result['camera'] = self.camera()
            self.json(result)
        elif path in ('/api/work-status', '/api/v1/work/status'):
            snapshot = behavior.snapshot()
            self.json(work_status(snapshot) if path.startswith('/api/v1/') else snapshot)
        elif path in ('/api/v1/camera', '/api/status'):
            self.json(self.camera())
        elif path == '/api/v1/observations/latest':
            self.json(behavior.observation_snapshot())
        elif path == '/api/v1/observations/frame.jpg':
            key = parse_qs(parsed.query).get('observation_id', [''])[0]
            if not key or len(key) > 256:
                self.error(400, 'BAD_REQUEST', 'observation_id required')
                return
            with behavior.lock:
                pair = behavior.observation_frame(key)
                if pair is None:
                    self.error(410, 'FRAME_EXPIRED', 'Fetch the latest observation again')
                    return
                observation, data = pair
                self.send_bytes(data, 'image/jpeg', headers={
                    'X-Observation-ID': key, 'X-Stream-Session-ID': observation['frame']['stream_session_id'],
                    'X-Frame-Sequence': observation['frame']['receive_sequence'],
                    'X-Config-Revision': observation['config_revision'],
                    'X-Privacy-Applied': str(observation['privacy_applied']).lower()})
        elif path in ('/api/frame.jpg', '/api/v1/video.jpg'):
            with behavior.lock:
                media = behavior.media
                if media is None or (time.monotonic_ns()-media['received'])/1e9 >= behavior.config['max_observation_age']:
                    self.error(503, 'FRAME_UNAVAILABLE', 'No fresh protected frame')
                    return
                headers = self.media_headers(media)
                data = media['jpeg']
                if path == '/api/frame.jpg':
                    data = media['annotated_locales'][locale]
                    headers['Content-Language'] = locale
                self.send_bytes(data, 'image/jpeg', headers=headers)
        elif path in ('/stream.mjpg', '/api/v1/video.mjpg'):
            self.stream(raw=path.startswith('/api/v1/'), locale=locale)
        else:
            self.error(404, 'NOT_FOUND', 'Unknown endpoint')

    def check_origin(self):
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            self.error(403, 'ORIGIN_REJECTED', 'Use a same-origin request or development proxy')
            return False
        return True

    def read_json(self, maximum):
        length = int(self.headers.get('Content-Length', '0'))
        if not 1 <= length <= maximum:
            raise LocalizedError('error.requestSize')
        self.connection.settimeout(5)
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise LocalizedError('error.jsonObject')
        return data

    def do_PUT(self):
        if not self.check_origin():
            return
        if self.path != '/api/v1/settings':
            self.error(404, 'NOT_FOUND', 'Unknown endpoint')
            return
        try:
            request = self.read_json(32768)
            if 'camera_source' in request:
                result = cameras.switch(request, self.camera())
                if result['revision'] != request['expected_revision']:
                    with state_lock:
                        state.update(status='connecting', timestamp=0, stream_session_id=None,
                                     width=None, height=None, jpeg_width=None, jpeg_height=None,
                                     source_fps=None, receive_sequence=None, pts_ns=None)
            else:
                result = behavior.apply_settings(request, self.camera())
        except SettingsConflict as exc:
            self.error(409, 'SETTINGS_CONFLICT', exc)
            return
        except (ValueError, TypeError, UnicodeError) as exc:
            self.error(400, 'BAD_REQUEST', exc)
            return
        except OSError:
            self.error(500, 'SETTINGS_SAVE_FAILED', '保存失败，请检查存储状态后重试')
            return
        result['camera_source'] = cameras.public()
        result['camera'] = self.camera()
        self.json(result)

    def do_POST(self):
        if not self.check_origin():
            return
        if self.path == '/api/v1/camera/test':
            try:
                self.json(cameras.test(self.read_json(8192)))
            except SettingsConflict as exc:
                self.error(409, 'SETTINGS_CONFLICT', exc)
            except (ValueError, TypeError, UnicodeError) as exc:
                self.error(400, 'CAMERA_TEST_FAILED', exc)
            return
        if self.path not in ('/api/work-action', '/api/v1/work/actions'):
            self.error(404, 'NOT_FOUND', 'Unknown endpoint')
            return
        try:
            data = self.read_json(1024)
            if data.get('action') not in ('start', 'end', 'review', 'confirm_camera'):
                raise ValueError('Unsupported action')
        except (ValueError, TypeError, UnicodeError) as exc:
            self.error(400, 'BAD_REQUEST', exc)
            return
        try:
            result = behavior.action(data['action'])
        except (ValueError, TypeError) as exc:
            self.error(409, 'ACTION_UNAVAILABLE', exc)
            return
        self.json(work_status(result) if self.path.startswith('/api/v1/') else result)


server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('WORKTIME_PORT', '8088'))), Handler)
server.daemon_threads = True
threading.Thread(target=capture, daemon=True).start()


def shutdown(*args):
    behavior.close()
    threading.Thread(target=server.shutdown, daemon=True).start()


signal.signal(signal.SIGTERM, shutdown)
try:
    server.serve_forever()
finally:
    behavior.close()
    server.server_close()
