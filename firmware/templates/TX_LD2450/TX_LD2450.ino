/**
 * THEIA TX — Heltec ESP32-S3 LoRa (LoRaWan_APP) + HLK-LD2450 (UART)
 * -------------------------------------------------------------------
 * Radar LD2450 sur Serial2
 * - RX ESP  = GPIO19 (recoit TX du LD2450)
 * - TX ESP  = GPIO21 (envoie vers RX du LD2450)
 *
 * Batterie:
 * - Module "Voltage Sensor 0-25V" (pont diviseur ~5:1)
 *   Bornier: VCC<25V = Batt+, GND = Batt-
 *   Pins:    S -> ADC (GPIO4),  - -> GND Heltec,  + (inutile)
 *
 * LoRa payload (format LD45):
 * - Absent : LD45;__TX_ID__;0;0;0;0;4.02
 * - Present: LD45;__TX_ID__;X;Y;D;V;4.02   (X,Y,D en cm, V en cm/s)
 *
 * Detection (Option B):
 * - Presence basee sur mouvement humain:
 *   - vitesse >= V_MIN_CM_S  OU variation position >= 3cm
 *   - CONFIRM_FRAMES frames consecutives avant passage en presence
 *   - HOLD_MS maintien apres dernier mouvement
 *
 * TX_ID is replaced at flash time by the THEIA provisioning system.
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include <Arduino.h>
#include <LD2450.h>
#include "LoRaWan_APP.h"
#include "HT_SSD1306Wire.h"
#include <math.h>

// ================= CONFIG =================
#define TX_ID "__TX_ID__"

// --- Radar UART ---
#define RADAR_UART_RX 19
#define RADAR_UART_TX 21
#define RADAR_BAUD    115200

#define BUTTON_PRG 0

// --- Batterie (aligne TX02) ---
#define ADC_BATT_PIN        4
#define VOLT_SAMPLES        8
#define VOLT_READ_PERIOD_MS 1000UL
#define VOLT_DIV_RATIO      5.00f

#define BUFFER_SIZE 96
char txpacket[BUFFER_SIZE];

// ===== OPTION B (mouvement humain) =====
#define V_MIN_CM_S      8
#define HOLD_MS         2500UL
#define CONFIRM_FRAMES  2
// ========================================

LD2450 radar;
SSD1306Wire screen(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);

// Batterie cache
static float g_battV = 0.0f;
static float g_battPct = 0.0f;
static uint32_t g_lastBattMs = 0;

// Mouvement / presence
static bool presenceState = false;
static unsigned long lastMoveMs = 0;
static int consecutiveMove = 0;

static bool havePrev = false;
static int prevX = 0, prevY = 0;

static int lastX = 0, lastY = 0, lastD = 0, lastV = 0;

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

// ------------------ LD2450 helpers ------------------
static int16_t ld2450_decode_signed15(uint16_t raw) {
  if (raw & 0x8000) return (int16_t)(raw - 0x8000);
  return -(int16_t)raw;
}

static inline int iabs(int v) { return v < 0 ? -v : v; }

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);

  // Radar
  Serial2.begin(RADAR_BAUD, SERIAL_8N1, RADAR_UART_RX, RADAR_UART_TX);
  radar.begin(Serial2, false);

  // LoRa
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  Radio.Init(nullptr);
  Radio.SetChannel(868000000);
  Radio.SetTxConfig(MODEM_LORA, 10, 0, 0, 7, 1, 8, false, true, 0, 0, false, 3000);

  // OLED
  screen.init();
  screen.setFont(ArialMT_Plain_10);
  screen.clear();
  screen.drawString(0, 0, "LD2450 TX READY");
  screen.display();

  // Batterie (1x au boot)
  updateBatteryIfNeeded(millis());
}

// ===================== LOOP =====================
void loop() {
  unsigned long now = millis();

  // Batterie (1x/s)
  updateBatteryIfNeeded(now);

  int targets = radar.read();

  bool haveCandidate = false;
  int x_cm = 0, y_cm = 0, d_cm = 0, v_cms = 0;

  // ===== Lecture radar =====
  if (targets > 0) {
    for (int i = 0; i < targets; i++) {
      LD2450::RadarTarget t = radar.getTarget(i);
      if (!t.valid) continue;

      uint16_t rawX = (uint16_t)(int16_t)t.x;
      uint16_t rawY = (uint16_t)(int16_t)t.y;
      uint16_t rawS = (uint16_t)(int16_t)t.speed;

      int16_t x_mm = ld2450_decode_signed15(rawX);
      int16_t y_mm = ld2450_decode_signed15(rawY);
      int16_t v    = ld2450_decode_signed15(rawS);

      // conversion cm
      x_cm = x_mm / 10;
      y_cm = y_mm / 10;

      // distance recalculee (FIABLE)
      d_cm = (int)lroundf(sqrtf((float)x_mm * x_mm + (float)y_mm * y_mm) / 10.0f);

      v_cms = v;

      // ignore bruit trop proche
      if (d_cm < 15) continue;

      haveCandidate = true;
      break;
    }
  }

  // ===== Option B : mouvement =====
  bool moved = false;

  if (haveCandidate) {
    // vitesse
    if (iabs(v_cms) >= V_MIN_CM_S) moved = true;

    // variation position
    if (havePrev) {
      if (iabs(x_cm - prevX) >= 3) moved = true;
      if (iabs(y_cm - prevY) >= 3) moved = true;
    }

    prevX = x_cm;
    prevY = y_cm;
    havePrev = true;
  }

  if (moved) {
    consecutiveMove++;
    lastMoveMs = now;

    lastX = x_cm;
    lastY = y_cm;
    lastD = d_cm;
    lastV = v_cms;

    if (!presenceState && consecutiveMove >= CONFIRM_FRAMES)
      presenceState = true;

  } else {
    consecutiveMove = 0;
    if (presenceState && (now - lastMoveMs > HOLD_MS)) {
      presenceState = false;
      havePrev = false;
    }
  }

  // ===== Envoi LoRa =====
  if (presenceState) {
    snprintf(txpacket, BUFFER_SIZE,
             "LD45;%s;%d;%d;%d;%d;%.2f",
             TX_ID, lastX, lastY, lastD, lastV, g_battV);
  } else {
    snprintf(txpacket, BUFFER_SIZE,
             "LD45;%s;0;0;0;0;%.2f",
             TX_ID, g_battV);
  }

  Radio.Send((uint8_t*)txpacket, strlen(txpacket));

  Serial.printf("[TX %s] %s\n", TX_ID, txpacket);

  delay(200);
}
