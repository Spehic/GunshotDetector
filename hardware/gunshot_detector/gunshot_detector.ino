#include <ProjectMIS_inferencing.h>
#include <PDM.h>

// --------- LoRaWAN OTAA Keys (replace with your real ones) ---------
#define LORA_POWER_PIN 5
const char* DEVEUI = "70B3D57ED0076774";
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

// --------- Detector Configuration ---------
const char* TARGET_LABEL  = "gunshot";
const float MIN_CONFIDENCE = 0.85f; // 85% — slightly relaxed for short transient sounds

// --------- Audio + Inference Buffers ---------
typedef struct {
    int16_t *buffer;
    uint8_t  buf_ready;
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
static int  microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr);
static void microphone_inference_end(void);

// --------- LoRa Helpers ---------
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
  else       snprintf(fullCmd, sizeof(fullCmd), cmd);

  Serial.print("Sending: "); Serial.print(fullCmd);
  Serial1.write(fullCmd, strlen(fullCmd));

  String response = readLoRaResponse(timeout);
  response.trim();
  Serial.print("Response: "); Serial.println(response);

  if (expected == nullptr)        return response.length() > 0;
  if (strstr(cmd, "AT+ID") != nullptr) return response.indexOf("+ID:") >= 0;
  return response.indexOf(expected) >= 0;
}

bool joinLoRaNetwork(int maxRetries = 5) {
  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    Serial.print("Join attempt "); Serial.println(attempt);
    
    // Send JOIN command
    Serial1.write("AT+JOIN\r\n");
    
    // Give it plenty of time. A Join can take up to 15-20 seconds 
    // because of the two RX windows.
    String response = readLoRaResponse(20000); 
    Serial.println("Response: " + response);

    if (response.indexOf("Network joined") >= 0) {
      return true;
    }

    Serial.println("Join failed, waiting before retry...");
    delay(10000); // Wait 10 seconds before trying again to clear the "busy" state
  }
  return false;
}

// --------- Setup ---------
void setup() {
  // 1) Power & init LoRa module
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH);
  delay(2000);

  Serial.begin(115200);
  Serial1.begin(9600);
  while (!Serial);

  Serial.println("=== Gunshot Detector – LoRaWAN + Edge Impulse ===");

  if (!sendATCommand("AT\r\n", nullptr, "OK", 500)) {
    Serial.println("LoRa module not responding!");
    while (1);
  }

  if (!sendATCommand("AT+ID=DevEui,\"%s\"\r\n", DEVEUI))  { Serial.println("DevEui setup failed!");  while (1); }
  if (!sendATCommand("AT+ID=APPEUI,\"%s\"\r\n", APPEUI))  { Serial.println("AppEui setup failed!");  while (1); }
  if (!sendATCommand("AT+KEY=APPKEY,\"%s\"\r\n", APPKEY)) { Serial.println("APPKEY setup failed!");  while (1); }
  if (!sendATCommand("AT+MODE=LWOTAA\r\n"))                { Serial.println("Mode setup failed!");    while (1); }

  if (!joinLoRaNetwork()) {
    Serial.println("Failed to join LoRaWAN network!");
    while (1);
  }
  Serial.println("Joined LoRaWAN network successfully!");

  // 2) Setup Audio Inference
  ei_printf("Inferencing settings:\n");
  ei_printf("\tInterval: %.2f ms\n",    (float)EI_CLASSIFIER_INTERVAL_MS);
  ei_printf("\tFrame size: %d\n",        EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE);
  ei_printf("\tSample length: %d ms\n",  EI_CLASSIFIER_RAW_SAMPLE_COUNT / 16);

  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    ei_printf("ERROR: Failed to start microphone!\n");
    while (1);
  }

  Serial.println("Listening for gunshots...");
}

// --------- Main Loop ---------
void loop() {
  if (!microphone_inference_record()) {
    ei_printf("ERROR: Failed to record audio.\n");
    return;
  }

  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data     = &microphone_audio_signal_get_data;

  ei_impulse_result_t result = { 0 };
  if (run_classifier(&signal, &result, debug_nn) != EI_IMPULSE_OK) {
    ei_printf("ERROR: Classifier failed!\n");
    return;
  }

  // Find top prediction
  size_t best_i = 0;
  float  best_v = result.classification[0].value;
  for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (result.classification[i].value > best_v) {
      best_v = result.classification[i].value;
      best_i = i;
    }
  }

  const char* best_label = result.classification[best_i].label;
  ei_printf("Top prediction: %s (%.2f)\n", best_label, best_v);

  // Send LoRa alert only on confirmed gunshot
  if (strcmp(best_label, TARGET_LABEL) == 0 && best_v >= MIN_CONFIDENCE) {
    Serial.println("*** GUNSHOT DETECTED ***");

    // Payload: device_id | confidence | lat | lon
    char payload[48];
    snprintf(payload, sizeof(payload), "xiao001|%.2f|%.3f|%.3f",
             best_v, 46.051, 14.505); // Replace with actual GPS coords if available

    char loraCmd[72];
    snprintf(loraCmd, sizeof(loraCmd), "AT+MSG=\"%s\"\r\n", payload);

    if (sendATCommand(loraCmd, nullptr, "OK", 5000)) {
      Serial.println("Alert sent via LoRaWAN!");
    } else {
      Serial.println("Failed to send LoRaWAN alert.");
    }
  }

  delay(100); // Tighter loop — gunshots are brief, minimise missed events
}

// --------- PDM / Inference Support ---------
static void pdm_data_ready_inference_callback(void) {
  int avail = PDM.available();
  int r     = PDM.read((char*)sampleBuffer, avail);
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
  if (!PDM.begin(1, EI_CLASSIFIER_FREQUENCY)) {
    ei_printf("ERROR: Failed to start PDM microphone!\n");
    microphone_inference_end();
    return false;
  }
  PDM.setGain(40);
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

static void microphone_inference_end(void) {
  PDM.end();
  free(inference.buffer);
}

#if !defined(EI_CLASSIFIER_SENSOR) || EI_CLASSIFIER_SENSOR != EI_CLASSIFIER_SENSOR_MICROPHONE
#error "Invalid model for current sensor."
#endif
