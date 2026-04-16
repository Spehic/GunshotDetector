const API_BASE = "https://backend.kbnet.si";

let map;
let markersLayer;

function initMap() {
  map = L.map("map").setView([46.0569, 14.5058], 13); // Ljubljana example

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  const data = await res.json();

  document.getElementById("totalDetections").textContent =
    data.totalDetections ?? 0;
  document.getElementById("gunshotDetections").textContent =
    data.gunshotDetections ?? 0;
  document.getElementById("avgConfidence").textContent =
    Number(data.avgConfidence ?? 0).toFixed(2);
  document.getElementById("avgPeak").textContent =
    Number(data.avgPeak ?? 0).toFixed(2);

  const byNodeList = document.getElementById("byNodeList");
  byNodeList.innerHTML = "";
  (data.byNode || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.node_id}: ${item.count}`;
    byNodeList.appendChild(li);
  });

  const byDayList = document.getElementById("byDayList");
  byDayList.innerHTML = "";
  (data.byDay || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.day}: ${item.count}`;
    byDayList.appendChild(li);
  });
}

async function fetchEvents() {
  const res = await fetch(`${API_BASE}/api/events?limit=100`);
  const events = await res.json();

  const eventList = document.getElementById("eventList");
  eventList.innerHTML = "";
  markersLayer.clearLayers();

  const bounds = [];

  events.forEach((event) => {
    const lat = Number(event.latitude);
    const lng = Number(event.longitude);

    const item = document.createElement("div");
    item.className = "event-item";
    item.innerHTML = `
      <strong>${event.label || "unknown"} | ${event.node_id}</strong>
      <div>Time: ${new Date(event.received_at).toLocaleString()}</div>
      <div>Confidence: ${Number(event.confidence || 0).toFixed(2)}</div>
      <div>Peak: ${Number(event.peak || 0).toFixed(2)}</div>
      <div>Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    `;
    eventList.appendChild(item);

    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
      const marker = L.marker([lat, lng]).addTo(markersLayer);
      marker.bindPopup(`
        <b>${event.label || "unknown"}</b><br/>
        Node: ${event.node_id}<br/>
        Time: ${new Date(event.received_at).toLocaleString()}<br/>
        Confidence: ${Number(event.confidence || 0).toFixed(2)}<br/>
        Peak: ${Number(event.peak || 0).toFixed(2)}
      `);
      bounds.push([lat, lng]);
    }
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

async function sendFakeDetection() {
  await fetch(`${API_BASE}/api/test-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      node_id: "xiao-1",
      label: "gunshot",
      confidence: 0.93,
      peak: 0.81,
      latitude: 46.0569 + (Math.random() - 0.5) * 0.01,
      longitude: 14.5058 + (Math.random() - 0.5) * 0.01
    })
  });

  await refreshAll();
}

async function refreshAll() {
  await Promise.all([fetchStats(), fetchEvents()]);
}

document.getElementById("sendTestBtn").addEventListener("click", sendFakeDetection);

initMap();
refreshAll();

// Refresh every 5 seconds
setInterval(refreshAll, 5000);
