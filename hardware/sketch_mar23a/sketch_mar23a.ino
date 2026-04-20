#include <Arduino.h>
//#include <Adafruit_TinyUSB.h>
void setup() {
// Turn ON LoRaWAN Modem
  pinMode(5, OUTPUT);
  digitalWrite(5, HIGH);
// Set parameters for LoRaWAN communication
Serial1.begin(9600);
while (!Serial1) {}
  Serial1.write("AT+ID=AppEui,\"FEFEFEFEFEFEFEFE\"");
  delay(1000);
  Serial1.write("AT+ID=DevEui,\"70B3D57ED0076774\"");
  delay(1000);
  Serial1.write("AT+KEY=AppKey,\"7879060DB75D2CA6F1147E14EA846886\"");
  delay(1000);
  Serial1.write("AT+MODE=LWOTAA");
  delay(1000);
  // Force ADR OFF and DR0 (SF12) for testing purpose
  Serial1.write("AT+ADR=OFF");
  delay(1000);
  Serial1.write("AT+DR=DR0");
  delay(1000);
  Serial1.write("AT+JOIN");
  delay(5000);
}
void loop() {
// Send LoRaWAN Message
  Serial1.write("AT+MSG=\"Nasi testni podatki:Martin Kosi\"");
  delay(10000);
}