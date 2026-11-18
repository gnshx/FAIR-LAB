#!/usr/bin/env bash
# ==============================================================================
# FairLab (FairGPU) — Node Telemetry Agent Automated Installer
# Target Environment: Linux Workstations (Ubuntu 22.04 / 24.04 LTS)
# Laboratory: IIT Bhilai · Computer Lab L-106
#
# Usage:
#   sudo ./install_node_agent.sh [CONTROLLER_URL] [MACHINE_ID]
#
# Examples:
#   sudo ./install_node_agent.sh http://10.0.1.100:5000/api/labs/L106/telemetry/report L106-PC-05
#   sudo ./install_node_agent.sh (auto-detects hostname and uses default server)
# ==============================================================================

set -e

CONTROLLER_URL="${1:-http://localhost:5000/api/labs/L106/telemetry/report}"
MACHINE_ID="${2:-$(hostname -s)}"

echo "=================================================================="
echo "🚀 FairLab GPU Telemetry Node Agent — Automated Installer"
echo "   Target Machine ID : ${MACHINE_ID}"
echo "   Controller URL    : ${CONTROLLER_URL}"
echo "=================================================================="

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is required. Please install python3 first."
    exit 1
fi
echo "✓ Python 3 is installed: $(python3 --version)"

# 2. Check NVIDIA SMI & Drivers
if command -v nvidia-smi &> /dev/null; then
    echo "✓ Detected NVIDIA Management Library (nvidia-smi):"
    nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || true
else
    echo "⚠️  nvidia-smi not found in PATH."
    echo "   Agent will operate in PCIe bus probe fallback mode (lspci)."
fi

# 3. Create destination directory
INSTALL_DIR="/opt/fairlab"
echo "📂 Installing agent files to ${INSTALL_DIR}..."
sudo mkdir -p "${INSTALL_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp "${SCRIPT_DIR}/l106_node_agent.py" "${INSTALL_DIR}/l106_node_agent.py"
sudo chmod +x "${INSTALL_DIR}/l106_node_agent.py"

# 4. Generate systemd service unit
SERVICE_FILE="/etc/systemd/system/fairlab-agent.service"
echo "⚙️ Generating systemd service unit: ${SERVICE_FILE}..."
sudo tee "${SERVICE_FILE}" > /dev/null <<EOF
[Unit]
Description=FairLab L-106 GPU Telemetry Node Agent
Documentation=https://github.com/iit-bhilai/fairlab
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Restart=always
RestartSec=10
Environment="FAIRLAB_CONTROLLER_URL=${CONTROLLER_URL}"
Environment="FAIRLAB_MACHINE_ID=${MACHINE_ID}"
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/l106_node_agent.py --interval 5

# Security sandboxing
ProtectSystem=full
ProtectHome=read-only
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

# 5. Reload systemd and start service
echo "🔄 Reloading systemd and enabling fairlab-agent.service..."
sudo systemctl daemon-reload
sudo systemctl enable --now fairlab-agent.service

echo ""
echo "=================================================================="
echo "🎉 SUCCESS: FairLab GPU Telemetry Agent is active on ${MACHINE_ID}!"
echo "   To view live logs: sudo journalctl -u fairlab-agent.service -f"
echo "   To check status:   sudo systemctl status fairlab-agent.service"
echo "=================================================================="

