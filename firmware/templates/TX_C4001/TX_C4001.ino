/*
 * THEIA TX Firmware - C4001 mmWave Radar Sensor
 * Heltec WiFi LoRa 32 V3 + DFRobot SEN0609 (C4001)
 *
 * Reads presence/distance from C4001 via I2C
 * and transmits via LoRa to the THEIA RX gateway.
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 *
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include "LoRaWan_APP.h"
#include "Arduino.h"
#include <Wire.h>

// ── Configuration ──────────────────────────────────
#define TX_ID       "__TX_ID__"
#define TX_INTERVAL 2000        // ms between LoRa transmissions
#define LORA_BAND   868E6       // EU868
#define LORA_SF     7
#define LORA_BW     125E3
#define LORA_TX_POWER 14        // dBm

// C4001 I2C config
#define C4001_ADDR  0x2C        // Default I2C address for SEN0609
#define SDA_PIN     41          // Heltec V3 I2C SDA
#define SCL_PIN     42          // Heltec V3 I2C SCL

// C4001 registers
#define REG_STATUS      0x00
#define REG_DISTANCE    0x01
#define REG_SPEED       0x02
#define REG_ENERGY      0x03

// ── C4001 I2C communication ───────────────────────
uint8_t c4001_presence = 0;
uint16_t c4001_distance = 0;  // cm
int16_t c4001_speed = 0;      // cm/s
uint16_t c4001_energy = 0;

bool readC4001Register(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(C4001_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(C4001_ADDR, len);
  for (uint8_t i = 0; i < len && Wire.available(); i++) {
    buf[i] = Wire.read();
  }
  return true;
}

void readC4001() {
  uint8_t buf[4];

  // Read status (presence)
  if (readC4001Register(REG_STATUS, buf, 1)) {
    c4001_presence = buf[0] & 0x01;
  }

  // Read distance
  if (readC4001Register(REG_DISTANCE, buf, 2)) {
    c4001_distance = (buf[0] | (buf[1] << 8));
  }

  // Read speed
  if (readC4001Register(REG_SPEED, buf, 2)) {
    c4001_speed = (int16_t)(buf[0] | (buf[1] << 8));
  }

  // Read energy (signal strength)
  if (readC4001Register(REG_ENERGY, buf, 2)) {
    c4001_energy = (buf[0] | (buf[1] << 8));
  }
}

// Battery voltage reading
float readBattery() {
  uint32_t raw = analogRead(1);
  return (raw / 4095.0) * 3.3 * 2.0;
}

// ── LoRa packet builder ───────────────────────────
// Format: "TX_ID | x=0 y=DIST presence=P direction=C distance=CM spd=S vbatt=V"
String buildPacket() {
  float vbatt = readBattery();
  String pkt = String(TX_ID) + " | ";

  if (c4001_presence) {
    // C4001 gives distance but not X position, so x=0
    String dir = "C";  // Center (single beam sensor)
    String mov;
    if (c4001_speed > 5) mov = "approaching";
    else if (c4001_speed < -5) mov = "receding";
    else mov = "stationary";

    pkt += "x=0 y=" + String(c4001_distance);
    pkt += " spd=" + String(c4001_speed);
    pkt += " presence=1 direction=" + dir;
    pkt += " distance=" + String(c4001_distance);
    pkt += " energy=" + String(c4001_energy);
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

  // Init I2C for C4001
  Wire.begin(SDA_PIN, SCL_PIN);

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
  // Read C4001 sensor
  readC4001();

  // Send LoRa packet at interval
  if (millis() - lastTx >= TX_INTERVAL) {
    lastTx = millis();
    String pkt = buildPacket();
    Serial.println("[TX] " + pkt);
    loraSend(pkt);
  }

  Radio.IrqProcess();
}
