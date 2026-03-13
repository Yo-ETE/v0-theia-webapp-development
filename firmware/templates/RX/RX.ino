// THEIA - RX LoRa Multi-TX (LD45) + OLED
// Affichage 3 TX par page, defilement auto toutes les 4s
// Bouton PRG : page suivante manuelle
// Fix presence : timeout strict par TX

#include <Arduino.h>
#include "LoRaWan_APP.h"
#include <Wire.h>
#include "HT_SSD1306Wire.h"
#include <math.h>

// =================== CONFIG ===================
#define ADC_BATT_PIN        4
#define VOLT_SAMPLES        8
#define VOLT_READ_PERIOD    1000UL
#define VOLT_DIV_RATIO      5.0f

#define BUFFER_SIZE         128
#define PRESENCE_TIMEOUT    3000UL   // ms sans paquet -> presence OFF
#define RSSI_TIMEOUT        5000UL
#define RSSI_SMOOTHING      6

#define PRES_ON_DIST        20
#define PRES_OFF_DIST       12

#define BUTTON_PRG          0
#define DEBOUNCE_DELAY      200UL

#define ANG_DEAD_DEG        30.0f
#define MIRROR_X            false

#define MAX_TX              8
#define TX_ID_LEN           8
#define TX_PER_PAGE         3
#define PAGE_AUTO_MS        4000UL   // defilement auto toutes les 4s
// =============================================

static char rxpacket[BUFFER_SIZE];
static int16_t Rssi = -120;
static bool receiveFlag = false;
static bool everReceived = false;
static unsigned long lastRssiUpdateMillis = 0;

SSD1306Wire screen(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);
static RadioEvents_t RadioEvents;

static float         g_battVoltage = 0.0f;
static unsigned long g_lastBattMs  = 0;

static int16_t rssiBuffer[RSSI_SMOOTHING];
static uint8_t rssiIndex = 0;
static bool rssiUpdated = false;

static bool lastBtn = HIGH;
static unsigned long lastBtnMs = 0;
static unsigned long lastPageFlipMs = 0;
static int currentPage = 0;

// ========= Utils =========
static int batteryPercentFromVoltage(float v) {
  const float V[] = {3.30f,3.50f,3.60f,3.70f,3.80f,3.85f,3.95f,4.10f,4.20f};
  const int   P[] = {0,10,20,30,50,60,75,92,100};
  if (v <= V[0]) return 0;
  if (v >= V[8]) return 100;
  for (int i = 0; i < 8; ++i) {
    if (v >= V[i] && v <= V[i+1]) {
      float t = (v - V[i]) / (V[i+1] - V[i]);
      return constrain((int)round(P[i] + t*(P[i+1]-P[i])), 0, 100);
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
  return (acc_mV / (float)VOLT_SAMPLES / 1000.0f) * VOLT_DIV_RATIO;
}

void VextON() { pinMode(Vext, OUTPUT); digitalWrite(Vext, LOW); }

static void updateRSSI(int16_t v) {
  rssiBuffer[rssiIndex] = v;
  rssiIndex = (rssiIndex + 1) % RSSI_SMOOTHING;
  rssiUpdated = true;
  lastRssiUpdateMillis = millis();
}
static int16_t getAverageRSSI() {
  int32_t s = 0;
  for (int i = 0; i < RSSI_SMOOTHING; i++) s += rssiBuffer[i];
  return (int16_t)(s / RSSI_SMOOTHING);
}

static char classifyDir(float a) {
  if (MIRROR_X) a = -a;
  if (a >=  ANG_DEAD_DEG) return 'D';
  if (a <= -ANG_DEAD_DEG) return 'G';
  return 'C';
}

// ========= Multi-TX state =========
struct TxState {
  bool used = false;
  char id[TX_ID_LEN] = {0};
  int x=0, y=0, d=0, v=0;
  float batt = NAN;
  char dir = '-';
  bool presence = false;
  unsigned long lastSeenMs = 0;
  unsigned long lastPresenceMs = 0;
  bool dInit = false;
  float dFilt = 0.0f;
  float txVoltFilt = NAN;
  int txPctShown = -1;
  int16_t rssi = -120;
};

static TxState txs[MAX_TX];

static int findOrAllocTx(const char* txid) {
  for (int i = 0; i < MAX_TX; i++)
    if (txs[i].used && strncmp(txs[i].id, txid, TX_ID_LEN) == 0) return i;
  for (int i = 0; i < MAX_TX; i++) {
    if (!txs[i].used) {
      txs[i] = TxState();
      txs[i].used = true;
      strncpy(txs[i].id, txid, TX_ID_LEN-1);
      txs[i].lastSeenMs = millis();
      return i;
    }
  }
  int oldest = 0;
  for (int i = 1; i < MAX_TX; i++)
    if (txs[i].lastSeenMs < txs[oldest].lastSeenMs) oldest = i;
  txs[oldest] = TxState();
  txs[oldest].used = true;
  strncpy(txs[oldest].id, txid, TX_ID_LEN-1);
  txs[oldest].lastSeenMs = millis();
  return oldest;
}

static int countTxUsed() {
  int c=0;
  for (int i=0;i<MAX_TX;i++) if (txs[i].used) c++;
  return c;
}

static int totalPages() {
  int n = countTxUsed();
  return max(1, (n + TX_PER_PAGE - 1) / TX_PER_PAGE);
}

static int getPageTxIndices(int page, int* out, int maxOut) {
  int found = 0;
  int slot = 0;
  for (int i = 0; i < MAX_TX && found < maxOut; i++) {
    if (!txs[i].used) continue;
    if (slot >= page * TX_PER_PAGE && slot < (page+1) * TX_PER_PAGE) {
      out[found++] = i;
    }
    slot++;
  }
  return found;
}

// ========= Parser LD45 =========
static bool parseLD45(const char* s, char* outTxId, int& x, int& y, int& d, int& v, float& batt) {
  char buf[BUFFER_SIZE];
  strncpy(buf, s, BUFFER_SIZE-1);
  buf[BUFFER_SIZE-1] = '\0';
  const int MAXP = 8;
  char* parts[MAXP];
  int n = 0;
  char* tok = strtok(buf, ";");
  while (tok && n < MAXP) { parts[n++] = tok; tok = strtok(nullptr, ";"); }
  if (n < 5 || strcmp(parts[0], "LD45") != 0) return false;

  batt = NAN;
  outTxId[0] = '\0';

  auto isInt = [](const char* p)->bool {
    if (!p || !*p) return false;
    const char* q = (*p=='-') ? p+1 : p;
    if (!*q) return false;
    while (*q) { if (*q<'0'||*q>'9') return false; q++; }
    return true;
  };

  if (n == 5) {
    if (!isInt(parts[1])) return false;
    x=atoi(parts[1]); y=atoi(parts[2]); d=atoi(parts[3]); v=atoi(parts[4]);
    return true;
  }
  if (n == 6) {
    if (isInt(parts[1])) {
      x=atoi(parts[1]); y=atoi(parts[2]); d=atoi(parts[3]); v=atoi(parts[4]);
      batt=atof(parts[5]);
    } else {
      strncpy(outTxId, parts[1], TX_ID_LEN-1);
      x=atoi(parts[2]); y=atoi(parts[3]); d=atoi(parts[4]); v=atoi(parts[5]);
    }
    return true;
  }
  if (n >= 7) {
    strncpy(outTxId, parts[1], TX_ID_LEN-1);
    outTxId[TX_ID_LEN-1] = '\0';
    x=atoi(parts[2]); y=atoi(parts[3]); d=atoi(parts[4]); v=atoi(parts[5]);
    batt=atof(parts[6]);
    return true;
  }
  return false;
}

// ========= Radio callback =========
void OnRxDone(uint8_t *payload, uint16_t size, int16_t rssi, int8_t) {
  uint16_t n = min<uint16_t>(size, BUFFER_SIZE-1);
  memcpy(rxpacket, payload, n);
  rxpacket[n] = '\0';
  Rssi = rssi;
  updateRSSI(rssi);
  receiveFlag = true;
  Radio.Sleep();
}

// ========= Setup =========
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  pinMode(BUTTON_PRG, INPUT_PULLUP);
  VextON();
  delay(100);
  screen.init();
  screen.setFont(ArialMT_Plain_10);
  screen.clear();
  screen.drawString(0, 0, "THEIA RX Multi-TX");
  screen.drawString(0, 12, "Init...");
  screen.display();
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  RadioEvents.RxDone = OnRxDone;
  Radio.Init(&RadioEvents);
  Radio.SetChannel(868000000);
  Radio.SetRxConfig(MODEM_LORA, 0, 7, 1, 0, 8, 0, false, 0, true, 0, 0, false, true);
  Radio.Rx(0);
  pinMode(LED, OUTPUT);
  digitalWrite(LED, LOW);
  for (int i = 0; i < RSSI_SMOOTHING; i++) rssiBuffer[i] = -100;
  g_battVoltage = readBatteryVoltage();
  g_lastBattMs  = millis();
  lastPageFlipMs = millis();
  delay(300);
  screen.clear();
  screen.display();
}

// ========= Loop =========
void loop() {
  Radio.IrqProcess();
  const unsigned long now = millis();

  // ----- bouton : page suivante -----
  bool b = digitalRead(BUTTON_PRG);
  if (b == LOW && lastBtn == HIGH && (now - lastBtnMs) > DEBOUNCE_DELAY) {
    currentPage = (currentPage + 1) % totalPages();
    lastBtnMs = now;
    lastPageFlipMs = now;
    rssiUpdated = true;
  }
  lastBtn = b;

  // ----- defilement auto -----
  if (totalPages() > 1 && (now - lastPageFlipMs) >= PAGE_AUTO_MS) {
    currentPage = (currentPage + 1) % totalPages();
    lastPageFlipMs = now;
    rssiUpdated = true;
  }

  // ----- batterie RX -----
  if (now - g_lastBattMs >= VOLT_READ_PERIOD) {
    g_lastBattMs  = now;
    g_battVoltage = readBatteryVoltage();
    rssiUpdated = true;
  }

  // ----- RX packet -----
  if (receiveFlag) {
    receiveFlag = false;
    everReceived = true;

    char txid[TX_ID_LEN] = {0};
    int x=0, y=0, d=0, v=0;
    float vbattTX = NAN;

    if (parseLD45(rxpacket, txid, x, y, d, v, vbattTX)) {
      if (txid[0] == '\0') strncpy(txid, "LEG", TX_ID_LEN-1);

      int idx = findOrAllocTx(txid);
      TxState &T = txs[idx];
      T.lastSeenMs = now;
      T.rssi = Rssi;

      bool isGravityMW = (x==0 && y==0 && d==1 && v==0);
      bool isAbsence   = (x==0 && y==0 && d==0 && v==0);

      if (isGravityMW) {
        T.presence = true;
        T.lastPresenceMs = now;
        T.x=0; T.y=0; T.v=0; T.dir='C';
        T.d = 1;  // conserve le marqueur d=1 pour le Pi
      } else if (isAbsence) {
        T.presence = false;
        T.d = 0;
      } else {
        float angle = atan2f((float)x, (float)y) * 180.0f / PI;
        if (!T.dInit) { T.dFilt=(float)d; T.dInit=true; }
        else T.dFilt = 0.60f*T.dFilt + 0.40f*(float)d;
        int dShow = (int)roundf(T.dFilt);
        bool pres = T.presence ? (dShow >= PRES_OFF_DIST) : (d >= PRES_ON_DIST);
        if (pres) {
          T.presence = true;
          T.lastPresenceMs = now;
          T.dir = classifyDir(angle);
          T.x=x; T.y=y; T.d=dShow; T.v=v;
        } else {
          T.presence = false;
        }
      }

      if (!isnan(vbattTX)) {
        if (isnan(T.txVoltFilt)) T.txVoltFilt = vbattTX;
        else T.txVoltFilt = 0.75f*T.txVoltFilt + 0.25f*vbattTX;
        int pct = batteryPercentFromVoltage(T.txVoltFilt);
        int quant = ((pct+1)/2)*2;
        if (T.txPctShown < 0 || abs(quant-T.txPctShown) >= 2) T.txPctShown = quant;
        T.batt = vbattTX;
      }

      // d brut (pas T.d) pour que le Pi recoive d=1 sur gravity_mw
      Serial.printf("[RX] %s | x=%d y=%d d=%d v=%d rssi=%d battTX=%s\n",
                    T.id, x, y, d, v, T.rssi,
                    isnan(vbattTX) ? "--" : String(vbattTX,2).c_str());
    }
    Radio.Rx(0);
  }

  // ----- timeout presence strict par TX -----
  for (int i=0; i<MAX_TX; i++) {
    if (!txs[i].used || !txs[i].presence) continue;
    if (now - txs[i].lastPresenceMs > PRESENCE_TIMEOUT) {
      txs[i].presence = false;
    }
  }

  // ----- LED : presence sur au moins un TX de la page courante -----
  bool anyPres = false;
  int pageIdx[TX_PER_PAGE];
  int cnt = getPageTxIndices(currentPage, pageIdx, TX_PER_PAGE);
  for (int i=0; i<cnt; i++) if (txs[pageIdx[i]].presence) anyPres = true;
  digitalWrite(LED, anyPres ? HIGH : LOW);

  // ----- affichage -----
  static unsigned long lastUiMs = 0;
  if (rssiUpdated || everReceived || (now - lastUiMs > 250)) {
    rssiUpdated = false;
    lastUiMs = now;
    screen.clear();

    // Header : RSSI global + batt RX + numero de page
    int16_t avgRssi = (millis()-lastRssiUpdateMillis > RSSI_TIMEOUT) ? -120 : getAverageRSSI();
    String header = (avgRssi == -120) ? "RSSI:-- " : ("R:" + String(avgRssi) + " ");
    header += "RX:" + String(batteryPercentFromVoltage(g_battVoltage)) + "%";
    header += " P" + String(currentPage+1) + "/" + String(totalPages());
    screen.drawString(0, 0, header);

    screen.drawLine(0, 11, 127, 11);

    if (!everReceived) {
      screen.drawString(0, 20, "Attente trames...");
    } else {
      int indices[TX_PER_PAGE];
      int n = getPageTxIndices(currentPage, indices, TX_PER_PAGE);

      for (int i = 0; i < n; i++) {
        TxState &T = txs[indices[i]];
        int yBase = 13 + i * 17;

        String line1 = String(T.id) + ": " + (T.presence ? "OUI " : "non ");
        if (T.presence) {
          if (T.d > 1)
            line1 += String(T.d) + "cm " + String(T.dir);
          else
            line1 += "MW";
        }
        screen.drawString(0, yBase, line1);

        String line2 = "R:" + String(T.rssi) + " ";
        line2 += (T.txPctShown >= 0) ? ("B:" + String(T.txPctShown) + "%") : "B:--";
        unsigned long ageS = (now - T.lastSeenMs) / 1000UL;
        line2 += " " + String(ageS) + "s";
        screen.drawString(0, yBase + 8, line2);
      }

      if (n == 0) screen.drawString(0, 20, "Aucun TX p." + String(currentPage+1));
    }

    screen.display();
  }

  delay(10);
}
