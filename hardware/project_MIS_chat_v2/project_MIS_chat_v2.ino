#include <ProjectMIS_inferencing.h>
#include <PDM.h>

// --------- LoRaWAN Keys ---------
#define LORA_POWER_PIN 5
const char* APPEUI = "FEFEFEFEFEFEFEFE"; // [cite: 6]
const char* DEVEUI = "70B3D57ED0076774"; // [cite: 5]
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886"; // [cite: 6]

// --------- Detector Config ---------
const char* TARGET_LABEL  = "gunshot"; // [cite: 5]
const float MIN_CONFIDENCE = 0.85f;    // [cite: 7]

// --------- Memory Optimized Buffers ---------
typedef struct {
    int16_t *buffer;
    uint8_t  buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

static inference_t inference;
static signed short sampleBuffer[256]; // Small buffer to save RAM [cite: 49]

// Forward Declarations
static bool microphone_inference_start(uint32_t n_samples);
static bool microphone_inference_record(void);
static int  microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr);
static void pdm_data_ready_inference_callback(void);

void setup() {
  Serial.begin(115200);
  while (!Serial);
  
  // 1. Hardware Power Up
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH);
  Serial1.begin(9600);
  while (!Serial1); // [cite: 2]

  Serial.println("--- PHASE 1: LoRaWAN Join ---");
  
  // 2. Clean Join Sequence (No AI running yet)
  Serial1.print("AT+ID=AppEui,\""); Serial1.print(APPEUI); Serial1.println("\"");
  delay(500);
  Serial1.print("AT+ID=DevEui,\""); Serial1.print(DEVEUI); Serial1.println("\"");
  delay(500);
  Serial1.print("AT+KEY=AppKey,\""); Serial1.print(APPKEY); Serial1.println("\"");
  delay(500);
  Serial1.println("AT+MODE=LWOTAA");
  delay(500);
  Serial1.println("AT+DR=DR0"); // [cite: 3]
  delay(500);
  Serial1.println("AT+JOIN");
  
  // Wait 15 seconds for the JOIN windows to complete 
  Serial.println("Waiting for Join Accept...");
  delay(15000); 

  Serial.println("--- PHASE 2: AI Initialization ---");

  // 3. Start Microphone after LoRa is finished [cite: 35]
  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    Serial.println("ERROR: Mic failed! Model too large for RAM?");
    while (1);
  }

  Serial.println("System online and listening...");
}

void loop() {
  if (!microphone_inference_record()) return; // [cite: 37, 55]

  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data     = &microphone_audio_signal_get_data; // [cite: 38]

  ei_impulse_result_t result = { 0 };
  if (run_classifier(&signal, &result, false) == EI_IMPULSE_OK) { // [cite: 39]
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
      if (strcmp(result.classification[i].label, TARGET_LABEL) == 0) { // [cite: 43]
        if (result.classification[i].value >= MIN_CONFIDENCE) {
          Serial.println("*** GUNSHOT DETECTED ***");
          
          // Send simple message to keep memory low
          char loraMsg[64];
          snprintf(loraMsg, sizeof(loraMsg), "AT+MSG=\"shot|%.2f\"", result.classification[i].value); // [cite: 46]
          Serial1.println(loraMsg);
          
          delay(5000); // Cooldown
        }
      }
    }
  }
}

// --------- Support Functions ---------

static void pdm_data_ready_inference_callback(void) {
  int avail = PDM.available();
  int r = PDM.read((char*)sampleBuffer, avail); // [cite: 49]
  if (!inference.buf_ready) {
    for (int i = 0; i < (r >> 1); i++) {
      inference.buffer[inference.buf_count++] = sampleBuffer[i];
      if (inference.buf_count >= inference.n_samples) {
        inference.buf_ready = 1; // [cite: 50]
        inference.buf_count = 0;
        break;
      }
    }
  }
}

static bool microphone_inference_start(uint32_t n_samples) {
  inference.buffer = (int16_t*)malloc(n_samples * sizeof(int16_t)); // 
  if (!inference.buffer) return false;

  inference.n_samples = n_samples;
  inference.buf_ready = 0;
  inference.buf_count = 0;

  PDM.onReceive(&pdm_data_ready_inference_callback);
  
  // No custom buffer size to save RAM [cite: 53]
  if (!PDM.begin(1, 16000)) {
    free(inference.buffer);
    return false;
  }
  PDM.setGain(40); // [cite: 54]
  return true;
}

static bool microphone_inference_record(void) {
  inference.buf_ready = 0;
  inference.buf_count = 0;
  while (!inference.buf_ready) delay(5); // [cite: 55]
  return true;
}

static int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr) {
  numpy::int16_to_float(&inference.buffer[offset], out_ptr, length); // [cite: 56]
  return 0;
}