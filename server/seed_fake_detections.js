import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "gunshots.db");

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randomLatLon() {
  // Ljubljana bounding box (approx)
  const lat = rand(46.00, 46.12);
  const lon = rand(14.45, 14.56);
  return { lat, lon };
}

function randomTimestampWithinDays(days) {
  const now = Date.now();
  const past = now - days * 24 * 60 * 60 * 1000;
  const t = rand(past, now);
  return new Date(t).toISOString();
}

async function main() {
  const db = new sqlite3.Database(dbPath);
  // Ensure table exists (same schema as server)
  await new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        node_id TEXT NOT NULL,
        label TEXT,
        confidence REAL,
        peak REAL,
        latitude REAL,
        longitude REAL,
        gateway_rssi REAL,
        gateway_snr REAL,
        raw_payload TEXT
      )
    `, (err) => err ? reject(err) : resolve());
  });

  const insertStmt = `INSERT INTO detections
    (received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const total = 200;
  for (let i = 0; i < total; i++) {
    const { lat, lon } = randomLatLon();
    const receivedAt = randomTimestampWithinDays(90); // last ~3 months
    const confidence = Number(rand(0.55, 0.98).toFixed(3));
    const peak = Number(rand(0.2, 1.0).toFixed(3));
    const nodeId = "sensor_2";
    const label = "gunshot";
    const gatewayRssi = Number(rand(-120, -30).toFixed(1));
    const gatewaySnr = Number(rand(-20, 20).toFixed(1));

    const raw = {
      node_id: nodeId,
      lat,
      lng: lon,
      confidence,
      peak,
      label
    };

    await new Promise((resolve, reject) => {
      db.run(insertStmt, [
        receivedAt,
        nodeId,
        label,
        confidence,
        peak,
        lat,
        lon,
        gatewayRssi,
        gatewaySnr,
        JSON.stringify(raw)
      ], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  console.log(`Inserted ${total} fake detections into ${dbPath}`);
  db.close();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
