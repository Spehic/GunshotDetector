import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./gunshots.db");

// Create table on startup
db.serialize(() => {
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
  `);
});

// Helper: run db query as promise
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/*
  TTN Webhook receiver

  Expected TTN webhook body shape is similar to:
  {
    "end_device_ids": {
      "device_id": "sensor-1"
    },
    "uplink_message": {
      "decoded_payload": {
        "node_id": "sensor-1",
        "lat": 46.0569,
        "lng": 14.5058,
        "confidence": 0.91,
        "label": "gunshot",
        "peak": 0.83
      },
      "rx_metadata": [
        {
          "rssi": -90,
          "snr": 5.2
        }
      ]
    }
  }
*/
app.post("/webhook/ttn", async (req, res) => {
  try {
    const body = req.body;

    const deviceId =
      body?.end_device_ids?.device_id ||
      body?.device_id ||
      "unknown-node";

    const decoded = body?.uplink_message?.decoded_payload || {};
    const rxMeta = body?.uplink_message?.rx_metadata?.[0] || {};

    const nodeId = decoded.node_id || deviceId;
    const label = decoded.label || "unknown";
    const confidence = Number(decoded.confidence ?? 0);
    const peak = Number(decoded.peak ?? 0);

    // Fixed sensor position or included in payload
    const latitude = Number(decoded.lat ?? decoded.latitude ?? 0);
    const longitude = Number(decoded.lng ?? decoded.longitude ?? 0);

    const gatewayRssi = Number(rxMeta.rssi ?? 0);
    const gatewaySnr = Number(rxMeta.snr ?? 0);

    const receivedAt = new Date().toISOString();

    await runQuery(
      `INSERT INTO detections
      (received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receivedAt,
        nodeId,
        label,
        confidence,
        peak,
        latitude,
        longitude,
        gatewayRssi,
        gatewaySnr,
        JSON.stringify(body)
      ]
    );

    console.log("Detection stored:", {
      receivedAt,
      nodeId,
      label,
      confidence,
      peak,
      latitude,
      longitude
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ ok: false, error: "Failed to store detection" });
  }
});

// Get all events
app.get("/api/events", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);

    const rows = await allQuery(
      `SELECT *
       FROM detections
       ORDER BY datetime(received_at) DESC
       LIMIT ?`,
      [limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("Events API error:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Get summary stats
app.get("/api/stats", async (req, res) => {
  try {
    const total = await getQuery(`SELECT COUNT(*) as count FROM detections`);
    const avgConfidence = await getQuery(
      `SELECT AVG(confidence) as avg FROM detections`
    );
    const avgPeak = await getQuery(
      `SELECT AVG(peak) as avg FROM detections`
    );
    const gunshotCount = await getQuery(
      `SELECT COUNT(*) as count FROM detections WHERE label = 'gunshot'`
    );
    const byNode = await allQuery(`
      SELECT node_id, COUNT(*) as count
      FROM detections
      GROUP BY node_id
      ORDER BY count DESC
    `);

    const byDay = await allQuery(`
      SELECT substr(received_at, 1, 10) as day, COUNT(*) as count
      FROM detections
      GROUP BY day
      ORDER BY day DESC
      LIMIT 7
    `);

    res.json({
      totalDetections: total?.count || 0,
      avgConfidence: avgConfidence?.avg || 0,
      avgPeak: avgPeak?.avg || 0,
      gunshotDetections: gunshotCount?.count || 0,
      byNode,
      byDay
    });
  } catch (err) {
    console.error("Stats API error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Manual test endpoint for quick demo without TTN
app.post("/api/test-event", async (req, res) => {
  try {
    const {
      node_id = "test-node",
      label = "gunshot",
      confidence = 0.95,
      peak = 0.87,
      latitude = 46.0569,
      longitude = 14.5058
    } = req.body || {};

    const receivedAt = new Date().toISOString();

    await runQuery(
      `INSERT INTO detections
      (received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receivedAt,
        node_id,
        label,
        confidence,
        peak,
        latitude,
        longitude,
        0,
        0,
        JSON.stringify(req.body || {})
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Test event error:", err);
    res.status(500).json({ error: "Failed to insert test event" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});