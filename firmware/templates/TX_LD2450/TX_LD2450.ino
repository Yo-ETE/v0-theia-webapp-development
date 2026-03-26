/**
 * THEIA TX — Heltec ESP32-S3 LoRa + HLK-LD2450 (UART)
 * -------------------------------------------------------------------
 * Radar LD2450 sur Serial2 (sans bibliotheque externe)
 * - RX ESP  = GPIO19 (recoit TX du LD2450)
 * - TX ESP  = GPIO21 (envoie vers RX du LD2450)
 *
 * LD2450 Frame format (30 bytes):
 *   Header: AA FF 03 00
 *   Target 1: X(2) Y(2) Speed(2) Resolution(2) = 8 bytes
 *   Target 2: X(2) Y(2) Speed(2) Resolution(2) = 8 bytes
 *   Target 3: X(2) Y(2) Speed(2) Resolution(2) = 8 bytes
 *   Footer: 55 CC
 *
 * LoRa payload (format LD45):
 * - Absent : LD45;__TX_ID__;0;0;0;0;4.02
 * - Present: LD45;__TX_ID__;X;Y;D;V;4.02   (X,Y,D en cm, V en cm/s)
 *
 * NOTE: __TX_ID__ is automatically replaced by the webapp during flash.
 * (c) 2026 Yoann ETE - THEIA Project
 */

#include <Arduino.h>
#include "LoRaWan_APP.h"
#include <math.h>

// ===================== CONFIG =====================
static const char* TX_ID = "__TX_ID__";

// --- Radar UART ---
#define RADAR_UART_RX     19
#define RADAR_UART_TX     21
#define RADAR_BAUD        256000

// --- Batterie ---
#define ADC_BATT_PIN        4
#define VOLT_SAMPLES        8
#define VOLT_READ_PERIOD_MS 1000UL
#define VOLT_DIV_RATIO      5.00f

// --- LoRa ---
#define LORA_FREQ         868000000
#define SEND_PERIOD_MS    1000UL

// --- Presence / filtrage ---
#define PRESENCE_HOLD_MS  1500UL
#define DIST_ALPHA        0.25f
#define SPD_ALPHA         0.25f

// --- Garde-fous distance ---
#define DIST_MIN_CM       20.0f
#define DIST_MAX_CM       600.0f   // 6m max utile pour LD2450

// --- Mouvement / sensibilite ---
#define SPD_MIN_CMS       10.0f
#define POS_DELTA_MIN_CM  3.0f

// --- Seuil d'entree ---
#define SPD_ENTRY_CMS     15.0f
#define TRAJ_ENTRY_NET_CM 20.0f

// --- Trajectoire NETTE anti-fantomes ---
#define TRAJ_NOISE_CM     3.0f
#define MIN_TRAJ_NET_CM   15.0f
#define MIN_TRAJ_FRAMES   3

// --- Detection filtre bloque ---
#define FILT_STABLE_THRESH_CM  4.0f
#define FILT_STABLE_LOCK_MS    5000UL

// --- Streaks ---
#define VALID_STREAK_ON   2
#define VALID_STREAK_OFF  3
#define FAST_SPD_CMS      50.0f

// --- Anti-sauts ---
#define JUMP_MAX_CM       250.0f

// --- LD2450 Frame ---
#define FRAME_SIZE        30
#define BUFFER_SIZE       96
// ===================================================

// LD2450 frame parsing
static uint8_t frameBuffer[FRAME_SIZE];
static uint8_t frameIdx = 0;

// Target structure
struct Target {
  bool valid;
  float xCm;
  float yCm;
  float spdCms;
  float distCm;
};

static RadioEvents_t RadioEvents;
static char txpacket[BUFFER_SIZE];

// Batterie
static float    g_battV   = 0.0f;
static uint32_t g_lastBattMs = 0;

// Filtres EMA
static bool   filtInit    = false;
static float  distFiltCm  = 0.0f;
static float  spdFiltCms  = 0.0f;
static float  xFiltCm     = 0.0f;
static float  yFiltCm     = 0.0f;

// Historique brut
static float  lastRawDistCm = NAN;
static float  prevRawDistCm = NAN;
static float  lastRawXCm    = NAN;
static float  lastRawYCm    = NAN;

// Trajectoire NETTE
static float  trajStartDistCm = NAN;
static float  trajNetCm       = 0.0f;
static uint8_t trajFrames     = 0;

// Filtre bloque
static float  filtPrevSnapCm = NAN;
static uint32_t filtLastMoveMs = 0;

// Streaks
static uint8_t validStreak   = 0;
static uint8_t invalidStreak = 0;

// Etat presence
static bool   presenceState  = false;
static uint32_t lastGoodMs   = 0;

// Timers
static uint32_t lastSendMs   = 0;
static uint32_t lastBeatMs   = 0;

// ============== LD2450 Frame Parser ==============
// Decode signed 16-bit from LD2450 (bit 15 = sign, bits 0-14 = magnitude in mm)
static int16_t decodeLD2450Coord(uint8_t low, uint8_t high) {
  uint16_t raw = (uint16_t)low | ((uint16_t)high << 8);
  bool negative = (raw & 0x8000) != 0;
  int16_t magnitude = raw & 0x7FFF;
  return negative ? -magnitude : magnitude;
}

// Parse 3 targets from frame buffer
static void parseTargets(Target targets[3]) {
  for (int i = 0; i < 3; i++) {
    int offset = 4 + i * 8;  // Skip 4-byte header
    
    int16_t xMm   = decodeLD2450Coord(frameBuffer[offset + 0], frameBuffer[offset + 1]);
    int16_t yMm   = decodeLD2450Coord(frameBuffer[offset + 2], frameBuffer[offset + 3]);
    int16_t spdMm = decodeLD2450Coord(frameBuffer[offset + 4], frameBuffer[offset + 5]);
    // Resolution bytes at offset+6, offset+7 (not used)
    
    targets[i].xCm   = xMm / 10.0f;
    targets[i].yCm   = yMm / 10.0f;
    targets[i].spdCms = spdMm / 10.0f;
    targets[i].distCm = sqrtf(targets[i].xCm * targets[i].xCm + targets[i].yCm * targets[i].yCm);
    
    // Valid if distance > 0 and within range
    targets[i].valid = (targets[i].distCm >= DIST_MIN_CM && targets[i].distCm <= DIST_MAX_CM);
  }
}

// Read and parse LD2450 frames from UART
static bool readRadarFrame(Target targets[3]) {
  while (Serial2.available()) {
    uint8_t b = Serial2.read();
    
    // State machine for frame sync
    if (frameIdx == 0 && b == 0xAA) {
      frameBuffer[frameIdx++] = b;
    } else if (frameIdx == 1 && b == 0xFF) {
      frameBuffer[frameIdx++] = b;
    } else if (frameIdx == 2 && b == 0x03) {
      frameBuffer[frameIdx++] = b;
    } else if (frameIdx == 3 && b == 0x00) {
      frameBuffer[frameIdx++] = b;
    } else if (frameIdx >= 4 && frameIdx < FRAME_SIZE) {
      frameBuffer[frameIdx++] = b;
      
      if (frameIdx == FRAME_SIZE) {
        // Check footer
        if (frameBuffer[28] == 0x55 && frameBuffer[29] == 0xCC) {
          parseTargets(targets);
          frameIdx = 0;
          return true;
        }
        frameIdx = 0;  // Invalid frame, reset
      }
    } else {
      frameIdx = 0;  // Lost sync, reset
      if (b == 0xAA) {
        frameBuffer[frameIdx++] = b;
      }
    }
  }
  return false;
}

// ============== Battery ==============
static float readBatteryVoltage() {
  analogReadResolution(12);
  analogSetPinAttenuation(ADC_BATT_PIN, ADC_11db);
  uint32_t acc = 0;
  for (int i = 0; i < VOLT_SAMPLES; ++i) {
    delayMicroseconds(150);
    acc += analogReadMilliVolts(ADC_BATT_PIN);
  }
  return (acc / (float)VOLT_SAMPLES / 1000.0f) * VOLT_DIV_RATIO;
}

static void updateBattery(uint32_t now) {
  if (g_lastBattMs == 0 || (now - g_lastBattMs) >= VOLT_READ_PERIOD_MS) {
    g_lastBattMs = now;
    g_battV = readBatteryVoltage();
  }
}

// ============== Trajectory ==============
static void trajUpdate(float distCm) {
  if (isnan(prevRawDistCm)) return;

  float step = distCm - prevRawDistCm;
  if (fabsf(step) < TRAJ_NOISE_CM) return;

  if (isnan(trajStartDistCm)) {
    trajStartDistCm = distCm;
    trajNetCm  = 0.0f;
    trajFrames = 0;
    return;
  }

  trajNetCm = distCm - trajStartDistCm;
  if (trajFrames < 255) trajFrames++;
}

static void trajReset() {
  trajStartDistCm = NAN;
  trajNetCm  = 0.0f;
  trajFrames = 0;
}

static bool trajValid() {
  return (trajFrames >= MIN_TRAJ_FRAMES) && (fabsf(trajNetCm) >= MIN_TRAJ_NET_CM);
}

static bool jumpGuard(float distCm) {
  if (isnan(lastRawDistCm)) return true;
  return fabsf(distCm - lastRawDistCm) <= JUMP_MAX_CM;
}

// ============== Filter Lock Detection ==============
static void checkFiltStable(uint32_t now) {
  if (!presenceState || !filtInit) {
    filtLastMoveMs  = now;
    filtPrevSnapCm  = distFiltCm;
    return;
  }
  if (isnan(filtPrevSnapCm)) {
    filtPrevSnapCm = distFiltCm;
    filtLastMoveMs = now;
    return;
  }
  if (fabsf(distFiltCm - filtPrevSnapCm) > FILT_STABLE_THRESH_CM) {
    filtPrevSnapCm = distFiltCm;
    filtLastMoveMs = now;
  } else if ((now - filtLastMoveMs) > FILT_STABLE_LOCK_MS) {
    Serial.println("[TRAJ] Filtre bloque => reset presence");
    presenceState = false;
    filtInit      = false;
    validStreak   = 0;
    trajReset();
    filtLastMoveMs = now;
    filtPrevSnapCm = NAN;
  }
}

// ============== EMA Filter ==============
static void onGoodMeasurement(float xCm, float yCm, float distCm, float spdCms) {
  if (!filtInit) {
    filtInit   = true;
    xFiltCm    = xCm;
    yFiltCm    = yCm;
    distFiltCm = distCm;
    spdFiltCms = spdCms;
  } else {
    xFiltCm    += DIST_ALPHA * (xCm    - xFiltCm);
    yFiltCm    += DIST_ALPHA * (yCm    - yFiltCm);
    distFiltCm += DIST_ALPHA * (distCm - distFiltCm);
    spdFiltCms += SPD_ALPHA  * (spdCms - spdFiltCms);
  }
  lastGoodMs = millis();
}

// ============== Target Selection ==============
static bool pickBestTarget(Target targets[3], float& outX, float& outY, float& outDist, float& outSpd) {
  float bestScore = -1.0f;
  bool found = false;

  for (int i = 0; i < 3; i++) {
    if (!targets[i].valid) continue;

    float score = fabsf(targets[i].spdCms) * 10.0f + (DIST_MAX_CM - targets[i].distCm);
    if (score > bestScore) {
      bestScore = score;
      outX    = targets[i].xCm;
      outY    = targets[i].yCm;
      outDist = targets[i].distCm;
      outSpd  = targets[i].spdCms;
      found   = true;
    }
  }
  return found;
}

// ============== Radar Frame Handler ==============
static void handleRadarFrame(Target targets[3]) {
  float xCm = 0, yCm = 0, distCm = 0, spdCms = 0;
  bool haveTarget = pickBestTarget(targets, xCm, yCm, distCm, spdCms);

  if (!haveTarget) {
    validStreak = 0;
    trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    prevRawDistCm = lastRawDistCm;
    lastRawDistCm = NAN;
    lastRawXCm = lastRawYCm = NAN;
    return;
  }

  if (!jumpGuard(distCm)) {
    validStreak = 0;
    trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  bool posDelta = false;
  if (!isnan(lastRawXCm) && !isnan(lastRawYCm)) {
    float dx = fabsf(xCm - lastRawXCm);
    float dy = fabsf(yCm - lastRawYCm);
    posDelta = (dx >= POS_DELTA_MIN_CM || dy >= POS_DELTA_MIN_CM);
  }

  bool spdMoves = (fabsf(spdCms) >= SPD_MIN_CMS);
  bool moves    = spdMoves || posDelta;

  prevRawDistCm = lastRawDistCm;
  lastRawDistCm = distCm;
  lastRawXCm    = xCm;
  lastRawYCm    = yCm;

  if (!moves) {
    validStreak = 0;
    trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  trajUpdate(distCm);

  if (!trajValid()) {
    return;
  }

  if (!presenceState) {
    bool fastEnough = (fabsf(spdCms) >= SPD_ENTRY_CMS);
    bool longEnough = (fabsf(trajNetCm) >= TRAJ_ENTRY_NET_CM);
    if (!fastEnough && !longEnough) return;
  }

  invalidStreak = 0;

  bool fastPass = (fabsf(spdCms) >= FAST_SPD_CMS);
  if (validStreak < 255) validStreak++;

  uint8_t need = fastPass ? 1 : VALID_STREAK_ON;
  if (validStreak >= need) {
    presenceState = true;
    onGoodMeasurement(xCm, yCm, distCm, spdCms);
  }
}

// ============== LoRa Callbacks ==============
static void OnTxDone()    { Radio.Standby(); }
static void OnTxTimeout() { Radio.Standby(); }

// ============== SETUP ==============
void setup() {
  Serial.begin(115200);
  delay(600);

  Serial.println();
  Serial.println("--- THEIA TX LD2450 (no lib) ---");
  Serial.printf("TX_ID=%s  RX=%d TX=%d\n", TX_ID, RADAR_UART_RX, RADAR_UART_TX);

  // Radar UART
  Serial2.begin(RADAR_BAUD, SERIAL_8N1, RADAR_UART_RX, RADAR_UART_TX);

  // LoRa
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  RadioEvents.TxDone    = OnTxDone;
  RadioEvents.TxTimeout = OnTxTimeout;
  Radio.Init(&RadioEvents);
  Radio.SetChannel(LORA_FREQ);
  Radio.SetTxConfig(MODEM_LORA,
                    14, 0, 0,
                    7, 1, 8,
                    false, true, 0, 0,
                    false, 3000);
  Radio.Standby();
  Serial.println("[LORA] OK");

  // Batterie init
  uint32_t now = millis();
  updateBattery(now);
  filtLastMoveMs = now;
  lastSendMs     = now;
  lastBeatMs     = now;

  Serial.println("[BOOT] setup done");
}

// ============== LOOP ==============
void loop() {
  const uint32_t now = millis();

  updateBattery(now);

  // Read radar frames
  Target targets[3];
  if (readRadarFrame(targets)) {
    handleRadarFrame(targets);
  }

  checkFiltStable(now);

  bool present = presenceState
                 && (lastGoodMs != 0)
                 && (now - lastGoodMs <= PRESENCE_HOLD_MS);

  // Beat debug 1x/s
  if (now - lastBeatMs >= 1000) {
    lastBeatMs = now;
    Serial.printf("[BEAT] present=%d state=%d dist=%.1fcm spd=%.1fcm/s x=%.1f y=%.1f v=%u iv=%u net=%.1f/%u\n",
                  present ? 1 : 0,
                  presenceState ? 1 : 0,
                  distFiltCm,
                  spdFiltCms,
                  xFiltCm,
                  yFiltCm,
                  (unsigned)validStreak,
                  (unsigned)invalidStreak,
                  trajNetCm,
                  (unsigned)trajFrames);
  }

  // Envoi LoRa 1x/s
  if (now - lastSendMs >= SEND_PERIOD_MS) {
    lastSendMs = now;

    if (!present) {
      snprintf(txpacket, BUFFER_SIZE,
               "LD45;%s;0;0;0;0;%.2f",
               TX_ID, g_battV);
      Serial.printf("[SEND] out=0 batt=%.2f => %s\n", g_battV, txpacket);
    } else {
      int xCm  = (int)lroundf(xFiltCm);
      int yCm  = (int)lroundf(yFiltCm);
      int dCm  = (int)lroundf(distFiltCm);
      int vCms = (int)lroundf(spdFiltCms);

      dCm = constrain(dCm, 20, 600);

      snprintf(txpacket, BUFFER_SIZE,
               "LD45;%s;%d;%d;%d;%d;%.2f",
               TX_ID, xCm, yCm, dCm, vCms, g_battV);
      Serial.printf("[SEND] out=1 x=%d y=%d d=%d v=%d batt=%.2f => %s\n",
                    xCm, yCm, dCm, vCms, g_battV, txpacket);
    }

    Radio.Standby();
    Radio.Send((uint8_t*)txpacket, strlen(txpacket));
  }

  Radio.IrqProcess();
  delay(5);
}
