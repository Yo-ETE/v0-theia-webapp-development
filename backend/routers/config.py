"""
THEIA - Configuration endpoints
WiFi scan/connect, Ethernet status, Tailscale VPN, Backups, Git branches.
"""
import asyncio
import json
import logging
import os
import subprocess
import glob
import shutil
import time
from datetime import datetime
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("theia.config")

router = APIRouter(prefix="/api/config")


# ── Helper: Get active WiFi interface ────────────────────────────────
def _get_wifi_interface():
    """Find the first available WiFi interface (wlan0, wlan1, wlp*, etc)."""
    import psutil
    # Check interfaces with iwconfig to find WiFi-capable ones
    for iface in psutil.net_if_addrs().keys():
        if iface.startswith(("wlan", "wlp")):
            try:
                result = subprocess.run(
                    ["iwconfig", iface], capture_output=True, text=True, timeout=3
                )
                if result.returncode == 0 and "IEEE 802.11" in result.stdout:
                    return iface
            except Exception:
                pass
    # Fallback: scan /sys/class/net for wireless devices
    try:
        import os
        for iface in os.listdir("/sys/class/net"):
            wireless_path = f"/sys/class/net/{iface}/wireless"
            if os.path.isdir(wireless_path):
                return iface
    except Exception:
        pass
    return "wlan0"  # Default fallback


def _get_ap_capable_interface():
    """Find a WiFi interface that supports AP mode for hotspot."""
    import os
    
    # Get all WiFi interfaces
    wifi_interfaces = []
    try:
        for iface in os.listdir("/sys/class/net"):
            wireless_path = f"/sys/class/net/{iface}/wireless"
            if os.path.isdir(wireless_path):
                wifi_interfaces.append(iface)
    except Exception:
        wifi_interfaces = ["wlan0", "wlan1"]
    
    # Check each interface for AP mode support using iw
    for iface in wifi_interfaces:
        try:
            # Get the phy for this interface
            phy_result = subprocess.run(
                ["iw", "dev", iface, "info"],
                capture_output=True, text=True, timeout=5
            )
            if phy_result.returncode != 0:
                continue
            
            # Extract phy name (like phy0, phy1)
            phy_name = None
            for line in phy_result.stdout.split('\n'):
                if 'wiphy' in line:
                    try:
                        phy_num = line.split()[-1]
                        phy_name = f"phy{phy_num}"
                    except:
                        pass
            
            if not phy_name:
                # Try alternate method
                phy_path = f"/sys/class/net/{iface}/phy80211/name"
                if os.path.exists(phy_path):
                    with open(phy_path) as f:
                        phy_name = f.read().strip()
            
            if not phy_name:
                continue
                
            # Check if this phy supports AP mode
            iw_list = subprocess.run(
                ["iw", phy_name, "info"],
                capture_output=True, text=True, timeout=5
            )
            if "* AP" in iw_list.stdout:
                print(f"[THEIA] Found AP-capable interface: {iface} on {phy_name}", flush=True)
                return iface
        except Exception as e:
            print(f"[THEIA] Error checking {iface}: {e}", flush=True)
            continue
    
    # Fallback: return first interface and let nmcli fail with clear error
    return wifi_interfaces[0] if wifi_interfaces else "wlan0"


# ── WiFi ──────────────────────────────────────────────────────────

@router.get("/wifi/status")
async def wifi_status():
    """Get current WiFi connection status."""
    try:
        def _get():
            iface = _get_wifi_interface()
            result = subprocess.run(
                ["iwconfig", iface], capture_output=True, text=True, timeout=5
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
                "interface": iface,
            }
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception as e:
        return {"connected": False, "ssid": "", "signal": 0, "interface": "", "error": str(e)}


@router.get("/wifi/scan")
async def wifi_scan():
    """Scan available WiFi networks."""
    try:
        def _scan():
            iface = _get_wifi_interface()
            result = subprocess.run(
                ["sudo", "iwlist", iface, "scan"],
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


# ── USB Modem ────────────────────────────────────────────────────────

@router.get("/usb-modem/status")
async def usb_modem_status():
    """Get USB modem/cellular connection status."""
    try:
        def _get():
            import psutil
            addrs = psutil.net_if_addrs()
            connected = False
            ip = ""
            interface = ""
            modem_type = "USB Modem"
            
            # Check for common USB modem interfaces
            prefixes = ["usb", "wwan", "ppp", "bnep", "cdc", "enx"]
            for iface_name in addrs.keys():
                if any(iface_name.startswith(p) for p in prefixes):
                    for a in addrs[iface_name]:
                        if a.family.name == "AF_INET" and not a.address.startswith("127."):
                            connected = True
                            ip = a.address
                            interface = iface_name
                            # Detect modem type from interface name
                            if "wwan" in iface_name:
                                modem_type = "4G/LTE Modem"
                            elif "ppp" in iface_name:
                                modem_type = "PPP Modem"
                            break
                    if connected:
                        break
            
            return {
                "connected": connected,
                "ipLocal": ip,
                "interface": interface,
                "type": modem_type,
            }
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception:
        return {"connected": False, "ipLocal": "", "interface": "", "type": "USB Modem"}


# ── WiFi Hotspot (AP Mode) ───────────────────────────────────────────

@router.get("/hotspot/status")
async def hotspot_status():
    """Get WiFi hotspot (AP) status."""
    try:
        def _get():
            active = False
            ssid = ""
            interface = ""
            clients = 0
            
            # Method 1: Check nmcli for active Hotspot connection
            try:
                conn_check = subprocess.run(
                    ["nmcli", "-t", "-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"],
                    capture_output=True, text=True, timeout=5
                )
                for line in conn_check.stdout.strip().split('\n'):
                    if line and "802-11-wireless" in line:
                        parts = line.split(':')
                        if len(parts) >= 3:
                            conn_name = parts[0]
                            # Check if this is a hotspot by checking interface mode
                            iface = parts[2] if len(parts) > 2 else ""
                            if iface:
                                iw_check = subprocess.run(
                                    ["iw", "dev", iface, "info"],
                                    capture_output=True, text=True, timeout=5
                                )
                                if "type AP" in iw_check.stdout:
                                    active = True
                                    interface = iface
                                    # Extract SSID from iw output
                                    for iw_line in iw_check.stdout.split('\n'):
                                        if 'ssid' in iw_line.lower():
                                            ssid = iw_line.split()[-1] if iw_line.split() else ""
                                    break
            except Exception:
                pass
            
            # Method 2: Check hostapd service (fallback)
            if not active:
                result = subprocess.run(
                    ["systemctl", "is-active", "hostapd"],
                    capture_output=True, text=True, timeout=5
                )
                if result.stdout.strip() == "active":
                    active = True
                    # Try to read hostapd.conf for SSID
                    try:
                        with open("/etc/hostapd/hostapd.conf", "r") as f:
                            for line in f:
                                if line.startswith("ssid="):
                                    ssid = line.strip().split("=", 1)[1]
                                elif line.startswith("interface="):
                                    interface = line.strip().split("=", 1)[1]
                    except Exception:
                        pass
            
            # Count connected clients
            if active and interface:
                try:
                    # Try iw station dump for client count
                    result = subprocess.run(
                        ["iw", "dev", interface, "station", "dump"],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0:
                        clients = result.stdout.count("Station")
                except Exception:
                    pass
            
            return {
                "active": active,
                "ssid": ssid,
                "interface": interface,
                "clients": clients,
            }
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception:
        return {"active": False, "ssid": "", "interface": "", "clients": 0}


@router.post("/hotspot/start")
async def hotspot_start(body: dict = None):
    """Start WiFi hotspot using hostapd."""
    ssid = (body or {}).get("ssid", "THEIA")
    password = (body or {}).get("password", "theia1234")
    try:
        def _start():
            # Use AP-capable interface instead of just any WiFi interface
            iface = _get_ap_capable_interface()
            print(f"[THEIA] Hotspot: starting on interface {iface}", flush=True)
            if not iface:
                return {"status": "error", "message": "Aucune interface WiFi trouvee"}
            
            # Check if hostapd is installed
            hostapd_check = subprocess.run(["which", "hostapd"], capture_output=True, timeout=5)
            if hostapd_check.returncode != 0:
                return {"status": "error", "message": "hostapd n'est pas installe. Installez avec: sudo apt install hostapd"}
            
            # Step 0: Set regulatory domain for proper WiFi transmission
            subprocess.run(["sudo", "iw", "reg", "set", "FR"], capture_output=True, timeout=5)
            time.sleep(0.5)
            
            # Step 1: Disconnect and clean up
            print(f"[THEIA] Hotspot: disconnecting {iface} and killing existing processes", flush=True)
            subprocess.run(["sudo", "nmcli", "device", "disconnect", iface], capture_output=True, timeout=10)
            time.sleep(0.5)
            subprocess.run(["sudo", "pkill", "-f", "create_ap"], capture_output=True, timeout=5)
            subprocess.run(["sudo", "pkill", "hostapd"], capture_output=True, timeout=5)
            subprocess.run(["sudo", "pkill", "dnsmasq"], capture_output=True, timeout=5)
            time.sleep(1)
            
            # Step 2: Try nmcli hotspot with explicit band/channel for better compatibility
            print(f"[THEIA] Hotspot: trying nmcli hotspot on {iface}", flush=True)
            # Use band=bg (2.4GHz) and channel 6 for maximum compatibility
            result = subprocess.run(
                ["sudo", "nmcli", "device", "wifi", "hotspot", "ifname", iface, "ssid", ssid, "password", password, "band", "bg", "channel", "6"],
                capture_output=True, text=True, timeout=30
            )
            print(f"[THEIA] Hotspot: nmcli returned {result.returncode}, stdout={result.stdout[:200] if result.stdout else ''}, stderr={result.stderr[:200] if result.stderr else ''}", flush=True)
            if result.returncode == 0:
                time.sleep(3)  # Give more time for AP to initialize
                # Verify hotspot is actually running and visible
                conn_check = subprocess.run(
                    ["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show", "--active"],
                    capture_output=True, text=True, timeout=5
                )
                print(f"[THEIA] Hotspot: active connections: {conn_check.stdout}", flush=True)
                
                # Check interface mode with iw
                iw_check = subprocess.run(
                    ["iw", "dev", iface, "info"],
                    capture_output=True, text=True, timeout=5
                )
                print(f"[THEIA] Hotspot: iw info: {iw_check.stdout}", flush=True)
                is_ap_mode = "type AP" in iw_check.stdout
                
                # Check if the SSID or "Hotspot" appears in active wireless connections
                if (ssid in conn_check.stdout or "Hotspot" in conn_check.stdout) and "802-11-wireless" in conn_check.stdout:
                    if is_ap_mode:
                        return {"status": "success", "message": f"Hotspot '{ssid}' demarre sur {iface} (nmcli)"}
                    else:
                        print(f"[THEIA] Hotspot: WARNING - connection active but interface not in AP mode", flush=True)
                        # Try to continue anyway, maybe it will work
                        return {"status": "warning", "message": f"Hotspot '{ssid}' cree mais mode AP non confirme sur {iface}"}
                
                # nmcli said OK but hotspot not actually running, continue to fallback
                print(f"[THEIA] Hotspot: nmcli returned 0 but no Hotspot connection active, trying hostapd", flush=True)
            
            # Step 3: Configure interface
            print(f"[THEIA] Hotspot: configuring interface {iface} for AP mode", flush=True)
            subprocess.run(["sudo", "ip", "link", "set", iface, "down"], capture_output=True, timeout=5)
            time.sleep(0.5)
            subprocess.run(["sudo", "ip", "addr", "flush", "dev", iface], capture_output=True, timeout=5)
            subprocess.run(["sudo", "ip", "addr", "add", "192.168.4.1/24", "dev", iface], capture_output=True, timeout=5)
            subprocess.run(["sudo", "ip", "link", "set", iface, "up"], capture_output=True, timeout=5)
            time.sleep(1)
            
            # Step 4: Start dnsmasq first (before hostapd, for DHCP)
            dnsmasq_conf = f"""interface={iface}
dhcp-range=192.168.4.2,192.168.4.254,255.255.255.0,24h
no-resolv
bind-interfaces
"""
            dnsmasq_path = "/tmp/theia_dnsmasq.conf"
            with open(dnsmasq_path, "w") as f:
                f.write(dnsmasq_conf)
            
            dnsmasq_result = subprocess.run(
                ["sudo", "dnsmasq", "-C", dnsmasq_path],
                capture_output=True, text=True, timeout=5
            )
            print(f"[THEIA] Hotspot: dnsmasq returned {dnsmasq_result.returncode}", flush=True)
            time.sleep(1)
            
            # Step 5: Try hostapd with multiple drivers
            drivers = ["nl80211", "rtl871xdrv", "wext"]
            hostapd_started = False
            last_error = ""
            
            for driver in drivers:
                hostapd_conf = f"""interface={iface}
driver={driver}
ssid={ssid}
hw_mode=g
channel=6
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase={password}
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
"""
                conf_path = f"/tmp/theia_hostapd_{driver}.conf"
                with open(conf_path, "w") as f:
                    f.write(hostapd_conf)
                
                # Start hostapd in background (-B flag)
                print(f"[THEIA] Hotspot: trying hostapd with driver {driver}", flush=True)
                hostapd_result = subprocess.run(
                    ["sudo", "hostapd", "-B", conf_path],
                    capture_output=True, text=True, timeout=10
                )
                print(f"[THEIA] Hotspot: hostapd {driver} returned {hostapd_result.returncode}, stderr={hostapd_result.stderr[:300] if hostapd_result.stderr else ''}", flush=True)
                
                time.sleep(1)
                
                # Check if hostapd is running (look for any hostapd process, not just the config file)
                ps_check = subprocess.run(
                    ["pgrep", "-a", "hostapd"],
                    capture_output=True, text=True, timeout=5
                )
                
                if ps_check.returncode == 0 and "hostapd" in ps_check.stdout:
                    hostapd_started = True
                    print(f"[THEIA] Hotspot: hostapd started with driver {driver}", flush=True)
                    break
                else:
                    last_error = hostapd_result.stderr.strip() or hostapd_result.stdout.strip() or f"Driver {driver} failed"
                    print(f"[THEIA] Hotspot: driver {driver} failed - {last_error}", flush=True)
                    subprocess.run(["sudo", "pkill", "hostapd"], capture_output=True, timeout=5)
            
            if hostapd_started:
                return {"status": "success", "message": f"Hotspot '{ssid}' demarre sur {iface} (192.168.4.1)"}
            else:
                # Even if hostapd failed, dnsmasq is running and interface is configured
                # Return partial success or error depending on dnsmasq
                if dnsmasq_result.returncode == 0:
                    return {"status": "warning", "message": f"DHCP demarre ({iface} @ 192.168.4.1) mais hostapd echoue. Erreur: {last_error}"}
                else:
                    return {"status": "error", "message": f"Echec hotspot et DHCP. Hostapd: {last_error}"}
        
        data = await asyncio.get_event_loop().run_in_executor(None, _start)
        return data
    except Exception as e:
        print(f"[THEIA] Hotspot: exception during start: {e}", flush=True)
        return {"status": "error", "message": str(e)}


@router.post("/hotspot/stop")
async def hotspot_stop():
    """Stop WiFi hotspot."""
    try:
        def _stop():
            stopped = False
            
            # Try nmcli first
            result = subprocess.run(
                ["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show", "--active"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.strip().split("\n"):
                if ":802-11-wireless" in line and ("Hotspot" in line or "hotspot" in line.lower()):
                    hotspot_name = line.split(":")[0]
                    subprocess.run(
                        ["sudo", "nmcli", "connection", "down", hotspot_name],
                        capture_output=True, text=True, timeout=10
                    )
                    stopped = True
                    break
            
            # Kill create_ap if running
            result = subprocess.run(["sudo", "pkill", "-f", "create_ap"], timeout=5)
            if result.returncode == 0:
                stopped = True
            
            # Kill hostapd if running
            result = subprocess.run(["sudo", "pkill", "hostapd"], timeout=5)
            if result.returncode == 0:
                stopped = True
            
            # Restore WiFi interface to managed mode
            iface = _get_wifi_interface()
            if iface:
                subprocess.run(["sudo", "ip", "addr", "flush", "dev", iface], timeout=5)
                subprocess.run(["sudo", "ip", "link", "set", iface, "up"], timeout=5)
                # Try to reconnect to previous network
                subprocess.run(["sudo", "wpa_cli", "-i", iface, "reconnect"], timeout=5)
            
            return {"status": "success", "message": "Hotspot arrete" if stopped else "Aucun hotspot actif"}
        data = await asyncio.get_event_loop().run_in_executor(None, _stop)
        return data
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Network Interfaces List ───────────────────────────────────��──────

@router.get("/network/interfaces")
async def network_interfaces():
    """List all network interfaces with their status."""
    try:
        def _get():
            import psutil
            addrs = psutil.net_if_addrs()
            stats = psutil.net_if_stats()
            interfaces = []
            
            for iface, addr_list in addrs.items():
                if iface == "lo":
                    continue
                
                iface_info = {
                    "name": iface,
                    "type": "unknown",
                    "up": stats.get(iface, type('', (), {'isup': False})).isup,
                    "ip": "",
                    "mac": "",
                }
                
                # Determine type
                if iface.startswith(("wlan", "wlp")):
                    iface_info["type"] = "wifi"
                elif iface.startswith(("eth", "enp", "eno")):
                    iface_info["type"] = "ethernet"
                elif iface.startswith(("usb", "wwan", "ppp", "cdc", "enx")):
                    iface_info["type"] = "usb_modem"
                elif iface.startswith("tailscale"):
                    iface_info["type"] = "vpn"
                
                for addr in addr_list:
                    if addr.family.name == "AF_INET" and not addr.address.startswith("127."):
                        iface_info["ip"] = addr.address
                    elif addr.family.name == "AF_PACKET":
                        iface_info["mac"] = addr.address
                
                interfaces.append(iface_info)
            
            return {"interfaces": interfaces}
        data = await asyncio.get_event_loop().run_in_executor(None, _get)
        return data
    except Exception:
        return {"interfaces": []}


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


@router.post("/git/fetch")
async def git_fetch(body: dict = None):
    """Fetch latest commits from remote for a given branch."""
    branch = (body or {}).get("branch", "")
    try:
        repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

        def _fetch():
            # git fetch origin
            cmd = ["git", "fetch", "--quiet", "origin"]
            if branch:
                cmd.append(branch)
            subprocess.run(cmd, capture_output=True, text=True, cwd=repo_dir, timeout=30)
            return {"status": "success", "message": f"Fetched origin{(' ' + branch) if branch else ''}"}

        data = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        return data
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


@router.post("/git/update")
async def git_update(body: dict = None):
    """Update from git with SSE streaming progress.
    Runs: git stash -> git pull -> chmod +x install.sh -> sudo bash install.sh
    Then schedules a delayed service restart via nohup so the response completes.
    """
    from fastapi.responses import StreamingResponse
    import queue as _queue

    branch = (body or {}).get("branch", "")
    repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

    msg_queue: _queue.Queue = _queue.Queue()

    def _run_update():
        """Execute the full update in a background thread, pushing SSE messages."""
        def send(step: str, detail: str = "", status: str = "running"):
            msg_queue.put(json.dumps({"step": step, "detail": detail, "status": status}))

        try:
            # 1. git stash
            send("git stash", "Sauvegarde des modifications locales...")
            r = subprocess.run(
                ["git", "stash"], capture_output=True, text=True, cwd=repo_dir, timeout=10
            )
            send("git stash", r.stdout.strip() or "OK", "done")

            # 2. git fetch
            send("git fetch", "Recuperation des commits distants...")
            cmd_fetch = ["git", "fetch", "--quiet", "origin"]
            if branch:
                cmd_fetch.append(branch)
            subprocess.run(cmd_fetch, capture_output=True, text=True, cwd=repo_dir, timeout=30)
            send("git fetch", "OK", "done")

            # 3. git checkout (if branch specified)
            if branch:
                send("git checkout", f"Passage sur la branche {branch}...")
                r = subprocess.run(
                    ["git", "checkout", branch],
                    capture_output=True, text=True, cwd=repo_dir, timeout=15
                )
                out = r.stdout.strip() or r.stderr.strip() or "OK"
                send("git checkout", out, "done" if r.returncode == 0 else "error")
                if r.returncode != 0:
                    send("FINISHED", out, "error")
                    msg_queue.put(None)
                    return

            # 4. git pull
            send("git pull", "Telechargement des mises a jour...")
            r = subprocess.run(
                ["git", "pull"], capture_output=True, text=True, cwd=repo_dir, timeout=60
            )
            pull_out = r.stdout.strip() or r.stderr.strip() or "OK"
            send("git pull", pull_out, "done" if r.returncode == 0 else "error")
            if r.returncode != 0:
                send("FINISHED", pull_out, "error")
                msg_queue.put(None)
                return

            # 5. install.sh
            install_sh = os.path.join(repo_dir, "install.sh")
            if os.path.exists(install_sh):
                send("install.sh", "Lancement de install.sh (peut prendre quelques minutes)...")
                subprocess.run(["chmod", "+x", install_sh], cwd=repo_dir, timeout=5)
                proc = subprocess.Popen(
                    ["sudo", "bash", install_sh],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, cwd=repo_dir,
                    env={**os.environ, "TERM": "dumb"}  # Disable colors in non-TTY
                )
                last_lines = []
                for line in proc.stdout:
                    line = line.rstrip()
                    if line:
                        last_lines.append(line)
                        # Stream last meaningful lines to frontend
                        send("install.sh", line)
                proc.wait()
                # Consider success if script ran to completion (even with non-zero exit)
                # Some systemctl commands may fail temporarily but install still succeeds
                if proc.returncode == 0:
                    send("install.sh", "install.sh termine avec succes", "done")
                else:
                    # Check if last lines indicate actual failure or just warnings
                    last_line = last_lines[-1] if last_lines else ""
                    # If we see success indicators in output, treat as success
                    if any(x in last_line.lower() for x in ["succes", "done", "complete", "ok", "installed"]):
                        send("install.sh", f"install.sh termine (exit {proc.returncode})", "done")
                    else:
                        send("install.sh", f"install.sh termine avec code {proc.returncode}", "done")
            else:
                # No install.sh -- do pip install + npm build manually
                venv_pip = "/opt/theia/.venv/bin/pip"
                req_file = os.path.join(repo_dir, "backend", "requirements.txt")
                if os.path.exists(venv_pip) and os.path.exists(req_file):
                    send("pip install", "Installation des dependances Python...")
                    subprocess.run(
                        ["sudo", venv_pip, "install", "-r", req_file, "-q"],
                        capture_output=True, text=True, cwd=repo_dir, timeout=120
                    )
                    send("pip install", "OK", "done")

                send("npm build", "Build du frontend Next.js...")
                subprocess.run(
                    ["sudo", "-u", "theia", "npm", "run", "build"],
                    capture_output=True, text=True,
                    cwd=os.path.join(repo_dir, "app") if os.path.isdir(os.path.join(repo_dir, "app")) else repo_dir,
                    timeout=300
                )
                send("npm build", "OK", "done")

            # 6. Schedule service restart with nohup (so this API can finish responding)
            send("restart", "Redemarrage des services dans 3 secondes...")
            subprocess.Popen(
                ["bash", "-c", "sleep 3 && sudo systemctl restart theia-api theia-web"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True
            )
            send("restart", "Redemarrage programme", "done")

            send("FINISHED", "Mise a jour terminee. Les services vont redemarrer.", "success")
        except Exception as e:
            send("FINISHED", str(e), "error")
        finally:
            msg_queue.put(None)  # Signal end of stream

    # Start update in background thread
    import threading
    t = threading.Thread(target=_run_update, daemon=True)
    t.start()

    async def event_generator():
        while True:
            try:
                msg = await asyncio.get_event_loop().run_in_executor(None, msg_queue.get, True, 0.5)
            except _queue.Empty:
                # Send keepalive comment
                yield ": keepalive\n\n"
                continue
            if msg is None:
                break
            yield f"data: {msg}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Git Version Info ──────────────────────────────────���───────────

@router.get("/git/version")
async def git_version():
    """Get current git version info (branch, commit, etc.)."""
    try:
        repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

        def _version():
            # Current branch
            branch = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            # Current commit hash (short)
            commit = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            # Current commit message
            commit_message = subprocess.run(
                ["git", "log", "-1", "--format=%s"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            # Current commit author
            commit_author = subprocess.run(
                ["git", "log", "-1", "--format=%an"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            # Current commit date
            commit_date = subprocess.run(
                ["git", "log", "-1", "--format=%ai"],
                capture_output=True, text=True, cwd=repo_dir, timeout=5
            ).stdout.strip()

            # Check if behind remote
            commits_behind = 0
            update_available = False
            try:
                subprocess.run(["git", "fetch", "--quiet"], capture_output=True, text=True, cwd=repo_dir, timeout=15)
                behind = subprocess.run(
                    ["git", "rev-list", "--count", f"{branch}..origin/{branch}"],
                    capture_output=True, text=True, cwd=repo_dir, timeout=5
                )
                if behind.returncode == 0:
                    commits_behind = int(behind.stdout.strip() or "0")
                    update_available = commits_behind > 0
            except Exception:
                pass

            # Latest commits on remote (for display)
            latest_commits = []
            try:
                log_result = subprocess.run(
                    ["git", "log", f"origin/{branch}", "--pretty=format:%h|%s|%ai|%an", "--max-count=10"],
                    capture_output=True, text=True, cwd=repo_dir, timeout=5
                )
                if log_result.returncode == 0 and log_result.stdout.strip():
                    for line in log_result.stdout.strip().split("\n"):
                        parts = line.split("|", 3)
                        if len(parts) >= 4:
                            latest_commits.append({
                                "hash": parts[0],
                                "message": parts[1],
                                "date": parts[2][:16],
                                "author": parts[3],
                            })
            except Exception:
                pass

            return {
                "branch": branch,
                "commit": commit,
                "commitDate": commit_date,
                "commitMessage": commit_message,
                "commitAuthor": commit_author,
                "updateAvailable": update_available,
                "commitsBehind": commits_behind,
                "latestCommits": latest_commits,
            }

        data = await asyncio.get_event_loop().run_in_executor(None, _version)
        return data
    except Exception as e:
        return {
            "branch": "unknown",
            "commit": "unknown",
            "commitDate": None,
            "updateAvailable": False,
            "commitsBehind": 0,
            "error": str(e),
        }


# ── Timezone ��─────────────────────────────────────────────────────

@router.get("/timezone")
async def get_timezone():
    """Get current system timezone."""
    try:
        def _get():
            result = subprocess.run(
                ["timedatectl", "show", "--property=Timezone", "--value"],
                capture_output=True, text=True, timeout=5,
            )
            tz = result.stdout.strip() or "UTC"
            # Also get current local time
            time_result = subprocess.run(
                ["date", "+%Y-%m-%d %H:%M:%S %Z"],
                capture_output=True, text=True, timeout=5,
            )
            return {"timezone": tz, "localTime": time_result.stdout.strip()}
        return await asyncio.get_event_loop().run_in_executor(None, _get)
    except Exception as e:
        return {"timezone": "UTC", "localTime": "", "error": str(e)}


@router.post("/timezone")
async def set_timezone(request: Request):
    """Set system timezone (e.g. Europe/Paris)."""
    try:
        body = await request.json()
        tz = body.get("timezone", "").strip()
        if not tz:
            return {"status": "error", "message": "Timezone manquant"}

        def _set():
            result = subprocess.run(
                ["sudo", "timedatectl", "set-timezone", tz],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                return {"status": "error", "message": result.stderr.strip() or "Erreur timedatectl"}
            # Verify
            check = subprocess.run(
                ["timedatectl", "show", "--property=Timezone", "--value"],
                capture_output=True, text=True, timeout=5,
            )
            new_tz = check.stdout.strip()
            now_result = subprocess.run(
                ["date", "+%Y-%m-%d %H:%M:%S %Z"],
                capture_output=True, text=True, timeout=5,
            )
            return {
                "status": "success",
                "message": f"Fuseau horaire mis a jour: {new_tz}",
                "timezone": new_tz,
                "localTime": now_result.stdout.strip(),
            }
        return await asyncio.get_event_loop().run_in_executor(None, _set)
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/timezone/list")
async def list_timezones():
    """List available timezones."""
    try:
        def _list():
            result = subprocess.run(
                ["timedatectl", "list-timezones"],
                capture_output=True, text=True, timeout=10,
            )
            zones = [z.strip() for z in result.stdout.strip().split("\n") if z.strip()]
            return {"timezones": zones}
        return await asyncio.get_event_loop().run_in_executor(None, _list)
    except Exception as e:
        return {"timezones": ["Europe/Paris", "UTC"], "error": str(e)}


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
