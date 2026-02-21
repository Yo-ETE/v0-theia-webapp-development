"""
THEIA - Configuration endpoints
WiFi scan/connect, Ethernet status, Tailscale VPN, Backups, Git branches.
"""
import asyncio
import os
import subprocess
import glob
import shutil
import time
from datetime import datetime
from fastapi import APIRouter

router = APIRouter(prefix="/api/config")


# ── WiFi ──────────────────────────────────────────────────────────

@router.get("/wifi/status")
async def wifi_status():
    """Get current WiFi connection status."""
    try:
        def _get():
            result = subprocess.run(
                ["iwconfig", "wlan0"], capture_output=True, text=True, timeout=5
            )
            connected = False
            ssid = ""
            signal = 0
            tx_rate = ""
            ip_local = ""

            if result.returncode == 0 and 'ESSID:"' in result.stdout:
                essid = result.stdout.split('ESSID:"')[1].split('"')[0]
                if essid:
                    connected = True
                    ssid = essid
                if "Signal level=" in result.stdout:
                    sig = result.stdout.split("Signal level=")[1].split(" ")[0]
                    signal = int(sig)
                if "Bit Rate=" in result.stdout:
                    rate = result.stdout.split("Bit Rate=")[1].split(" ")[0]
                    tx_rate = f"{rate} Mb/s"

            # Get IP
            ip_result = subprocess.run(
                ["hostname", "-I"], capture_output=True, text=True, timeout=3
            )
            if ip_result.returncode == 0:
                ips = ip_result.stdout.strip().split()
                ip_local = ips[0] if ips else ""

            # Internet check
            has_internet = False
            ping_ms = 0
            try:
                ping = subprocess.run(
                    ["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                    capture_output=True, text=True, timeout=4
                )
                if ping.returncode == 0:
                    has_internet = True
                    for line in ping.stdout.split("\n"):
                        if "time=" in line:
                            t = line.split("time=")[1].split(" ")[0]
                            ping_ms = round(float(t), 1)
                            break
            except Exception:
                pass

            return {
                "connected": connected,
                "ssid": ssid,
                "signal": signal,
                "txRate": tx_rate,
                "ipLocal": ip_local,
                "hasInternet": has_internet,
                "pingMs": ping_ms,
            }
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception as e:
        return {"connected": False, "ssid": "", "signal": 0, "error": str(e)}


@router.get("/wifi/scan")
async def wifi_scan():
    """Scan available WiFi networks."""
    try:
        def _scan():
            result = subprocess.run(
                ["sudo", "iwlist", "wlan0", "scan"],
                capture_output=True, text=True, timeout=15
            )
            networks = []
            if result.returncode == 0:
                cells = result.stdout.split("Cell ")
                for cell in cells[1:]:
                    ssid = ""
                    signal = 0
                    security = "Open"
                    bssid = ""
                    if "ESSID:" in cell:
                        ssid = cell.split('ESSID:"')[1].split('"')[0] if 'ESSID:"' in cell else ""
                    if "Signal level=" in cell:
                        sig_str = cell.split("Signal level=")[1].split(" ")[0]
                        try:
                            sig = int(sig_str)
                            signal = min(100, max(0, 2 * (sig + 100))) if sig < 0 else sig
                        except ValueError:
                            signal = 0
                    if "Address:" in cell:
                        bssid = cell.split("Address:")[1].split("\n")[0].strip()
                    if "WPA2" in cell:
                        security = "WPA2"
                    elif "WPA" in cell:
                        security = "WPA"
                    elif "WEP" in cell:
                        security = "WEP"
                    if ssid:
                        networks.append({
                            "ssid": ssid,
                            "signal": signal,
                            "security": security,
                            "bssid": bssid,
                        })
            # Deduplicate by SSID, keep strongest
            seen = {}
            for n in networks:
                if n["ssid"] not in seen or n["signal"] > seen[n["ssid"]]["signal"]:
                    seen[n["ssid"]] = n
            return sorted(seen.values(), key=lambda x: x["signal"], reverse=True)

        networks = await asyncio.get_event_loop().run_in_executor(None, _scan)
        return {"status": "success", "networks": networks}
    except Exception as e:
        return {"status": "error", "message": str(e), "networks": []}


@router.post("/wifi/connect")
async def wifi_connect(body: dict):
    """Connect to a WiFi network."""
    ssid = body.get("ssid", "")
    password = body.get("password", "")
    try:
        def _connect():
            # Use nmcli to connect
            cmd = ["sudo", "nmcli", "device", "wifi", "connect", ssid]
            if password:
                cmd += ["password", password]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                return {"status": "success", "message": f"Connecte a {ssid}"}
            return {"status": "error", "message": result.stderr.strip() or "Echec de connexion"}
        data = await asyncio.get_event_loop().run_in_executor(None, _connect)
        return data
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/wifi/saved")
async def wifi_saved():
    """List saved WiFi networks."""
    try:
        def _saved():
            result = subprocess.run(
                ["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"],
                capture_output=True, text=True, timeout=5
            )
            saved = []
            if result.returncode == 0:
                for line in result.stdout.strip().split("\n"):
                    parts = line.split(":")
                    if len(parts) >= 2 and "wireless" in parts[1]:
                        saved.append(parts[0])
            return saved
        saved = await asyncio.get_event_loop().run_in_executor(None, _saved)
        return {"saved": saved}
    except Exception:
        return {"saved": []}


@router.get("/ethernet/status")
async def ethernet_status():
    """Get Ethernet connection status."""
    try:
        def _get():
            import psutil
            addrs = psutil.net_if_addrs()
            connected = False
            ip = ""
            for iface_name in ["eth0", "enp0s25", "eno1"]:
                if iface_name in addrs:
                    for a in addrs[iface_name]:
                        if a.family.name == "AF_INET" and not a.address.startswith("127."):
                            connected = True
                            ip = a.address
                            break
                if connected:
                    break
            return {"connected": connected, "ipLocal": ip}
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception:
        return {"connected": False, "ipLocal": ""}


# ── Tailscale ─────────────────────────────────────────────────────

@router.get("/tailscale/status")
async def tailscale_status():
    """Get Tailscale VPN status."""
    try:
        def _get():
            import json as _json
            # Check if installed
            which = subprocess.run(["which", "tailscale"], capture_output=True, text=True, timeout=3)
            if which.returncode != 0:
                return {"installed": False, "running": False, "online": False}

            result = subprocess.run(
                ["tailscale", "status", "--json"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return {"installed": True, "running": False, "online": False}

            data = _json.loads(result.stdout)
            self_node = data.get("Self", {})
            peers = []
            for _, peer in data.get("Peer", {}).items():
                peers.append({
                    "id": peer.get("ID", ""),
                    "hostname": peer.get("HostName", ""),
                    "ip": peer.get("TailscaleIPs", [""])[0] if peer.get("TailscaleIPs") else "",
                    "os": peer.get("OS", ""),
                    "online": peer.get("Online", False),
                    "exitNodeOption": peer.get("ExitNodeOption", False),
                    "isExitNode": peer.get("ExitNode", False),
                    "rxBytes": peer.get("RxBytes", 0),
                    "txBytes": peer.get("TxBytes", 0),
                })

            return {
                "installed": True,
                "running": True,
                "online": self_node.get("Online", False),
                "tailscaleIp": self_node.get("TailscaleIPs", [""])[0] if self_node.get("TailscaleIPs") else "",
                "hostname": self_node.get("HostName", ""),
                "magicDns": self_node.get("DNSName", ""),
                "version": data.get("Version", ""),
                "exitNode": bool(data.get("ExitNodeStatus")),
                "authUrl": data.get("AuthURL", ""),
                "peers": peers,
            }
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception as e:
        return {"installed": False, "running": False, "online": False, "error": str(e)}


@router.post("/tailscale/up")
async def tailscale_up():
    """Start Tailscale."""
    try:
        def _up():
            result = subprocess.run(
                ["sudo", "tailscale", "up"],
                capture_output=True, text=True, timeout=15
            )
            if "https://" in result.stderr:
                url = [w for w in result.stderr.split() if w.startswith("https://")]
                return {"status": "auth_needed", "authUrl": url[0] if url else "", "message": "Authentification requise"}
            if result.returncode == 0:
                return {"status": "success", "message": "Tailscale connecte"}
            return {"status": "error", "message": result.stderr.strip()}
        data = await asyncio.get_event_loop().run_in_executor(None, _up)
        return data
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/tailscale/down")
async def tailscale_down():
    """Stop Tailscale."""
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(["sudo", "tailscale", "down"], capture_output=True, text=True, timeout=10)
        )
        return {"status": "success" if result.returncode == 0 else "error",
                "message": "Tailscale deconnecte" if result.returncode == 0 else result.stderr.strip()}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/tailscale/logout")
async def tailscale_logout():
    """Logout Tailscale."""
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(["sudo", "tailscale", "logout"], capture_output=True, text=True, timeout=10)
        )
        return {"status": "success" if result.returncode == 0 else "error",
                "message": "Tailscale deconnecte et deauthentifie" if result.returncode == 0 else result.stderr.strip()}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/tailscale/exit-node")
async def tailscale_exit_node(body: dict):
    """Set/unset exit node."""
    ip = body.get("ip", "")
    try:
        cmd = ["sudo", "tailscale", "set"]
        if ip:
            cmd += ["--exit-node", ip]
        else:
            cmd += ["--exit-node="]
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        )
        return {"status": "success" if result.returncode == 0 else "error",
                "message": f"Exit node {'active' if ip else 'desactive'}" if result.returncode == 0 else result.stderr.strip()}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Backups ───────────────────────────────────────────────────────

BACKUP_DIR = os.getenv("THEIA_BACKUP_DIR", "/opt/theia/backups")
DATA_DIR = os.getenv("THEIA_DATA_DIR", "/opt/theia/data")


@router.get("/backups")
async def list_backups_endpoint():
    """List backup files."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        files = sorted(glob.glob(os.path.join(BACKUP_DIR, "*.tar.gz")), reverse=True)
        backups = []
        for f in files:
            stat = os.stat(f)
            backups.append({
                "filename": os.path.basename(f),
                "size": stat.st_size,
                "date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        return {"backups": backups}
    except Exception:
        return {"backups": []}


@router.post("/backups")
async def create_backup():
    """Create a backup of the data directory."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"theia_backup_{ts}.tar.gz"
        filepath = os.path.join(BACKUP_DIR, filename)

        def _create():
            subprocess.run(
                ["tar", "-czf", filepath, "-C", os.path.dirname(DATA_DIR), os.path.basename(DATA_DIR)],
                check=True, timeout=120
            )
        await asyncio.get_event_loop().run_in_executor(None, _create)
        return {"status": "success", "filename": filename, "message": f"Sauvegarde creee: {filename}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/backups/restore")
async def restore_backup(body: dict):
    """Restore a backup."""
    filename = body.get("filename", "")
    filepath = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(filepath):
        return {"status": "error", "message": "Sauvegarde introuvable"}
    try:
        def _restore():
            subprocess.run(
                ["tar", "-xzf", filepath, "-C", os.path.dirname(DATA_DIR)],
                check=True, timeout=120
            )
        await asyncio.get_event_loop().run_in_executor(None, _restore)
        return {"status": "success", "message": f"Sauvegarde {filename} restauree"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.delete("/backups/{filename}")
async def delete_backup(filename: str):
    """Delete a backup file."""
    filepath = os.path.join(BACKUP_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return {"status": "success", "message": f"Sauvegarde {filename} supprimee"}
    return {"status": "error", "message": "Fichier introuvable"}


# ── Git Branches ──────────────────────────────────────────────────

@router.get("/git/branches")
async def git_branches():
    """List git branches."""
    try:
        repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

        def _branches():
            # Fetch
            subprocess.run(["git", "fetch", "--quiet"], capture_output=True, text=True, cwd=repo_dir, timeout=15)
            # Current branch
            current = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, cwd=repo_dir
            ).stdout.strip()
            # All branches (remote)
            result = subprocess.run(
                ["git", "branch", "-r", "--format=%(refname:short)"],
                capture_output=True, text=True, cwd=repo_dir
            )
            branches = []
            for line in result.stdout.strip().split("\n"):
                b = line.strip().replace("origin/", "")
                if b and b != "HEAD" and b not in branches:
                    branches.append(b)
            # Make sure current is in list
            if current and current not in branches:
                branches.insert(0, current)
            return {"current": current, "branches": sorted(branches)}

        data = await asyncio.get_event_loop().run_in_executor(None, _branches)
        return data
    except Exception as e:
        return {"current": "main", "branches": ["main"], "error": str(e)}


@router.post("/git/update")
async def git_update(body: dict = None):
    """Update from git with optional branch switch."""
    branch = (body or {}).get("branch", "")
    try:
        repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

        def _update():
            lines = []
            commands = []

            # Get current commit before update
            old_hash = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            commands.append("git fetch --quiet")
            subprocess.run(["git", "fetch", "--quiet"], capture_output=True, text=True, cwd=repo_dir, timeout=15)

            if branch:
                cmd = f"git checkout {branch}"
                commands.append(cmd)
                r = subprocess.run(
                    ["git", "checkout", branch],
                    capture_output=True, text=True, cwd=repo_dir, timeout=15
                )
                lines.append(r.stdout.strip())
                if r.returncode != 0:
                    lines.append(r.stderr.strip())

            commands.append("git pull --ff-only")
            r = subprocess.run(
                ["git", "pull", "--ff-only"],
                capture_output=True, text=True, cwd=repo_dir, timeout=30
            )
            lines.append(r.stdout.strip())
            if r.returncode != 0:
                lines.append(r.stderr.strip())
                return {"status": "error", "output": "\n".join(lines), "commands": commands, "commits": []}

            # Get new commits since old hash
            commits = []
            try:
                log_result = subprocess.run(
                    ["git", "log", f"{old_hash}..HEAD", "--pretty=format:%h|%s|%ai|%an", "--max-count=20"],
                    capture_output=True, text=True, cwd=repo_dir, timeout=5
                )
                if log_result.returncode == 0 and log_result.stdout.strip():
                    for line in log_result.stdout.strip().split("\n"):
                        parts = line.split("|", 3)
                        if len(parts) >= 4:
                            commits.append({
                                "hash": parts[0],
                                "message": parts[1],
                                "date": parts[2][:16],
                                "author": parts[3],
                            })
            except Exception:
                pass

            # Run install if exists
            install = os.path.join(repo_dir, "install.sh")
            if os.path.exists(install):
                commands.append("sudo bash install.sh")
                r2 = subprocess.run(
                    ["sudo", "bash", "install.sh"],
                    capture_output=True, text=True, cwd=repo_dir, timeout=300
                )
                lines.append(r2.stdout.strip()[-500:] if r2.stdout else "")

            return {"status": "success", "output": "\n".join(lines), "commands": commands, "commits": commits}

        data = await asyncio.get_event_loop().run_in_executor(None, _update)
        return data
    except Exception as e:
        return {"status": "error", "output": str(e), "commands": [], "commits": []}


# ── System ────────────────────────────────────────────────────────

@router.post("/apt/update")
async def apt_update():
    """Run apt update."""
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(
                ["sudo", "apt", "update", "-y"],
                capture_output=True, text=True, timeout=120
            )
        )
        return {"status": "success" if result.returncode == 0 else "error",
                "output": result.stdout + result.stderr}
    except Exception as e:
        return {"status": "error", "output": str(e)}


@router.post("/apt/upgrade")
async def apt_upgrade():
    """Run apt upgrade."""
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(
                ["sudo", "apt", "upgrade", "-y"],
                capture_output=True, text=True, timeout=600
            )
        )
        return {"status": "success" if result.returncode == 0 else "error",
                "output": result.stdout + result.stderr}
    except Exception as e:
        return {"status": "error", "output": str(e)}
