"""Bounded, asynchronous protected-video publishing and same-origin WHEP sessions."""
from copy import deepcopy
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler
import uuid

import yaml
from .runtime_quality import RuntimeQuality

LOCALES = ('zh-CN', 'en')
PREVIEW = dict(width=640, max_fps=10, bitrate=600000)
PROFILES = {'remote':PREVIEW,'local':dict(width=1920,max_fps=12,bitrate=4000000)}


# Independent validation instances must not bind the production media ports.
_PORT_OFFSET = int(os.environ.get('WORKTIME_MEDIA_PORT_OFFSET', '0'))
RTSP_PORT, WHEP_PORT, API_PORT, ICE_PORT = [p+_PORT_OFFSET for p in (8554, 8889, 9997, 8189)]
if not all(0 < p < 65536 for p in (RTSP_PORT, WHEP_PORT, API_PORT, ICE_PORT)):
    raise ValueError('Invalid media port offset')


class H264Publisher:
    def __init__(self, locale, width, height, profile):
        from .video import Gst
        self.Gst = Gst
        self.origin = None
        options = PROFILES[profile]
        self.frame_duration = round(1e9/options['max_fps'])
        self.pipeline = Gst.parse_launch(
            'appsrc name=frames is-live=true format=time block=false max-buffers=1 leaky-type=downstream '
            '! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream '
            '! videoconvert ! video/x-raw,format=I420 ! nvvidconv '
            '! video/x-raw(memory:NVMM),format=NV12 '
            f"! nvv4l2h264enc bitrate={options['bitrate']} control-rate=1 maxperf-enable=true "
            f"iframeinterval={options['max_fps']} idrinterval={options['max_fps']} insert-sps-pps=true num-B-Frames=0 "
            '! video/x-h264,profile=baseline ! h264parse '
            f'! rtspclientsink location=rtsp://127.0.0.1:{RTSP_PORT}/worktime-{locale}-{profile} protocols=tcp latency=0')
        self.source = self.pipeline.get_by_name('frames')
        self.source.set_property('caps', Gst.Caps.from_string(
            f"video/x-raw,format=BGR,width={width},height={height},framerate={options['max_fps']}/1"))
        self.size = (width, height)
        if self.pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            self.close()
            raise RuntimeError('Hardware encoder did not start')

    def write(self, image, received):
        Gst = self.Gst
        message = self.pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
        if message:
            raise RuntimeError('Video publisher disconnected')
        if self.origin is None:
            self.origin = received
        data = image.tobytes()
        buffer = Gst.Buffer.new_allocate(None, len(data), None)
        buffer.fill(0, data)
        buffer.pts = buffer.dts = max(0, received-self.origin)
        buffer.duration = self.frame_duration
        if self.source.emit('push-buffer', buffer) != Gst.FlowReturn.OK:
            raise RuntimeError('Video publisher rejected frame')

    def close(self):
        self.pipeline.set_state(self.Gst.State.NULL)


class VideoTransport:
    def __init__(self, root):
        self.root = Path(root)
        self.condition = threading.Condition(threading.RLock())
        self.quality = RuntimeQuality()
        self.stop = threading.Event()
        self.epoch = 0
        self.latest = None
        self.jpegs = {}
        self.sockets = set()
        self.socket_profiles = {}
        self.output_sockets = set()
        self.sessions = {}
        self.pending = {}
        self.publishers = {}
        self.process = None
        self.error = None
        self.opener = build_opener(ProxyHandler({}))
        self.thread = threading.Thread(target=self.run, daemon=True, name='protected-video')
        self.thread.start()

    def request(self, path, method='GET', data=None, headers=None):
        req = Request(f'http://127.0.0.1:{WHEP_PORT}'+path, data=data, method=method, headers=headers or {})
        return self.opener.open(req, timeout=5)

    def status(self):
        with self.condition:
            available = self.process is not None and self.process.poll() is None
            return dict(webrtc_available=available, preview=PREVIEW.copy(), profiles=deepcopy(PROFILES), viewers=len(self.sessions)+len(self.sockets)+len(self.pending),
                        fallback=dict(width=640,max_fps=5,jpeg_quality=45),
                        error=self.error, epoch=self.epoch, runtime_quality=self.quality.snapshot())

    def submit(self, image, persons, config, fresh, regions_match, received, meta=None):
        with self.condition:
            self.latest = (self.epoch, image, persons, config, fresh, regions_match, meta or {}, received)
            self.condition.notify_all()

    def invalidate(self):
        with self.condition:
            self.epoch += 1
            self.latest = None
            self.jpegs.clear()
            # shutdown cancels blocked writes without waiting for network acknowledgements.
            for connection in self.sockets | getattr(self, 'output_sockets', set()):
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            self.condition.notify_all()

    def add_socket(self, connection, profile='remote'):
        with self.condition:
            if len(self.sockets)+len(self.sessions)+len(self.pending) >= 3:
                raise ValueError('Video viewer limit reached')
            self.sockets.add(connection)
            if not hasattr(self,'socket_profiles'):
                self.socket_profiles={}
            self.socket_profiles[connection]=profile
            return self.epoch

    def remove_socket(self, connection):
        with self.condition:
            self.sockets.discard(connection)
            self.socket_profiles.pop(connection,None)

    def create(self, locale, offer, profile='remote'):
        if profile not in PROFILES:
            raise ValueError('Invalid video profile')
        key=(locale,profile)
        token = uuid.uuid4().hex
        with self.condition:
            if len(self.sessions)+len(self.sockets)+len(self.pending) >= 3:
                raise ValueError('Video viewer limit reached')
            epoch = self.epoch
            self.pending[token] = (key, epoch)
            self.condition.notify_all()
        location = None
        try:
            deadline = time.monotonic()+8
            while time.monotonic() < deadline:
                with self.condition:
                    if epoch != self.epoch or self.stop.is_set():
                        raise ValueError('Video configuration changed')
                    ready = key in self.publishers
                if ready:
                    try:
                        with self.request('/worktime-'+locale+'-'+profile+'/whep', 'POST', offer,
                                          {'Content-Type':'application/sdp'}) as response:
                            answer = response.read(131073)
                            location = response.headers['Location']
                            etag = response.headers.get('ETag', '*')
                        break
                    except HTTPError as error:
                        if error.code not in (404, 400, 503):
                            raise
                self.stop.wait(.15)
            else:
                raise ValueError('Video publisher unavailable')
            # MediaMTX resource locations must stay on the local WHEP endpoint.
            path = urlsplit(location).path
            if not path.startswith('/worktime-'+locale+'-'+profile+'/whep/'):
                raise ValueError('Invalid media session location')
            with self.condition:
                if epoch != self.epoch or self.stop.is_set():
                    raise ValueError('Video configuration changed')
                self.sessions[token] = dict(locale=locale,profile=profile,epoch=epoch,path=path,etag=etag,created=time.monotonic())
            return token, answer, etag
        except Exception:
            if location:
                self.delete_remote(urlsplit(location).path)
            raise
        finally:
            with self.condition:
                self.pending.pop(token, None)

    def session_request(self, token, method, data=None, etag='*'):
        with self.condition:
            session = self.sessions.get(token)
            if not session or session['epoch'] != self.epoch:
                raise ValueError('Expired media session')
            path = session['path']
        try:
            with self.request(path, method, data, {'Content-Type':'application/trickle-ice-sdpfrag','If-Match':etag}) as response:
                return response.status, response.read(131072)
        finally:
            if method == 'DELETE':
                with self.condition:
                    self.sessions.pop(token, None)

    def delete_remote(self, path):
        try:
            with self.request(path, 'DELETE'):
                pass
        except OSError:
            pass

    def start_server(self):
        binary = self.root/'vendor/mediamtx/mediamtx'
        if not binary.exists():
            raise RuntimeError('MediaMTX is not installed')
        addresses = ['127.0.0.1']
        try:
            result = subprocess.run(['hostname','-I'],capture_output=True,text=True,timeout=2)
            addresses += [value for value in result.stdout.split() if ipaddress.ip_address(value).version == 4]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        config = dict(logLevel='warn', rtsp=True,rtspAddress=f'127.0.0.1:{RTSP_PORT}',rtspTransports=['tcp'],
                      rtmp=False,hls=False,srt=False,playback=False,moq=False,
                      webrtc=True,webrtcAddress=f'127.0.0.1:{WHEP_PORT}',webrtcAllowOrigins=['*'],
                      webrtcLocalUDPAddress=f':{ICE_PORT}',webrtcLocalTCPAddress=f':{ICE_PORT}',
                      webrtcIPsFromInterfaces=False,webrtcAdditionalHosts=list(dict.fromkeys(addresses)),
                      webrtcICEServers2=[],api=True,apiAddress=f'127.0.0.1:{API_PORT}',
                      udpMaxPayloadSize=1180,writeQueueSize=64,
                      paths={'worktime-'+locale+'-'+profile:dict(source='publisher') for locale in LOCALES for profile in PROFILES})
        directory = self.root/'logs'
        directory.mkdir(exist_ok=True)
        path = directory/'mediamtx.runtime.yml'
        path.write_text(yaml.safe_dump(config))
        with (directory/'mediamtx.log').open('ab') as log:
            self.process = subprocess.Popen([str(binary),str(path)],stdin=subprocess.DEVNULL,
                                            stdout=log,stderr=subprocess.STDOUT,close_fds=True)

    def run(self):
        import cv2
        from .overlay import draw_overlay
        last_server_attempt = 0
        published = {}
        last_publish = dict.fromkeys(PROFILES,0)
        last_jpeg = dict.fromkeys(PROFILES,0)
        active_epoch = self.epoch
        while not self.stop.is_set():
            try:
                now = time.monotonic()
                if (self.process is None or self.process.poll() is not None) and now-last_server_attempt >= 3:
                    last_server_attempt = now
                    try:
                        self.start_server()
                    except (OSError, RuntimeError) as error:
                        self.error = str(error)
                with self.condition:
                    epoch = self.epoch
                    packet = self.latest
                    stale = not packet or now-packet[-1]/1e9 >= packet[3]['max_observation_age']
                    obsolete = [key for key,value in self.sessions.items() if value['epoch'] != epoch or stale or now-value['created'] > 30]
                    removed = [self.sessions.pop(key) for key in obsolete]
                    demanded = {(value['locale'],value['profile']) for value in self.sessions.values()}
                    demanded.update(key for key,version in self.pending.values() if version == epoch)
                    jpeg_profiles = set(self.socket_profiles.values())
                for session in removed:
                    self.delete_remote(session['path'])
                if active_epoch != epoch or stale:
                    for publisher in self.publishers.values():
                        publisher.close()
                    with self.condition:
                        self.publishers.clear()
                        self.jpegs.clear()
                    active_epoch = epoch
                    published.clear()
                for locale in list(self.publishers):
                    if locale not in demanded:
                        self.publishers.pop(locale).close()
                if stale:
                    self.stop.wait(.01)
                    continue
                _,image,persons,config,fresh,regions_match,meta,received = packet
                height,width = image.shape[:2]
                for profile,options in PROFILES.items():
                    jpeg_needed = profile in jpeg_profiles
                    profile_demand = {key for key in demanded if key[1] == profile}
                    if not profile_demand and not jpeg_needed:
                        continue
                    if published.get(profile) is packet or now-last_publish[profile] < 1/options['max_fps']:
                        continue
                    published[profile] = packet
                    last_publish[profile] = now
                    target_width = min(options['width'],width)//2*2
                    target_height = max(2,round(height*target_width/width/2)*2)
                    small = cv2.resize(image,(target_width,target_height),interpolation=cv2.INTER_AREA)
                    jpeg_interval = .1 if profile == 'local' else .2
                    make_jpeg = jpeg_needed and now-last_jpeg[profile] >= jpeg_interval
                    quality = 82 if profile == 'local' else 45
                    def cache_jpeg(locale,marked):
                        ok,jpeg = cv2.imencode('.jpg',marked,[cv2.IMWRITE_JPEG_QUALITY,quality])
                        if ok:
                            with self.condition:
                                if epoch == self.epoch:
                                    self.jpegs[(locale,profile)] = (epoch,received,jpeg.tobytes(),config['revision'],config['privacy']['enabled'],meta,config['max_observation_age'])
                                    self.condition.notify_all()
                    if make_jpeg:
                        cache_jpeg('raw',small)
                    for locale in LOCALES:
                        key=(locale,profile)
                        if key not in profile_demand and not make_jpeg:
                            continue
                        marked = small.copy()
                        if regions_match:
                            draw_overlay(marked,persons,config,fresh=fresh,locale=locale)
                        if key in profile_demand:
                            if key not in self.publishers:
                                self.publishers[key] = H264Publisher(locale,target_width,target_height,profile)
                            with self.condition:
                                if epoch != self.epoch:
                                    break
                                encoded_started = time.monotonic_ns()
                                self.publishers[key].write(marked, received)
                                self.quality.sample('encoder_submit_ms', (time.monotonic_ns()-encoded_started)/1e6)
                                self.quality.mark('video_send_'+locale+'_'+profile)
                        if make_jpeg:
                            cache_jpeg(locale,marked)
                    if make_jpeg:
                        last_jpeg[profile] = now
                if self.process is not None and self.process.poll() is None:
                    self.error = None
                self.stop.wait(.002)
            except Exception as error:
                self.error = type(error).__name__+': '+str(error)
                for publisher in self.publishers.values():
                    publisher.close()
                with self.condition:
                    self.publishers.clear()
                self.stop.wait(.5)
        for publisher in self.publishers.values():
            publisher.close()
        with self.condition:
            removed = list(self.sessions.values())
            self.sessions.clear()
        for session in removed:
            self.delete_remote(session['path'])
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

    def close(self):
        self.invalidate()
        self.stop.set()
        self.thread.join(timeout=12)
