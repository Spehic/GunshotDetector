#include <Arduino.h>

#define LORA_POWER_PIN 5
// Use your actual keys from TTN
const char* DEVEUI = "70B3D57ED0076774";
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

void sendAT(const char* cmd) {
  Serial.print("Sending: "); Serial.println(cmd);
  Serial1.print(cmd);
  
  unsigned long start = millis();
  while (millis() - start < 10000) { // 10s timeout
    while (Serial1.available()) {
      Serial.print((char)Serial1.read());
    }
  }
  Serial.println("\n--- Done ---");
}

void setup() {
  // 1. Hardware Reset the Module
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, LOW);
  delay(2000);
  digitalWrite(LORA_POWER_PIN, HIGH);
  delay(3000);

  Serial.begin(115200);
  Serial1.begin(9600);
  while (!Serial);

  Serial.println("LoRaWAN Connectivity Test");

  // 2. Configure Module
  sendAT("AT\r\n");
  sendAT("AT+ID=DevEui\r\n"); // Check if it matches your DEVEUI
  
  // Set Keys
  char buf[128];
  sprintf(buf, "AT+ID=DevEui,\"%s\"\r\n", DEVEUI); sendAT(buf);
  sprintf(buf, "AT+ID=AppEui,\"%s\"\r\n", APPEUI); sendAT(buf);
  sprintf(buf, "AT+KEY=APPKEY,\"%s\"\r\n", APPKEY); sendAT(buf);
  
  // Set Region and Mode
  sendAT("AT+MODE=LWOTAA\r\n");
  sendAT("AT+DR=EU868\r\n"); // Force Slovenia region
  sendAT("AT+CH=NUM,0-7\r\n"); // Ensure it's using the standard 8 channels
  
  Serial.println("Starting Join Process... Watch TTN Live Data now!");
  sendAT("AT+JOIN\r\n");
}

void loop() {
  // If it joins, it will send a small test message every 30 seconds
  static unsigned long lastSend = 0;
  if (millis() - lastSend > 30000) {
    sendAT("AT+MSG=\"HELLO\"\r\n");
    lastSend = millis();
  }
}