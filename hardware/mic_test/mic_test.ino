#include <PDM.h>

// Buffer to read samples into, each sample is 16-bits
short sampleBuffer[256];

// Number of samples read
volatile int samplesRead;

void setup() {
  Serial.begin(115200);
  while (!Serial);

  Serial.println("Starting PDM Microphone Test...");

  // Configure the data ready callback
  PDM.onReceive(onPDMdata);

  // Initialize PDM with:
  // - 1 channel (mono)
  // - 16000 samples per second
  if (!PDM.begin(1, 16000)) {
    Serial.println("Failed to start PDM!");
    while (1);
  }
  
  // Set gain (0 to 80)
  PDM.setGain(20);
}

void loop() {
  // Wait for samples to be read
  if (samplesRead) {
    // Print samples to the Serial Plotter
    for (int i = 0; i < samplesRead; i++) {
      Serial.println(sampleBuffer[i]);
    }
    // Clear the read count
    samplesRead = 0;
  }
}

void onPDMdata() {
  // Query the number of bytes available
  int bytesAvailable = PDM.available();

  // Read into the sample buffer
  PDM.read(sampleBuffer, bytesAvailable);

  // 16-bit samples, so 2 bytes per sample
  samplesRead = bytesAvailable / 2;
}