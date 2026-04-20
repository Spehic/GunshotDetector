#include <ProjectMIS_inferencing.h>
#include <PDM.h>

// --------- Hardware & Configuration ---------
#define LORA_POWER_PIN 5
const char* APPEUI = "FEFEFEFEFEFEFEFE";
const char* DEVEUI = "70B3D57ED0076774";
const char* APPKEY = "7879060DB75D2CA6F1147E14EA846886";

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
  pinMode(LORA_POWER_PIN, OUTPUT);
  digitalWrite(LORA_POWER_PIN, HIGH);

  Serial.begin(115200);
  Serial1.begin(9600); 
  while (!Serial1);

  Serial.println("--- Booting: Short JSON Mode ---");
  
  Serial1.println("AT+RESET"); 
  delay(2000);
  Serial1.print("AT+ID=AppEui,\""); Serial1.print(APPEUI); Serial1.println("\"");
  delay(500);
  Serial1.print("AT+ID=DevEui,\""); Serial1.print(DEVEUI); Serial1.println("\"");
  delay(500);
  Serial1.print("AT+KEY=AppKey,\""); Serial1.print(APPKEY); Serial1.println("\"");
  delay(500);
  Serial1.println("AT+MODE=LWOTAA");
  delay(500);
  Serial1.println("AT+DR=DR0");
  delay(500);
  
  Serial.println("Joining TTN...");
  Serial1.println("AT+JOIN");
  delay(20000); 

  // --- STARTUP CONNECTIVITY TEST (Short JSON) ---
  Serial.println("Sending Short JSON Test...");
  Serial1.println("AT+MSG=\"{\\\"id\\\":\\\"s1\\\",\\\"lab\\\":\\\"test\\\"}\""); 
  delay(5000); 

  if (!microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT)) {
    Serial.println("Mic Error");
    while (1); 
  }
}

void loop() {
  if (!microphone_inference_record()) return;

  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data     = &microphone_audio_signal_get_data;

  ei_impulse_result_t result = { 0 };
  if (run_classifier(&signal, &result, debug_nn) == EI_IMPULSE_OK) {
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
      if (strcmp(result.classification[i].label, TARGET_LABEL) == 0) {
        if (result.classification[i].value >= MIN_CONFIDENCE) {
          Serial.println("!!! GUNSHOT !!!");
          
          char json_payload[128];
          // Shortened keys: id, lab (label), conf, pk (peak), lat, lon
          snprintf(json_payload, sizeof(json_payload), 
            "AT+MSG=\"{\\\"id\\\":\\\"s1\\\",\\\"lab\\\":\\\"gs\\\",\\\"conf\\\":%.2f,\\\"pk\\\":0.85,\\\"lat\\\":46.05,\\\"lon\\\":14.50}\"", 
            result.classification[i].value);
          
          Serial1.println(json_payload);
          delay(10000); 
        }
      }
    }
  }
}

// --------- Support Functions ---------

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
  while (!inference.buf_ready) delay(10);
  return true;
}

static int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr) {
  numpy::int16_to_float(&inference.buffer[offset], out_ptr, length);
  return 0;
}