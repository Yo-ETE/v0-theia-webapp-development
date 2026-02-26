/**
 * THEIA TX — Heltec ESP32-S3 LoRa (LoRaWan_APP) + DFRobot C4001 (UART)
 * -------------------------------------------------------------------
 * UART C4001 sur Serial1 (pins SAFE, evite 43/44 qui servent a l'USB/boot)
 * - RX ESP  = GPIO5  (recoit TX du C4001)
 * - TX ESP  = GPIO6  (envoie vers RX du C4001)
 *
 * Batterie:
 * - Module "Voltage Sensor 0-25V" (pont diviseur ~5:1)
 *   Bornier: VCC<25V = Batt+, GND = Batt-
 *   Pins:    S -> ADC,  - -> GND Heltec,  + (inutile)
 *
 * LoRa payload (compat RX LD2450-like):
 * - Absent : LD45;__TX_ID__;0;0;0;0;4.02
 * - Present: LD45;__TX_ID__;0;Y;D;V;4.02
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include <Arduino.h>
#include "LoRaWan_APP.h"
#include <math.h>

// ===================== CONFIG =====================
static const char* TX_ID = "__TX_ID__";

// --- C4001 UART (Serial1) ---
#define C4001_RX_PIN   5
#define C4001_TX_PIN   6
#define C4001_BAUD     9600

// --- Batterie ---
#define ADC_BATT_PIN        4
#define VOLT_SAMPLES        8
#define VOLT_READ_PERIOD_MS 1000UL
#define VOLT_DIV_RATIO      5.00f

// --- LoRa ---
#define LORA_FREQ        868000000
#define SEND_PERIOD_MS   1000UL

// --- Presence / filtrage ---
#define PRESENCE_HOLD_MS 3000UL
#define DIST_ALPHA       0.25f

// --- Mapping LD45 ---
#define X_CM_WHEN_PRESENT  0
#define Y_MIN_CM           20
#define Y_MAX_CM           2500
// ===================================================

// UART radar
HardwareSerial RadarSerial(1);
static String radarLine;

// Etat radar
static uint32_t lastMotionMs = 0;
static float lastDistM = 0.0f;
static float lastSpeedMps = 0.0f;
static bool  filtInit = false;

// LoRa
static RadioEvents_t RadioEvents;
static uint32_t lastSendMs = 0;
static uint32_t lastBeatMs = 0;

// Batterie cache
static float g_battV = 0.0f;
static float g_battPct = 0.0f;
static uint32_t g_lastBattMs = 0;

// ------------------ Batterie ------------------
static float batteryPercentCurve(float v) {
  if (v >= 4.20f) return 100;
  if (v >= 4.10f) return 90;
  if (v >= 4.00f) return 80;
  if (v >= 3.92f) return 70;
  if (v >= 3.85f) return 60;
  if (v >= 3.80f) return 50;
  if (v >= 3.75f) return 40;
  if (v >= 3.70f) return 30;
  if (v >= 3.60f) return 20;
  if (v >= 3.50f) return 10;
  return 0;
}

static float readBatteryVoltage(float* out_vpin = nullptr, uint32_t* out_mv = nullptr) {
  analogReadResolution(12);
  analogSetPinAttenuation(ADC_BATT_PIN, ADC_11db);

  uint32_t acc = 0;
  for (int i = 0; i < VOLT_SAMPLES; ++i) {
    delayMicroseconds(150);
    acc += analogReadMilliVolts(ADC_BATT_PIN);
  }

  uint32_t mv = (uint32_t)lround(acc / (float)VOLT_SAMPLES);
  float v_pin = mv / 1000.0f;
  float v_batt = v_pin * VOLT_DIV_RATIO;

  if (out_vpin) *out_vpin = v_pin;
  if (out_mv)   *out_mv   = mv;

  return v_batt;
}

static void updateBatteryIfNeeded(uint32_t now) {
  if (g_lastBattMs == 0 || (now - g_lastBattMs) >= VOLT_READ_PERIOD_MS) {
    g_lastBattMs = now;

    float vpin = 0.0f;
    uint32_t mv = 0;
    g_battV = readBatteryVoltage(&vpin, &mv);
    g_battPct = batteryPercentCurve(g_battV);

    Serial.printf("[BATT] mv=%lumV vpin=%.3fV vbatt=%.3fV pct=%.0f%% ratio=%.2f\n",
                  (unsigned long)mv, vpin, g_battV, g_battPct, (float)VOLT_DIV_RATIO);
  }
}

// ------------------ CSV helper ------------------
static String csvField(const String& s, int idx) {
  int field = 0;
  int start = 0;
  for (int i = 0; i <= (int)s.length(); i++) {
    if (i == (int)s.length() || s[i] == ',') {
      if (field == idx) {
        String tok = s.substring(start, i);
        tok.trim();
        return tok;
      }
      field++;
      start = i + 1;
    }
  }
  return "";
}

// ------------------ Radar parse ------------------
static void handleRadarSentence(const String& s) {
  if (!s.startsWith("$DFDMD")) return;

  int n = csvField(s, 1).toInt();
  if (n <= 0) return;

  float dist = csvField(s, 3).toFloat();
  float spd  = csvField(s, 4).toFloat();
  if (dist <= 0.0f) return;

  const uint32_t now = millis();
  lastMotionMs = now;

  // EWMA
  if (!filtInit) {
    filtInit = true;
    lastDistM = dist;
    lastSpeedMps = spd;
  } else {
    lastDistM = lastDistM + DIST_ALPHA * (dist - lastDistM);
    lastSpeedMps = lastSpeedMps + DIST_ALPHA * (spd - lastSpeedMps);
  }
}

static void radarPoll() {
  while (RadarSerial.available()) {
    char c = (char)RadarSerial.read();

    if (c == '$') {
      radarLine = "$";
    } else if (radarLine.length()) {
      radarLine += c;
      if (c == '*') {
        handleRadarSentence(radarLine);
        radarLine = "";
      }
      if (radarLine.length() > 200) radarLine = "";
    }
  }
}

static void sendRadarCmd(const char* cmd) {
  RadarSerial.print(cmd);
  RadarSerial.print("\r\n");
  Serial.print(">> "); Serial.println(cmd);
}

// ------------------ LoRa ------------------
static void OnTxDone(void)    { Radio.Standby(); }
static void OnTxTimeout(void) { Radio.Standby(); }

static void loraInit() {
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);

  RadioEvents.TxDone = OnTxDone;
  RadioEvents.TxTimeout = OnTxTimeout;

  Radio.Init(&RadioEvents);
  Radio.SetChannel(LORA_FREQ);

  Radio.SetTxConfig(MODEM_LORA,
                    14, 0, 0,
                    7, 1, 8,
                    false, true, 0, 0,
                    false, 3000);

  Radio.Standby();
}

static void loraSendLine(const String& line) {
  Radio.Standby();
  Radio.Send((uint8_t*)line.c_str(), (uint16_t)line.length());
}

// ===================== SETUP / LOOP =====================
void setup() {
  Serial.begin(115200);
  delay(800);

  Serial.println();
  Serial.println("--- THEIA TX C4001 -> LoRa (LD45) ---");
  Serial.printf("TX_ID=%s\n", TX_ID);
  Serial.printf("C4001 Serial1 RX=%d TX=%d baud=%d\n", C4001_RX_PIN, C4001_TX_PIN, C4001_BAUD);
  Serial.printf("Battery ADC GPIO%d (div ratio=%.2f)\n", ADC_BATT_PIN, (float)VOLT_DIV_RATIO);

  RadarSerial.begin(C4001_BAUD, SERIAL_8N1, C4001_RX_PIN, C4001_TX_PIN);
  delay(600);

  sendRadarCmd("sensorStop");
  delay(150);
  sendRadarCmd("setRunApp 1");
  delay(150);
  sendRadarCmd("sensorStart 1");
  delay(150);

  loraInit();
  Serial.println("[LORA] OK");

  lastSendMs = millis();
  lastBeatMs = millis();
  Serial.println("[BOOT] setup done");
}

void loop() {
  const uint32_t now = millis();

  radarPoll();

  updateBatteryIfNeeded(now);

  bool present = (lastMotionMs != 0) && (now - lastMotionMs <= PRESENCE_HOLD_MS);

  if (now - lastBeatMs >= 1000) {
    lastBeatMs = now;
    Serial.printf("[BEAT] present=%d dist=%.3fm spd=%.3fm/s last=%lums\n",
                  present ? 1 : 0,
                  lastDistM,
                  lastSpeedMps,
                  (lastMotionMs ? (unsigned long)(now - lastMotionMs) : 999999UL));
  }

  if (now - lastSendMs >= SEND_PERIOD_MS) {
    lastSendMs = now;

    String payload;

    if (!present) {
      payload = "LD45;" + String(TX_ID) + ";0;0;0;0;" + String(g_battV, 2);
      Serial.printf("[SEND] out=0 batt=%.2f (%.0f%%) => %s\n", g_battV, g_battPct, payload.c_str());
    } else {
      int distCm = (int)lround(lastDistM * 100.0f);
      int spdCms = (int)lround(lastSpeedMps * 100.0f);

      distCm = constrain(distCm, Y_MIN_CM, Y_MAX_CM);

      payload = "LD45;" + String(TX_ID) + ";" + String(X_CM_WHEN_PRESENT) + ";" +
                String(distCm) + ";" + String(distCm) + ";" + String(spdCms) + ";" +
                String(g_battV, 2);

      Serial.printf("[SEND] out=1 dist=%dcm spd=%dcm/s batt=%.2f (%.0f%%) => %s\n",
                    distCm, spdCms, g_battV, g_battPct, payload.c_str());
    }

    loraSendLine(payload);
  }

  Radio.IrqProcess();
  delay(5);
}
