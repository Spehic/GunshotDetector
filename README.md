# 🔫 Gunshot Detection System (LoRa + Edge Impulse)

## 📖 Overview

This project is a prototype **urban gunshot detection system** built
using IoT, machine learning, and LoRaWAN.

It captures acoustic events on edge devices, classifies them using an ML
model, and transmits detections to a backend for storage, analysis, and
visualization.

### 🧰 Technologies Used

-   XIAO nRF52 microcontroller
-   Edge Impulse (ML model)
-   LoRaWAN + The Things Network (TTN)
-   Node.js (Express backend)
-   SQLite database
-   Web dashboard (Leaflet map)

------------------------------------------------------------------------

## 🏗️ Architecture

Sensor → LoRa → TTN → Webhook → Backend → Database → Frontend

### Flow

1.  Sensor detects sound and runs ML classification
2.  Data is sent via LoRaWAN to TTN
3.  TTN triggers webhook
4.  Backend stores event in SQLite database
5.  Frontend fetches and visualizes data

------------------------------------------------------------------------

## ✨ Features

-   Real-time event ingestion via webhook\
-   ML-based gunshot detection (Edge Impulse)\
-   Map visualization (Leaflet)\
-   Detection statistics dashboard\
-   Multi-node sensor support

------------------------------------------------------------------------

## ⚠️ Limitations

-   Detects gunshot-like events, not guaranteed real gunshots\
-   Displays sensor location, not actual source location\
-   No triangulation

------------------------------------------------------------------------

## 🚀 How to Run

### 🔧 Backend

``` bash
cd server
npm install
npm start
```

Runs on: https://backend.kbnet.si
------------------------------------------------------------------------

### 🌐 Frontend

``` bash
cd frontend
python -m http.server 8080
```

Open in browser: https://mis.kbnet.si

------------------------------------------------------------------------

# 📡 API Documentation (MIS-projekt)

## GunshotDetector API

This API receives detection data from IoT sensors via **The Things
Network (TTN)** and stores it in a SQLite database.

### Features

-   Receiving webhook events
-   Fetching detection history
-   Viewing aggregated statistics
-   Inserting test data

Designed for real-time monitoring and analysis of acoustic gunshot
detection systems.

Base URL: https://backend.kbnet.si

------------------------------------------------------------------------

## 📊 GET /api/events

**Endpoint:** https://backend.kbnet.si/api/events

Returns a list of recent detection events stored in the database.

### Query Parameters

-   limit (optional): number of results (default: 100, max: 500)

### Behavior

-   Results are ordered by newest first
-   Includes full event data including signal metrics and location
-   Raw payload is returned as a JSON string

### Use Cases

-   Dashboard display
-   Debugging incoming data
-   Map visualization

------------------------------------------------------------------------

## 📈 GET /api/stats

**Endpoint:** https://backend.kbnet.si/api/stats

Returns aggregated statistics about detection events.

### Includes

-   totalDetections
-   avgConfidence
-   avgPeak
-   gunshotDetections

### Breakdowns

-   byNode (detections per sensor)
-   byDay (last 7 days)

### Use Cases

-   Analytics dashboards
-   System monitoring
-   Trend analysis

------------------------------------------------------------------------

## 🧪 POST /api/test-event

**Endpoint:** https://backend.kbnet.si/api/test-event

Creates a test detection event manually without TTN.

### Use Cases

-   Backend testing
-   Demo data
-   Development

### Request Body

``` json
{
  "node_id": "sensor-1",
  "label": "gunshot",
  "confidence": 0.92,
  "peak": 0.85,
  "latitude": 46.05,
  "longitude": 14.50
}
```

### Defaults

-   node_id: "test-node"
-   label: "gunshot"
-   confidence: 0.95
-   peak: 0.87
-   latitude: 46.0569
-   longitude: 14.5058

### Notes

-   RSSI and SNR set to 0
-   Payload stored as-is
-   Timestamp auto-generated

------------------------------------------------------------------------

## 🔔 POST /webhook/ttn

**Endpoint:** https://backend.kbnet.si/webhook/ttn

Receives uplink messages from TTN and stores them as detection events.

### Extracted Fields

-   node_id
-   label
-   confidence
-   peak
-   latitude, longitude
-   gateway RSSI, SNR

### Example Payload

``` json
{
  "node_id": "sensor-1",
  "label": "gunshot",
  "confidence": 0.92,
  "peak": 0.85,
  "latitude": 46.05,
  "longitude": 14.50
}
```

### Notes

-   Missing fields default safely
-   Full payload stored
-   Timestamp generated automatically
-   Intended for TTN webhook use

------------------------------------------------------------------------

## 🗄️ Database Schema

Table: detections

-   id
-   received_at
-   node_id
-   label
-   confidence
-   peak
-   latitude
-   longitude
-   gateway_rssi
-   gateway_snr
-   raw_payload
