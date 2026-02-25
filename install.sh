#!/usr/bin/env bash
# ============================================
# THEIA - Automated Installation Script
# IoT Hub Surveillance System for Raspberry Pi
# ============================================
# Usage: sudo ./install.sh
# Idempotent - safe to re-run at any time.
# ============================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Config ---
APP_DIR="/opt/theia/app"
DATA_DIR="/opt/theia/data"
TILE_DIR="/opt/theia/tiles"
LOG_DIR="/opt/theia/logs"
VENV_DIR="$APP_DIR/.venv"
SERVICE_USER="${SUDO_USER:-pi}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MAJOR=20

# --- Helpers ---
info()  { echo -e "${CYAN}[THEIA]${NC} $1"; }
ok()    { echo -e "${GREEN}[  OK ]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN ]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL ]${NC} $1"; exit 1; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        fail "This script must be run as root (use sudo ./install.sh)"
    fi
}

# ============================================
# STEP 1: System packages
# ============================================
install_system_packages() {
    info "Updating system packages..."
    apt-get update -qq
    apt-get upgrade -y -qq

    info "Installing dependencies..."
    apt-get install -y -qq \
        python3 python3-venv python3-pip python3-dev \
        gpsd gpsd-clients \
        curl wget git \
        build-essential \
        sqlite3 \
        2>/dev/null

    ok "System packages installed"
}

# ============================================
# STEP 1b: Arduino CLI (for TX firmware flashing)
# ============================================
install_arduino_cli() {
    if command -v arduino-cli &>/dev/null; then
        ok "arduino-cli already installed ($(arduino-cli version | head -1))"
    else
        info "Installing arduino-cli..."
        curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh
        ok "arduino-cli installed"
    fi

    info "Installing ESP32 board core (this may take a few minutes)..."
    # Add ESP32 board URL
    sudo -u "$SERVICE_USER" arduino-cli config init --overwrite 2>/dev/null || true
    sudo -u "$SERVICE_USER" arduino-cli config add board_manager.additional_urls \
        "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json" 2>/dev/null || true
    sudo -u "$SERVICE_USER" arduino-cli core update-index 2>/dev/null || true
    sudo -u "$SERVICE_USER" arduino-cli core install esp32:esp32 2>/dev/null || true

    # Install required libraries
    info "Installing Arduino libraries..."
    sudo -u "$SERVICE_USER" arduino-cli lib install "LD2450" 2>/dev/null || true

    ok "Arduino CLI + ESP32 core configured"
}

# ============================================
# STEP 2: Node.js (via NodeSource)
# ============================================
install_nodejs() {
    if command -v node &>/dev/null; then
        local current_version
        current_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$current_version" -ge "$NODE_MAJOR" ]]; then
            ok "Node.js v$(node -v) already installed"
            return
        fi
    fi

    info "Installing Node.js ${NODE_MAJOR}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
    npm install -g npm@latest 2>/dev/null || true

    ok "Node.js $(node -v) installed"
}

# ============================================
# STEP 3: Create directory structure
# ============================================
create_directories() {
    info "Creating THEIA directories..."
    mkdir -p "$APP_DIR" "$DATA_DIR" "$TILE_DIR" "$LOG_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" /opt/theia
    ok "Directories created: $APP_DIR, $DATA_DIR, $TILE_DIR, $LOG_DIR"
}

# ============================================
# STEP 4: Copy application files
# ============================================
copy_app_files() {
    info "Copying application files to $APP_DIR..."

    # rsync everything except node_modules, .next, .venv, .git
    rsync -a --delete \
        --exclude='node_modules' \
        --exclude='.next' \
        --exclude='.venv' \
        --exclude='.git' \
        --exclude='__pycache__' \
        "$SCRIPT_DIR/" "$APP_DIR/"

    chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
    ok "Application files synced"
}

# ============================================
# STEP 5: Environment file
# ============================================
setup_env() {
    local env_file="$APP_DIR/.env"

    if [[ ! -f "$env_file" ]]; then
        info "Creating .env from template..."
        cp "$APP_DIR/.env.example" "$env_file"
    else
        info ".env already exists, preserving..."
    fi

    # Force Pi mode
    sed -i 's/^NEXT_PUBLIC_MODE=.*/NEXT_PUBLIC_MODE=pi/' "$env_file"

    # Clear hardcoded serial ports so auto-detection works
    sed -i 's|^GPS_DEVICE=/dev/ttyUSB.*|GPS_DEVICE=|' "$env_file"
    sed -i 's|^LORA_SERIAL_PORT=/dev/ttyACM.*|LORA_SERIAL_PORT=|' "$env_file"

    # Ensure all required keys exist (add missing ones from example)
    while IFS= read -r line; do
        if [[ "$line" =~ ^[A-Z_]+= ]]; then
            key="${line%%=*}"
            if ! grep -q "^${key}=" "$env_file"; then
                echo "$line" >> "$env_file"
                info "Added missing env var: $key"
            fi
        fi
    done < "$APP_DIR/.env.example"

    chown "$SERVICE_USER:$SERVICE_USER" "$env_file"
    ok "Environment configured (NEXT_PUBLIC_MODE=pi)"
}

# ============================================
# STEP 6: Python virtual environment + deps
# ============================================
setup_python() {
    info "Setting up Python virtual environment..."

    if [[ ! -d "$VENV_DIR" ]]; then
        sudo -u "$SERVICE_USER" python3 -m venv "$VENV_DIR"
    fi

    sudo -u "$SERVICE_USER" "$VENV_DIR/bin/pip" install --upgrade pip -q
    sudo -u "$SERVICE_USER" "$VENV_DIR/bin/pip" install -r "$APP_DIR/backend/requirements.txt" -q

    ok "Python dependencies installed"
}

# ============================================
# STEP 7: Node.js dependencies + build
# ============================================
setup_nodejs() {
    info "Installing Node.js dependencies..."
    cd "$APP_DIR"

    # Install deps (--legacy-peer-deps for react-leaflet React 19 compat)
    sudo -u "$SERVICE_USER" npm ci --legacy-peer-deps --prefer-offline --no-audit 2>/dev/null || \
    sudo -u "$SERVICE_USER" npm install --legacy-peer-deps --prefer-offline --no-audit

    info "Building Next.js application..."
    sudo -u "$SERVICE_USER" npm run build

    # Standalone build requires manual copy of static assets + public
    # See: https://nextjs.org/docs/app/api-reference/config/next-config-js/output#automatically-copying-traced-files
    if [[ -d "$APP_DIR/.next/standalone" ]]; then
        info "Copying static assets to standalone output..."
        cp -r "$APP_DIR/.next/static" "$APP_DIR/.next/standalone/.next/static"
        if [[ -d "$APP_DIR/public" ]]; then
            cp -r "$APP_DIR/public" "$APP_DIR/.next/standalone/public"
        fi
        ok "Static assets copied to standalone"
    fi

    ok "Next.js built successfully"
}

# ============================================
# STEP 8a: Setup udev rules for stable USB names
# ============================================
setup_udev() {
    info "Setting up udev rules for stable USB device names..."
    if [[ -f "$APP_DIR/scripts/setup-udev-rules.sh" ]]; then
        bash "$APP_DIR/scripts/setup-udev-rules.sh"
        ok "udev rules configured"
    else
        warn "scripts/setup-udev-rules.sh not found, skipping udev setup"
    fi
}

# ============================================
# STEP 8b: Configure GPSD
# ============================================
setup_gpsd() {
    # Prefer /dev/theia-gps (udev symlink), then GPS_DEVICE from .env, then skip
    local gps_device=""

    if [[ -e "/dev/theia-gps" ]]; then
        gps_device="/dev/theia-gps"
    else
        gps_device=$(grep '^GPS_DEVICE=' "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2)
    fi

    if [[ -n "$gps_device" && -e "$gps_device" ]]; then
        info "Configuring gpsd for $gps_device..."

        cat > /etc/default/gpsd <<EOF
START_DAEMON="true"
GPSD_OPTIONS="-n"
DEVICES="$gps_device"
USBAUTO="false"
EOF
        systemctl restart gpsd 2>/dev/null || true
        systemctl enable gpsd 2>/dev/null || true
        ok "gpsd configured for $gps_device"
    else
        # No GPS device found -- configure gpsd with no device
        # CRITICAL: USBAUTO=false prevents gpsd from grabbing the LoRa port!
        info "No GPS device found. Configuring gpsd with no device..."

        cat > /etc/default/gpsd <<EOF
START_DAEMON="true"
GPSD_OPTIONS="-n"
DEVICES=""
USBAUTO="false"
EOF
        systemctl restart gpsd 2>/dev/null || true
        systemctl enable gpsd 2>/dev/null || true
        ok "gpsd configured (no device -- LoRa port protected)"
    fi
}

# ============================================
# STEP 9: Install systemd services
# ============================================
install_services() {
    info "Installing systemd services..."

    # Copy service files
    cp "$APP_DIR/services/theia-api.service" /etc/systemd/system/
    cp "$APP_DIR/services/theia-web.service" /etc/systemd/system/

    # Update User/Group in service files to match actual user
    sed -i "s/User=pi/User=$SERVICE_USER/" /etc/systemd/system/theia-api.service
    sed -i "s/Group=pi/Group=$SERVICE_USER/" /etc/systemd/system/theia-api.service
    sed -i "s/User=pi/User=$SERVICE_USER/" /etc/systemd/system/theia-web.service
    sed -i "s/Group=pi/Group=$SERVICE_USER/" /etc/systemd/system/theia-web.service

    systemctl daemon-reload

    # Enable and start services
    systemctl enable theia-api.service
    systemctl enable theia-web.service
    systemctl restart theia-api.service
    systemctl restart theia-web.service

    ok "Services installed and started"
}

# ============================================
# STEP 10: Verify
# ============================================
verify_install() {
    info "Verifying installation..."
    echo ""

    local all_ok=true

    # Check services
    for svc in theia-api theia-web; do
        if systemctl is-active --quiet "$svc"; then
            ok "$svc is running"
        else
            warn "$svc is NOT running"
            all_ok=false
        fi
    done

    # Wait for API startup
    sleep 3

    # Check health endpoint
    if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
        ok "API health check passed"
    else
        warn "API health check failed (may still be starting)"
        all_ok=false
    fi

    # Get IPs
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}  THEIA - Installation Complete${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""

    # LAN IPs
    local lan_ips
    lan_ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' || echo "unknown")
    for ip in $lan_ips; do
        echo -e "  Web UI:     ${GREEN}http://${ip}:3000${NC}"
        echo -e "  API:        ${GREEN}http://${ip}:8000${NC}"
    done

    # Tailscale
    if command -v tailscale &>/dev/null; then
        local ts_ip
        ts_ip=$(tailscale ip -4 2>/dev/null || echo "")
        if [[ -n "$ts_ip" ]]; then
            echo ""
            echo -e "  Tailscale:  ${GREEN}http://${ts_ip}:3000${NC}"
            echo -e "  Tailscale:  ${GREEN}http://${ts_ip}:8000${NC}"
        fi
    fi

    echo ""
    echo -e "  Dashboard:  ${GREEN}http://localhost:3000/dashboard${NC}"
    echo -e "  API Docs:   ${GREEN}http://localhost:8000/docs${NC}"
    echo ""

    # Service status
    echo -e "  ${CYAN}Service Status:${NC}"
    for svc in theia-api theia-web gpsd; do
        local status
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            status="${GREEN}active${NC}"
        else
            status="${YELLOW}inactive${NC}"
        fi
        printf "    %-20s %b\n" "$svc" "$status"
    done

    echo ""
    echo -e "  ${CYAN}Useful commands:${NC}"
    echo "    sudo systemctl status theia-api"
    echo "    sudo systemctl status theia-web"
    echo "    sudo journalctl -u theia-api -f"
    echo "    sudo journalctl -u theia-web -f"
    echo ""

    if $all_ok; then
        ok "All checks passed. THEIA is ready."
    else
        warn "Some checks failed. Review the output above."
    fi
}

# ============================================
# MAIN
# ============================================
main() {
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}  THEIA - IoT Hub Installation${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""

    check_root
    install_system_packages
    install_arduino_cli
    install_nodejs
    create_directories
    copy_app_files
    setup_env
    setup_python
    setup_nodejs
    setup_udev
    setup_gpsd
    install_services
    verify_install
}

main "$@"
