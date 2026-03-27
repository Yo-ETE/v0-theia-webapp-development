/**
 * THEIA TX — XAVER 400 Through-Wall Radar (Python Script)
 * -------------------------------------------------------------------
 * This is NOT an Arduino firmware. The XAVER 400 uses a Python script
 * running on a PC/Raspberry Pi to capture the BNC video output and
 * transmit target positions via LoRa.
 * 
 * See TX_XAVER.py for the actual implementation.
 * 
 * TX_ID placeholder for provisioning: __TX_ID__
 * 
 * Hardware Setup:
 * - XAVER 400 BNC output → USB capture card → PC/Raspberry Pi
 * - Heltec ESP32-S3 LoRa connected via USB serial
 * - Python script captures video, detects targets, sends via LoRa
 * 
 * Message format: LD45;TX_ID;x;y;d;speed;battery
 * - x, y: target position in mm (relative to radar center)
 * - d: distance in mm
 * - speed: always 0 (static detection)
 * - battery: always 100 (powered device)
 */

// This file exists only for the webapp firmware manager.
// The actual code is in TX_XAVER.py

void setup() {
  // See TX_XAVER.py
}

void loop() {
  // See TX_XAVER.py
}
