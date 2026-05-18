import sqlite3 from 'sqlite3';

const srcPath = '/home/myob11/gunshots.db';
const destPath = '/home/myob11/GunshotDetector/server/gunshots.db';

const db = new sqlite3.Database(destPath);

db.serialize(() => {
  db.run(`ATTACH DATABASE '${srcPath}' AS srcdb`, (err) => {
    if (err) {
      console.error('Attach failed:', err);
      db.close();
      process.exit(1);
    }

    const insertSql = `INSERT INTO detections
      (received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload)
      SELECT received_at, node_id, label, confidence, peak, latitude, longitude, gateway_rssi, gateway_snr, raw_payload
      FROM srcdb.detections`;

    db.run(insertSql, function (err) {
      if (err) {
        console.error('Insert failed:', err);
        db.run("DETACH DATABASE srcdb", () => db.close());
        process.exit(1);
      }

      db.run("DETACH DATABASE srcdb", (err) => {
        if (err) console.error('Detach failed:', err);
        db.get('SELECT COUNT(*) as c FROM detections', (err, row) => {
          if (err) console.error('Count failed:', err);
          else console.log('Server DB row count after copy:', row.c);
          db.close();
        });
      });
    });
  });
});
