#include <LD2450.h>
#include "LoRaWan_APP.h"
#include "HT_SSD1306Wire.h"
#include <math.h>

// ------------ TX ID ------------
#define TX_ID "TX01"

// ------------ Radar (UART) ------------
#define RADAR_UART_RX 19
#define RADAR_UART_TX 21
#define RADAR_BAUD 115200

// ------------ Bouton / LED ------------
#define BUTTON_PRG 0

// ------------ Voltage sensor ------------
#define ADC_BATT_PIN        4
#define VOLT_SAMPLES        8
#define VOLT_READ_PERIOD    1000UL
#define VOLT_DIV_RATIO      5.0f

// ------------ UI ------------
#define UI_TOP_Y            0
#define UI_LINE1_Y         12
#define UI_LINE2_Y         24
#define UI_LINE3_Y         36

#define BUFFER_SIZE 96
char txpacket[BUFFER_SIZE];

LD2450 radar;
SSD1306Wire screen(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);

bool silentMode = false;
bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 200;

static float         g_battVoltage = 0.0f;
static unsigned long g_lastBattMs  = 0;

// =====================================================
// Anti-ghost : mediane + debounce ON/OFF
// =====================================================

// -- Temporisation --
#define PRESENCE_HOLD_MS     1200UL   // maintien apres derniere bonne mesure
#define CONFIRM_FRAMES       3        // [NEW] nb de frames "bons" consecutifs pour passer ON

// -- Fenetre mediane --
#define WIN_N               5
#define MED_TOL_CM          50        // [FIX] reduit de 80 a 50 (plus strict)
#define INLIERS_MIN         3

// -- Distance guard --
#define DIST_MIN_CM         15        // [NEW] ignore en-dessous (bruit capteur)
#define DIST_MAX_CM         600       // [NEW] ignore au-dela (fantomes lointains)

static bool presenceState = false;
static unsigned long lastGoodMs = 0;

// Buffer distances pour la mediane
static int dWin[WIN_N] = {0};
static int wIdx = 0;
static int wCount = 0;            // [NEW] nb de mesures reellement inserees

// [NEW] Compteur de frames bons consecutifs pour debounce ON
static int consecutiveGood = 0;

// Derniere mesure validee
static int  lastXcm = 0, lastYcm = 0, lastDcm = 0, lastV = 0;
static String lastDir = "--";

// =====================================================

static int batteryPercentFromVoltage(float v) {
  const float V[] = {3.30f, 3.50f, 3.60f, 3.70f, 3.80f, 3.85f, 3.95f, 4.10f, 4.20f};
  const int   P[] = {   0  ,   10 ,   20 ,   30 ,   50 ,   60 ,   75 ,   92 ,  100 };
  if (v <= V[0]) return 0;
  if (v >= V[8]) return 100;
  for (int i = 0; i < 8; ++i) {
    if (v >= V[i] && v <= V[i+1]) {
      float t = (v - V[i]) / (V[i+1] - V[i]);
      int pct = (int)round(P[i] + t * (P[i+1] - P[i]));
      return constrain(pct, 0, 100);
    }
  }
  return 0;
}

static float readBatteryVoltage() {
  analogSetPinAttenuation(ADC_BATT_PIN, ADC_11db);
  uint32_t acc_mV = 0;
  for (int i = 0; i < VOLT_SAMPLES; ++i) {
    delayMicroseconds(150);
    acc_mV += analogReadMilliVolts(ADC_BATT_PIN);
  }
  float v_pin = (acc_mV / (float)VOLT_SAMPLES) / 1000.0f;
  return v_pin * VOLT_DIV_RATIO;
}

static void drawRightAligned(int y, const String& text) {
  int16_t x = 128 - screen.getStringWidth(text);
  if (x < 0) x = 0;
  screen.drawString(x, y, text);
}

void VextON() { pinMode(Vext, OUTPUT); digitalWrite(Vext, LOW); }

void toggleSilent() {
  silentMode = !silentMode;
  if (silentMode) {
    screen.displayOff();
    digitalWrite(LED, LOW);
  } else {
    screen.displayOn();
  }
}

// [FIX] classifyDirection reset quand il n'y a plus de presence
// pour eviter que l'etat G/C/D "colle" entre deux detections
String classifyDirection(float angleDeg, bool reset) {
  const float ENTER_D = +30.0f, EXIT_D = +20.0f;
  const float ENTER_G = -30.0f, EXIT_G = -20.0f;
  const float CENTER_BAND = 20.0f;
  static String dir = "C";

  if (reset) { dir = "C"; return dir; }

  if (dir == "C") {
    if (angleDeg >= ENTER_D) dir = "D";
    else if (angleDeg <= ENTER_G) dir = "G";
  } else if (dir == "D") {
    if (angleDeg <= EXIT_D) dir = "C";
  } else if (dir == "G") {
    if (angleDeg >= EXIT_G) dir = "C";
  }
  if (fabs(angleDeg) <= CENTER_BAND) dir = "C";
  return dir;
}

static int16_t ld2450_decode_signed15(uint16_t raw) {
  if (raw & 0x8000) return (int16_t)(raw - 0x8000);
  return (int16_t)(- (int16_t)raw);
}

// --- tri insertion + mediane ---
static int medianOfArray(int* src, int n) {
  int a[WIN_N];
  for (int i = 0; i < n; i++) a[i] = src[i];
  for (int i = 1; i < n; i++) {
    int key = a[i], j = i - 1;
    while (j >= 0 && a[j] > key) { a[j+1] = a[j]; j--; }
    a[j+1] = key;
  }
  return a[n / 2];
}

static int getMedianWin() {
  int n = min(wCount, WIN_N);
  if (n == 0) return 0;
  return medianOfArray(dWin, n);
}

static int countInliers(int med) {
  int c = 0;
  int n = min(wCount, WIN_N);
  for (int i = 0; i < n; i++) {
    if (abs(dWin[i] - med) <= MED_TOL_CM) c++;
  }
  return c;
}

void setup() {
  Serial.begin(115200);

  Serial2.begin(RADAR_BAUD, SERIAL_8N1, RADAR_UART_RX, RADAR_UART_TX);
  radar.begin(Serial2, false);

  analogReadResolution(12);

  VextON();
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  Radio.Init(nullptr);
  Radio.SetChannel(868000000);
  Radio.SetTxConfig(MODEM_LORA, 10, 0, 0, 7, 1, 8, false, true, 0, 0, false, 3000);

  pinMode(LED, OUTPUT);
  digitalWrite(LED, LOW);
  pinMode(BUTTON_PRG, INPUT_PULLUP);

  screen.init();
  screen.setFont(ArialMT_Plain_10);
  screen.clear();
  screen.drawString(0, UI_TOP_Y, "LD2450 + LoRa TX");
  drawRightAligned(UI_TOP_Y, String(TX_ID));
  screen.drawString(0, UI_LINE1_Y, "Init...");
  screen.display();
  delay(500);

  g_battVoltage = readBatteryVoltage();
  g_lastBattMs  = millis();
  screen.clear();
  screen.display();
}

void loop() {
  // Bouton silencieux
  int reading = digitalRead(BUTTON_PRG);
  if (reading == LOW && lastButtonState == HIGH && (millis() - lastDebounceTime) > debounceDelay) {
    toggleSilent();
    lastDebounceTime = millis();
  }
  lastButtonState = reading;

  unsigned long now = millis();
  if (now - g_lastBattMs >= VOLT_READ_PERIOD) {
    g_lastBattMs  = now;
    g_battVoltage = readBatteryVoltage();
  }

  int targets = radar.read();

  bool haveCandidate = false;
  int candX = 0, candY = 0, candD = 0, candV = 0;
  String candDir = "--";

  // Premiere cible valide
  if (targets > 0) {
    for (int i = 0; i < targets; i++) {
      LD2450::RadarTarget t = radar.getTarget(i);
      if (!t.valid) continue;

      uint16_t rawX = (uint16_t)(int16_t)t.x;
      uint16_t rawY = (uint16_t)(int16_t)t.y;
      uint16_t rawS = (uint16_t)(int16_t)t.speed;

      int16_t x_mm = ld2450_decode_signed15(rawX);
      int16_t y_mm = ld2450_decode_signed15(rawY);
      int16_t v_cms = ld2450_decode_signed15(rawS);

      float d_mm_f = sqrtf((float)x_mm * (float)x_mm + (float)y_mm * (float)y_mm);
      int d_cm = (int)lroundf(d_mm_f / 10.0f);

      // [NEW] Filtre distance min/max -- ignore bruit et fantomes lointains
      if (d_cm < DIST_MIN_CM || d_cm > DIST_MAX_CM) continue;

      // [NEW] Filtre Y negatif -- le LD2450 ne voit que devant (y > 0)
      // Un y_mm negatif est un artefact
      if (y_mm < 50) continue;  // moins de 5mm devant = bruit

      int x_cm = x_mm / 10;
      int y_cm = y_mm / 10;

      float angle = atan2f((float)x_cm, (float)y_cm) * 180.0f / PI;
      candDir = classifyDirection(angle, false);

      candX = x_cm; candY = y_cm; candD = d_cm; candV = v_cms;
      haveCandidate = true;
      break;
    }
  }

  // --- Fenetre mediane ---
  // [FIX] Ne plus remplir toute la fenetre d'un coup au premier sample
  if (haveCandidate) {
    dWin[wIdx] = candD;
    wIdx = (wIdx + 1) % WIN_N;
    if (wCount < WIN_N) wCount++;
  } else {
    // Pas de candidate : inserer 9999 (sera rejete par inliers)
    dWin[wIdx] = 9999;
    wIdx = (wIdx + 1) % WIN_N;
    if (wCount < WIN_N) wCount++;
  }

  bool good = false;
  if (haveCandidate && wCount >= INLIERS_MIN) {
    int med = getMedianWin();
    int inl = countInliers(med);

    // Candidate proche de la mediane + assez d'inliers
    if (abs(candD - med) <= MED_TOL_CM && inl >= INLIERS_MIN) {
      good = true;
    }
  }

  // --- Machine a etats avec debounce ON ---
  if (good) {
    consecutiveGood++;
    lastXcm = candX; lastYcm = candY; lastDcm = candD; lastV = candV; lastDir = candDir;

    if (presenceState) {
      // Deja ON : rafraichir le timer
      lastGoodMs = now;
    } else {
      // Pas encore ON : attendre CONFIRM_FRAMES consecutifs
      if (consecutiveGood >= CONFIRM_FRAMES) {
        presenceState = true;
        lastGoodMs = now;
        Serial.printf("[TX %s] Presence CONFIRMED after %d frames\n", TX_ID, CONFIRM_FRAMES);
      }
    }
  } else {
    consecutiveGood = 0;  // reset le compteur des qu'un frame est mauvais

    if (presenceState && (now - lastGoodMs > PRESENCE_HOLD_MS)) {
      presenceState = false;
      // [FIX] Reset direction state machine pour la prochaine detection
      classifyDirection(0, true);
      Serial.printf("[TX %s] Presence OFF\n", TX_ID);
    }
  }

  // --- Envoi LoRa ---
  if (presenceState) {
    snprintf(txpacket, BUFFER_SIZE, "LD45;%s;%d;%d;%d;%d;%.2f",
             TX_ID, lastXcm, lastYcm, lastDcm, lastV, g_battVoltage);
    Radio.Send((uint8_t *)txpacket, strlen(txpacket));
    Serial.printf("[TX %s] %s (ON)\n", TX_ID, txpacket);
  } else {
    snprintf(txpacket, BUFFER_SIZE, "LD45;%s;0;0;0;0", TX_ID);
    Radio.Send((uint8_t *)txpacket, strlen(txpacket));
  }

  // --- OLED ---
  if (!silentMode) {
    screen.clear();
    screen.drawString(0, UI_TOP_Y, "LD2450 TX");
    drawRightAligned(UI_TOP_Y, String(TX_ID));
    drawRightAligned(UI_LINE1_Y, String(batteryPercentFromVoltage(g_battVoltage)) + "%");

    String status = presenceState ? "OUI" : (consecutiveGood > 0 ? String(consecutiveGood) + "/" + String(CONFIRM_FRAMES) : "non");
    screen.drawString(0, UI_LINE1_Y, "Presence: " + status);
    screen.drawString(0, UI_LINE2_Y, "D:" + String(lastDcm) + "cm V:" + String(lastV));
    screen.drawString(0, UI_LINE3_Y, "X:" + String(lastXcm) + " Y:" + String(lastYcm));
    screen.drawString(0, UI_LINE3_Y + 12, "Dir: " + lastDir + " G:" + String(consecutiveGood));
    screen.display();
  }

  digitalWrite(LED, (!silentMode && presenceState) ? HIGH : LOW);
  delay(200);
}
