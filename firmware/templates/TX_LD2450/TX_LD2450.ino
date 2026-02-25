/*
 * THEIA TX Firmware - LD2450 mmWave Radar Sensor
 * Heltec WiFi LoRa 32 V3 + HLK-LD2450
 *
 * Reads presence/distance/direction from LD2450 via UART
 * and transmits via LoRa to the THEIA RX gateway.
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 *
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include "LoRaWan_APP.h"
#include "Arduino.h"

// ── Configuration ──────────────────────────────────
#define TX_ID       "__TX_ID__"
#define TX_INTERVAL 2000        // ms between LoRa transmissions
#define LORA_BAND   868E6       // EU868
#define LORA_SF     7
#define LORA_BW     125E3
#define LORA_TX_POWER 14        // dBm

// LD2450 UART (GPIO18=RX, GPIO17=TX on Heltec V3)
#define LD_RX_PIN   18
#define LD_TX_PIN   17
#define LD_BAUD     256000

HardwareSerial LDSerial(1);

// ── LD2450 frame parsing ───────────────────────────
// Frame: AA FF 03 00 ... 55 CC (30 bytes)
#define LD_FRAME_LEN 30
uint8_t ldBuf[LD_FRAME_LEN];
int ldIdx = 0;

// Target data (up to 3 targets from LD2450)
struct Target {
  int16_t x;      // mm (lateral)
  int16_t y;      // mm (distance forward)
  int16_t speed;  // cm/s
  uint16_t res;   // resolution
};
Target targets[3];
int targetCount = 0;

// Battery voltage reading
float readBattery() {
  // Heltec V3: battery on ADC pin 1 with voltage divider
  // Use built-in Heltec battery reading if available
  uint32_t raw = analogRead(1);
  return (raw / 4095.0) * 3.3 * 2.0; // Voltage divider factor ~2
}

// ── LD2450 frame parser ────────────────────────────
bool parseLD2450Frame(uint8_t *buf) {
  // Verify header AA FF 03 00 and footer 55 CC
  if (buf[0] != 0xAA || buf[1] != 0xFF || buf[2] != 0x03 || buf[3] != 0x00) return false;
  if (buf[28] != 0x55 || buf[29] != 0xCC) return false;

  targetCount = 0;
  for (int i = 0; i < 3; i++) {
    int offset = 4 + i * 8;
    int16_t x  = (int16_t)(buf[offset] | (buf[offset + 1] << 8));
    int16_t y  = (int16_t)(buf[offset + 2] | (buf[offset + 3] << 8));
    int16_t sp = (int16_t)(buf[offset + 4] | (buf[offset + 5] << 8));
    uint16_t r = (uint16_t)(buf[offset + 6] | (buf[offset + 7] << 8));

    // Sign handling: LD2450 uses bit 15 for sign on x
    if (x & 0x8000) x = -(x & 0x7FFF);
    if (y & 0x8000) y = -(y & 0x7FFF);
    if (sp & 0x8000) sp = -(sp & 0x7FFF);

    // Valid target if y > 0
    if (y > 0) {
      targets[targetCount] = {x, y, sp, r};
      targetCount++;
    }
  }
  return true;
}

void readLD2450() {
  while (LDSerial.available()) {
    uint8_t b = LDSerial.read();
    if (ldIdx == 0 && b != 0xAA) continue;
    if (ldIdx == 1 && b != 0xFF) { ldIdx = 0; continue; }
    ldBuf[ldIdx++] = b;
    if (ldIdx >= LD_FRAME_LEN) {
      parseLD2450Frame(ldBuf);
      ldIdx = 0;
    }
  }
}

// ── LoRa packet builder ───────────────────────────
// Format: "TX_ID | x=X y=Y spd=S presence=P direction=D distance=CM vbatt=V"
String buildPacket() {
  float vbatt = readBattery();
  String pkt = String(TX_ID) + " | ";

  if (targetCount > 0) {
    // Use closest target (smallest y = distance)
    int closest = 0;
    for (int i = 1; i < targetCount; i++) {
      if (targets[i].y < targets[closest].y) closest = i;
    }
    Target &t = targets[closest];

    int distCm = t.y / 10;      // mm -> cm
    int xCm = t.x / 10;
    int speedCms = t.speed;

    // Direction based on x position
    String dir;
    if (abs(xCm) < 30) dir = "C";       // Center
    else if (xCm < 0) dir = "L";         // Left
    else dir = "R";                       // Right

    // Movement direction
    String mov;
    if (speedCms > 5) mov = "approaching";
    else if (speedCms < -5) mov = "receding";
    else mov = "stationary";

    pkt += "x=" + String(xCm) + " y=" + String(distCm);
    pkt += " spd=" + String(speedCms);
    pkt += " presence=1 direction=" + dir;
    pkt += " distance=" + String(distCm);
    pkt += " targets=" + String(targetCount);
  } else {
    pkt += "x=0 y=0 presence=0 distance=0";
  }

  pkt += " vbatt=" + String(vbatt, 2);
  return pkt;
}

// ── LoRa TX ────────────────────────────────────────
unsigned long lastTx = 0;

void loraSend(String data) {
  Radio.Send((uint8_t *)data.c_str(), data.length());
}

// ── Setup ──────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("[THEIA-TX] " TX_ID " booting...");

  // Init LD2450 serial
  LDSerial.begin(LD_BAUD, SERIAL_8N1, LD_RX_PIN, LD_TX_PIN);

  // Init LoRa
  Mcu.begin();
  RadioEvents_t events;
  memset(&events, 0, sizeof(events));
  Radio.Init(&events);
  Radio.SetChannel(LORA_BAND);
  Radio.SetTxConfig(
    MODEM_LORA, LORA_TX_POWER, 0,
    LORA_BW == 125E3 ? 0 : (LORA_BW == 250E3 ? 1 : 2),
    LORA_SF, 1, 8, false, true, 0, 0, false, 3000
  );

  Serial.println("[THEIA-TX] Ready. Interval=" + String(TX_INTERVAL) + "ms");
}

// ── Loop ───────────────────────────────────────────
void loop() {
  // Continuously read LD2450 data
  readLD2450();

  // Send LoRa packet at interval
  if (millis() - lastTx >= TX_INTERVAL) {
    lastTx = millis();
    String pkt = buildPacket();
    Serial.println("[TX] " + pkt);
    loraSend(pkt);
  }

  Radio.IrqProcess();
}
