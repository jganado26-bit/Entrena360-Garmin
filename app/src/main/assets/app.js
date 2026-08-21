"use strict";

const STORAGE_KEY = "territorio360-state-v1";
const AREA_CLAIM_SIZE = 0.0005;
const LINE_CLAIM_SIZE = 0.0002;
const LOOP_MIN_DISTANCE_METERS = 500;
const LOOP_CLOSE_DISTANCE_METERS = 100;
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
  { id: "first", icon: "🚩", name: "Primer paso", detail: "1 km recorrido", test: s => totalDistanceMeters(s) >= 1000 },
  { id: "mapmaker", icon: "🗺️", name: "Cartógrafo", detail: "10 ha cerradas", test: s => totalAreaSqm(s) >= 100000 },
  { id: "century", icon: "💯", name: "Gran dominio", detail: "100 ha cerradas", test: s => totalAreaSqm(s) >= 1000000 },
  { id: "allrounder", icon: "🧩", name: "Todoterreno", detail: "4 modalidades", test: s => usedModes(s).size >= 4 },
  { id: "wanderer", icon: "🌍", name: "Sin fronteras", detail: "3 entornos", test: s => usedEnvironments(s).size >= 3 },
  { id: "seeker", icon: "✨", name: "Buscador", detail: "3 hallazgos", test: s => discoveredCount(s) >= 3 }
];

let state = loadState();
let map;
let territoryLayer;
let waypointLayer;
let socialLayer;
let activeRoute;
let positionMarker;
let accuracyCircle;
let watchId = null;
let timerId = null;
let installPrompt = null;
let pendingWaypointPosition = null;
let demoTimer = null;
let toastTimer = null;
let rankingMode = "distance";

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
  if (typeof initializeSocialBeta === "function") initializeSocialBeta();
}

function defaultState() {
  return {
    version: 4,
    profile: { name: "Jesús", city: "Zamora" },
    areaClaims: {},
    lineClaims: {},
    activities: [],
    waypoints: [],
    active: null,
    social: {
      config: { url: "", publicKey: "" },
      session: null,
      group: null,
      shareExactRoutes: false,
      lastSyncAt: null
    }
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object") return defaultState();
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

function normalizeState(parsed) {
  const clean = defaultState();
  const normalized = {
    ...clean,
    ...parsed,
    version: 4,
    profile: { ...clean.profile, ...(parsed.profile || {}) },
    areaClaims: parsed.areaClaims && typeof parsed.areaClaims === "object" ? parsed.areaClaims : {},
    lineClaims: parsed.lineClaims && typeof parsed.lineClaims === "object" ? parsed.lineClaims : {},
    activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    waypoints: Array.isArray(parsed.waypoints) ? parsed.waypoints : [],
    active: parsed.active || null,
    social: {
      ...clean.social,
      ...(parsed.social || {}),
      config: { ...clean.social.config, ...(parsed.social?.config || {}) }
    }
  };

  if (Number(parsed.version || 1) < 2) {
    normalized.areaClaims = {};
    normalized.lineClaims = {};
    [...normalized.activities]
      .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0))
      .forEach(activity => migrateActivityConquest(activity, normalized));
  }
  return normalized;
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
  socialLayer = L.layerGroup().addTo(map);
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
  $("#distanceRankingButton").addEventListener("click", () => setRankingMode("distance"));
  $("#conquestRankingButton").addEventListener("click", () => setRankingMode("conquest"));
  $("#connectionInfoButton").addEventListener("click", () => $("#connectionDialog").showModal());
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
  if (typeof bindSocialEvents === "function") bindSocialEvents();

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
  if (target === "community" && typeof refreshSocialCommunity === "function") refreshSocialCommunity();
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

  const hasMovement = active.distanceMeters >= 20 && active.points.length > 1;
  if (!hasMovement && !options.keepShort) {
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
  const conquest = applyRouteConquest(active.points, active.mode, state, active.id, active.distanceMeters);
  const score = scoreForConquest(active.mode, conquest, active.distanceMeters, active.discoveredIds.length);
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
    discoveredIds: active.discoveredIds,
    ...conquest,
    score
  };

  state.activities.unshift(activity);
  state.active = null;
  saveState();
  stopTimer();
  updateSessionPanel();
  renderAll();
  if (activity.points.length > 1) map.fitBounds(activeRoute.getBounds(), { padding: [40, 180], maxZoom: 17 });
  const result = activity.conquestType === "area"
    ? `${formatArea(activity.newAreaSqm)} nuevos`
    : `${formatNumber(activity.newLinearMeters / 1000, 2)} km lineales nuevos`;
  showToast(`Aventura guardada · ${result}`);
  if (typeof syncActivitySocial === "function") syncActivitySocial(activity);
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
  $("#liveConquest").textContent = isClosedRoute(active.points, active.distanceMeters) ? "Zona" : "Lineal";
  $("#livePace").textContent = formatPace(seconds, active.distanceMeters, active.mode);
  const liveScore = distanceScoreFor(active.mode, active.distanceMeters) + active.discoveredIds.length * 300;
  $("#mapScore").textContent = formatInteger(totalScore(state) + liveScore);
  $("#mapArea").textContent = formatNumber(totalAreaSqm(state) / 10000, 1);
  $("#mapLinear").textContent = formatNumber(totalLinearMeters(state) / 1000, 2);
}

function updateGpsStatus(message, status) {
  $("#gpsStatus").textContent = message;
  $("#gpsDot").className = status === "ready" ? "ready" : status === "error" ? "error" : "";
}

function cellIdAt(lat, lng, size) {
  const y = Math.floor((lat + 90) / size);
  const x = Math.floor((lng + 180) / size);
  return `${y}_${x}`;
}

function cellBounds(id, size) {
  const [y, x] = id.split("_").map(Number);
  const south = y * size - 90;
  const west = x * size - 180;
  return [[south, west], [south + size, west + size]];
}

function cellCenter(id, size) {
  const bounds = cellBounds(id, size);
  return {
    lat: (bounds[0][0] + bounds[1][0]) / 2,
    lng: (bounds[0][1] + bounds[1][1]) / 2
  };
}

function routeDistance(points) {
  return points.reduce((sum, point, index) => {
    if (!index) return 0;
    const previous = points[index - 1];
    return sum + haversine(previous.lat, previous.lng, point.lat, point.lng);
  }, 0);
}

function isClosedRoute(points, distanceMeters = routeDistance(points)) {
  if (points.length < 4 || distanceMeters < LOOP_MIN_DISTANCE_METERS) return false;
  const first = points[0];
  const last = points.at(-1);
  return haversine(first.lat, first.lng, last.lat, last.lng) <= LOOP_CLOSE_DISTANCE_METERS;
}

function simplifyForGeometry(points) {
  if (points.length <= 2) return [...points];
  const simplified = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1);
    const point = points[index];
    if (haversine(previous.lat, previous.lng, point.lat, point.lng) >= 8) simplified.push(point);
  }
  simplified.push(points.at(-1));
  if (simplified.length <= 800) return simplified;
  const step = Math.ceil(simplified.length / 800);
  return simplified.filter((_, index) => index % step === 0 || index === simplified.length - 1);
}

function polygonAreaSqm(points) {
  if (points.length < 3) return 0;
  const referenceLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const metersPerLng = 111320 * Math.cos(referenceLat * Math.PI / 180);
  const projected = points.map(point => ({ x: point.lng * metersPerLng, y: point.lat * 111320 }));
  let twiceArea = 0;
  projected.forEach((point, index) => {
    const next = projected[(index + 1) % projected.length];
    twiceArea += point.x * next.y - next.x * point.y;
  });
  return Math.abs(twiceArea) / 2;
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const point = polygon[index];
    const previous = polygon[previousIndex];
    const crosses = (point.lat > lat) !== (previous.lat > lat)
      && lng < (previous.lng - point.lng) * (lat - point.lat) / ((previous.lat - point.lat) || Number.EPSILON) + point.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

function areaCellsInsidePolygon(points) {
  const polygon = simplifyForGeometry(points);
  const lats = polygon.map(point => point.lat);
  const lngs = polygon.map(point => point.lng);
  const minY = Math.floor((Math.min(...lats) + 90) / AREA_CLAIM_SIZE);
  const maxY = Math.floor((Math.max(...lats) + 90) / AREA_CLAIM_SIZE);
  const minX = Math.floor((Math.min(...lngs) + 180) / AREA_CLAIM_SIZE);
  const maxX = Math.floor((Math.max(...lngs) + 180) / AREA_CLAIM_SIZE);
  const candidates = Math.max(1, (maxY - minY + 1) * (maxX - minX + 1));
  const step = Math.max(1, Math.ceil(Math.sqrt(candidates / 60000)));
  const ids = [];
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const id = `${y}_${x}`;
      const center = cellCenter(id, AREA_CLAIM_SIZE);
      if (pointInPolygon(center.lat, center.lng, polygon)) ids.push(id);
    }
  }
  if (!ids.length) {
    const centerLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
    const centerLng = lngs.reduce((sum, value) => sum + value, 0) / lngs.length;
    ids.push(cellIdAt(centerLat, centerLng, AREA_CLAIM_SIZE));
  }
  return [...new Set(ids)];
}

function lineCellsAlongRoute(points) {
  const ids = new Set();
  points.forEach((point, index) => {
    if (!index) {
      ids.add(cellIdAt(point.lat, point.lng, LINE_CLAIM_SIZE));
      return;
    }
    const previous = points[index - 1];
    const distance = haversine(previous.lat, previous.lng, point.lat, point.lng);
    const steps = Math.max(1, Math.ceil(distance / 12));
    for (let part = 0; part <= steps; part += 1) {
      const ratio = part / steps;
      ids.add(cellIdAt(
        previous.lat + (point.lat - previous.lat) * ratio,
        previous.lng + (point.lng - previous.lng) * ratio,
        LINE_CLAIM_SIZE
      ));
    }
  });
  return [...ids];
}

function applyRouteConquest(points, mode, targetState, activityId, measuredDistance) {
  const distanceMeters = Number(measuredDistance) || routeDistance(points);
  const timestamp = Number(points.at(-1)?.time) || Date.now();
  if (isClosedRoute(points, distanceMeters)) {
    const polygon = simplifyForGeometry(points);
    const allIds = areaCellsInsidePolygon(polygon);
    const newIds = allIds.filter(id => !targetState.areaClaims[id]);
    newIds.forEach(id => {
      targetState.areaClaims[id] = { at: timestamp, mode, activityId };
    });
    const grossAreaSqm = polygonAreaSqm(polygon);
    return {
      conquestType: "area",
      polygon: polygon.map(point => [point.lat, point.lng]),
      grossAreaSqm: Math.round(grossAreaSqm),
      newAreaSqm: Math.round(grossAreaSqm * newIds.length / Math.max(1, allIds.length)),
      areaCellIds: newIds,
      newLinearMeters: 0,
      lineCellIds: []
    };
  }

  const allIds = lineCellsAlongRoute(points);
  const newIds = allIds.filter(id => !targetState.lineClaims[id]);
  newIds.forEach(id => {
    targetState.lineClaims[id] = { at: timestamp, mode, activityId };
  });
  return {
    conquestType: "line",
    polygon: [],
    grossAreaSqm: 0,
    newAreaSqm: 0,
    areaCellIds: [],
    newLinearMeters: Math.round(distanceMeters * newIds.length / Math.max(1, allIds.length)),
    lineCellIds: newIds
  };
}

function migrateActivityConquest(activity, targetState) {
  const points = Array.isArray(activity.points) ? activity.points : [];
  if (points.length < 2) return;
  const conquest = applyRouteConquest(points, activity.mode || "run", targetState, activity.id, activity.distanceMeters);
  Object.assign(activity, conquest);
  delete activity.newCellIds;
  activity.score = scoreForConquest(activity.mode, conquest, activity.distanceMeters, activity.discoveredIds?.length || 0);
}

function renderTerritoryOnMap() {
  territoryLayer.clearLayers();
  state.activities.slice().reverse().forEach(activity => {
    if (!Array.isArray(activity.points) || activity.points.length < 2) return;
    const mode = MODE_DATA[activity.mode] || MODE_DATA.run;
    const coordinates = activity.points.map(point => [point.lat, point.lng]);
    if (activity.conquestType === "area") {
      L.polygon(coordinates, {
        color: mode.color,
        weight: 3,
        opacity: .9,
        fillColor: mode.color,
        fillOpacity: .18,
        lineJoin: "round"
      }).bindPopup(`<strong>${mode.icon} Zona cerrada</strong><br>${formatArea(activity.newAreaSqm)} nuevos`).addTo(territoryLayer);
      return;
    }
    L.polyline(coordinates, {
      color: mode.color,
      weight: 12,
      opacity: .25,
      lineCap: "round",
      interactive: false
    }).addTo(territoryLayer);
    L.polyline(coordinates, {
      color: mode.color,
      weight: 3,
      opacity: .92,
      lineCap: "round"
    }).bindPopup(`<strong>${mode.icon} Tramo lineal</strong><br>${formatNumber(activity.newLinearMeters / 1000, 2)} km nuevos`).addTo(territoryLayer);
  });
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
  if (typeof renderSocialUi === "function") renderSocialUi();
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
  if (typeof renderSocialUi === "function") renderSocialUi();
}

function renderMapSummary() {
  $("#mapArea").textContent = formatNumber(totalAreaSqm(state) / 10000, 1);
  $("#mapLinear").textContent = formatNumber(totalLinearMeters(state) / 1000, 2);
  $("#mapScore").textContent = formatInteger(totalScore(state));
}

function renderTerritoryDashboard() {
  const areaSqm = totalAreaSqm(state);
  const linearMeters = totalLinearMeters(state);
  const score = totalScore(state);
  const level = Math.floor(score / 1000) + 1;
  const levelRemainder = score % 1000;
  const progress = Math.round(levelRemainder / 10);

  $("#territoryAreaValue").textContent = formatArea(areaSqm);
  $("#totalLinear").textContent = `${formatNumber(linearMeters / 1000, 2)} km`;
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
    list.innerHTML = `<div class="empty-state">Tu primera aventura aparecerá aquí. Cierra una ruta para delimitar una zona o deja el recorrido abierto para conquistar un tramo.</div>`;
    renderRanking();
    return;
  }
  list.innerHTML = state.activities.slice(0, 12).map(activity => {
    const mode = MODE_DATA[activity.mode] || MODE_DATA.run;
    const source = sourceLabel(activity);
    const conquest = activity.conquestType === "area"
      ? `${formatArea(activity.newAreaSqm)} nuevos · zona cerrada`
      : `${formatNumber(activity.newLinearMeters / 1000, 2)} km lineales nuevos`;
    return `<article class="activity-item">
      <div class="activity-icon">${mode.icon}</div>
      <div class="activity-copy"><strong>${mode.label} · ${formatDate(activity.startTime)}</strong><span>${source} · ${formatDuration(activity.durationSeconds)} · ${conquest}</span></div>
      <div class="activity-value"><strong>${formatNumber((activity.distanceMeters || 0) / 1000, 2)} km</strong><span>+${formatInteger(activity.score || 0)} pts</span></div>
    </article>`;
  }).join("");
  renderRanking();
}

function sourceLabel(activity) {
  if (activity.demo) return "Demo";
  const sourceNames = {
    suunto: "Suunto",
    coros: "COROS",
    garmin: "Garmin",
    polar: "Polar",
    wahoo: "Wahoo",
    strava: "Strava",
    gpx: "GPX / reloj",
    tcx: "TCX / reloj"
  };
  if (sourceNames[activity.source]) return sourceNames[activity.source];
  if (activity.source === "health-connect") return "Health Connect";
  return ENVIRONMENT_DATA[activity.environment] || "Aventura";
}

function setRankingMode(mode) {
  rankingMode = mode === "conquest" ? "conquest" : "distance";
  const distanceButton = $("#distanceRankingButton");
  const conquestButton = $("#conquestRankingButton");
  distanceButton.classList.toggle("active", rankingMode === "distance");
  conquestButton.classList.toggle("active", rankingMode === "conquest");
  distanceButton.setAttribute("aria-selected", String(rankingMode === "distance"));
  conquestButton.setAttribute("aria-selected", String(rankingMode === "conquest"));
  renderRanking();
}

function renderRanking() {
  const container = $("#rankingList");
  if (!container) return;
  const name = state.profile.name || "Explorador";
  const avatar = escapeHtml(name.trim().charAt(0).toUpperCase() || "E");
  const isDistance = rankingMode === "distance";
  const value = isDistance
    ? `${formatNumber(totalDistanceMeters(state) / 1000, 2)} km`
    : `${formatInteger(conquestRankingPoints(state))} pts`;
  const help = isDistance ? "Todos los kilómetros cuentan, aunque repitas zona" : "Solo suman zonas y tramos que sean nuevos";
  container.innerHTML = `<article class="ranking-row">
    <span class="ranking-position">1</span>
    <span class="ranking-avatar">${avatar}</span>
    <span class="ranking-copy"><strong>${escapeHtml(name)}</strong><small>${help}</small></span>
    <strong class="ranking-value">${value}</strong>
  </article>`;
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
  const distanceKm = Math.floor(totalDistanceMeters(state) / 1000);
  const areaHa = Math.floor(totalAreaSqm(state) / 10000);
  const linearKm = Math.floor(totalLinearMeters(state) / 1000);
  if (distanceKm < 1) return { icon: "🚩", name: "Primer kilómetro", description: "Completa tu primer kilómetro; también cuenta si recorres una zona conocida.", current: distanceKm, target: 1 };
  if (areaHa < 1) return { icon: "⭕", name: "Cierra el círculo", description: "Vuelve a menos de 100 m del inicio y delimita al menos una hectárea siguiendo el recorrido.", current: areaHa, target: 1 };
  if (linearKm < 5) return { icon: "🛣️", name: "Traza tu camino", description: "Conquista cinco kilómetros lineales nuevos en rutas abiertas.", current: linearKm, target: 5 };
  if (discoveredCount(state) < 1) return { icon: "🧭", name: "Primer hallazgo", description: "Crea un punto en el mapa y acércate a menos de 35 metros durante una aventura.", current: 0, target: 1 };
  if (usedModes(state).size < 2) return { icon: "🔄", name: "Cambia el paso", description: "Completa aventuras utilizando dos formas diferentes de moverte.", current: usedModes(state).size, target: 2 };
  if (usedEnvironments(state).size < 3) return { icon: "🌲", name: "Tres mundos", description: "Explora tres entornos distintos: urbano, campo, bosque, montaña, costa o agua.", current: usedEnvironments(state).size, target: 3 };
  if (areaHa < 10) return { icon: "🗺️", name: "Hazte cartógrafo", description: "Amplía tu dominio cerrado hasta alcanzar diez hectáreas.", current: areaHa, target: 10 };
  if (usedModes(state).size < 4) return { icon: "🧩", name: "Explorador total", description: "Conquista territorio corriendo, caminando, nadando y en bicicleta.", current: usedModes(state).size, target: 4 };
  return { icon: "👑", name: "El gran dominio", description: "Sigue explorando hasta alcanzar cien hectáreas cerradas.", current: Math.min(areaHa, 100), target: 100 };
}

function distanceScoreFor(mode, distanceMeters) {
  const multiplier = MODE_DATA[mode]?.multiplier || 1;
  return Math.round((Number(distanceMeters) || 0) / 1000 * 25 * multiplier);
}

function conquestPointsForActivity(activity) {
  const multiplier = MODE_DATA[activity.mode]?.multiplier || 1;
  if (activity.conquestType === "area") return Math.round((Number(activity.newAreaSqm) || 0) / 10000 * 20 * multiplier);
  return Math.round((Number(activity.newLinearMeters) || 0) / 1000 * 150 * multiplier);
}

function scoreForConquest(mode, conquest, distanceMeters, finds = 0) {
  return distanceScoreFor(mode, distanceMeters)
    + conquestPointsForActivity({ mode, ...conquest })
    + finds * 300;
}

function totalScore(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.score) || 0), 0);
}

function totalDistanceMeters(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.distanceMeters) || 0), 0);
}

function totalAreaSqm(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.newAreaSqm) || 0), 0);
}

function totalLinearMeters(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + (Number(activity.newLinearMeters) || 0), 0);
}

function conquestRankingPoints(currentState) {
  return currentState.activities.reduce((sum, activity) => sum + conquestPointsForActivity(activity), 0);
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

function saveProfile() {
  const name = $("#profileName").value.trim();
  if (!name) {
    showToast("Escribe un nombre de explorador.");
    return;
  }
  state.profile.name = name;
  saveState();
  $(".avatar").textContent = name.charAt(0).toUpperCase();
  renderRanking();
  if (typeof updateSocialProfile === "function") updateSocialProfile();
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
    const parsedRoute = parseActivityFile(text, file.name);
    const points = parsedRoute.points;
    if (points.length < 2) throw new Error("El archivo no contiene una ruta válida.");
    const importKey = routeImportKey(points);
    const duplicate = state.activities.some(activity => {
      if (activity.importKey === importKey) return true;
      if (!activity.importKey && activity.source !== "gps" && Array.isArray(activity.points) && activity.points.length > 1) {
        return routeImportKey(activity.points) === importKey;
      }
      return false;
    });
    if (duplicate) throw new Error("Esta actividad ya está importada. No volverá a sumar kilómetros ni conquista.");
    const mode = $("#importMode").value;
    const environment = $("#importEnvironment").value;
    const activity = createActivityFromRoute(points, mode, environment, parsedRoute.source, importKey);
    $("#importDialog").close();
    event.currentTarget.reset();
    $("#gpxFileName").textContent = "Toca aquí para elegirlo";
    activeRoute.setLatLngs(activity.points.map(point => [point.lat, point.lng]));
    map.fitBounds(activeRoute.getBounds(), { padding: [40, 160], maxZoom: 17 });
    renderAll();
    const result = activity.conquestType === "area"
      ? `${formatArea(activity.newAreaSqm)} nuevos`
      : `${formatNumber(activity.newLinearMeters / 1000, 2)} km lineales nuevos`;
    showToast(`${sourceLabel(activity)} importado · ${result}`);
    if (typeof syncActivitySocial === "function") syncActivitySocial(activity);
  } catch (error) {
    showToast(error.message || "No se pudo importar el archivo de actividad.");
  }
}

function parseActivityFile(text, fileName = "") {
  const documentXml = new DOMParser().parseFromString(text, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("El archivo está dañado o no es válido.");
  const tcxTrackpoints = xmlElements(documentXml, "Trackpoint");
  const gpxTrackpoints = [...xmlElements(documentXml, "trkpt"), ...xmlElements(documentXml, "rtept")];
  let points;
  let format;
  if (tcxTrackpoints.length) {
    points = parseTcxDocument(tcxTrackpoints);
    format = "tcx";
  } else if (gpxTrackpoints.length) {
    points = parseGpxDocument(gpxTrackpoints);
    format = "gpx";
  } else {
    throw new Error("El archivo no contiene una ruta GPS compatible.");
  }
  return { points: limitTrackPoints(points), source: detectActivitySource(text, fileName, format) };
}

function parseGpx(text) {
  const documentXml = new DOMParser().parseFromString(text, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("El archivo GPX está dañado o no es válido.");
  const nodes = [...xmlElements(documentXml, "trkpt"), ...xmlElements(documentXml, "rtept")];
  return limitTrackPoints(parseGpxDocument(nodes));
}

function parseGpxDocument(nodes) {
  return nodes.map((node, index) => {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    const timeText = xmlElements(node, "time")[0]?.textContent;
    return { lat, lng, time: timeText ? new Date(timeText).getTime() : index * 10000 };
  }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function parseTcxDocument(nodes) {
  return nodes.map((node, index) => {
    const lat = Number(xmlElements(node, "LatitudeDegrees")[0]?.textContent);
    const lng = Number(xmlElements(node, "LongitudeDegrees")[0]?.textContent);
    const timeText = xmlElements(node, "Time")[0]?.textContent;
    return { lat, lng, time: timeText ? new Date(timeText).getTime() : index * 10000 };
  }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function xmlElements(root, localName) {
  const namespaced = root.getElementsByTagNameNS ? [...root.getElementsByTagNameNS("*", localName)] : [];
  return namespaced.length ? namespaced : [...root.getElementsByTagName(localName)];
}

function limitTrackPoints(raw) {
  if (raw.length <= MAX_TRACK_POINTS) return raw;
  const step = Math.ceil(raw.length / MAX_TRACK_POINTS);
  return raw.filter((_, index) => index % step === 0 || index === raw.length - 1);
}

function detectActivitySource(text, fileName, format) {
  const clue = `${fileName} ${text.slice(0, 60000)}`.toLowerCase();
  if (clue.includes("suunto")) return "suunto";
  if (clue.includes("coros")) return "coros";
  if (clue.includes("garmin")) return "garmin";
  if (clue.includes("polar")) return "polar";
  if (clue.includes("wahoo")) return "wahoo";
  if (clue.includes("strava")) return "strava";
  return format;
}

function routeImportKey(points) {
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points.at(-1);
  const raw = [
    Math.round(Number(first.time) / 1000),
    Math.round(Number(last.time) / 1000),
    first.lat.toFixed(5), first.lng.toFixed(5),
    middle.lat.toFixed(5), middle.lng.toFixed(5),
    last.lat.toFixed(5), last.lng.toFixed(5),
    Math.round(routeDistance(points)), points.length
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `route-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createActivityFromRoute(points, mode, environment, source = "gpx", importKey = null) {
  const distanceMeters = routeDistance(points);
  const firstTime = points[0].time > 100000000000 ? points[0].time : Date.now() - Math.max(600000, distanceMeters / 2.4 * 1000);
  const lastTime = points.at(-1).time > firstTime ? points.at(-1).time : Date.now();
  const durationSeconds = Math.max(1, Math.round((lastTime - firstTime) / 1000));
  const id = makeId();
  const conquest = applyRouteConquest(points, mode, state, id, distanceMeters);
  const activity = {
    id, mode, environment, source, importKey, demo: false,
    startTime: firstTime, endTime: lastTime, durationSeconds,
    distanceMeters: Math.round(distanceMeters), points,
    discoveredIds: [],
    ...conquest,
    score: scoreForConquest(mode, conquest, distanceMeters, 0)
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
  const safeState = {
    ...state,
    social: {
      ...state.social,
      session: null,
      group: null
    }
  };
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), app: "Territorio 360", ...safeState }, null, 2);
  downloadBlob(payload, `territorio-360-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  showToast("Copia de tus datos descargada.");
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.activities)) throw new Error();
    if (!window.confirm("Esta copia sustituirá los datos actuales. ¿Continuar?")) return;
    state = normalizeState({
      ...parsed,
      active: null,
      social: { ...(parsed.social || {}), session: null, group: null }
    });
    saveState();
    activeRoute.setLatLngs([]);
    if (typeof clearSocialRuntime === "function") clearSocialRuntime();
    renderAll();
    showToast("Copia restaurada correctamente.");
  } catch {
    showToast("El archivo no es una copia válida de Territorio 360.");
  }
}

function resetData() {
  if (!window.confirm("¿Borrar recorridos, territorios, puntos y logros de este dispositivo? Esta acción no se puede deshacer.")) return;
  clearPositionWatch();
  if (demoTimer) clearInterval(demoTimer);
  state = defaultState();
  saveState();
  activeRoute.setLatLngs([]);
  if (typeof clearSocialRuntime === "function") clearSocialRuntime();
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
