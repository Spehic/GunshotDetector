const API_BASE = "https://backend.kbnet.si";
const EVENT_LIMIT = 1000;

let map;
let markersLayer;
let selectionLayer;
let selectedHalo;
let selectedEventKey = null;
let hasAutoFitted = false;

let allEvents = [];
let markerByKey = new Map();

let timelineChart;
let nodeChart;
let shotTimelineChart;

let lastSeenEventTime = 0;
let lastSeenEventSignature = null;
let lastAlertEventKey = null;
let alertHideTimeout;

const timelineGranularitySelect = document.getElementById("timelineGranularity");
const webhookAlert = document.getElementById("webhookAlert");
const webhookAlertText = document.getElementById("webhookAlertText");
const alertSeeMapBtn = document.getElementById("alertSeeMapBtn");

const shotAxisFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

function initMap() {
  map = L.map("map").setView([46.0569, 14.5058], 13); // Ljubljana example

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  selectionLayer = L.layerGroup().addTo(map);

  map.on("click", clearSelectedEvent);
}

function toDisplayLabel(label) {
  return String(label || "unknown").trim() || "unknown";
}

function buildEventKey(event, index) {
  if (event.id !== undefined && event.id !== null) {
    return `id:${event.id}`;
  }

  return `${event.received_at || "unknown-time"}|${event.node_id || "unknown-node"}|${index}`;
}

function getWeekStart(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

function formatBucketKey(date, granularity) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (granularity === "year") {
    return `${year}`;
  }

  if (granularity === "month") {
    return `${year}-${month}`;
  }

  if (granularity === "week") {
    const weekStart = getWeekStart(date);
    const y = weekStart.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const firstWeekStart = getWeekStart(jan4);
    const diffMs = weekStart - firstWeekStart;
    const weekNumber = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
    return `${y}-W${String(weekNumber).padStart(2, "0")}`;
  }

  return `${year}-${month}-${day}`;
}

function parseBucketToSortableDate(bucket, granularity) {
  if (granularity === "year") {
    return new Date(`${bucket}-01-01T00:00:00Z`);
  }

  if (granularity === "month") {
    return new Date(`${bucket}-01T00:00:00Z`);
  }

  if (granularity === "week") {
    const [yearPart, weekPart] = bucket.split("-W");
    const year = Number(yearPart);
    const week = Number(weekPart);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const firstWeekStart = getWeekStart(jan4);
    firstWeekStart.setUTCDate(firstWeekStart.getUTCDate() + (week - 1) * 7);
    return firstWeekStart;
  }

  return new Date(`${bucket}T00:00:00Z`);
}

function createChartsIfNeeded() {
  const timelineCanvas = document.getElementById("timelineChart");
  const nodeCanvas = document.getElementById("nodeChart");
  const shotTimelineCanvas = document.getElementById("shotTimelineChart");

  if (!timelineChart) {
    timelineChart = new Chart(timelineCanvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Gunshot detections",
            data: [],
            borderColor: "#df5f2d",
            backgroundColor: "rgba(223, 95, 45, 0.20)",
            fill: true,
            tension: 0.25,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            },
            grid: {
              color: "rgba(39, 59, 43, 0.1)"
            }
          },
          x: {
            grid: {
              color: "rgba(39, 59, 43, 0.06)"
            }
          }
        }
      }
    });
  }

  if (!nodeChart) {
    nodeChart = new Chart(nodeCanvas, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Detections",
            data: [],
            backgroundColor: "rgba(26, 109, 90, 0.80)",
            borderColor: "#1a6d5a",
            borderWidth: 1.5,
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: "y",
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0
            },
            grid: {
              color: "rgba(39, 59, 43, 0.1)"
            }
          },
          y: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  if (!shotTimelineChart) {
    shotTimelineChart = new Chart(shotTimelineCanvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Detected shots",
            data: [],
            pointBackgroundColor: "rgba(223, 95, 45, 0.75)",
            pointBorderColor: "#df5f2d",
            pointBorderWidth: 1.4,
            pointRadius(context) {
              return context.raw?.r || 4;
            },
            pointHoverRadius(context) {
              return (context.raw?.r || 4) + 2;
            },
            fill: false,
            showLine: false
          },
          {
            label: "Confidence trend",
            type: "line",
            data: [],
            borderColor: "rgba(26, 109, 90, 0.95)",
            backgroundColor: "rgba(26, 109, 90, 0.2)",
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              color: "#425346"
            }
          },
          tooltip: {
            callbacks: {
              title(items) {
                const x = items[0]?.raw?.x;
                return x ? shotAxisFormatter.format(new Date(x)) : "Detection";
              },
              label(context) {
                if (context.datasetIndex === 1) {
                  return `Trend: ${Number(context.raw.y).toFixed(2)}`;
                }

                const raw = context.raw || {};
                const node = raw.node || "unknown-node";
                const confidence = Number(raw.y || 0).toFixed(2);
                const peak = Number(raw.peak || 0).toFixed(2);
                return `${node} | Confidence: ${confidence} | Peak: ${peak}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 1,
            grid: {
              color: "rgba(39, 59, 43, 0.1)"
            },
            title: {
              display: true,
              text: "Confidence"
            }
          },
          x: {
            type: "linear",
            grid: {
              color: "rgba(39, 59, 43, 0.06)"
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8,
              callback(value) {
                return shotAxisFormatter.format(new Date(value));
              }
            },
            title: {
              display: true,
              text: "Detection Time"
            }
          }
        }
      }
    });
  }
}

function getEventSignature(event) {
  if (!event) {
    return "";
  }

  if (event.id !== undefined && event.id !== null) {
    return `id:${event.id}`;
  }

  return `${event.received_at || "unknown-time"}|${event.node_id || "unknown-node"}|${event.label || "unknown-label"}`;
}

function getLatestEvent(events) {
  let latestEvent = null;
  let latestTime = -1;

  events.forEach((event) => {
    const eventTime = new Date(event.received_at).getTime();
    if (Number.isNaN(eventTime)) {
      return;
    }

    if (eventTime > latestTime) {
      latestTime = eventTime;
      latestEvent = event;
    }
  });

  return latestEvent;
}

function showWebhookAlertForEvent(event, eventKey) {
  if (!webhookAlert || !event) {
    return;
  }

  lastAlertEventKey = eventKey || null;

  if (webhookAlertText) {
    webhookAlertText.textContent = `ALERT: New detection received from /tnt/webhook (${toDisplayLabel(event.label)} | ${event.node_id || "unknown-node"}) at ${new Date(event.received_at).toLocaleTimeString()}`;
  }

  if (alertSeeMapBtn) {
    alertSeeMapBtn.style.display = lastAlertEventKey ? "inline-flex" : "none";
  }

  webhookAlert.classList.add("is-visible");

  if (alertHideTimeout) {
    clearTimeout(alertHideTimeout);
  }

  alertHideTimeout = setTimeout(() => {
    webhookAlert.classList.remove("is-visible");
  }, 8000);
}

function processIncomingAlert(events) {
  const latestEvent = getLatestEvent(events);
  if (!latestEvent) {
    return;
  }

  const latestTime = new Date(latestEvent.received_at).getTime();
  const latestSignature = getEventSignature(latestEvent);
  const latestEventIndex = events.findIndex((event) => event === latestEvent);
  const latestEventKey = latestEventIndex >= 0 ? buildEventKey(latestEvent, latestEventIndex) : null;

  if (!lastSeenEventTime) {
    lastSeenEventTime = latestTime;
    lastSeenEventSignature = latestSignature;
    return;
  }

  const isNewEvent = latestTime > lastSeenEventTime
    || (latestTime === lastSeenEventTime && latestSignature !== lastSeenEventSignature);

  if (isNewEvent) {
    showWebhookAlertForEvent(latestEvent, latestEventKey);
    lastSeenEventTime = latestTime;
    lastSeenEventSignature = latestSignature;
  }
}

function renderTimelineVisuals() {
  createChartsIfNeeded();

  const granularity = timelineGranularitySelect.value;

  const gunshotEvents = allEvents.filter((event) =>
    String(event.label || "").toLowerCase().includes("gunshot")
  );

  const bucketCounts = new Map();
  const nodeCounts = new Map();

  gunshotEvents.forEach((event) => {
    const eventDate = new Date(event.received_at);
    if (Number.isNaN(eventDate.getTime())) {
      return;
    }

    const bucket = formatBucketKey(eventDate, granularity);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);

    const nodeId = event.node_id || "unknown";
    nodeCounts.set(nodeId, (nodeCounts.get(nodeId) || 0) + 1);
  });

  const timelineEntries = [...bucketCounts.entries()].sort((a, b) => {
    const left = parseBucketToSortableDate(a[0], granularity).getTime();
    const right = parseBucketToSortableDate(b[0], granularity).getTime();
    return left - right;
  });

  const timelineLabels = timelineEntries.map(([bucket]) => bucket);
  const timelineData = timelineEntries.map(([, count]) => count);

  const topNodeEntries = [...nodeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const nodeLabels = topNodeEntries.map(([node]) => node);
  const nodeData = topNodeEntries.map(([, count]) => count);

  const sortedShotEvents = [...gunshotEvents].sort((a, b) => {
    const left = new Date(a.received_at).getTime();
    const right = new Date(b.received_at).getTime();
    return left - right;
  });

  const maxShotsOnTimeline = 120;
  const latestShotEvents = sortedShotEvents.slice(-maxShotsOnTimeline);

  const shotScatterData = latestShotEvents
    .map((event) => {
      const timeValue = new Date(event.received_at).getTime();
      if (Number.isNaN(timeValue)) {
        return null;
      }

      const confidence = Number(event.confidence || 0);
      const peak = Number(event.peak || 0);

      return {
        x: timeValue,
        y: confidence,
        r: 4 + Math.min(7, Math.max(0, peak * 8)),
        peak,
        node: event.node_id || "unknown-node"
      };
    })
    .filter(Boolean);

  const rollingWindow = 6;
  const trendData = shotScatterData.map((point, index, arr) => {
    const startIndex = Math.max(0, index - rollingWindow + 1);
    const windowSlice = arr.slice(startIndex, index + 1);
    const avg = windowSlice.reduce((sum, item) => sum + item.y, 0) / windowSlice.length;

    return {
      x: point.x,
      y: avg
    };
  });

  timelineChart.data.labels = timelineLabels;
  timelineChart.data.datasets[0].data = timelineData;
  timelineChart.update("none");

  nodeChart.data.labels = nodeLabels;
  nodeChart.data.datasets[0].data = nodeData;
  nodeChart.update("none");

  shotTimelineChart.data.datasets[0].data = shotScatterData;
  shotTimelineChart.data.datasets[1].data = trendData;
  shotTimelineChart.update("none");
}

function setSelectedEventVisualState(key) {
  document.querySelectorAll(".event-item").forEach((item) => {
    if (item.dataset.eventKey === key) {
      item.classList.add("is-selected");
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    else {
      item.classList.remove("is-selected");
    }
  });
}

function clearSelectedEvent() {
  selectedEventKey = null;
  selectionLayer.clearLayers();
  document.querySelectorAll(".event-item").forEach((item) => {
    item.classList.remove("is-selected");
  });
}

function focusEventByKey(eventKey, zoomToLocation = true) {
  if (!eventKey) {
    clearSelectedEvent();
    return;
  }

  if (selectedEventKey === eventKey) {
    clearSelectedEvent();
    return;
  }

  const marker = markerByKey.get(eventKey);
  if (!marker) {
    clearSelectedEvent();
    return;
  }

  selectedEventKey = eventKey;
  selectionLayer.clearLayers();

  const latLng = marker.getLatLng();

  if (zoomToLocation) {
    map.flyTo(latLng, Math.max(map.getZoom(), 16), {
      duration: 0.8
    });
  }

  selectedHalo = L.circleMarker(latLng, {
    radius: 16,
    color: "#ff5a36",
    weight: 3,
    fillColor: "#ffd4c6",
    fillOpacity: 0.45,
    interactive: false
  }).addTo(selectionLayer);

  marker.openPopup();
  setSelectedEventVisualState(eventKey);
}

async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  if (!res.ok) {
    throw new Error(`Stats request failed (${res.status})`);
  }

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
  const res = await fetch(`${API_BASE}/api/events?limit=${EVENT_LIMIT}`);
  if (!res.ok) {
    throw new Error(`Events request failed (${res.status})`);
  }

  const events = await res.json();
  allEvents = Array.isArray(events) ? events : [];
  processIncomingAlert(allEvents);

  const eventList = document.getElementById("eventList");
  eventList.innerHTML = "";
  markersLayer.clearLayers();
  markerByKey = new Map();

  const bounds = [];

  allEvents.forEach((event, index) => {
    const eventKey = buildEventKey(event, index);
    const lat = Number(event.latitude);
    const lng = Number(event.longitude);
    const label = toDisplayLabel(event.label);

    const item = document.createElement("div");
    item.className = "event-item";
    item.dataset.eventKey = eventKey;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.innerHTML = `
      <strong>${label} | ${event.node_id || "unknown-node"}</strong>
      <div>Time: ${new Date(event.received_at).toLocaleString()}</div>
      <div>Confidence: ${Number(event.confidence || 0).toFixed(2)}</div>
      <div>Peak: ${Number(event.peak || 0).toFixed(2)}</div>
      <div>Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    `;

    item.addEventListener("click", () => {
      focusEventByKey(eventKey, true);
    });

    item.addEventListener("keydown", (eventObj) => {
      if (eventObj.key === "Enter" || eventObj.key === " ") {
        eventObj.preventDefault();
        focusEventByKey(eventKey, true);
      }
    });

    eventList.appendChild(item);

    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
      const marker = L.marker([lat, lng]).addTo(markersLayer);
      marker.bindPopup(`
        <b>${label}</b><br/>
        Node: ${event.node_id || "unknown-node"}<br/>
        Time: ${new Date(event.received_at).toLocaleString()}<br/>
        Confidence: ${Number(event.confidence || 0).toFixed(2)}<br/>
        Peak: ${Number(event.peak || 0).toFixed(2)}
      `);

      marker.on("click", () => {
        focusEventByKey(eventKey, false);
      });

      markerByKey.set(eventKey, marker);
      bounds.push([lat, lng]);
    }
  });

  if (!hasAutoFitted && bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30] });
    hasAutoFitted = true;
  }

  if (selectedEventKey && markerByKey.has(selectedEventKey)) {
    focusEventByKey(selectedEventKey, false);
  }
  else {
    clearSelectedEvent();
  }

  renderTimelineVisuals();
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
  try {
    await Promise.all([fetchStats(), fetchEvents()]);
  }
  catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to refresh dashboard:", error);
  }
}

document.getElementById("sendTestBtn").addEventListener("click", sendFakeDetection);
timelineGranularitySelect.addEventListener("change", renderTimelineVisuals);

if (alertSeeMapBtn) {
  alertSeeMapBtn.addEventListener("click", () => {
    if (!lastAlertEventKey) {
      return;
    }

    focusEventByKey(lastAlertEventKey, true);
    document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

initMap();
refreshAll();

// Refresh every 5 seconds
setInterval(refreshAll, 5000);
