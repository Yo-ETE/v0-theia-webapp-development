#!/usr/bin/env python3
"""
THEIA - Noeud Xaver 400
Capture BNC -> OpenCV -> detection multicibles + batterie -> payload LD45 -> LoRa

TX_ID: __TX_ID__
"""

import cv2
import numpy as np
import serial
import time
import math
from collections import deque

# -- Config --------------------------------------------------------------------
VIDEO_DEVICE   = 0
SERIAL_PORT    = "/dev/ttyUSB0"
SERIAL_BAUD    = 115200
TX_ID          = "__TX_ID__"  # Injected by THEIA provisioning
SEND_INTERVAL  = 1.0
MIN_AREA       = 40

# -- Filtre persistance temporelle (emulation waterfall) ----------------------
PERSIST_MIN_S     = 3.0   # secondes minimum pour valider une vraie cible
PERSIST_RADIUS_CM = 80    # rayon de clustering cm (meme cible si < 80cm)
PERSIST_HISTORY_S = 22.0  # duree historique = waterfall Xaver

# -- Zone radar ----------------------------------------------------------------
RADAR_X1, RADAR_X2 = 270, 718
RADAR_Y1, RADAR_Y2 = 5, 428
RADAR_CENTER_X     = 490 - RADAR_X1
RADAR_HEIGHT_PX    = RADAR_Y2 - RADAR_Y1
RADAR_WIDTH_PX     = RADAR_X2 - RADAR_X1
RADAR_HEIGHT_CM    = 800
RADAR_WIDTH_CM     = 800

# -- Zone batterie Xaver (bas gauche image) ------------------------------------
BATT_X1, BATT_X2 = 5,  50
BATT_Y1, BATT_Y2 = 435, 468

def px_to_cm(px_x, px_y):
    y_cm = int((1.0 - px_y / RADAR_HEIGHT_PX) * RADAR_HEIGHT_CM)
    x_cm = int((px_x - RADAR_CENTER_X) / RADAR_WIDTH_PX * RADAR_WIDTH_CM)
    return x_cm, y_cm

# -- Lecture batterie Xaver ----------------------------------------------------
_batt_pct   = -1.0
_last_batt  = 0.0
BATT_PERIOD = 10.0  # lecture toutes les 10s

def read_xaver_battery(frame):
    """
    Lit l'indicateur pile Xaver en bas gauche de l'image BNC.
    Structure : 1 barre rouge (bas) + 0-4 barres vertes (au dessus)
    0 vert=20%, 1 vert=40%, 2 verts=60%, 3 verts=80%, 4 verts=100%
    
    Astuce : on analyse uniquement les colonnes CENTRALES (x=4..14)
    pour eviter le contour cyan (bords x=0..3 et x=15..18).
    Les vraies barres vertes ont H=60-82, S>150 (vert sature).
    Le contour cyan a H=85-110 (plus bleu).
    """
    inner = frame[430:468, 53:72]
    if inner.size == 0:
        return -1.0

    # Ne garder que les colonnes centrales (evite le contour cyan)
    inner_center = inner[:, 4:15]
    hsv   = cv2.cvtColor(inner_center, cv2.COLOR_BGR2HSV)
    h     = inner_center.shape[0]
    bar_h = h // 5  # ~7-8px par barre

    n_green_bars = 0
    for i in range(1, 5):  # barres 2..5 (les vertes potentielles)
        y1  = h - (i+1)*bar_h
        y2  = h - i*bar_h
        bar = hsv[max(0,y1):y2, :]
        # Vert sature H=60-82, S>150 (exclut cyan H=85+)
        green = cv2.inRange(bar, np.array([60, 150, 80]), np.array([82, 255, 255]))
        if cv2.countNonZero(green) > 3:
            n_green_bars += 1

    pct     = 20 + n_green_bars * 20  # 20..100%
    voltage = round(pct / 100.0 * 10.8, 2)
    return voltage

# -- Plages HSV cibles ---------------------------------------------------------
TARGET_COLORS = [
    (np.array([0,   100, 160]), np.array([5,   255, 255])),  # rouge bas (S abaisse a 100)
    (np.array([175, 100, 160]), np.array([180, 255, 255])),  # rouge haut
    (np.array([40,  150, 150]), np.array([130, 255, 255])),  # vert/cyan/bleu (etendu a H=130)
    (np.array([10,   80, 160]), np.array([40,  255, 255])),  # orange/jaune/jaune-vert
    (np.array([140, 100, 100]), np.array([165, 255, 255])),  # magenta/rose
    (np.array([100, 150, 100]), np.array([140, 255, 255])),  # bleu pur/violet H=100-140
]

# -- Tracker de persistance ----------------------------------------------------
_raw_history = deque()  # (timestamp, x_cm, y_cm, d_cm)

def _purge_history(now):
    while _raw_history and (now - _raw_history[0][0]) > PERSIST_HISTORY_S:
        _raw_history.popleft()

def _get_persistent_targets(now):
    if not _raw_history:
        return []
    points = list(_raw_history)
    used = [False] * len(points)
    clusters = []
    for i, (t_i, x_i, y_i, d_i) in enumerate(points):
        if used[i]:
            continue
        cluster = [(t_i, x_i, y_i, d_i)]
        used[i] = True
        for j, (t_j, x_j, y_j, d_j) in enumerate(points):
            if used[j]:
                continue
            if math.sqrt((x_i - x_j)**2 + (y_i - y_j)**2) <= PERSIST_RADIUS_CM:
                cluster.append((t_j, x_j, y_j, d_j))
                used[j] = True
        clusters.append(cluster)
    valid = []
    for cluster in clusters:
        times = [p[0] for p in cluster]
        duration = max(times) - min(times)
        if duration >= PERSIST_MIN_S:
            recent = [p for p in cluster if now - p[0] <= 1.5] or cluster
            x_m = int(sum(p[1] for p in recent) / len(recent))
            y_m = int(sum(p[2] for p in recent) / len(recent))
            d_m = int(math.sqrt(x_m**2 + y_m**2))
            valid.append((x_m, y_m, d_m, duration))
    valid.sort(key=lambda t: t[3], reverse=True)
    return [(x, y, d) for x, y, d, _ in valid]


def detect_targets(frame):
    roi = frame[RADAR_Y1:RADAR_Y2, RADAR_X1:RADAR_X2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

    combined = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in TARGET_COLORS:
        combined = cv2.bitwise_or(combined, cv2.inRange(hsv, lower, upper))

    kernel = np.ones((3, 3), np.uint8)
    combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN,  kernel)
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    targets = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < MIN_AREA:
            continue
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
        x_cm, y_cm = px_to_cm(cx, cy)
        d_cm = int(math.sqrt(x_cm**2 + y_cm**2))
        if d_cm > 10:
            targets.append((x_cm, y_cm, d_cm, area))

    # Trier par aire decroissante
    targets.sort(key=lambda t: t[3], reverse=True)

    # Alimenter l'historique
    now = time.time()
    for x, y, d, _ in targets:
        _raw_history.append((now, x, y, d))
    _purge_history(now)

    # Retourner uniquement les cibles persistantes
    persistent = _get_persistent_targets(now)
    if len(targets) > 1:
        print(f"[XAVER] {len(persistent)} persistante(s) / {len(targets)} brutes")
    return persistent

# -- Vitesse -------------------------------------------------------------------
_prev_x, _prev_y, _prev_time = 0, 0, time.time()

def estimate_speed(x_cm, y_cm):
    global _prev_x, _prev_y, _prev_time
    now = time.time()
    dt  = now - _prev_time
    speed = 0
    if 0 < dt < 2.0:
        speed = int(math.sqrt((x_cm-_prev_x)**2 + (y_cm-_prev_y)**2) / dt)
    _prev_x, _prev_y, _prev_time = x_cm, y_cm, now
    return speed

# -- Main ----------------------------------------------------------------------
def main():
    global _batt_pct, _last_batt

    print(f"[XAVER] Demarrage - {TX_ID}")

    cap = cv2.VideoCapture(VIDEO_DEVICE, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  720)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 10)

    if not cap.isOpened():
        print("[XAVER] ERREUR: impossible d'ouvrir /dev/video0")
        return

    print("[XAVER] Capture OK")

    try:
        ser = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)
        time.sleep(1)
        print("[XAVER] LoRa OK")
    except Exception as e:
        print(f"[XAVER] ERREUR LoRa: {e}")
        ser = None

    last_send  = time.time()
    last_x, last_y, last_d, last_v = 0, 0, 0, 0
    presence   = False
    batt_v     = -1.0

    print("[XAVER] En attente de cible...")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            # Lecture batterie toutes les 10s
            now = time.time()
            if now - _last_batt >= BATT_PERIOD:
                _last_batt = now
                batt_v = read_xaver_battery(frame)
                if batt_v >= 0:
                    print(f"[XAVER] Batterie Xaver: {batt_v:.2f}V ({int(batt_v/10.8*100)}%)")

            # Detection cibles
            targets = detect_targets(frame)

            if targets:
                x_cm, y_cm, d_cm = targets[0]
                v_cms = estimate_speed(x_cm, y_cm)
                last_x, last_y, last_d, last_v = x_cm, y_cm, d_cm, v_cms
                presence = True
                if len(targets) > 1:
                    print(f"[XAVER] {len(targets)} cibles - principale: x={x_cm} y={y_cm} d={d_cm}cm")
            else:
                presence = False

            # Envoi LoRa
            if now - last_send >= SEND_INTERVAL:
                last_send = now
                batt_str = f"{batt_v:.2f}" if batt_v >= 0 else "0.00"

                if presence:
                    payload = f"LD45;{TX_ID};{last_x};{last_y};{last_d};{last_v};{batt_str}\n"
                    print(f"[XAVER] {payload.strip()}")
                    if ser:
                        try:
                            ser.write(payload.encode())
                        except Exception as e:
                            print(f"[XAVER] Erreur serie: {e}")
                else:
                    payload = f"LD45;{TX_ID};0;0;0;0;{batt_str}\n"
                    print(f"[XAVER] {payload.strip()}")
                    if ser:
                        try:
                            ser.write(payload.encode())
                        except Exception as e:
                            print(f"[XAVER] Erreur serie: {e}")

            time.sleep(0.05)

    except KeyboardInterrupt:
        print("\n[XAVER] Arret")
    finally:
        cap.release()
        if ser:
            ser.close()

if __name__ == "__main__":
    main()
