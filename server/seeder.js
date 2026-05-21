import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "gunshots.db");

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randomLatLonForVic() {
  // Bounding box tightly drawn around the Vič district in Ljubljana
  const lat = rand(46.035, 46.050);
  const lon = rand(14.470, 14.495);
  return { lat, lon };
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

async function insertSingleDetection(db) {
  const insertStmt = `INSERT INTO detections
    (received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const { lat, lon } = randomLatLonForVic();
  const receivedAt = getCurrentTimestamp(); 
  const confidence = Number(rand(0.55, 0.98).toFixed(3));
  const peak = Number(rand(0.2, 1.0).toFixed(3));
  const nodeId = "sensor_2"; // Kept node name exactly as it was
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

  return new Promise((resolve, reject) => {
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
      else {
        console.log(`[${receivedAt}] Inserted 1 fake detection in Vič (ID: ${this.lastID})`);
        resolve(this.lastID);
      }
    });
  });
}

async function main() {
  const db = new sqlite3.Database(dbPath);

  // Ensure table exists
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

  // 1. Run immediately on startup
  try {
    await insertSingleDetection(db);
  } catch (err) {
    console.error("Initial insertion failed:", err);
  }

  // 2. Schedule to run every 2 hours indefinitely
  const TWO_HOURS_IN_MS = 2 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await insertSingleDetection(db);
    } catch (err) {
      console.error("Periodic insertion failed:", err);
    }
  }, TWO_HOURS_IN_MS);

  console.log(`Seeder is running. Waiting to inject next detection in 2 hours...`);
  
  // Handle graceful shutdown so db closes cleanly if you stop the script
  process.on('SIGINT', () => {
    console.log("\nClosing database and exiting...");
    db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Initialization failed:", err);
  process.exit(1);
});