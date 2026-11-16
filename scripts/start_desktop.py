#!/usr/bin/env python3
"""Open the local dashboard without waiting for the foreground CLI launcher."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[1]
OPENER = build_opener(ProxyHandler({}))


def camera_ready(url):
    try:
        with OPENER.open(url + 'api/v1/camera', timeout=1) as response:
            value = json.load(response)
        return value.get('schema_version') == '1.0' and value.get('decoder') in ('nvv4l2decoder', 'software')
    except (OSError, ValueError, AttributeError):
        return False


def project_running(root):
    entry = root / 'scripts/preview.py'
    proc = Path('/proc')
    if not proc.exists():
        return False
    for process in proc.iterdir():
        if not process.name.isdigit():
            continue
        try:
            args = (process / 'cmdline').read_bytes().split(b'\0')
            cwd = (process / 'cwd').resolve()
            if any(arg and (cwd / os.fsdecode(arg)).resolve() == entry for arg in args[1:]):
                return True
        except (OSError, ValueError):
            continue
    return False


def ensure_service(root, url, timeout=60):
    """Readiness, not start.sh exit, determines when the browser can open.

    A desktop click never attaches to or takes ownership of an existing service.
    The detached CLI launcher retains its own normal shutdown/cleanup behaviour.
    """
    logs = root / 'logs'
    logs.mkdir(exist_ok=True)
    with (logs / 'desktop-start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if camera_ready(url):
            return False
        process = None
        if not project_running(root):
            entry = root / 'start.sh'
            if not entry.is_file() or not os.access(entry, os.X_OK):
                raise RuntimeError(f'找不到可执行的启动脚本：{entry}')
            with (logs / 'desktop-service.log').open('ab') as output:
                process = subprocess.Popen([str(entry)], cwd=root, stdin=subprocess.DEVNULL,
                    stdout=output, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
            print('正在后台启动工时统计系统……', flush=True)
        else:
            print('服务正在运行，等待页面就绪……', flush=True)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if camera_ready(url):
                return process is not None
            if process is not None and process.poll() is not None:
                raise RuntimeError(f'服务未启动成功，请查看：{logs / "desktop-service.log"}')
            time.sleep(.2)
    raise RuntimeError(f'页面在 {timeout} 秒内未就绪；未重启现有服务。请查看：{logs / "preview.log"}')


def browser_command(url):
    local = Path.home() / '.local/opt/firefox/firefox'
    if local.is_file() and os.access(local, os.X_OK):
        return [str(local), '--new-tab', url]
    for name in ('firefox', 'chromium', 'chromium-browser', 'google-chrome'):
        binary = shutil.which(name)
        if binary:
            return [binary, '--new-tab', url]
    raise RuntimeError('找不到浏览器，请检查 Firefox 安装。')


def open_browser(root, url):
    if not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
        raise RuntimeError(f'当前没有桌面显示会话，请从 Jetson 桌面双击；或手动访问 {url}')
    command = browser_command(url)
    path = root / 'logs/desktop-browser.log'
    with path.open('ab') as output:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    # Firefox may hand the URL to an existing window and exit successfully.
    time.sleep(.7)
    if process.poll() not in (None, 0):
        raise RuntimeError(f'浏览器打开失败，请查看：{path}；服务仍在运行。')


def main():
    try:
        port = int(os.environ.get('WORKTIME_PORT', '8088'))
        if not 1 <= port <= 65535:
            raise ValueError('端口不合法')
        url = f'http://127.0.0.1:{port}/'
        ensure_service(ROOT, url)
        open_browser(ROOT, url)
        print(f'监控页面已打开：{url}', flush=True)
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        text = f'启动失败：{error}'
        print(text, file=sys.stderr, flush=True)
        try:
            log = ROOT / 'logs/desktop-launcher.log'
            log.parent.mkdir(exist_ok=True)
            with log.open('a') as output:
                output.write(time.strftime('%Y-%m-%d %H:%M:%S ') + text + '\n')
        except OSError:
            pass
        if sys.stdin.isatty():
            try:
                input('按回车关闭此窗口。')
            except EOFError:
                pass
        return 1


if __name__ == '__main__':
    sys.exit(main())
