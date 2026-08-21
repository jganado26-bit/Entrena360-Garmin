"use strict";

const STORAGE_KEY = "territorio360-state-v1";
const CELL_SIZE = 0.001;
const DEFAULT_CENTER = [41.5035, -5.7460];
const MAX_TRACK_POINTS = 5000;

const MODE_DATA = {
  run:  { label: "Correr",    icon: "🏃", color: "#c9f35b", multiplier: 1,    maxSpeed: 12 },
  walk: { label: "Caminar",   icon: "🥾", color: "#ffca69", multiplier: 1.1,  maxSpeed: 7 },
  bike: { label: "Bicicleta", icon: "🚴", color: "#6fc4ff", multiplier: 0.58, maxSpeed: 30 },
  swim: { label: "Nadar",     icon: "🏊", color: "#45b9f3", multiplier: 1.4,  maxSpeed: 5 }
};

const ENVIRONMENT_DATA = {
  urban: "Urbano",
  country: "Campo y caminos",
  forest: "Bosque",
  mountain: "Montaña",
  coast: "Costa",
  water: "Río, lago o piscina"
};

const WAYPOINT_DATA = {
  treasure: { label: "Tesoro", icon: "🧭" },
  viewpoint: { label: "Mirador", icon: "🔭" },
  nature: { label: "Naturaleza", icon: "🌿" },
  history: { label: "Lugar histórico", icon: "🏛️" },
  water: { label: "Rincón de agua", icon: "💧" }
};

const BADGES = [
  { id: "first", icon: "🚩", name: "Primer paso", detail: "5 parcelas", test: s => claimedCount(s) >= 5 },
  { id: "mapmaker", icon: "🗺️", name: "Cartógrafo", detail: "25 parcelas", test: s => claimedCount(s) >= 25 },
  { id: "century", icon: "💯", name: "Gran dominio", detail: "100 parcelas", test: s => claimedCount(s) >= 100 },
  { id: "allrounder", icon: "🧩", name: "Todoterreno", detail: "4 modalidades", test: s => usedModes(s).size >= 4 },
  { id: "wanderer", icon: "🌍", name: "Sin fronteras", detail: "3 entornos", test: s => usedEnvironments(s).size >= 3 },
  { id: "seeker", icon: "✨", name: "Buscador", detail: "3 hallazgos", test: s => discoveredCount(s) >= 3 }
];

let state = loadState();
let map;
let territoryLayer;
let waypointLayer;
let activeRoute;
let positionMarker;
let accuracyCircle;
let watchId = null;
let timerId = null;
let installPrompt = null;
let pendingWaypointPosition = null;
let demoTimer = null;
let toastTimer = null;
let drawnCellIds = new Set();

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (typeof L === "undefined") {
    showToast("No se pudo cargar el mapa. Comprueba la conexión.");
    return;
  }

  setupMap();
  bindEvents();
  renderAll();
  restoreActiveSession();
  registerServiceWorker();
}

function defaultState() {
  return {
    version: 1,
    profile: { name: "Jesús" },
    claimed: {},
    activities: [],
    waypoints: [],
    active: null
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object") return defaultState();
    const clean = defaultState();
    return {
      ...clean,
      ...parsed,
      profile: { ...clean.profile, ...(parsed.profile || {}) },
      claimed: parsed.claimed && typeof parsed.claimed === "object" ? parsed.claimed : {},
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
      waypoints: Array.isArray(parsed.waypoints) ? parsed.waypoints : []
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error(error);
    showToast("No queda espacio para guardar más recorridos en este dispositivo.");
  }
}

function setupMap() {
  map = L.map("map", {
    center: DEFAULT_CENTER,
    zoom: 14,
    zoomControl: false,
    preferCanvas: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"
  }).addTo(map);

  L.control.zoom({ position: "topright" }).addTo(map);
  territoryLayer = L.layerGroup().addTo(map);
  waypointLayer = L.layerGroup().addTo(map);
  activeRoute = L.polyline([], { color: "#f4fff9", weight: 5, opacity: .92, lineCap: "round" }).addTo(map);

  map.on("contextmenu", event => openWaypointDialog(event.latlng));
}

function bindEvents() {
  $$(".bottom-nav button").forEach(button => button.addEventListener("click", () => showView(button.dataset.target)));
  $("#openStartButton").addEventListener("click", () => $("#startDialog").showModal());
  $("#startForm").addEventListener("submit", handleStartForm);
  $("#pauseButton").addEventListener("click", togglePause);
  $("#stopButton").addEventListener("click", () => finalizeActiveActivity());
  $("#locateButton").addEventListener("click", locateOnce);
  $("#addWaypointButton").addEventListener("click", () => openWaypointDialog(map.getCenter()));
  $("#waypointForm").addEventListener("submit", saveWaypoint);
  $("#waypointList").addEventListener("click", handleWaypointListClick);
  $("#saveProfileButton").addEventListener("click", saveProfile);
  $("#openImportButton").addEventListener("click", () => $("#importDialog").showModal());
  $("#gpxFile").addEventListener("change", updateGpxFileName);
  $("#importForm").addEventListener("submit", handleGpxImport);
  $("#demoButton").addEventListener("click", startDemo);
  $("#backupButton").addEventListener("click", exportBackup);
  $("#exportButton").addEventListener("click", exportBackup);
  $("#importBackupButton").addEventListener("click", () => $("#backupFile").click());
  $("#backupFile").addEventListener("change", importBackup);
  $("#resetButton").addEventListener("click", resetData);
  $("#installButton").addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    $("#installButton").hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("#installButton").hidden = true;
    showToast("Territorio 360 ya está instalada.");
  });
}

function showView(target) {
  $$(".view").forEach(view => {
    const active = view.dataset.view === target;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  $$(".bottom-nav button").forEach(button => {
    const active = button.dataset.target === target;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (target === "map") setTimeout(() => map.invalidateSize(), 60);
  else renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleStartForm(event) {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === "cancel") {
    $("#startDialog").close();
    return;
  }
  if (state.active) {
    showToast("Ya hay una aventura en marcha.");
    $("#startDialog").close();
    return;
  }
  const data = new FormData(event.currentTarget);
  startActivity(data.get("mode"), data.get("environment"));
  $("#startDialog").close();
}

function startActivity(mode, environment, options = {}) {
  if (!MODE_DATA[mode]) mode = "run";
  if (!ENVIRONMENT_DATA[environment]) environment = "country";
  const now = Date.now();
  state.active = {
    id: makeId(),
    mode,
    environment,
    source: options.source || "gps",
    demo: Boolean(options.demo),
    startTime: now,
    pausedAt: null,
    totalPausedMs: 0,
    paused: false,
    points: [],
    distanceMeters: 0,
    newCellIds: [],
    discoveredIds: []
  };
  saveState();
  updateSessionPanel();
  activeRoute.setLatLngs([]);
  if (!options.demo) startWatchingPosition();
  startTimer();
  showToast(`${MODE_DATA[mode].icon} Aventura iniciada`);
}

function restoreActiveSession() {
  if (!state.active) return;
  state.active.paused = true;
  state.active.pausedAt = Date.now();
  saveState();
  activeRoute.setLatLngs(state.active.points.map(point => [point.lat, point.lng]));
  updateSessionPanel();
  startTimer();
  if (state.active.points.length) {
    map.fitBounds(activeRoute.getBounds(), { padding: [50, 170], maxZoom: 17 });
  }
  showToast("Tienes una aventura pausada. Pulsa Reanudar para continuar.");
}

function startWatchingPosition() {
  if (!state.active || state.active.paused || state.active.demo) return;
  clearPositionWatch();
  if (!("geolocation" in navigator)) {
    updateGpsStatus("Este dispositivo no ofrece ubicación GPS.", "error");
    return;
  }
  updateGpsStatus("Buscando señal GPS…", "waiting");
  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handlePositionError,
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
  );
}

function handlePosition(position) {
  const coords = position.coords;
  updatePositionMarker(coords.latitude, coords.longitude, coords.accuracy);
  if (!state.active || state.active.paused) return;

  if (coords.accuracy > 80) {
    updateGpsStatus(`Señal débil (±${Math.round(coords.accuracy)} m)`, "waiting");
    return;
  }

  const point = {
    lat: Number(coords.latitude.toFixed(7)),
    lng: Number(coords.longitude.toFixed(7)),
    time: position.timestamp || Date.now(),
    accuracy: Math.round(coords.accuracy)
  };
  acceptTrackPoint(point);
  updateGpsStatus(`GPS listo · precisión ±${point.accuracy} m`, "ready");
}

function acceptTrackPoint(point, options = {}) {
  const active = state.active;
  if (!active || active.paused) return false;
  const previous = active.points.at(-1);

  if (previous) {
    const segment = haversine(previous.lat, previous.lng, point.lat, point.lng);
    const seconds = Math.max(1, (point.time - previous.time) / 1000);
    const speed = segment / seconds;
    const maxSpeed = MODE_DATA[active.mode].maxSpeed;
    if (!options.force && speed > maxSpeed) {
      updateGpsStatus("Salto de GPS descartado", "waiting");
      return false;
    }
    if (!options.force && segment < 3) return false;
    active.distanceMeters += segment;
    claimSegment(previous, point, active.mode);
  } else {
    claimCell(point.lat, point.lng, active.mode);
  }

  active.points.push(point);
  if (active.points.length > MAX_TRACK_POINTS) {
    active.points = active.points.filter((_, index) => index % 2 === 0);
  }

  activeRoute.addLatLng([point.lat, point.lng]);
  discoverNearbyWaypoints(point.lat, point.lng);
  updateLiveStats();
  if (active.points.length === 1) map.setView([point.lat, point.lng], 17);
  else if (!options.noFollow) map.panTo([point.lat, point.lng], { animate: true, duration: .35 });
  if (active.points.length % 5 === 0) saveState();
  return true;
}

function handlePositionError(error) {
  const messages = {
    1: "Permiso de ubicación denegado",
    2: "No se encuentra la señal GPS",
    3: "El GPS tarda demasiado en responder"
  };
  updateGpsStatus(messages[error.code] || "No se pudo leer la ubicación", "error");
}

function locateOnce() {
  if (!("geolocation" in navigator)) {
    showToast("Este dispositivo no ofrece ubicación GPS.");
    return;
  }
  $("#locateButton").textContent = "…";
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    updatePositionMarker(latitude, longitude, accuracy);
    map.setView([latitude, longitude], 17);
    $("#locateButton").textContent = "⌖";
  }, error => {
    handlePositionError(error);
    $("#locateButton").textContent = "⌖";
    showToast("No he podido obtener tu posición.");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 });
}

function updatePositionMarker(lat, lng, accuracy = 0) {
  if (!positionMarker) {
    positionMarker = L.circleMarker([lat, lng], {
      radius: 8, color: "#ffffff", weight: 3, fillColor: "#4ce0b3", fillOpacity: 1
    }).addTo(map);
    accuracyCircle = L.circle([lat, lng], {
      radius: accuracy, color: "#4ce0b3", weight: 1, fillColor: "#4ce0b3", fillOpacity: .08
    }).addTo(map);
  } else {
    positionMarker.setLatLng([lat, lng]);
    accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
  }
}

function togglePause() {
  const active = state.active;
  if (!active) return;
  if (active.paused) {
    active.totalPausedMs += Math.max(0, Date.now() - (active.pausedAt || Date.now()));
    active.pausedAt = null;
    active.paused = false;
    $("#pauseButton").textContent = "Pausar";
    if (!active.demo) startWatchingPosition();
    updateGpsStatus(active.demo ? "Recorrido simulado" : "Buscando señal GPS…", "waiting");
  } else {
    active.paused = true;
    active.pausedAt = Date.now();
    clearPositionWatch();
    $("#pauseButton").textContent = "Reanudar";
    updateGpsStatus("Aventura pausada", "waiting");
  }
  saveState();
  updateLiveStats();
}

function finalizeActiveActivity(options = {}) {
  const active = state.active;
  if (!active) return;
  if (!options.skipConfirm && !window.confirm("¿Finalizar esta aventura y guardar el territorio conquistado?")) return;

  clearPositionWatch();
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }

  const hasMovement = active.distanceMeters >= 20 || active.newCellIds.length > 1;
  if (!hasMovement && !options.keepShort) {
    active.newCellIds.forEach(id => delete state.claimed[id]);
    state.active = null;
    saveState();
    activeRoute.setLatLngs([]);
    updateSessionPanel();
    renderAll();
    showToast("Aventura descartada: el recorrido era demasiado corto.");
    return;
  }

  const endTime = Date.now();
  const pausedMs = active.totalPausedMs + (active.paused && active.pausedAt ? endTime - active.pausedAt : 0);
  const durationSeconds = options.durationOverride || Math.max(1, Math.round((endTime - active.startTime - pausedMs) / 1000));
  const score = scoreFor(active.mode, active.newCellIds.length, active.distanceMeters, active.discoveredIds.length);
  const activity = {
    id: active.id,
    mode: active.mode,
    environment: active.environment,
    source: active.source,
    demo: active.demo,
    startTime: active.startTime,
    endTime,
    durationSeconds,
    distanceMeters: Math.round(active.distanceMeters),
    points: active.points,
    newCellIds: active.newCellIds,
    discoveredIds: active.discoveredIds,
    score
  };

  state.activities.unshift(activity);
  state.active = null;
  saveState();
  stopTimer();
  updateSessionPanel();
  renderAll();
  if (activity.points.length > 1) map.fitBounds(activeRoute.getBounds(), { padding: [40, 180], maxZoom: 17 });
  showToast(`Aventura guardada · +${score} puntos`);
}

function clearPositionWatch() {
  if (watchId !== null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function startTimer() {
  stopTimer();
  timerId = window.setInterval(updateLiveStats, 1000);
  updateLiveStats();
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function elapsedSeconds(active = state.active) {
  if (!active) return 0;
  const now = active.paused && active.pausedAt ? active.pausedAt : Date.now();
  return Math.max(0, Math.round((now - active.startTime - active.totalPausedMs) / 1000));
}

function updateSessionPanel() {
  const active = Boolean(state.active);
  $("#sessionIdle").hidden = active;
  $("#sessionActive").hidden = !active;
  if (!active) {
    stopTimer();
    return;
  }
  $("#pauseButton").textContent = state.active.paused ? "Reanudar" : "Pausar";
  updateLiveStats();
}

function updateLiveStats() {
  const active = state.active;
  if (!active) return;
  const seconds = elapsedSeconds(active);
  $("#liveTime").textContent = formatDuration(seconds);
  $("#liveDistance").textContent = `${formatNumber(active.distanceMeters / 1000, 2)} km`;
  $("#liveCells").textContent = active.newCellIds.length;
  $("#livePace").textContent = formatPace(seconds, active.distanceMeters, active.mode);
  const liveScore = scoreFor(active.mode, active.newCellIds.length, active.distanceMeters, active.discoveredIds.length);
  $("#mapScore").textContent = formatInteger(totalScore(state) + liveScore);
  $("#mapDistance").textContent = formatNumber(totalDistanceMeters(state) / 1000 + active.distanceMeters / 1000, 2);
  $("#mapCellCount").textContent = formatInteger(claimedCount(state));
}

function updateGpsStatus(message, status) {
  $("#gpsStatus").textContent = message;
  $("#gpsDot").className = status === "ready" ? "ready" : status === "error" ? "error" : "";
}

function cellIdFor(lat, lng) {
  const y = Math.floor((lat + 90) / CELL_SIZE);
  const x = Math.floor((lng + 180) / CELL_SIZE);
  return `${y}_${x}`;
}

function cellBounds(id) {
  const [y, x] = id.split("_").map(Number);
  const south = y * CELL_SIZE - 90;
  const west = x * CELL_SIZE - 180;
  return [[south, west], [south + CELL_SIZE, west + CELL_SIZE]];
}

function claimCell(lat, lng, mode, at = Date.now()) {
  const id = cellIdFor(lat, lng);
  if (state.claimed[id]) return false;
  state.claimed[id] = { at, mode };
  if (state.active && !state.active.newCellIds.includes(id)) state.active.newCellIds.push(id);
  drawClaimedCell(id, state.claimed[id]);
  return true;
}

function claimSegment(from, to, mode) {
  const distance = haversine(from.lat, from.lng, to.lat, to.lng);
  const steps = Math.max(1, Math.ceil(distance / 25));
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    claimCell(
      from.lat + (to.lat - from.lat) * ratio,
      from.lng + (to.lng - from.lng) * ratio,
      mode,
      to.time || Date.now()
    );
  }
}

function drawClaimedCell(id, claim) {
  if (!territoryLayer || drawnCellIds.has(id)) return;
  const color = MODE_DATA[claim.mode]?.color || MODE_DATA.run.color;
  L.rectangle(cellBounds(id), {
    cellId: id,
    className: "claimed-cell",
    color,
    weight: 1,
    opacity: .72,
    fillColor: color,
    fillOpacity: .29,
    interactive: false
  }).addTo(territoryLayer);
  drawnCellIds.add(id);
}

function renderTerritoryOnMap() {
  territoryLayer.clearLayers();
  drawnCellIds = new Set();
  Object.entries(state.claimed).forEach(([id, claim]) => drawClaimedCell(id, claim));
}

function openWaypointDialog(latlng) {
  pendingWaypointPosition = { lat: latlng.lat, lng: latlng.lng };
  $("#waypointCoordinates").textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  $("#waypointName").value = "";
  $("#waypointDialog").showModal();
}

function saveWaypoint(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#waypointDialog").close();
    return;
  }
  if (!pendingWaypointPosition) return;
  const data = new FormData(event.currentTarget);
  state.waypoints.push({
    id: makeId(),
    name: String(data.get("name") || "Lugar por descubrir").trim(),
    type: String(data.get("type") || "treasure"),
    lat: pendingWaypointPosition.lat,
    lng: pendingWaypointPosition.lng,
    createdAt: Date.now(),
    discoveredAt: null,
    discoveredBy: null
  });
  saveState();
  pendingWaypointPosition = null;
  $("#waypointDialog").close();
  renderWaypoints();
  renderMissions();
  showToast("Nuevo punto añadido al mapa.");
}

function discoverNearbyWaypoints(lat, lng) {
  if (!state.active) return;
  let changed = false;
  state.waypoints.forEach(waypoint => {
    if (waypoint.discoveredAt) return;
    if (haversine(lat, lng, waypoint.lat, waypoint.lng) <= 35) {
      waypoint.discoveredAt = Date.now();
      waypoint.discoveredBy = state.active.id;
      if (!state.active.discoveredIds.includes(waypoint.id)) state.active.discoveredIds.push(waypoint.id);
      changed = true;
      showToast(`✨ Hallazgo: ${waypoint.name}`);
    }
  });
  if (changed) {
    renderWaypoints();
    saveState();
  }
}

function renderWaypoints() {
  waypointLayer.clearLayers();
  state.waypoints.forEach(waypoint => {
    const data = WAYPOINT_DATA[waypoint.type] || WAYPOINT_DATA.treasure;
    const marker = L.marker([waypoint.lat, waypoint.lng], {
      icon: L.divIcon({
        className: "territory-waypoint-marker",
        html: `<div style="width:34px;height:34px;display:grid;place-items:center;border-radius:50% 50% 50% 12px;transform:rotate(-45deg);background:${waypoint.discoveredAt ? "#c9f35b" : "#17352e"};border:2px solid #f5fbf8;box-shadow:0 7px 18px rgba(0,0,0,.28)"><span style="transform:rotate(45deg);font-size:17px">${data.icon}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
      })
    });
    marker.bindPopup(`<strong>${escapeHtml(waypoint.name)}</strong>${waypoint.discoveredAt ? "Descubierto" : `${data.label} · acércate a menos de 35 m`}`);
    marker.addTo(waypointLayer);
  });

  const container = $("#waypointList");
  if (!state.waypoints.length) {
    container.innerHTML = `<div class="empty-state">Aún no has creado ningún punto. Añade uno o mantén pulsado un lugar del mapa.</div>`;
    return;
  }
  container.innerHTML = [...state.waypoints]
    .sort((a, b) => Number(Boolean(a.discoveredAt)) - Number(Boolean(b.discoveredAt)))
    .map(waypoint => {
      const data = WAYPOINT_DATA[waypoint.type] || WAYPOINT_DATA.treasure;
      return `<article class="waypoint-item ${waypoint.discoveredAt ? "discovered" : ""}">
        <div class="waypoint-icon">${data.icon}</div>
        <div class="waypoint-copy"><strong>${escapeHtml(waypoint.name)}</strong><span>${waypoint.discoveredAt ? `Descubierto · ${formatDate(waypoint.discoveredAt)}` : `${data.label} · pendiente`}</span></div>
        <button class="mini-delete" type="button" data-waypoint-delete="${waypoint.id}" aria-label="Eliminar ${escapeHtml(waypoint.name)}">×</button>
      </article>`;
    }).join("");
}

function handleWaypointListClick(event) {
  const button = event.target.closest("[data-waypoint-delete]");
  if (!button) return;
  const id = button.dataset.waypointDelete;
  const waypoint = state.waypoints.find(item => item.id === id);
  if (!waypoint || !window.confirm(`¿Eliminar el punto “${waypoint.name}”?`)) return;
  state.waypoints = state.waypoints.filter(item => item.id !== id);
  saveState();
  renderWaypoints();
  renderMissions();
}

function renderAll() {
  renderTerritoryOnMap();
  renderWaypoints();
  renderMapSummary();
  renderTerritoryDashboard();
  renderMissions();
  $("#profileName").value = state.profile.name || "Jesús";
  const avatarLetter = (state.profile.name || "J").trim().charAt(0).toUpperCase() || "J";
  $(".avatar").textContent = avatarLetter;
  updateSessionPanel();
}

function renderMapSummary() {
  $("#mapCellCount").textContent = formatInteger(claimedCount(state));
  $("#mapScore").textContent = formatInteger(totalScore(state));
  $("#mapDistance").textContent = formatNumber(totalDistanceMeters(state) / 1000, 2);
}

function renderTerritoryDashboard() {
  const cells = claimedCount(state);
  const score = totalScore(state);
  const level = Math.floor(score / 1000) + 1;
  const levelRemainder = score % 1000;
  const progress = Math.round(levelRemainder / 10);

  $("#territoryCells").textContent = formatInteger(cells);
  $("#territoryArea").textContent = `≈ ${formatArea(approximateClaimedArea())} explorados`;
  $("#totalDistance").textContent = `${formatNumber(totalDistanceMeters(state) / 1000, 1)} km`;
  $("#totalActivities").textContent = state.activities.length;
  $("#totalEnvironments").textContent = usedEnvironments(state).size;
  $("#totalFinds").textContent = discoveredCount(state);
  $("#levelBadge").textContent = `Nivel ${level}`;
  $("#levelProgress").textContent = `${progress}%`;
  $("#levelRing").style.setProperty("--progress", `${progress * 3.6}deg`);

  const modeDistances = Object.fromEntries(Object.keys(MODE_DATA).map(mode => [mode, 0]));
  state.activities.forEach(activity => {
    if (modeDistances[activity.mode] !== undefined) modeDistances[activity.mode] += activity.distanceMeters || 0;
  });
  const max = Math.max(1, ...Object.values(modeDistances));
  $("#modeBreakdown").innerHTML = Object.entries(MODE_DATA).map(([mode, data]) => `
    <div class="mode-row" data-mode="${mode}"><span>${data.icon} ${data.label}</span><div class="meter"><i style="width:${(modeDistances[mode] / max) * 100}%"></i></div><strong>${formatNumber(modeDistances[mode] / 1000, 1)} km</strong></div>
  `).join("");

  const list = $("#activityList");
  if (!state.activities.length) {
    list.innerHTML = `<div class="empty-state">Tu primera aventura aparecerá aquí. El sofá, de momento, no conquista parcelas.</div>`;
    return;
  }
  list.innerHTML = state.activities.slice(0, 12).map(activity => {
    const mode = MODE_DATA[activity.mode] || MODE_DATA.run;
    const source = activity.demo ? "demo" : activity.source === "gpx" ? "GPX" : ENVIRONMENT_DATA[activity.environment] || "Aventura";
    return `<article class="activity-item">
      <div class="activity-icon">${mode.icon}</div>
      <div class="activity-copy"><strong>${mode.label} · ${formatDate(activity.startTime)}</strong><span>${source} · ${formatDuration(activity.durationSeconds)} · ${activity.newCellIds?.length || 0} parcelas</span></div>
      <div class="activity-value"><strong>${formatNumber((activity.distanceMeters || 0) / 1000, 2)} km</strong><span>+${formatInteger(activity.score || 0)} pts</span></div>
    </article>`;
  }).join("");
}

function renderMissions() {
  const score = totalScore(state);
  $("#missionScore").textContent = formatInteger(score);
  const unlocked = BADGES.filter(badge => badge.test(state));
  $("#badgeCount").textContent = `${unlocked.length}/${BADGES.length}`;
  $("#badgeGrid").innerHTML = BADGES.map(badge => `
    <article class="badge-card ${badge.test(state) ? "unlocked" : ""}"><b>${badge.icon}</b><strong>${badge.name}</strong><span>${badge.detail}</span></article>
  `).join("");

  const mission = nextMission();
  const percent = Math.min(100, Math.round((mission.current / mission.target) * 100));
  $("#featuredMission").innerHTML = `
    <span class="eyebrow">Misión recomendada</span>
    <h2>${mission.icon} ${mission.name}</h2>
    <p>${mission.description}</p>
    <div class="mission-progress"><div class="meter"><i style="width:${percent}%"></i></div><strong>${mission.current}/${mission.target}</strong></div>
  `;
}

function nextMission() {
  const cells = claimedCount(state);
  if (cells < 5) return { icon: "🚩", name: "Abre el mapa", description: "Conquista tus primeras cinco parcelas en cualquier modalidad.", current: cells, target: 5 };
  if (discoveredCount(state) < 1) return { icon: "🧭", name: "Primer hallazgo", description: "Crea un punto en el mapa y acércate a menos de 35 metros durante una aventura.", current: 0, target: 1 };
  if (usedModes(state).size < 2) return { icon: "🔄", name: "Cambia el paso", description: "Completa aventuras utilizando dos formas diferentes de moverte.", current: usedModes(state).size, target: 2 };
  if (usedEnvironments(state).size < 3) return { icon: "🌲", name: "Tres mundos", description: "Explora tres entornos distintos: urbano, campo, bosque, montaña, costa o agua.", current: usedEnvironments(state).size, target: 3 };
  if (cells < 25) return { icon: "🗺️", name: "Hazte cartógrafo", description: "Amplía tu dominio hasta alcanzar 25 parcelas conquistadas.", current: cells, target: 25 };
  if (usedModes(state).size < 4) return { icon: "🧩", name: "Explorador total", description: "Conquista territorio corriendo, caminando, nadando y en bicicleta.", current: usedModes(state).size, target: 4 };
  return { icon: "👑", name: "El gran dominio", description: "Sigue explorando hasta alcanzar las 100 parcelas conquistadas.", current: Math.min(cells, 100), target: 100 };
}

function scoreFor(mode, newCells, distanceMeters, finds = 0) {
  const multiplier = MODE_DATA[mode]?.multiplier || 1;
  return Math.round(newCells * 100 * multiplier + (distanceMeters / 1000) * 25 * multiplier + finds * 300);
}

function totalScore(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.score) || 0), 0);
}

function totalDistanceMeters(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.distanceMeters) || 0), 0);
}

function claimedCount(currentState) {
  return Object.keys(currentState.claimed || {}).length;
}

function discoveredCount(currentState) {
  return currentState.waypoints.filter(waypoint => waypoint.discoveredAt).length;
}

function usedModes(currentState) {
  return new Set(currentState.activities.map(activity => activity.mode).filter(Boolean));
}

function usedEnvironments(currentState) {
  return new Set(currentState.activities.map(activity => activity.environment).filter(Boolean));
}

function approximateClaimedArea() {
  return Object.keys(state.claimed).reduce((sum, id) => {
    const bounds = cellBounds(id);
    const latitude = (bounds[0][0] + bounds[1][0]) / 2;
    const height = 111320 * CELL_SIZE;
    const width = 111320 * Math.cos(latitude * Math.PI / 180) * CELL_SIZE;
    return sum + height * width;
  }, 0);
}

function saveProfile() {
  const name = $("#profileName").value.trim();
  if (!name) {
    showToast("Escribe un nombre de explorador.");
    return;
  }
  state.profile.name = name;
  saveState();
  $(".avatar").textContent = name.charAt(0).toUpperCase();
  showToast("Perfil guardado.");
}

function updateGpxFileName() {
  $("#gpxFileName").textContent = $("#gpxFile").files[0]?.name || "Toca aquí para elegirlo";
}

async function handleGpxImport(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#importDialog").close();
    return;
  }
  const file = $("#gpxFile").files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const points = parseGpx(text);
    if (points.length < 2) throw new Error("El archivo no contiene una ruta válida.");
    const mode = $("#importMode").value;
    const environment = $("#importEnvironment").value;
    const activity = createActivityFromRoute(points, mode, environment, "gpx");
    $("#importDialog").close();
    event.currentTarget.reset();
    $("#gpxFileName").textContent = "Toca aquí para elegirlo";
    activeRoute.setLatLngs(activity.points.map(point => [point.lat, point.lng]));
    map.fitBounds(activeRoute.getBounds(), { padding: [40, 160], maxZoom: 17 });
    renderAll();
    showToast(`GPX importado · ${activity.newCellIds.length} parcelas nuevas`);
  } catch (error) {
    showToast(error.message || "No se pudo importar el archivo GPX.");
  }
}

function parseGpx(text) {
  const documentXml = new DOMParser().parseFromString(text, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("El archivo GPX está dañado o no es válido.");
  const nodes = [...documentXml.querySelectorAll("trkpt, rtept")];
  const raw = nodes.map((node, index) => {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    const timeText = node.querySelector("time")?.textContent;
    return { lat, lng, time: timeText ? new Date(timeText).getTime() : index * 10000 };
  }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (raw.length <= MAX_TRACK_POINTS) return raw;
  const step = Math.ceil(raw.length / MAX_TRACK_POINTS);
  return raw.filter((_, index) => index % step === 0 || index === raw.length - 1);
}

function createActivityFromRoute(points, mode, environment, source = "gpx") {
  const before = new Set(Object.keys(state.claimed));
  let distanceMeters = 0;
  points.forEach((point, index) => {
    if (index === 0) claimCell(point.lat, point.lng, mode, point.time);
    else {
      distanceMeters += haversine(points[index - 1].lat, points[index - 1].lng, point.lat, point.lng);
      claimSegment(points[index - 1], point, mode);
    }
  });
  const newCellIds = Object.keys(state.claimed).filter(id => !before.has(id));
  const firstTime = points[0].time > 100000000000 ? points[0].time : Date.now() - Math.max(600000, distanceMeters / 2.4 * 1000);
  const lastTime = points.at(-1).time > firstTime ? points.at(-1).time : Date.now();
  const durationSeconds = Math.max(1, Math.round((lastTime - firstTime) / 1000));
  const activity = {
    id: makeId(), mode, environment, source, demo: false,
    startTime: firstTime, endTime: lastTime, durationSeconds,
    distanceMeters: Math.round(distanceMeters), points,
    newCellIds, discoveredIds: [],
    score: scoreFor(mode, newCellIds.length, distanceMeters, 0)
  };
  state.activities.unshift(activity);
  saveState();
  return activity;
}

function startDemo() {
  if (state.active) {
    showToast("Finaliza primero la aventura actual.");
    return;
  }
  showView("map");
  const center = map.getCenter();
  startActivity("bike", "country", { demo: true, source: "demo" });
  updateGpsStatus("Recorrido simulado en marcha", "ready");

  const points = [];
  const count = 48;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    points.push({
      lat: center.lat + Math.sin(angle) * .0022 + Math.sin(angle * 2) * .00035,
      lng: center.lng + Math.cos(angle) * .0030,
      time: Date.now() + i * 15000,
      accuracy: 5
    });
  }
  points.push({ ...points[0], time: Date.now() + count * 15000 });

  let index = 0;
  demoTimer = window.setInterval(() => {
    if (!state.active || state.active.paused) return;
    const point = points[index];
    acceptTrackPoint(point, { force: true });
    updatePositionMarker(point.lat, point.lng, 5);
    index += 1;
    if (index >= points.length) {
      clearInterval(demoTimer);
      demoTimer = null;
      finalizeActiveActivity({ skipConfirm: true, keepShort: true, durationOverride: count * 15 });
    }
  }, 120);
}

function exportBackup() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), app: "Territorio 360", ...state }, null, 2);
  downloadBlob(payload, `territorio-360-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  showToast("Copia de tus datos descargada.");
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.activities) || typeof parsed.claimed !== "object") throw new Error();
    if (!window.confirm("Esta copia sustituirá los datos actuales. ¿Continuar?")) return;
    state = {
      ...defaultState(),
      ...parsed,
      profile: { ...defaultState().profile, ...(parsed.profile || {}) },
      active: null
    };
    saveState();
    activeRoute.setLatLngs([]);
    renderAll();
    showToast("Copia restaurada correctamente.");
  } catch {
    showToast("El archivo no es una copia válida de Territorio 360.");
  }
}

function resetData() {
  if (!window.confirm("¿Borrar recorridos, parcelas, puntos y logros de este dispositivo? Esta acción no se puede deshacer.")) return;
  clearPositionWatch();
  if (demoTimer) clearInterval(demoTimer);
  state = defaultState();
  saveState();
  activeRoute.setLatLngs([]);
  renderAll();
  showToast("La aplicación vuelve a estar como nueva.");
}

async function installApp() {
  if (!installPrompt) {
    showToast("Abre el menú del navegador y elige “Instalar aplicación”.");
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#installButton").hidden = true;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Service worker:", error));
  }
}

function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function haversine(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatPace(seconds, meters, mode) {
  if (!meters || meters < 50) return "—";
  if (mode === "bike") {
    const kmh = (meters / 1000) / (seconds / 3600);
    return Number.isFinite(kmh) ? `${formatNumber(kmh, 1)} km/h` : "—";
  }
  const secondsPerKm = seconds / (meters / 1000);
  if (!Number.isFinite(secondsPerKm) || secondsPerKm > 5999) return "—";
  return `${Math.floor(secondsPerKm / 60)}:${String(Math.round(secondsPerKm % 60)).padStart(2, "0")}/km`;
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
}

function formatInteger(value) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(timestamp));
}

function formatArea(squareMeters) {
  if (squareMeters >= 1e6) return `${formatNumber(squareMeters / 1e6, 2)} km²`;
  if (squareMeters >= 10000) return `${formatNumber(squareMeters / 10000, 2)} ha`;
  return `${formatInteger(squareMeters)} m²`;
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
