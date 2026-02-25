/*
 * THEIA TX Firmware - C4001 mmWave Radar Sensor
 * Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262)
 *
 * Uses RadioLib for LoRa (no Heltec SDK dependency).
 * Reads presence/distance from DFRobot C4001 (SEN0609) via I2C
 * and transmits via LoRa to the THEIA RX gateway.
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 *
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include <Arduino.h>
#include <RadioLib.h>
#include <Wire.h>

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
SX1262 radio = new Module(8, 14, 12, 13);

// ── C4001 I2C ─────────────────────────────────────
#define C4001_ADDR  0x2C        // Default I2C address
#define SDA_PIN     41          // Heltec V3 I2C
#define SCL_PIN     42

#define REG_STATUS      0x00
#define REG_DISTANCE    0x01
#define REG_SPEED       0x02
#define REG_ENERGY      0x03

uint8_t c4001_presence = 0;
uint16_t c4001_distance = 0;  // cm
int16_t c4001_speed = 0;      // cm/s
uint16_t c4001_energy = 0;

bool readC4001Register(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(C4001_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom((uint8_t)C4001_ADDR, len);
  for (uint8_t i = 0; i < len && Wire.available(); i++) {
    buf[i] = Wire.read();
  }
  return true;
}

void readC4001() {
  uint8_t buf[4];
  if (readC4001Register(REG_STATUS, buf, 1)) {
    c4001_presence = buf[0] & 0x01;
  }
  if (readC4001Register(REG_DISTANCE, buf, 2)) {
    c4001_distance = (buf[0] | (buf[1] << 8));
  }
  if (readC4001Register(REG_SPEED, buf, 2)) {
    c4001_speed = (int16_t)(buf[0] | (buf[1] << 8));
  }
  if (readC4001Register(REG_ENERGY, buf, 2)) {
    c4001_energy = (buf[0] | (buf[1] << 8));
  }
}

// ── Battery ───────────────────────────────────────
float readBattery() {
  uint32_t raw = analogRead(1);
  return (raw / 4095.0) * 3.3 * 2.0;
}

// ── Packet builder ────────────────────────────────
// "TX_ID | x=0 y=DIST presence=P direction=C distance=CM spd=S vbatt=V"
String buildPacket() {
  float vbatt = readBattery();
  String pkt = String(TX_ID) + " | ";

  if (c4001_presence) {
    pkt += "x=0 y=" + String(c4001_distance);
    pkt += " spd=" + String(c4001_speed);
    pkt += " presence=1 direction=C";
    pkt += " distance=" + String(c4001_distance);
    pkt += " energy=" + String(c4001_energy);
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

  // I2C
  Wire.begin(SDA_PIN, SCL_PIN);

  // SX1262 LoRa init
  Serial.print("[LoRa] Init SX1262... ");
  int state = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SW, LORA_TX_PWR);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("OK");
  } else {
    Serial.print("FAIL code=");
    Serial.println(state);
  }
  radio.setDio2AsRfSwitch(true);

  Serial.println("[THEIA-TX] Ready. Interval=" + String(TX_INTERVAL) + "ms");
}

void loop() {
  readC4001();

  if (millis() - lastTx >= TX_INTERVAL) {
    lastTx = millis();
    String pkt = buildPacket();
    Serial.println("[TX] " + pkt);
    radio.transmit(pkt);
  }
}
