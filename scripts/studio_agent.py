"""User service: supervises durable local training jobs without owning live inference."""
from pathlib import Path
import signal
import sys
import threading
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from jetson_worktime.studio import Studio
from jetson_worktime.training import TrainingQueue
stop=threading.Event()
signal.signal(signal.SIGTERM,lambda *args:stop.set())
queue=TrainingQueue(Studio(ROOT))
# Prevent two supervisors from launching the same durable queue.
import fcntl
with (queue.store.data/'agent.lock').open('a') as guard:
    try: fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: sys.exit(0)
    # A power loss during spawn can leave preparing without a PID.
    for job in queue.store.list('job'):
        if job['state'] in ('preparing','stopping') and not job.get('pid'):
            job.update(state='interrupted',stage='interrupted',error='interrupted');queue.store.put('job',job)
    while not stop.is_set():
        try:
            (queue.store.data/'agent-heartbeat').touch()
            queue.tick()
        except Exception:
            import traceback;traceback.print_exc()
        stop.wait(1)
