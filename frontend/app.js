const API_BASE = "https://backend.kbnet.si";
const EVENT_LIMIT = 1000;

let map;
let markersLayer;
let selectionLayer;
let selectedHalo;
let mapHeatLayer;
let selectedEventKey = null;
let hasAutoFitted = false;

let allEvents = [];
let markerByKey = new Map();

let timelineChart;
let nodeChart;
let shotTimelineChart;
let hourlyHeatmapChart;
let showHourlyHeatmap = false;

let lastSeenEventTime = 0;
let lastSeenEventSignature = null;
let lastAlertEventKey = null;
let alertHideTimeout;
let liveDetectionCount = 0;
let showMapHeatmap = true;

const timelineGranularitySelect = document.getElementById("timelineGranularity");
const webhookAlert = document.getElementById("webhookAlert");
const webhookAlertText = document.getElementById("webhookAlertText");
const alertSeeMapBtn = document.getElementById("alertSeeMapBtn");
const themeToggle = document.getElementById("themeToggle");
const toggleHourlyHeatmap = document.getElementById("toggleHourlyHeatmap");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const liveCounterDisplay = document.getElementById("liveCounter");
const toggleMapHeatmapBtn = document.getElementById("toggleMapHeatmap");

const shotAxisFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const chartThemePlugin = {
  id: "chartThemePlugin",
  beforeDraw(chart, _args, opts) {
    const { ctx, chartArea } = chart;
    if (!chartArea || !opts?.backgroundColor) {
      return;
    }

    ctx.save();
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );
    ctx.restore();
  }
};

if (typeof Chart !== "undefined") {
  Chart.register(chartThemePlugin);
}

function getChartThemePalette() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  if (isDark) {
    return {
      text: "#e2e8f0",
      gridStrong: "rgba(148, 163, 184, 0.2)",
      gridSoft: "rgba(148, 163, 184, 0.12)",
      chartBg: "rgba(15, 23, 42, 0.5)",
      timelineLine: "#fb923c",
      timelineFill: "rgba(251, 146, 60, 0.2)",
      nodeFill: "rgba(45, 212, 191, 0.72)",
      nodeBorder: "#2dd4bf",
      shotPointFill: "rgba(251, 146, 60, 0.75)",
      shotPointBorder: "#fb923c",
      trendLine: "rgba(52, 211, 153, 0.95)",
      heatmapFill: "rgba(251, 146, 60, 0.55)",
      heatmapBorder: "#fb923c"
    };
  }

  return {
    text: "#425346",
    gridStrong: "rgba(39, 59, 43, 0.1)",
    gridSoft: "rgba(39, 59, 43, 0.06)",
    chartBg: "rgba(255, 255, 255, 0.55)",
    timelineLine: "#df5f2d",
    timelineFill: "rgba(223, 95, 45, 0.2)",
    nodeFill: "rgba(26, 109, 90, 0.8)",
    nodeBorder: "#1a6d5a",
    shotPointFill: "rgba(223, 95, 45, 0.75)",
    shotPointBorder: "#df5f2d",
    trendLine: "rgba(26, 109, 90, 0.95)",
    heatmapFill: "rgba(223, 95, 45, 0.6)",
    heatmapBorder: "#df5f2d"
  };
}

function applyChartTheme() {
  const palette = getChartThemePalette();

  if (timelineChart) {
    timelineChart.data.datasets[0].borderColor = palette.timelineLine;
    timelineChart.data.datasets[0].backgroundColor = palette.timelineFill;
    timelineChart.options.plugins.chartThemePlugin = { backgroundColor: palette.chartBg };
    timelineChart.options.scales.y.grid.color = palette.gridStrong;
    timelineChart.options.scales.x.grid.color = palette.gridSoft;
    timelineChart.options.scales.y.ticks.color = palette.text;
    timelineChart.options.scales.x.ticks.color = palette.text;
    timelineChart.update("none");
  }

  if (nodeChart) {
    nodeChart.data.datasets[0].backgroundColor = palette.nodeFill;
    nodeChart.data.datasets[0].borderColor = palette.nodeBorder;
    nodeChart.options.plugins.chartThemePlugin = { backgroundColor: palette.chartBg };
    nodeChart.options.scales.x.grid.color = palette.gridStrong;
    nodeChart.options.scales.x.ticks.color = palette.text;
    nodeChart.options.scales.y.ticks.color = palette.text;
    nodeChart.update("none");
  }

  if (shotTimelineChart) {
    shotTimelineChart.data.datasets[0].pointBackgroundColor = palette.shotPointFill;
    shotTimelineChart.data.datasets[0].pointBorderColor = palette.shotPointBorder;
    shotTimelineChart.data.datasets[1].borderColor = palette.trendLine;
    shotTimelineChart.data.datasets[1].backgroundColor = "rgba(26, 109, 90, 0.2)";
    shotTimelineChart.options.plugins.chartThemePlugin = { backgroundColor: palette.chartBg };
    shotTimelineChart.options.plugins.legend.labels.color = palette.text;
    shotTimelineChart.options.scales.y.grid.color = palette.gridStrong;
    shotTimelineChart.options.scales.x.grid.color = palette.gridSoft;
    shotTimelineChart.options.scales.y.ticks.color = palette.text;
    shotTimelineChart.options.scales.x.ticks.color = palette.text;
    shotTimelineChart.options.scales.y.title.color = palette.text;
    shotTimelineChart.options.scales.x.title.color = palette.text;
    shotTimelineChart.update("none");
  }

  if (hourlyHeatmapChart) {
    if (hourlyHeatmapChart.data.datasets[0]) {
      hourlyHeatmapChart.data.datasets[0].backgroundColor = palette.heatmapFill;
      hourlyHeatmapChart.data.datasets[0].borderColor = palette.heatmapBorder;
    }
    hourlyHeatmapChart.options.plugins.chartThemePlugin = { backgroundColor: palette.chartBg };
    hourlyHeatmapChart.options.scales.y.ticks.color = palette.text;
    hourlyHeatmapChart.options.scales.x.ticks.color = palette.text;
    hourlyHeatmapChart.options.scales.y.title.color = palette.text;
    hourlyHeatmapChart.options.scales.x.title.color = palette.text;
    hourlyHeatmapChart.options.scales.y.grid.color = palette.gridStrong;
    hourlyHeatmapChart.options.scales.x.grid.color = palette.gridSoft;
    hourlyHeatmapChart.update("none");
  }
}

function initMap() {
  map = L.map("map").setView([46.0569, 14.5058], 13); // Ljubljana example

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  selectionLayer = L.layerGroup().addTo(map);

  if (typeof L.heatLayer === "function") {
    mapHeatLayer = L.heatLayer([], {
      radius: 26,
      blur: 20,
      maxZoom: 17,
      gradient: {
        0.2: "#1a6d5a",
        0.45: "#22c55e",
        0.7: "#f59e0b",
        1.0: "#ef4444"
      }
    }).addTo(map);
  }

  map.on("click", clearSelectedEvent);
}

function updateMapHeatmap(events) {
  if (!map || !mapHeatLayer) {
    return;
  }

  const heatPoints = events
    .filter((event) => String(event.label || "").toLowerCase().includes("gunshot"))
    .map((event) => {
      const lat = Number(event.latitude);
      const lng = Number(event.longitude);
      const confidence = Number(event.confidence || 0);
      if (Number.isNaN(lat) || Number.isNaN(lng) || lat === 0 || lng === 0) {
        return null;
      }

      const weight = Math.min(1, Math.max(0.1, confidence || 0.1));
      return [lat, lng, weight];
    })
    .filter(Boolean);

  mapHeatLayer.setLatLngs(heatPoints);

  if (showMapHeatmap) {
    if (!map.hasLayer(mapHeatLayer)) {
      map.addLayer(mapHeatLayer);
    }
  }
  else if (map.hasLayer(mapHeatLayer)) {
    map.removeLayer(mapHeatLayer);
  }
}

function initThemeToggle() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeToggleIcon(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
      const newTheme = currentTheme === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      updateThemeToggleIcon(newTheme);
      applyChartTheme();
    });
  }
}

function updateThemeToggleIcon(theme) {
  if (themeToggle) {
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  }
}

function toDisplayLabel(label) {
  return String(label || "unknown").trim() || "unknown";
}

function getThreatLevel(confidence) {
  if (confidence >= 0.85) {
    return "threat-red";
  }
  if (confidence >= 0.7) {
    return "threat-yellow";
  }
  return "threat-green";
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
  const palette = getChartThemePalette();
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
            borderColor: palette.timelineLine,
            backgroundColor: palette.timelineFill,
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
          chartThemePlugin: {
            backgroundColor: palette.chartBg
          },
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: palette.text
            },
            grid: {
              color: palette.gridStrong
            }
          },
          x: {
            ticks: {
              color: palette.text
            },
            grid: {
              color: palette.gridSoft
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
            backgroundColor: palette.nodeFill,
            borderColor: palette.nodeBorder,
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
          chartThemePlugin: {
            backgroundColor: palette.chartBg
          },
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: palette.text
            },
            grid: {
              color: palette.gridStrong
            }
          },
          y: {
            ticks: {
              color: palette.text
            },
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
            pointBackgroundColor: palette.shotPointFill,
            pointBorderColor: palette.shotPointBorder,
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
            borderColor: palette.trendLine,
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
          chartThemePlugin: {
            backgroundColor: palette.chartBg
          },
          legend: {
            display: true,
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              color: palette.text
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
              color: palette.gridStrong
            },
            ticks: {
              color: palette.text
            },
            title: {
              display: true,
              text: "Confidence",
              color: palette.text
            }
          },
          x: {
            type: "linear",
            grid: {
              color: palette.gridSoft
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8,
              color: palette.text,
              callback(value) {
                return shotAxisFormatter.format(new Date(value));
              }
            },
            title: {
              display: true,
              text: "Detection Time",
              color: palette.text
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

  if (!hourlyHeatmapChart) {
    const palette = getChartThemePalette();
    hourlyHeatmapChart = new Chart(document.getElementById("hourlyHeatmapChart"), {
      type: "bubble",
      data: {
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          chartThemePlugin: {
            backgroundColor: palette.chartBg
          },
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `Detections: ${context.raw.r || 0}`;
              }
            }
          }
        },
        scales: {
          y: {
            min: 0,
            max: 7,
            ticks: {
              stepSize: 1,
              color: palette.text,
              callback(value) {
                const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                return days[value];
              }
            },
            title: {
              display: true,
              text: "Day of Week",
              color: palette.text
            },
            grid: {
              color: palette.gridStrong
            }
          },
          x: {
            min: 0,
            max: 24,
            ticks: {
              stepSize: 1,
              color: palette.text
            },
            title: {
              display: true,
              text: "Hour of Day",
              color: palette.text
            },
            grid: {
              color: palette.gridSoft
            }
          }
        }
      }
    });
  }
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
  const newEvents = Array.isArray(events) ? events : [];
  
  liveDetectionCount = newEvents.length;
  if (liveCounterDisplay) {
    liveCounterDisplay.textContent = liveDetectionCount;
  }

  allEvents = newEvents;
  updateMapHeatmap(allEvents);
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
    const confidence = Number(event.confidence || 0);
    const threatClass = getThreatLevel(confidence);

    const item = document.createElement("div");
    item.className = `event-item ${threatClass}`;
    item.dataset.eventKey = eventKey;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.innerHTML = `
      <strong>${label} | ${event.node_id || "unknown-node"}</strong>
      <div>Time: ${new Date(event.received_at).toLocaleString()}</div>
      <div>Confidence: ${confidence.toFixed(2)}</div>
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
        Confidence: ${confidence.toFixed(2)}<br/>
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
    console.error("Failed to refresh dashboard:", error);
  }
}

function exportToCSV() {
  const headers = ["timestamp", "label", "node_id", "confidence", "peak", "latitude", "longitude"];
  const rows = allEvents.map((event) => [
    event.received_at,
    event.label,
    event.node_id,
    event.confidence,
    event.peak,
    event.latitude,
    event.longitude
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `gunshot-detections-${new Date().toISOString().split("T")[0]}.csv`);
  link.click();
  URL.revokeObjectURL(url);
}

function exportToPDF() {
  const JsPdfCtor = window.jsPDF || window.jspdf?.jsPDF;
  if (typeof JsPdfCtor === "undefined") {
    alert("PDF export requires jsPDF library. Please add it manually or use CSV export.");
    return;
  }

  const doc = new JsPdfCtor();
  const timestamp = new Date().toLocaleString();
  const gunshotCount = allEvents.filter((e) => String(e.label || "").toLowerCase().includes("gunshot")).length;

  doc.setFontSize(16);
  doc.text("Gunshot Detection Report", 10, 10);

  doc.setFontSize(10);
  doc.text(`Generated: ${timestamp}`, 10, 20);
  doc.text(`Total Detections: ${allEvents.length}`, 10, 28);
  doc.text(`Gunshot Detections: ${gunshotCount}`, 10, 36);

  const gunshotEvents = allEvents.filter((e) => String(e.label || "").toLowerCase().includes("gunshot")).slice(-20);
  let yPos = 45;

  doc.setFontSize(11);
  doc.text("Recent Gunshot Events:", 10, yPos);
  yPos += 8;

  doc.setFontSize(8);
  gunshotEvents.forEach((event) => {
    const text = `${new Date(event.received_at).toLocaleString()} | ${event.node_id} | Conf: ${Number(event.confidence || 0).toFixed(2)}`;
    doc.text(text, 10, yPos);
    yPos += 6;
    if (yPos > 280) {
      doc.addPage();
      yPos = 10;
    }
  });

  doc.save(`gunshot-report-${new Date().toISOString().split("T")[0]}.pdf`);
}

document.getElementById("sendTestBtn").addEventListener("click", sendFakeDetection);
timelineGranularitySelect.addEventListener("change", renderTimelineVisuals);

if (toggleHourlyHeatmap) {
  toggleHourlyHeatmap.addEventListener("click", () => {
    showHourlyHeatmap = !showHourlyHeatmap;
    const container = document.querySelector(".hourly-heatmap-container");
    if (showHourlyHeatmap) {
      container.classList.add("visible");
      toggleHourlyHeatmap.classList.add("active");
    }
    else {
      container.classList.remove("visible");
      toggleHourlyHeatmap.classList.remove("active");
    }
  });
}

if (exportPdfBtn) {
  exportPdfBtn.addEventListener("click", exportToPDF);
}

if (exportCsvBtn) {
  exportCsvBtn.addEventListener("click", exportToCSV);
}

if (toggleMapHeatmapBtn) {
  toggleMapHeatmapBtn.addEventListener("click", () => {
    showMapHeatmap = !showMapHeatmap;
    toggleMapHeatmapBtn.classList.toggle("active", showMapHeatmap);
    toggleMapHeatmapBtn.textContent = showMapHeatmap ? "Hide map heatmap" : "Show map heatmap";

    if (mapHeatLayer && map) {
      if (showMapHeatmap && !map.hasLayer(mapHeatLayer)) {
        map.addLayer(mapHeatLayer);
      }
      if (!showMapHeatmap && map.hasLayer(mapHeatLayer)) {
        map.removeLayer(mapHeatLayer);
      }
    }
  });
}

if (alertSeeMapBtn) {
  alertSeeMapBtn.addEventListener("click", () => {
    if (!lastAlertEventKey) {
      return;
    }

    focusEventByKey(lastAlertEventKey, true);
    document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

initThemeToggle();
initMap();
refreshAll();
applyChartTheme();

// Refresh every 5 seconds
setInterval(refreshAll, 5000);
