#include <ProjectMIS_inferencing.h>
#include <PDM.h>

// --------- Configuration ---------
const char* TARGET_LABEL  = "gunshot";
const float MIN_CONFIDENCE = 0.85f;

// --------- Audio + Inference Buffers ---------
typedef struct {
    int16_t *buffer;
    uint8_t  buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

static inference_t inference;
static signed short sampleBuffer[256]; 
static bool debug_nn = false;

// Forward Declarations
static void pdm_data_ready_inference_callback(void);
static bool microphone_inference_start(uint32_t n_samples);
static bool microphone_inference_record(void);
static int  microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr);

void setup() {
  Serial.begin(115200);
  while (!Serial); // Wait for Serial Monitor to open

  Serial.println("=== AI Recognition Test Mode ===");
  Serial.println("Initializing Microphone...");

  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    Serial.println("ERR: Failed to start PDM microphone!");
    while (1); 
  }

  Serial.println("System Ready. Listening for gunshots...");
  Serial.println("---------------------------------------");
}

void loop() {
  // 1. Capture audio
  if (!microphone_inference_record()) {
    Serial.println("ERR: Record failed");
    return;
  }

  // 2. Prepare signal for Edge Impulse
  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data     = &microphone_audio_signal_get_data;

  // 3. Run Inference
  ei_impulse_result_t result = { 0 };
  EI_IMPULSE_ERROR res = run_classifier(&signal, &result, debug_nn);
  
  if (res != EI_IMPULSE_OK) {
    Serial.print("ERR: Classifier failed with code: ");
    Serial.println(res);
    return;
  }

  // 4. Check results
  for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    // Print all labels to monitor for debugging
    if (result.classification[i].value > 0.3) { // Only show labels with >30% confidence
        Serial.print(result.classification[i].label);
        Serial.print(": ");
        Serial.println(result.classification[i].value);
    }

    // Explicit Alert for Gunshot
    if (strcmp(result.classification[i].label, TARGET_LABEL) == 0) {
      if (result.classification[i].value >= MIN_CONFIDENCE) {
        Serial.println("\n[!!!] ALERT: GUNSHOT DETECTED [!!!]");
        Serial.print("CONFIDENCE: ");
        Serial.println(result.classification[i].value);
        Serial.println("---------------------------------------\n");
      }
    }
  }
}

// --------- Audio Support Functions ---------

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
  if (!PDM.begin(1, 16000)) {
    free(inference.buffer);
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