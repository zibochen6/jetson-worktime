#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"
cat > "$unit_dir/worktime-training.service" <<EOF
[Unit]
Description=Worktime local training supervisor
After=network.target
[Service]
Type=simple
WorkingDirectory=$project_root
ExecStart=$project_root/.venv/bin/python $project_root/scripts/studio_agent.py
Restart=on-failure
RestartSec=3
KillMode=process
UMask=0077
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now worktime-training.service
printf '%s\n' 'Training service installed. Enable loginctl linger for this user to start before desktop login.'
