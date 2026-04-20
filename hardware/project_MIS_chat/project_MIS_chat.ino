//#include <ML_arduino3_inferencing.h>
#include <PDM.h>

// --------- LoRaWAN OTAA Keys ---------
#define LORA_POWER_PIN 5
const char* DEVEUI = "70B3D57ED0076774";
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

// --------- Detector Configuration ---------
// Ensure "gunshot" matches the label used in your Edge Impulse project
const char* TARGET_LABEL = "gunshot"; 
const float MIN_CONFIDENCE = 0.90f; 

// --------- Audio + Inference Buffers ---------
typedef struct {
    int16_t *buffer;
    uint8_t buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;
static inference_t inference;
static signed short sampleBuffer[2048];
static bool debug_nn = false;

// --------- Forward Declarations ---------
static void pdm_data_ready_inference_callback(void);
static bool microphone_inference_start(uint32_t n_samples);
static bool microphone_inference_record(void);
static int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr);
static void microphone_inference_end(void);

String readLoRaResponse(unsigned long timeout = 1000) {
  String response;
  unsigned long start = millis();
  while (millis() - start < timeout) {
    while (Serial1.available()) {
      char c = Serial1.read();
      response += c;
    }
    if (response.endsWith("\r\n")) break;
  }
  return response;
}

bool sendATCommand(const char* cmd, const char* param = nullptr, const char* expected = nullptr, unsigned long timeout = 1000) {
  char fullCmd[64];
  if (param) snprintf(fullCmd, sizeof(fullCmd), cmd, param);
  else snprintf(fullCmd, sizeof(fullCmd), cmd);
  
  Serial.print("Sending: "); Serial.print(fullCmd);
  Serial1.write(fullCmd, strlen(fullCmd));
  
  String response = readLoRaResponse(timeout);
  response.trim();
  Serial.print("Response: "); Serial.println(response);

  if (expected == nullptr) return response.length() > 0;
  if (strstr(cmd, "AT+ID") != nullptr) return response.indexOf("+ID:") >= 0;
  
  return response.indexOf(expected) >= 0;
}

bool joinLoRaNetwork(int maxRetries = 3) {
  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    Serial.print("Join attempt "); Serial.println(attempt);
    if (!sendATCommand("AT+JOIN\r\n", nullptr, "+JOIN: Network joined", 30000)) {
      delay(5000);
      continue;
    }
    return true;
  }
  return false;
}

void setup() {
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH);
  delay(2000);

  Serial.begin(115200);
  Serial1.begin(9600);
  while (!Serial);

  Serial.println("Initializing LoRaWAN...");

  if (!sendATCommand("AT\r\n", nullptr, "OK", 500)) {
    Serial.println("LoRa module error!");
    while(1);
  }

  sendATCommand("AT+ID=DevEui,\"%s\"\r\n", DEVEUI);
  sendATCommand("AT+ID=APPEUI,\"%s\"\r\n", APPEUI);
  sendATCommand("AT+KEY=APPKEY,\"%s\"\r\n", APPKEY);
  sendATCommand("AT+MODE=LWOTAA\r\n");

  if (!joinLoRaNetwork(5)) {
    Serial.println("Network join failed!");
    while(1);
  }

  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    while (1);
  }
}

void loop() {
  if (!microphone_inference_record()) return;

  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data = &microphone_audio_signal_get_data;
  ei_impulse_result_t result = { 0 };
  
  if (run_classifier(&signal, &result, debug_nn) != EI_IMPULSE_OK) return;

  size_t best_i = 0;
  float best_v = result.classification[0].value;
  for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (result.classification[i].value > best_v) {
      best_v = result.classification[i].value;
      best_i = i;
    }
  }
  
  const char* best_label = result.classification[best_i].label;
  
  // Detection logic for gunshots
  if (strcmp(best_label, TARGET_LABEL) == 0 && best_v >= MIN_CONFIDENCE) {
    Serial.print("GUNSHOT DETECTED: "); Serial.println(best_v);
    
    char payload[48];
    // Payload: ID | Type | Confidence | Lat | Lon
    snprintf(payload, sizeof(payload), "gun_001|SHOT|%.2f|46.051|14.505", best_v);

    char loraCmd[80];
    snprintf(loraCmd, sizeof(loraCmd), "AT+MSG=\"%s\"\r\n", payload);
    
    sendATCommand(loraCmd, nullptr, "OK", 5000);
  }

  delay(200); 
}

// --------- PDM Support Functions ---------
static void pdm_data_ready_inference_callback(void) {
  int avail = PDM.available();
  int r = PDM.read((char*)sampleBuffer, avail);
  if (!inference.buf_ready) {
    for (int i = 0; i < (r >> 1); i++) {
      inference.buffer[inference.buf_count++] = sampleBuffer[i];
      if (inference.buf_count >= inference.n_samples) {
        inference.buf_ready = 1;
        inference.buf_count = 0;
        break;
      }
    }
  }
}

static bool microphone_inference_start(uint32_t n_samples) {
  inference.buffer = (int16_t*)malloc(n_samples * sizeof(int16_t));
  if (!inference.buffer) return false;
  inference.n_samples = n_samples;
  inference.buf_ready = 0;
  inference.buf_count = 0;

  PDM.onReceive(&pdm_data_ready_inference_callback);
  PDM.setBufferSize(4096);
  if (!PDM.begin(1, EI_CLASSIFIER_FREQUENCY)) return false;
  PDM.setGain(30); // Lower gain often helps with loud impulsive sounds like shots
  return true;
}

static bool microphone_inference_record(void) {
  inference.buf_ready = 0;
  inference.buf_count = 0;
  while (!inference.buf_ready) delay(10);
  return true;
}

static int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr) {
  numpy::int16_to_float(&inference.buffer[offset], out_ptr, length);
  return 0;
}