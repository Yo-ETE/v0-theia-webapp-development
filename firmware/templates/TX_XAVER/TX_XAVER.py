#!/usr/bin/env python3
"""
THEIA TX — XAVER 400 BNC Capture + LoRa Bridge
===============================================
Captures video output from XAVER 400 BNC connector,
detects targets via HSV color analysis, and sends
coordinates via LoRa to THEIA hub.

TX_ID: __TX_ID__

Requirements:
- Python 3.8+
- OpenCV (cv2)
- pyserial
- USB capture card connected to XAVER BNC output
- Heltec ESP32 LoRa module on serial port

Usage:
  python TX_XAVER.py --port /dev/ttyUSB0 --camera 0
"""

import cv2
import serial
import time
import argparse
import numpy as np
from collections import deque

# ─── Configuration ───────────────────────────────────────────────────────────
TX_ID = "__TX_ID__"  # Injected by THEIA provisioning
SERIAL_PORT = "/dev/ttyUSB0"
SERIAL_BAUD = 115200
CAMERA_INDEX = 0

# HSV thresholds for target detection (green markers on XAVER display)
HSV_LOWER = np.array([35, 100, 100])
HSV_UPPER = np.array([85, 255, 255])

# Detection parameters
MIN_CONTOUR_AREA = 50
MAX_TARGETS = 3
SEND_INTERVAL = 0.5  # seconds between LoRa transmissions

# ─── LoRa Message Format ─────────────────────────────────────────────────────
# Format: LD45;TX_ID;x;y;distance;speed;battery
# x, y: relative position in mm (center = 0,0)
# distance: depth in mm
# speed: estimated speed in mm/s (0 if static)
# battery: always 4200 (powered device)

def send_lora(ser, x_mm, y_mm, dist_mm, speed=0):
    """Send detection data via LoRa"""
    msg = f"LD45;{TX_ID};{x_mm};{y_mm};{dist_mm};{speed};4200\n"
    ser.write(msg.encode())
    print(f"[TX] {msg.strip()}")

def detect_targets(frame):
    """Detect targets in XAVER display frame using HSV color analysis"""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, HSV_LOWER, HSV_UPPER)
    
    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    targets = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < MIN_CONTOUR_AREA:
            continue
            
        M = cv2.moments(contour)
        if M["m00"] == 0:
            continue
            
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
        
        # Convert pixel coordinates to relative position
        # Assuming XAVER display shows 8m range, 120deg FOV
        frame_h, frame_w = frame.shape[:2]
        
        # X: lateral position (-4000mm to +4000mm)
        x_mm = int((cx - frame_w / 2) / frame_w * 8000)
        
        # Y: depth (0 to 8000mm, bottom = close, top = far)
        y_mm = 0  # Lateral only for now
        
        # Distance: vertical position maps to depth
        dist_mm = int((1 - cy / frame_h) * 8000)
        
        targets.append((x_mm, y_mm, dist_mm, area))
    
    # Sort by area (largest first) and limit
    targets.sort(key=lambda t: t[3], reverse=True)
    return targets[:MAX_TARGETS]

def main():
    parser = argparse.ArgumentParser(description="THEIA XAVER 400 Bridge")
    parser.add_argument("--port", default=SERIAL_PORT, help="Serial port for LoRa")
    parser.add_argument("--baud", type=int, default=SERIAL_BAUD, help="Baud rate")
    parser.add_argument("--camera", type=int, default=CAMERA_INDEX, help="Camera index")
    args = parser.parse_args()
    
    # Open serial connection
    try:
        ser = serial.Serial(args.port, args.baud, timeout=1)
        print(f"[XAVER] Serial connected: {args.port}")
    except Exception as e:
        print(f"[XAVER] Serial error: {e}")
        return
    
    # Open video capture
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"[XAVER] Cannot open camera {args.camera}")
        return
    
    print(f"[XAVER] Camera opened, TX_ID={TX_ID}")
    
    last_send = 0
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue
            
            targets = detect_targets(frame)
            
            now = time.time()
            if targets and (now - last_send) >= SEND_INTERVAL:
                # Send first target (primary)
                x, y, dist, _ = targets[0]
                send_lora(ser, x, y, dist)
                last_send = now
            
            # Display preview (optional)
            cv2.imshow("XAVER", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
    except KeyboardInterrupt:
        print("\n[XAVER] Stopped")
    finally:
        cap.release()
        ser.close()
        cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
