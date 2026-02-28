/**
 * THEIA TX — Heltec ESP32-S3 LoRa (LoRaWan_APP) + DFRobot C4001 (UART)
 * -------------------------------------------------------------------
 * UART C4001 sur Serial1 (pins SAFE)
 * - RX ESP = GPIO5  (recoit TX du C4001)
 * - TX ESP = GPIO6  (envoie vers RX du C4001)
 *
 * Sortie LoRa (INCHANGEE):
 * - Absent : LD45;__TX_ID__;0;0;0;0;4.02
 * - Present: LD45;__TX_ID__;0;Y;D;V;4.02   (Y,D en cm ; V en cm/s)
 *
 * --- v2.2 : seuils assouplis pour passages normaux ---
 * Probleme v2 : trop restrictif, passages normaux rates
 * Causes identifiees :
 *   - MIN_TRAJ_NET_M trop eleve (0.25m) pour un couloir axial
 *   - MIN_TRAJ_FRAMES = 4 trop lent a accumuler
 *   - SPD_ENTRY_MIN_MPS = 0.18 bloquait les entrees a vitesse normale
 *   - VALID_STREAK_ON = 3 ajoutait encore du delai
 * Equilibre : on garde l'anti-fantome mais on abaisse les seuils
 *
 * NOTE: __TX_ID__ is automatically replaced by the webapp during flash.
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
#define ADC_BATT_PIN     4
#define VOLT_SAMPLES     8
#define VOLT_DIV_RATIO   5.0f

// --- LoRa ---
#define LORA_FREQ        868000000
#define SEND_PERIOD_MS   1000UL

// --- Presence / filtrage ---
#define PRESENCE_HOLD_MS 2000UL     // +500ms vs v2: moins de coupures
#define DIST_ALPHA       0.25f

// --- Garde-fous distance ---
#define DIST_MIN_M        0.30f
#define DIST_MAX_M       16.00f

// --- Mouvement / sensibilite ---
#define SPD_MIN_MPS       0.10f     // abaisse (v2: 0.12)
#define RAW_DELTA_MOVE_M  0.10f     // abaisse (v2: 0.12)
#define FILT_DELTA_MOVE_M 0.15f     // abaisse (v2: 0.18)

// --- Anti-fantome spd ~ 0 ---
#define SPD_ZERO_MPS      0.06f
#define RAW_DELTA_MIN_M   0.05f
#define ECHO_HOLD_MIN_M   0.30f

// --- Trajectoire NETTE ---
// Assouplie par rapport a v2 pour ne pas rater les passages normaux
// Un echo fixe oscillant +/-4cm => trajNetM ~ 0 => toujours bloque
// Un passage normal a 0.8m/s => 12cm net en 2 trames => passe
#define MIN_TRAJ_NET_M         0.12f   // abaisse (v2: 0.25m) — 12cm net suffit
#define MIN_TRAJ_FRAMES        2       // abaisse (v2: 4) — 2 trames suffisent
#define TRAJ_STEP_NOISE_M      0.04f   // inchange

// --- Seuil d'entree (assoupli) ---
#define SPD_ENTRY_MIN_MPS      0.14f   // abaisse (v2: 0.18)
#define ENTRY_TRAJ_NET_M       0.12f   // abaisse (v2: 0.25)

// --- Filtre bloque ---
#define FILT_STABLE_THRESH_M   0.04f
#define FILT_STABLE_LOCK_MS    5000UL

// --- Reset inactivite (FIX inactivite) ---
// Si aucune mesure valide depuis X ms => reset complet de l'etat
// Evite que trajStartDistM, filtres, streaks restent sur d'anciennes valeurs
#define INACTIVITY_RESET_MS    10000UL

// --- Anti-sauts ---
#define JUMP_MAX_M        2.50f
#define SPIKE_DIST_M      1.20f
#define SPIKE_SPD_MPS     0.75f

// --- Streaks ---
#define VALID_STREAK_ON   2       // abaisse (v2: 3)
#define VALID_STREAK_OFF  2
#define SPD_FAST_MPS      0.50f   // abaisse (v2: 0.60) => fast streak plus facile
#define FAST_STREAK_ON    1

// --- Mapping LD45 ---
#define X_CM_WHEN_PRESENT  0
#define Y_MIN_CM           20
#define Y_MAX_CM           2500
// ===================================================

// UART radar
HardwareSerial RadarSerial(1);
static String radarLine;

// Etat / filtres
static bool     filtInit = false;
static float    distFiltM = 0.0f;
static float    spdFiltMps = 0.0f;

// Historique brut
static float    lastRawDistM = NAN;
static float    prevRawDistM = NAN;

// Streaks
static uint8_t  validStreak = 0;

// Trajectoire NETTE
static float    trajStartDistM = NAN;
static float    trajNetM = 0.0f;
static uint8_t  trajFrames = 0;

// Filtre bloque
static float    filtPrevSnapshotM = NAN;
static uint32_t filtLastMoveMs = 0;

// Etat presence stable
static bool     presenceState = false;
static uint8_t  invalidStreak = 0;
static float    lastAcceptedDistM = NAN;

static uint32_t lastGoodMs = 0;
static uint32_t lastSendMs = 0;
static uint32_t lastBeatMs = 0;

// LoRa
static RadioEvents_t RadioEvents;

// ------------------ Batterie ------------------
static float readBatteryVoltage() {
  analogReadResolution(12);
  analogSetPinAttenuation(ADC_BATT_PIN, ADC_11db);
  uint32_t acc = 0;
  for (int i = 0; i < VOLT_SAMPLES; ++i) {
    delayMicroseconds(150);
    acc += analogReadMilliVolts(ADC_BATT_PIN);
  }
  float v_pin = (acc / (float)VOLT_SAMPLES) / 1000.0f;
  return v_pin * VOLT_DIV_RATIO;
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

// ------------------ Anti-spike ------------------
static bool spikeGuard(float distM, float spdMps) {
  float v = fabsf(spdMps);
  if (!presenceState) {
    if (!isnan(lastRawDistM)) {
      float jump = fabsf(distM - lastRawDistM);
      if (jump > 1.50f && v < 0.10f) return false;
    }
    return true;
  }
  if (!isnan(lastAcceptedDistM)) {
    float d = fabsf(distM - lastAcceptedDistM);
    if (d > SPIKE_DIST_M && v < SPIKE_SPD_MPS) return false;
  }
  return true;
}

// ------------------ Trajectoire NETTE ------------------
static void trajUpdate(float distM) {
  if (isnan(trajStartDistM)) {
    trajStartDistM = distM;
    trajNetM = 0.0f;
    trajFrames = 0;
    return;
  }
  float step = distM - prevRawDistM;
  if (fabsf(step) < TRAJ_STEP_NOISE_M) return;
  trajNetM = distM - trajStartDistM;
  if (trajFrames < 255) trajFrames++;
}

static void trajReset() {
  trajStartDistM = NAN;
  trajNetM = 0.0f;
  trajFrames = 0;
}

static bool trajValid() {
  return (trajFrames >= MIN_TRAJ_FRAMES) && (fabsf(trajNetM) >= MIN_TRAJ_NET_M);
}

// ------------------ Accept measurement ------------------
static bool acceptMeasurement(float distM, float spdMps) {
  if (distM < DIST_MIN_M || distM > DIST_MAX_M) return false;

  float spdAbs = fabsf(spdMps);

  if (!isnan(lastRawDistM)) {
    float jump = fabsf(distM - lastRawDistM);
    if (jump > JUMP_MAX_M) return false;
  }

  bool rawDeltaMove = false;
  if (!isnan(prevRawDistM)) {
    rawDeltaMove = (fabsf(distM - prevRawDistM) >= RAW_DELTA_MOVE_M);
  }

  // 1) spd ~ 0 + stable => echo fixe
  bool spdZero = (spdAbs < SPD_ZERO_MPS);
  if (spdZero && !isnan(prevRawDistM)) {
    float dRaw = fabsf(distM - prevRawDistM);
    if (dRaw < RAW_DELTA_MIN_M) {
      if (filtInit && fabsf(distM - distFiltM) < ECHO_HOLD_MIN_M) return false;
      return false;
    }
  }

  // 2) Echo fixe (proche filtre + pas de mouvement)
  if (filtInit) {
    bool closeToFilt = (fabsf(distM - distFiltM) < 0.20f);
    bool noMove      = (spdAbs < SPD_MIN_MPS) && (!rawDeltaMove);
    if (closeToFilt && noMove) return false;
  }

  // 3) Regle principale
  if (spdAbs >= SPD_MIN_MPS) return true;
  if (rawDeltaMove) return true;

  // 4) Tres lent: sortie du filtre
  if (filtInit) {
    float need = presenceState ? (FILT_DELTA_MOVE_M * 0.8f) : FILT_DELTA_MOVE_M;
    if (fabsf(distM - distFiltM) >= need) return true;
  }

  return false;
}

// ------------------ Filtre bloque ------------------
static void checkFiltStable(uint32_t now) {
  if (!presenceState || !filtInit) {
    filtLastMoveMs = now;
    filtPrevSnapshotM = distFiltM;
    return;
  }
  if (isnan(filtPrevSnapshotM)) {
    filtPrevSnapshotM = distFiltM;
    filtLastMoveMs = now;
    return;
  }
  if (fabsf(distFiltM - filtPrevSnapshotM) > FILT_STABLE_THRESH_M) {
    filtPrevSnapshotM = distFiltM;
    filtLastMoveMs = now;
  } else if ((now - filtLastMoveMs) > FILT_STABLE_LOCK_MS) {
    Serial.println("[TRAJ] Filtre bloque => reset presence (echo fixe)");
    presenceState = false;
    filtInit = false;
    validStreak = 0;
    trajReset();
    filtLastMoveMs = now;
    filtPrevSnapshotM = NAN;
  }
}

// ------------------ Reset inactivite (FIX) ------------------
// Appele dans loop(). Si le radar ne produit plus rien depuis
// INACTIVITY_RESET_MS, on remet TOUT a zero proprement.
// => La prochaine detection repart d'un etat sain.
static void checkInactivity(uint32_t now) {
  if (presenceState) return;  // si presence active, pas de reset

  bool noActivity = (lastGoodMs == 0) ||
                    ((now - lastGoodMs) > INACTIVITY_RESET_MS);

  if (noActivity && filtInit) {
    Serial.println("[INACT] Reset complet etat (inactivite prolongee)");
    filtInit          = false;
    distFiltM         = 0.0f;
    spdFiltMps        = 0.0f;
    lastRawDistM      = NAN;
    prevRawDistM      = NAN;
    validStreak       = 0;
    invalidStreak     = 0;
    lastAcceptedDistM = NAN;
    filtPrevSnapshotM = NAN;
    filtLastMoveMs    = now;
    trajReset();
  }
}

static void onGoodMeasurement(float distM, float spdMps) {
  const uint32_t now = millis();
  if (!filtInit) {
    filtInit = true;
    distFiltM = distM;
    spdFiltMps = spdMps;
  } else {
    distFiltM  += DIST_ALPHA * (distM  - distFiltM);
    spdFiltMps += DIST_ALPHA * (spdMps - spdFiltMps);
  }
  lastGoodMs = now;
}

// ------------------ Radar parse ------------------
static void handleRadarSentence(const String& s) {
  if (!s.startsWith("$DFDMD")) return;

  String f1 = csvField(s, 1);
  String f3 = csvField(s, 3);
  String f4 = csvField(s, 4);
  if (!f1.length() || !f3.length() || !f4.length()) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  int n = f1.toInt();
  if (n <= 0) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  float distM  = f3.toFloat();
  float spdMps = f4.toFloat();

  if (distM <= 0.0f) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  if (distM < DIST_MIN_M || distM > DIST_MAX_M) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    prevRawDistM = lastRawDistM;
    lastRawDistM = distM;
    return;
  }

  if (!spikeGuard(distM, spdMps)) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    prevRawDistM = lastRawDistM;
    lastRawDistM = distM;
    return;
  }

  bool ok = acceptMeasurement(distM, spdMps);

  prevRawDistM = lastRawDistM;
  lastRawDistM = distM;

  if (ok) trajUpdate(distM);

  if (!ok) {
    validStreak = 0; trajReset();
    if (invalidStreak < 255) invalidStreak++;
    if (invalidStreak >= VALID_STREAK_OFF) presenceState = false;
    return;
  }

  if (!trajValid()) return;  // accumule silencieusement

  // Seuil d'entree
  if (!presenceState) {
    bool spdOk  = (fabsf(spdMps) >= SPD_ENTRY_MIN_MPS);
    bool trajOk = (fabsf(trajNetM) >= ENTRY_TRAJ_NET_M);
    if (!spdOk && !trajOk) return;
  }

  invalidStreak = 0;

  bool fastPass = (fabsf(spdMps) >= SPD_FAST_MPS);
  if (validStreak < 255) validStreak++;

  uint8_t need = fastPass ? FAST_STREAK_ON : VALID_STREAK_ON;
  if (validStreak >= need) {
    presenceState = true;
    lastAcceptedDistM = distM;
    onGoodMeasurement(distM, spdMps);
  }
}

// --- poll ---
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
      if (radarLine.length() > 220) radarLine = "";
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
  Serial.println("--- THEIA TX C4001 -> LoRa (LD45) v2.2 ---");
  Serial.printf("TX_ID=%s\n", TX_ID);
  Serial.printf("C4001 Serial1 RX=%d TX=%d baud=%d\n", C4001_RX_PIN, C4001_TX_PIN, C4001_BAUD);

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

  filtLastMoveMs = millis();
  lastSendMs = millis();
  lastBeatMs = millis();
  Serial.println("[BOOT] setup done");
}

void loop() {
  const uint32_t now = millis();

  radarPoll();
  checkFiltStable(now);
  checkInactivity(now);

  bool present = presenceState && (lastGoodMs != 0) && (now - lastGoodMs <= PRESENCE_HOLD_MS);

  if (now - lastBeatMs >= 1000) {
    lastBeatMs = now;
    Serial.printf("[BEAT] present=%d state=%d dist=%.3fm spd=%.3fm/s v=%u iv=%u last=%lums raw=%.2f prev=%.2f net=%.2f/%u\n",
                  present ? 1 : 0,
                  presenceState ? 1 : 0,
                  distFiltM, spdFiltMps,
                  (unsigned)validStreak,
                  (unsigned)invalidStreak,
                  lastGoodMs ? (unsigned long)(now - lastGoodMs) : 999999UL,
                  lastRawDistM, prevRawDistM,
                  trajNetM, (unsigned)trajFrames);
  }

  if (now - lastSendMs >= SEND_PERIOD_MS) {
    lastSendMs = now;

    float batt = readBatteryVoltage();
    String payload;

    if (!present) {
      payload = "LD45;" + String(TX_ID) + ";0;0;0;0;" + String(batt, 2);
      Serial.printf("[SEND] out=0 batt=%.2f => %s\n", batt, payload.c_str());
    } else {
      int distCm = (int)lround(distFiltM * 100.0f);
      int spdCms = (int)lround(spdFiltMps * 100.0f);
      distCm = constrain(distCm, Y_MIN_CM, Y_MAX_CM);

      payload = "LD45;" + String(TX_ID) + ";" + String(X_CM_WHEN_PRESENT) + ";" +
                String(distCm) + ";" + String(distCm) + ";" + String(spdCms) + ";" + String(batt, 2);

      Serial.printf("[SEND] out=1 dist=%dcm spd=%dcm/s batt=%.2f => %s\n",
                    distCm, spdCms, batt, payload.c_str());
    }

    loraSendLine(payload);
  }

  Radio.IrqProcess();
  delay(5);
}
