// THEIA - TX Gravity MW V2 (SEN0192)
// Capteur micro-ondes presence-only

#include "LoRaWan_APP.h"
#include "Arduino.h"

#define TX_ID "__TX_ID__"

// =========================
// LoRa
// =========================
#define RF_FREQUENCY              868000000
#define TX_OUTPUT_POWER           14
#define LORA_BANDWIDTH            0
#define LORA_SPREADING_FACTOR     7
#define LORA_CODINGRATE           1
#define LORA_PREAMBLE_LENGTH      8
#define LORA_SYMBOL_TIMEOUT       0
#define LORA_FIX_LENGTH_PAYLOAD_ON false
#define LORA_IQ_INVERSION_ON      false

#define SEND_PERIOD_MS            1000UL

// =========================
// Pins
// =========================
#define MICROWAVE_PIN             26

// =========================
// Detection
// =========================
#define DETECT_ACTIVE_LOW         1
#define PRESENCE_LATCH_MS         500UL
#define FIXED_BATTERY_V           4.10f

static RadioEvents_t RadioEvents;
char txpacket[64];
bool txDone = true;
unsigned long lastSend = 0;
unsigned long lastDetectMs = 0;

// =========================
// Radio callbacks
// =========================
void onTxDone(void) {
  txDone = true;
  Serial.println("[LORA] TX done");
}

void onTxTimeout(void) {
  txDone = true;
  Serial.println("[LORA] TX timeout");
}

// =========================
// Helpers
// =========================
bool rawMotionDetected() {
  int raw = digitalRead(MICROWAVE_PIN);
#if DETECT_ACTIVE_LOW
  return (raw == LOW);
#else
  return (raw == HIGH);
#endif
}

void updateDetection() {
  if (rawMotionDetected()) {
    lastDetectMs = millis();
  }
}

bool presentNow() {
  if (rawMotionDetected()) return true;
  return (millis() - lastDetectMs) < PRESENCE_LATCH_MS;
}

float readBatteryVoltage() {
  return FIXED_BATTERY_V;
}

void buildPacket(bool present, float batt) {
  // 0 = repos / 1 = detection
  snprintf(txpacket, sizeof(txpacket),
           "LD45;%s;0;0;%d;0;%.2f",
           TX_ID, present ? 1 : 0, batt);
}

// =========================
// Setup
// =========================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(MICROWAVE_PIN, INPUT_PULLUP);

  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);

  RadioEvents.TxDone = onTxDone;
  RadioEvents.TxTimeout = onTxTimeout;

  Radio.Init(&RadioEvents);
  Radio.SetChannel(RF_FREQUENCY);

  Radio.SetTxConfig(MODEM_LORA,
                    TX_OUTPUT_POWER,
                    0,
                    LORA_BANDWIDTH,
                    LORA_SPREADING_FACTOR,
                    LORA_CODINGRATE,
                    LORA_PREAMBLE_LENGTH,
                    LORA_FIX_LENGTH_PAYLOAD_ON,
                    true,
                    0,
                    0,
                    LORA_IQ_INVERSION_ON,
                    3000);

  Serial.println("[BOOT] TX Microwave SEN0192 ready");
}

// =========================
// Loop
// =========================
void loop() {
  Radio.IrqProcess();

  // On memorise toute detection vue
  updateDetection();

  if ((millis() - lastSend >= SEND_PERIOD_MS) && txDone) {
    lastSend = millis();
    txDone = false;

    bool raw = rawMotionDetected();
    bool present = presentNow();
    float batt = readBatteryVoltage();

    buildPacket(present, batt);

    Serial.printf("[RAW=%d PRESENT=%d AGE=%lu] ",
                  raw ? 1 : 0,
                  present ? 1 : 0,
                  (lastDetectMs == 0) ? 999999UL : (millis() - lastDetectMs));
    Serial.println(txpacket);

    Radio.Send((uint8_t*)txpacket, strlen(txpacket));
  }
}
