# Gunshot Detection System (LoRa + Edge Impulse)

## Overview
This project is a prototype urban gunshot detection system using:
- XIAO nRF52 microcontroller
- Edge Impulse ML model
- LoRaWAN + TTN
- Node.js backend
- Web dashboard with map visualization

## Architecture
Sensor → LoRa → TTN → Webhook → Backend → Database → Frontend

## Features
- Real-time event ingestion
- Map visualization (Leaflet)
- Detection statistics
- Multi-node support

## Limitations
- Detects gunshot-like events, not guaranteed gunshots
- Displays sensor location, not true source location
- No triangulation

## How to run

### Backend
```bash
cd server
npm install
npm start

cd ../frontend
python -m http.server 8080
```
