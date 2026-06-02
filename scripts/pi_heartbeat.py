#!/usr/bin/env python3
"""
THEIA Pi Node Heartbeat
-----------------------
Envoie périodiquement l'IP actuelle au HUB pour permettre le contrôle SSH distant.
Ce script doit tourner en service systemd sur chaque Pi XAVER.

Installation:
1. Copier ce fichier sur le Pi: /home/theia-xaver/heartbeat.py
2. Créer le service systemd: /etc/systemd/system/theia-heartbeat.service
3. Activer: sudo systemctl enable --now theia-heartbeat

Exemple de service systemd (/etc/systemd/system/theia-heartbeat.service):
[Unit]
Description=THEIA Heartbeat Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=theia-xaver
ExecStart=/usr/bin/python3 /home/theia-xaver/heartbeat.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
"""

import socket
import time
import requests
import subprocess
import os

# Configuration - adapter selon le Pi
NODE_ID = os.environ.get("THEIA_NODE_ID", "xaver01")  # xaver01, xaver02
HUB_HOSTS = [
    "theia.tail19d68e.ts.net",  # Tailscale MagicDNS
    "192.168.84.179",            # Local network fallback
    "theia",                     # mDNS
]
HUB_PORT = 8000
HEARTBEAT_INTERVAL = 60  # secondes


def get_local_ip():
    """Obtenir l'IP locale du Pi."""
    try:
        # Méthode 1: via socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        pass
    
    try:
        # Méthode 2: via hostname
        hostname = socket.gethostname()
        return socket.gethostbyname(hostname)
    except Exception:
        return "127.0.0.1"


def get_mac_address():
    """Obtenir l'adresse MAC de l'interface principale."""
    try:
        # Lire l'adresse MAC de l'interface wlan0 ou eth0
        for iface in ["wlan0", "eth0"]:
            path = f"/sys/class/net/{iface}/address"
            if os.path.exists(path):
                with open(path) as f:
                    return f.read().strip()
    except Exception:
        pass
    return None


def get_hostname():
    """Obtenir le hostname du Pi."""
    try:
        return socket.gethostname()
    except Exception:
        return None


def send_heartbeat(hub_url: str) -> bool:
    """Envoyer le heartbeat au HUB."""
    payload = {
        "node_id": NODE_ID,
        "ip_address": get_local_ip(),
        "mac_address": get_mac_address(),
        "hostname": get_hostname(),
    }
    
    try:
        resp = requests.post(
            f"{hub_url}/api/logs/heartbeat",
            json=payload,
            timeout=5,
        )
        if resp.status_code == 200:
            print(f"[HEARTBEAT] OK -> {hub_url} | IP: {payload['ip_address']}")
            return True
        else:
            print(f"[HEARTBEAT] Error {resp.status_code}: {resp.text}")
    except requests.exceptions.RequestException as e:
        print(f"[HEARTBEAT] Failed to reach {hub_url}: {e}")
    
    return False


def main():
    print(f"[THEIA] Heartbeat service starting for node: {NODE_ID}")
    print(f"[THEIA] Local IP: {get_local_ip()}")
    print(f"[THEIA] MAC: {get_mac_address()}")
    print(f"[THEIA] Hostname: {get_hostname()}")
    
    while True:
        success = False
        
        # Essayer chaque HUB possible
        for hub in HUB_HOSTS:
            hub_url = f"http://{hub}:{HUB_PORT}"
            if send_heartbeat(hub_url):
                success = True
                break
        
        if not success:
            print(f"[HEARTBEAT] Failed to reach any HUB")
        
        time.sleep(HEARTBEAT_INTERVAL)


if __name__ == "__main__":
    main()
