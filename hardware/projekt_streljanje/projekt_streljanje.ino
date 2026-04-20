#include <ML_arduino3_inferencing.h>
#include <PDM.h>

// --------- LoRaWAN OTAA Keys (replace with your real ones) ---------
#define LORA_POWER_PIN 5
const char* DEVEUI = "70B3D57ED0076774";
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

// --------- Detector Configuration ---------
const char* TARGET_LABEL = "motorka";
const float MIN_CONFIDENCE = 0.9f; // 90%

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
    // If we got a complete response (ends with \r\n), return early
    if (response.endsWith("\r\n")) {
      break;
    }
  }
  return response;
}

bool sendATCommand(const char* cmd, const char* param = nullptr, const char* expected = nullptr, unsigned long timeout = 1000) {
  char fullCmd[64];
  if (param) {
    snprintf(fullCmd, sizeof(fullCmd), cmd, param);
  } else {
    snprintf(fullCmd, sizeof(fullCmd), cmd);
  }
  
  Serial.print("Sending: "); Serial.print(fullCmd);
  Serial1.write(fullCmd, strlen(fullCmd));
  
  String response = readLoRaResponse(timeout);
  response.trim(); // Remove extra whitespace
  Serial.print("Response: "); Serial.println(response);

  // If no expected response specified, assume command succeeded if we got any response
  if (expected == nullptr) {
    return response.length() > 0;
  }
  
  // Special case for ID commands
  if (strstr(cmd, "AT+ID") != nullptr) {
    return response.indexOf("+ID:") >= 0;
  }
  
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
  //  1) Power & init LoRa module 
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH); // Turn on LoRa power
  delay(2000); // Increased delay for module power-up

  // Initialize serial ports
  Serial.begin(115200);
  Serial1.begin(9600);
  while (!Serial); // Wait only for Serial (debug), not Serial1

  Serial.println("Initializing LoRaWAN...");

  // Verify module communication
  if (!sendATCommand("AT\r\n", nullptr, "OK", 500)) {
    Serial.println("LoRa module not responding!");
    while(1);
  }

  // Configure OTAA parameters - now accepts "+ID:" in response
  if (!sendATCommand("AT+ID=DevEui,\"%s\"\r\n", DEVEUI)) {
    Serial.println("DevEui setup failed!");
    while(1);
  }
  
  if (!sendATCommand("AT+ID=APPEUI,\"%s\"\r\n", APPEUI)) {
    Serial.println("AppEui setup failed!");
    while(1);
  }
  
  if (!sendATCommand("AT+KEY=APPKEY,\"%s\"\r\n", APPKEY)) {
    Serial.println("APPKEY setup failed!");
    while(1);
  }
  
  if (!sendATCommand("AT+MODE=LWOTAA\r\n")) {
    Serial.println("Mode setup failed!");
    while(1);
  }

  // Join network with retries
  if (!joinLoRaNetwork(5)) { // Increased to 5 retries
    Serial.println("Failed to join network after retries!");
    while(1);
  }

  Serial.println("Successfully joined LoRaWAN network!");

  //  2) Setup Audio Inference 
  Serial.println("=== Edge Impulse Audio Classifier ===");
  ei_printf("Inferencing settings:\n");
  ei_printf("\tInterval: %.2f ms\n", (float)EI_CLASSIFIER_INTERVAL_MS);
  ei_printf("\tFrame size: %d\n", EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE);
  ei_printf("\tSample length: %d ms\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT / 16);

  // Start microphone inference
  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    ei_printf("ERROR: Failed to start microphone inference!\n");
    while (1);
  }
}

void loop() {
  ei_printf("\nStarting audio recording...\n");
  if (!microphone_inference_record()) {
    ei_printf("ERROR: Failed to record audio.\n");
    return;
  }

  // Run the classifier
  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data = &microphone_audio_signal_get_data;
  ei_impulse_result_t result = { 0 };
  
  if (run_classifier(&signal, &result, debug_nn) != EI_IMPULSE_OK) {
    ei_printf("ERROR: Classifier failed!\n");
    return;
  }

  // Find top prediction
  size_t best_i = 0;
  float best_v = result.classification[0].value;
  for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (result.classification[i].value > best_v) {
      best_v = result.classification[i].value;
      best_i = i;
    }
  }
  
  const char* best_label = result.classification[best_i].label;
  ei_printf("Top Prediction: %s (%.2f)\n", best_label, best_v);

// Replace the message sending section in your loop() function
if (strcmp(best_label, TARGET_LABEL) == 0 && best_v >= MIN_CONFIDENCE) {
    // Create compact payload (no hex conversion needed)
    char payload[32];
    snprintf(payload, sizeof(payload), "xiao001|%.2f|%.3f|%.3f", 
             best_v, 46.051, 14.505); // Replace with actual GPS coords

    // Send raw bytes directly
    char loraCmd[64];
    snprintf(loraCmd, sizeof(loraCmd), "AT+MSG=\"%s\"\r\n", payload);
    
    if (sendATCommand(loraCmd, nullptr, "OK", 5000)) {
        Serial.println("Message sent successfully!");
    } else {
        Serial.println("Failed to send message!");
    }
}

  delay(500); // Short delay between classifications
}

//  PDM / Inference Support Functions 
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
  while (!inference.buf_ready) {
    delay(10);
  }
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