"""Regression checks for slow viewers and media invalidation."""
import ast
from pathlib import Path
import socket
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock
import numpy as np
from jetson_worktime.runtime_quality import RuntimeQuality
from jetson_worktime.streaming import VideoTransport


def transport():
    value=VideoTransport.__new__(VideoTransport)
    value.condition=threading.Condition(threading.RLock())
    value.epoch=0
    value.latest=None
    value.jpegs={}
    value.sessions={}
    value.pending={}
    value.sockets=set()
    value.stop=threading.Event()
    return value


class StreamingTests(unittest.TestCase):
    def test_short_stall_retains_peer_without_publishing_stale_frames_and_long_stall_expires(self):
        value=transport();value.root=Path('.')
        value.process=SimpleNamespace(poll=lambda:None,terminate=lambda:None,wait=lambda timeout:None)
        value.quality=RuntimeQuality();value.error=None
        value.delete_remote=MagicMock()
        key=('en','local');sent=[];arrived=threading.Event()
        publisher=SimpleNamespace(write=lambda image,received,*args:(sent.append(received),arrived.set()),close=MagicMock())
        value.publishers={key:publisher}
        value.sessions={'viewer':dict(epoch=0,locale='en',profile='local',created=time.monotonic(),path='/viewer')}
        config=dict(max_observation_age=1.5,revision=0,privacy={'enabled':False})
        frame=np.zeros((20,20,3),np.uint8)
        value.submit(frame,[],config,True,True,time.monotonic_ns())
        worker=threading.Thread(target=value.run);worker.start()
        def eventually(predicate):
            deadline=time.monotonic()+1
            while not predicate() and time.monotonic()<deadline:threading.Event().wait(.005)
            self.assertTrue(predicate(),value.error)
        try:
            self.assertTrue(arrived.wait(1),value.error);arrived.clear()
            # Force a stale input, then wait for the worker to discard cached JPEGs.
            with value.condition:
                value.jpegs[key]='old';value.submit(frame,[],config,True,True,time.monotonic_ns()-2000000000)
            eventually(lambda:not value.jpegs)
            self.assertEqual(len(sent),1);self.assertIn('viewer',value.sessions)
            self.assertIs(value.publishers[key],publisher);publisher.close.assert_not_called()
            value.submit(frame,[],config,True,True,time.monotonic_ns())
            self.assertTrue(arrived.wait(1),value.error)
            self.assertEqual(len(sent),2);self.assertIn('viewer',value.sessions)
            self.assertIs(value.publishers[key],publisher)
            value.submit(frame,[],config,True,True,time.monotonic_ns()-7000000000)
            eventually(lambda:'viewer' not in value.sessions and not value.publishers)
            value.delete_remote.assert_called_once_with('/viewer');publisher.close.assert_called_once()
        finally:
            value.stop.set();worker.join(2)

    def test_video_delete_dispatch_is_not_shadowed_by_studio_delete(self):
        from urllib.parse import urlsplit
        root=Path(__file__).resolve().parents[1]
        handler=next(n for n in ast.parse((root/'scripts/preview.py').read_text()).body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        methods=[n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='do_DELETE']
        self.assertEqual(len(methods),1,'duplicate HTTP handlers silently replace each other')
        studio=SimpleNamespace(handle=MagicMock(return_value=True))
        namespace=dict(urlsplit=urlsplit,studio_http=studio)
        exec(compile(ast.Module(body=methods,type_ignores=[]),'preview.py','exec'),namespace)
        instance=SimpleNamespace(path='/api/v1/video/sessions/'+'a'*32,whep=MagicMock(),error=MagicMock())
        namespace['do_DELETE'](instance)
        instance.whep.assert_called_once_with('DELETE');studio.handle.assert_not_called()
        instance.path='/api/v1/datasets/example';namespace['do_DELETE'](instance)
        studio.handle.assert_called_once_with(instance,'DELETE');instance.error.assert_not_called()

    def test_latest_frame_replaces_previous_without_a_queue(self):
        value=transport()
        value.submit('old',[],{},True,True,1)
        value.submit('new',[],{},True,True,2)
        self.assertEqual(value.latest[1],'new')
        value.invalidate()
        self.assertIsNone(value.latest)
        self.assertEqual(value.epoch,1)

    def test_invalidation_interrupts_a_blocked_socket(self):
        value=transport()
        sender,receiver=socket.socketpair()
        self.addCleanup(sender.close)
        self.addCleanup(receiver.close)
        sender.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
        value.add_socket(sender)
        finished=threading.Event()
        def write():
            try:sender.sendall(b'x'*1000000)
            except OSError:pass
            finally:finished.set()
        worker=threading.Thread(target=write,daemon=True)
        worker.start()
        self.assertFalse(finished.wait(.05))
        start=time.monotonic()
        value.invalidate()
        self.assertTrue(finished.wait(.5))
        self.assertLess(time.monotonic()-start,.5)
        worker.join()

    def test_viewer_limit_and_invalidated_session(self):
        value=transport()
        value.sessions={str(i):dict(epoch=0,path='/unused') for i in range(3)}
        with self.assertRaises(ValueError):value.add_socket(MagicMock())
        value.invalidate()
        with self.assertRaises(ValueError):value.session_request('0','PATCH',b'data')

    def test_fallback_records_only_the_requested_stream_and_releases_it(self):
        value=transport();connection=MagicMock()
        value.add_socket(connection,'local',stream='raw')
        self.assertEqual(value.socket_streams[connection],('raw','local'))
        value.remove_socket(connection)
        self.assertEqual(value.socket_streams,{})

    def test_fallback_cancellation_interrupts_the_real_socket_and_rejects_late_get(self):
        value=transport();sender,receiver=socket.socketpair();self.addCleanup(sender.close);self.addCleanup(receiver.close)
        token='a'*32;value.add_socket(sender,'local',token=token)
        value.cancel_fallback(token)
        self.assertNotIn(sender,value.sockets);self.assertEqual(receiver.recv(1),b'')
        value.cancel_fallback(token)
        with self.assertRaises(ValueError):value.add_socket(sender,'local',token=token)
        value.cancel_fallback('b'*32)
        with self.assertRaises(ValueError):value.add_socket(sender,'local',token='b'*32)

    def test_stream_network_write_does_not_hold_media_lock(self):
        root=Path(__file__).resolve().parents[1]
        tree=ast.parse((root/'scripts/preview.py').read_text())
        handler=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        method=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='stream')
        namespace=dict(behavior=None,time=time,socket=socket,parse_qs=__import__('urllib.parse',fromlist=['parse_qs']).parse_qs,urlsplit=__import__('urllib.parse',fromlist=['urlsplit']).urlsplit)
        exec(compile(ast.Module(body=[method],type_ignores=[]),'preview.py','exec'),namespace)
        value=transport();packet=(0,time.monotonic_ns(),b'jpeg');value.jpegs[('en','remote')]=packet
        stop=threading.Event();namespace['behavior']=SimpleNamespace(transport=value,stop=stop)
        socket_mock=MagicMock(); acquired=[]
        def write(data):
            done=threading.Event()
            def settings_change():
                with value.condition:acquired.append(True)
                done.set()
            thread=threading.Thread(target=settings_change);thread.start()
            self.assertTrue(done.wait(.5),'socket write is holding a shared lock')
            thread.join();stop.set()
        instance=SimpleNamespace(path='/stream.mjpg',connection=socket_mock,send_response=MagicMock(),send_header=MagicMock(),end_headers=MagicMock(),wfile=SimpleNamespace(write=write,flush=lambda:None))
        namespace['stream'](instance,locale='en')
        self.assertEqual(acquired,[True])
        self.assertEqual(value.sockets,set())

    def test_reconnecting_viewer_waits_for_fresh_frame_after_cached_frame_expires(self):
        from urllib.parse import parse_qs,urlsplit
        root=Path(__file__).resolve().parents[1]
        handler=next(n for n in ast.parse((root/'scripts/preview.py').read_text()).body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        method=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='stream')
        value=transport();value.jpegs[('en','remote')]=(0,time.monotonic_ns()-3000000000,b'stale')
        stop=threading.Event();namespace=dict(behavior=SimpleNamespace(transport=value,stop=stop),time=time,socket=socket,parse_qs=parse_qs,urlsplit=urlsplit)
        exec(compile(ast.Module(body=[method],type_ignores=[]),'preview.py','exec'),namespace)
        sent=[]
        def write(data):sent.append(data);stop.set()
        instance=SimpleNamespace(path='/stream.mjpg',connection=MagicMock(),send_response=MagicMock(),send_header=MagicMock(),end_headers=MagicMock(),wfile=SimpleNamespace(write=write,flush=lambda:None))
        thread=threading.Thread(target=lambda:namespace['stream'](instance,locale='en'),daemon=True);thread.start()
        time.sleep(.05)
        with value.condition:
            value.jpegs[('en','remote')]=(0,time.monotonic_ns(),b'fresh')
            value.condition.notify_all()
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(sent),1)
        self.assertIn(b'fresh',sent[0])
        self.assertNotIn(b'stale',sent[0])

    def test_mjpeg_keeps_socket_when_expired_cache_is_cleared_then_resumes(self):
        from urllib.parse import parse_qs,urlsplit
        root=Path(__file__).resolve().parents[1]
        handler=next(n for n in ast.parse((root/'scripts/preview.py').read_text()).body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        method=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='stream')
        value=transport();key=('en','remote');value.jpegs[key]=(0,time.monotonic_ns(),b'first')
        stop=threading.Event();first=threading.Event();sent=[]
        namespace=dict(behavior=SimpleNamespace(transport=value,stop=stop),time=time,socket=socket,parse_qs=parse_qs,urlsplit=urlsplit)
        exec(compile(ast.Module(body=[method],type_ignores=[]),'preview.py','exec'),namespace)
        def write(data):
            sent.append(data)
            if len(sent)==1:
                with value.condition:value.jpegs.clear();value.condition.notify_all()
                first.set()
            else:stop.set()
        instance=SimpleNamespace(path='/stream.mjpg',connection=MagicMock(),send_response=MagicMock(),send_header=MagicMock(),end_headers=MagicMock(),wfile=SimpleNamespace(write=write,flush=lambda:None))
        thread=threading.Thread(target=lambda:namespace['stream'](instance,locale='en'),daemon=True);thread.start()
        try:
            self.assertTrue(first.wait(1));self.assertTrue(thread.is_alive())
            with value.condition:
                value.jpegs[key]=(0,time.monotonic_ns(),b'resumed');value.condition.notify_all()
            thread.join(1);self.assertFalse(thread.is_alive());self.assertEqual(len(sent),2)
            self.assertIn(b'resumed',sent[1])
        finally:
            stop.set()
            with value.condition:value.stop.set();value.condition.notify_all()
            thread.join(1)

    def test_capture_preview_skips_every_detection_layer_without_modifying_privacy(self):
        import numpy as np
        from unittest.mock import patch
        from jetson_worktime.streaming import preview_frame
        from jetson_worktime.media import protect_frame
        image=np.random.default_rng(3).integers(0,255,(200,200,3),dtype=np.uint8)
        person=dict(bbox_xyxy=[50,10,150,190],keypoints=[])
        config=dict(privacy={'enabled':True})
        protected=protect_frame(image,[person],config)
        self.assertFalse(np.array_equal(image,protected))
        with patch('jetson_worktime.overlay.draw_overlay') as overlay:
            result=preview_frame(protected,[person],config,True,True,'raw')
            overlay.assert_not_called()
        self.assertTrue(np.array_equal(result,protected))
        with self.assertRaises(ValueError):preview_frame(protected,[],config,True,True,'untrusted')

    def test_raw_stream_uses_the_same_bounded_latest_frame_and_invalidation(self):
        value=transport()
        value.jpegs[('raw','remote')]=(0,time.monotonic_ns(),b'protected-unmarked')
        value.submit('protected',[],{'revision':9},True,True,time.monotonic_ns())
        value.invalidate()
        self.assertIsNone(value.latest)
        self.assertEqual(value.jpegs,{})

    def test_annotated_preview_draws_on_a_copy_and_raw_is_in_media_paths(self):
        import numpy as np
        from unittest.mock import patch
        from jetson_worktime.streaming import preview_frame,VIDEO_STREAMS
        self.assertIn('raw',VIDEO_STREAMS)
        image=np.zeros((20,20,3),np.uint8)
        def draw(frame,*args,**kwargs):frame[0,0]=255
        with patch('jetson_worktime.overlay.draw_overlay',side_effect=draw):
            marked=preview_frame(image,[],{},True,True,'en')
        self.assertTrue(np.all(image==0));self.assertGreater(marked.sum(),0)
