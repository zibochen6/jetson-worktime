#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "启动失败：找不到项目 Python 环境 $PYTHON_BIN" >&2
  exit 1
fi
# Training supervision is independent of the browser and preview process group.
if command -v systemctl >/dev/null 2>&1 && systemctl --user cat worktime-training.service >/dev/null 2>&1; then
  systemctl --user start worktime-training.service || true
fi
exec "$PYTHON_BIN" - "$PROJECT_DIR" <<'PY'
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import signal
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
interrupted = False


def on_signal(signum, frame):
    global interrupted
    interrupted = True


def find_running_pid():
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            arguments = (directory/'cmdline').read_bytes().split(b'\0')
            cwd = (directory/'cwd').resolve()
            if any(arg and (cwd/os.fsdecode(arg)).resolve() == entry for arg in arguments[1:]):
                return int(directory.name)
        except (OSError, ValueError):
            continue
    return None


def addresses():
    result = [('本机', '127.0.0.1')]
    try:
        interfaces = json.loads(subprocess.check_output(['ip', '-j', 'address', 'show', 'up'], text=True, timeout=3))
        for interface in interfaces:
            name = interface.get('ifname', '')
            for item in interface.get('addr_info', []):
                address = item.get('local', '')
                try:
                    ip = ipaddress.ip_address(address)
                except ValueError:
                    continue
                if ip.version != 4 or ip.is_loopback or ip.is_link_local or ip.is_unspecified:
                    continue
                label = 'Tailscale' if name.startswith('tailscale') else name
                if not any(value == address for _, value in result):
                    result.append((label, address))
    except (OSError, ValueError, subprocess.SubprocessError):
        try:
            for address in subprocess.check_output(['hostname', '-I'], text=True, timeout=3).split():
                ip = ipaddress.ip_address(address)
                if ip.version == 4 and not ip.is_loopback and not ip.is_link_local and not any(v == address for _, v in result):
                    result.append(('网络', address))
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    return result


def check_port_available(port):
    # Match HTTPServer's SO_REUSEADDR policy: a closed server's TIME_WAIT sockets
    # must not make a legitimate restart look like another live service.
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(('0.0.0.0', port))
        probe.listen(1)


def web_ready(port):
    try:
        with opener.open(f'http://127.0.0.1:{port}/api/v1/camera', timeout=1) as response:
            camera = json.load(response)
        return isinstance(camera, dict) and camera.get('schema_version') == '1.0' and camera.get('decoder') in ('nvv4l2decoder', 'software')
    except (OSError, URLError, ValueError):
        return False


def show_addresses(port):
    print('可访问地址（请根据网络选择）：', flush=True)
    for label, address in addresses():
        print(f'  {label}: http://{address}:{port}/', flush=True)
    print('地址取决于网络连通性及防火墙设置。', flush=True)


def stop_owned(process):
    print('\n正在停止服务并释放摄像头、GPU 和视频资源……', flush=True)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        print('正常退出超时，正在强制停止本次启动的进程组。', flush=True)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    # The media server belongs to the same dedicated process group.
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        print('本次启动的服务已退出。', flush=True)
    else:
        print('仍有本次启动的子进程，正在清理。', flush=True)
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(50):
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                print('子进程已退出。', flush=True)
                break
            time.sleep(.1)
        else:
            print('子进程尚未全部退出，请检查进程和端口。', file=sys.stderr, flush=True)
            return False
    return True


def identity(pid):
    try:
        data = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return None if data[0] == 'Z' else data[19]
    except (OSError, IndexError):
        return None


def existing_port(pid, default):
    try:
        entries = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
        value = next((x.split(b'=', 1)[1] for x in entries if x.startswith(b'WORKTIME_PORT=')), None)
        return int(value) if value and 1 <= int(value) <= 65535 else 8088
    except (OSError, ValueError):
        return default


def watch_existing(pid, token):
    print('已连接到本项目现有服务；保持终端打开，按 Ctrl+C 停止此服务。', flush=True)
    while not interrupted and identity(pid) == token:
        time.sleep(.2)
    if not interrupted:
        print('服务已退出。', flush=True)
        return 0
    # Compare the process start time immediately before signalling to avoid a reused PID.
    if identity(pid) != token:
        print('原服务已退出。', flush=True)
        return 0
    print('\n正在停止现有服务并释放其资源……', flush=True)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return 0
    for _ in range(300):
        if identity(pid) != token:
            print('服务已退出。', flush=True)
            return 0
        time.sleep(.1)
    print('服务未在 30 秒内退出，请检查服务日志和残留进程。', file=sys.stderr, flush=True)
    return 1


def main():
    try:
        port = int(os.environ.get('WORKTIME_PORT', '8088'))
    except ValueError:
        print('启动失败：WORKTIME_PORT 必须是整数端口。', file=sys.stderr)
        return 1
    if not 1 <= port <= 65535 or not entry.is_file():
        print('启动失败：请检查端口和 scripts/preview.py。', file=sys.stderr)
        return 1
    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    logs.mkdir(exist_ok=True)
    process = None
    with (logs/'start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid = find_running_pid()
        if pid:
            token = identity(pid)
            if token is None:
                print('检测到的服务已退出，请重新运行启动脚本。', file=sys.stderr)
                return 1
            actual_port = existing_port(pid, port)
            print(f'服务已在运行（PID {pid}）。', flush=True)
            show_addresses(actual_port)
            # Release the launcher lock while attached; other launchers can inspect it.
            fcntl.flock(lock, fcntl.LOCK_UN)
            return watch_existing(pid, token)
        try:
            check_port_available(port)
        except OSError:
            print(f'启动失败：端口 {port} 已被占用。', file=sys.stderr)
            return 1
        if interrupted:
            return 130
        with log_path.open('ab') as output:
            process = subprocess.Popen([sys.executable, '-u', str(entry)], cwd=root,
                stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True, close_fds=True)
        print('正在启动工时统计系统……', flush=True)
        deadline = time.monotonic()+60
        while time.monotonic() < deadline and not interrupted:
            if process.poll() is not None:
                print(f'启动失败，请查看日志：{log_path}', file=sys.stderr)
                return 1
            if web_ready(port):
                break
            time.sleep(.2)
        else:
            stop_owned(process)
            if not interrupted:
                print(f'启动超时，请查看日志：{log_path}', file=sys.stderr)
            return 130 if interrupted else 1
    print(f'启动成功，进程 PID {process.pid}；日志：{log_path}', flush=True)
    show_addresses(port)
    print('保持终端打开；按 Ctrl+C 停止本次启动的服务。', flush=True)
    while not interrupted and process.poll() is None:
        time.sleep(.2)
    if interrupted:
        return 0 if stop_owned(process) else 1
    print(f'服务已退出（退出码 {process.returncode}），请查看日志：{log_path}', file=sys.stderr)
    stop_owned(process)
    return process.returncode or 1


try:
    sys.exit(main())
except OSError as error:
    print(f'启动失败：{error}', file=sys.stderr)
    sys.exit(1)
PY
