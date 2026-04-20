#include <PDM.h>

// --------- LORA ---------
#define LORA_POWER_PIN 5
const char* DEVEUI = "70B3D57ED0076774";
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

// --------- DETECTION ---------
#define TRIGGER_LEVEL 1200
#define COOLDOWN_MS 5000

// --------- AUDIO ---------
short sampleBuffer[256];
volatile int samplesRead = 0;

// --------- STATE ---------
unsigned long lastSend = 0;

// --------- MIC CALLBACK ---------
void onPDMdata() {
  int bytesAvailable = PDM.available();
  PDM.read(sampleBuffer, bytesAvailable);
  samplesRead = bytesAvailable / 2;
}

// --------- SERIAL MONITOR LOG ONLY ---------
void logMsg(const char* msg) {
  Serial.println(msg);
}

// --------- LORA ---------
String readLoRa(unsigned long timeout = 2000) {
  String r;
  unsigned long start = millis();

  while (millis() - start < timeout) {
    while (Serial1.available()) {
      r += (char)Serial1.read();
    }
  }
  return r;
}

void sendAT(const char* cmd) {
  Serial1.print(cmd);
  readLoRa(1000);
}

bool joinNetwork() {
  logMsg("Joining LoRa...");

  for (int i = 0; i < 5; i++) {
    sendAT("AT+JOIN\r\n");
    String r = readLoRa(8000);

    if (r.indexOf("Network joined") >= 0) {
      logMsg("LoRa JOINED");
      return true;
    }

    delay(3000);
  }

  logMsg("LoRa JOIN FAILED");
  return false;
}

// --------- SETUP ---------
void setup() {
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH);
  delay(2000);

  Serial.begin(115200);   // MONITOR ONLY
  Serial1.begin(9600);    // LORA

  logMsg("SYSTEM START");

  sendAT("AT\r\n");
  sendAT("AT+ID=DevEui,\"70B3D57ED0076774\"\r\n");
  sendAT("AT+ID=APPEUI,\"FEFEFEFEFEFEFEFE\"\r\n");
  sendAT("AT+KEY=APPKEY,\"7879060DB75D2CA6F1147E14EA846886\"\r\n");
  sendAT("AT+MODE=LWOTAA\r\n");

  joinNetwork();

  PDM.onReceive(onPDMdata);

  if (!PDM.begin(1, 16000)) {
    logMsg("MIC FAILED");
    while (1);
  }

  PDM.setGain(30);

  logMsg("MIC READY");
}

// --------- LOOP ---------
void loop() {

  if (samplesRead) {

    int peak = 0;

    // --------- RAW PLOTTER OUTPUT ---------
    for (int i = 0; i < samplesRead; i++) {

      int v = sampleBuffer[i];

      // PLOTTER ONLY
      //Serial.println(v);

      int av = abs(v);
      if (av > peak) peak = av;
    }

    samplesRead = 0;

    // --------- SMOOTHED ENVELOPE (IMPORTANT FIX) ---------
    static float envelope = 0;
    envelope = (0.85 * envelope) + (0.15 * peak);

    int env = (int)envelope;

    // --------- DEBUG (MONITOR ONLY) ---------
    /*if (env > TRIGGER_LEVEL) {
      Serial.println("SQUELCH ACTIVE");
    }*/

    // --------- PROPER SQUELCH LOGIC ---------
    if (env > TRIGGER_LEVEL && millis() - lastSend > COOLDOWN_MS) {

      Serial.println("SQUELCH BREAK");  // monitor ONLY

      char payload[64];
      snprintf(payload, sizeof(payload),
               "gun_001|SHOT|%.2f|46.051|14.505",
               (float)env / 2000.0);

      char cmd[100];
      snprintf(cmd, sizeof(cmd), "AT+MSG=\"%s\"\r\n", payload);

      Serial1.print(cmd);

      lastSend = millis();
    }
  }
}