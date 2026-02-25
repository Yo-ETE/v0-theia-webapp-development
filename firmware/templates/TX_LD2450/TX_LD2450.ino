/*
 * THEIA TX Firmware - LD2450 mmWave Radar Sensor
 * Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262)
 *
 * Uses RadioLib for LoRa (no Heltec SDK dependency).
 * Reads presence/distance/direction from LD2450 via UART
 * and transmits via LoRa to the THEIA RX gateway.
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 *
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include <Arduino.h>
#include <RadioLib.h>

// ── TX ID (replaced by provisioning) ──────────────
#define TX_ID       "__TX_ID__"

// ── LoRa config ───────────────────────────────────
#define LORA_FREQ   868.0       // MHz EU868
#define LORA_BW     125.0       // kHz
#define LORA_SF     7
#define LORA_CR     5           // 4/5
#define LORA_TX_PWR 14          // dBm
#define LORA_SW     0x12        // Sync word
#define TX_INTERVAL 2000        // ms

// Heltec WiFi LoRa 32 V3 SX1262 pin mapping
// NSS=8, DIO1=14, RST=12, BUSY=13
SX1262 radio = new Module(8, 14, 12, 13);

// ── LD2450 UART ───────────────────────────────────
// GPIO18=RX from sensor, GPIO17=TX to sensor
#define LD_RX_PIN   18
#define LD_TX_PIN   17
#define LD_BAUD     256000

HardwareSerial LDSerial(1);

// LD2450 frame: AA FF 03 00 ... 55 CC (30 bytes)
#define LD_FRAME_LEN 30
uint8_t ldBuf[LD_FRAME_LEN];
int ldIdx = 0;

struct Target {
  int16_t x;      // mm
  int16_t y;      // mm (forward distance)
  int16_t speed;  // cm/s
};
Target targets[3];
int targetCount = 0;

// ── Battery ───────────────────────────────────────
// Heltec V3: ADC1 on GPIO1 with voltage divider
float readBattery() {
  uint32_t raw = analogRead(1);
  return (raw / 4095.0) * 3.3 * 2.0;
}

// ── LD2450 parser ─────────────────────────────────
bool parseLD2450Frame(uint8_t *buf) {
  if (buf[0] != 0xAA || buf[1] != 0xFF) return false;
  if (buf[2] != 0x03 || buf[3] != 0x00) return false;
  if (buf[28] != 0x55 || buf[29] != 0xCC) return false;

  targetCount = 0;
  for (int i = 0; i < 3; i++) {
    int off = 4 + i * 8;
    int16_t x  = (int16_t)(buf[off] | (buf[off + 1] << 8));
    int16_t y  = (int16_t)(buf[off + 2] | (buf[off + 3] << 8));
    int16_t sp = (int16_t)(buf[off + 4] | (buf[off + 5] << 8));

    if (x & 0x8000) x = -(x & 0x7FFF);
    if (y & 0x8000) y = -(y & 0x7FFF);
    if (sp & 0x8000) sp = -(sp & 0x7FFF);

    if (y > 0) {
      targets[targetCount++] = {x, y, sp};
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

// ── Packet builder ────────────────────────────────
// "TX_ID | x=X y=Y spd=S presence=P direction=D distance=CM vbatt=V"
String buildPacket() {
  float vbatt = readBattery();
  String pkt = String(TX_ID) + " | ";

  if (targetCount > 0) {
    int closest = 0;
    for (int i = 1; i < targetCount; i++) {
      if (targets[i].y < targets[closest].y) closest = i;
    }
    Target &t = targets[closest];
    int distCm = t.y / 10;
    int xCm = t.x / 10;

    String dir = "C";
    if (xCm < -30) dir = "L";
    else if (xCm > 30) dir = "R";

    pkt += "x=" + String(xCm) + " y=" + String(distCm);
    pkt += " spd=" + String(t.speed);
    pkt += " presence=1 direction=" + dir;
    pkt += " distance=" + String(distCm);
    pkt += " targets=" + String(targetCount);
  } else {
    pkt += "x=0 y=0 presence=0 distance=0";
  }
  pkt += " vbatt=" + String(vbatt, 2);
  return pkt;
}

// ── Main ──────────────────────────────────────────
unsigned long lastTx = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("[THEIA-TX] " TX_ID " booting (RadioLib)...");

  // LD2450
  LDSerial.begin(LD_BAUD, SERIAL_8N1, LD_RX_PIN, LD_TX_PIN);

  // SX1262 LoRa init
  Serial.print("[LoRa] Init SX1262... ");
  int state = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SW, LORA_TX_PWR);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("OK");
  } else {
    Serial.print("FAIL code=");
    Serial.println(state);
  }
  // Heltec V3 DIO2 controls RF switch
  radio.setDio2AsRfSwitch(true);

  Serial.println("[THEIA-TX] Ready. Interval=" + String(TX_INTERVAL) + "ms");
}

void loop() {
  readLD2450();

  if (millis() - lastTx >= TX_INTERVAL) {
    lastTx = millis();
    String pkt = buildPacket();
    Serial.println("[TX] " + pkt);
    radio.transmit(pkt);
  }
}
