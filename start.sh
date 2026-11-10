#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "启动失败，找不到项目 Python 环境 $PYTHON_BIN" >&2
  exit 1
fi

exec "$PYTHON_BIN" - "$PROJECT_DIR" <<'PY'
import fcntl
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

root = Path(sys.argv[1])
entry = root/'scripts/preview.py'
logs = root/'logs'
log_path = logs/'preview.log'
opener = build_opener(ProxyHandler({}))


def find_running_pid():
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            arguments = (directory/'cmdline').read_bytes().split(b'\0')
            cwd = (directory/'cwd').resolve()
            for argument in arguments[1:]:
                if argument and (cwd/os.fsdecode(argument)).resolve() == entry:
                    return int(directory.name)
        except (OSError, ValueError):
            continue
    return None


def web_ready(port):
    try:
        with opener.open(f'http://127.0.0.1:{port}/api/v1/camera', timeout=1) as response:
            camera = json.load(response)
        return isinstance(camera, dict) and camera.get('schema_version') == '1.0' and camera.get('decoder') in ('nvv4l2decoder', 'software')
    except (OSError, URLError, ValueError):
        return False


def show_info(pid, port):
    try:
        addresses = subprocess.check_output(['hostname', '-I'], text=True, timeout=2).split()
    except (OSError, subprocess.SubprocessError):
        addresses = []
    host = next((address for address in addresses if '.' in address), '127.0.0.1')
    try:
        output = Path(f'/proc/{pid}/fd/1').resolve()
        destination = str(output) if output.is_file() else '当前进程的标准输出'
    except OSError:
        destination = str(log_path)
    print(f'访问地址  http://{host}:{port}')
    print(f'进程 PID  {pid}')
    print(f'运行日志  {destination}')


def main():
    try:
        port = int(os.environ.get('WORKTIME_PORT', '8088'))
    except ValueError:
        print('启动失败，WORKTIME_PORT 必须是整数端口。', file=sys.stderr)
        return 1
    if not 1 <= port <= 65535 or not entry.is_file():
        print('启动失败，请检查端口范围和 scripts/preview.py。', file=sys.stderr)
        return 1

    logs.mkdir(exist_ok=True)
    with (logs/'start.lock').open('a') as lock:
        # One launcher at a time. Detached children do not inherit this lock.
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid = find_running_pid()
        process = None
        if pid is None:
            try:
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    probe.bind(('0.0.0.0', port))
            except OSError:
                print(f'启动失败，端口 {port} 已被占用或无法使用。', file=sys.stderr)
                return 1
            with log_path.open('ab') as output:
                process = subprocess.Popen(
                    [sys.executable, '-u', str(entry)], cwd=root,
                    stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                    start_new_session=True, close_fds=True)
            pid = process.pid
            print('正在后台启动工时统计系统，请稍候……', flush=True)
        else:
            print('检测到已有服务进程，正在检查页面……', flush=True)

        deadline = time.monotonic()+60
        while time.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                print(f'启动失败，进程已退出。请查看 {log_path}', file=sys.stderr)
                return 1
            if not Path(f'/proc/{pid}').exists():
                print(f'服务进程已退出，请查看 {log_path}', file=sys.stderr)
                return 1
            if web_ready(port):
                print('启动成功。' if process is not None else '服务已在运行。')
                show_info(pid, port)
                return 0
            time.sleep(1)
        print(f'页面尚未就绪，进程 PID 为 {pid}。请检查端口 {port} 和运行日志 {log_path}。', file=sys.stderr)
        return 1


try:
    sys.exit(main())
except OSError as error:
    print(f'启动失败，{error}', file=sys.stderr)
    sys.exit(1)
PY
