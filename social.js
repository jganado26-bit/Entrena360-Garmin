"use strict";

let groupRankingMode = "distance";
let socialActivities = [];
let socialLayerVisible = true;
let socialBusy = false;

function initializeSocialBeta() {
  const defaults = window.TERRITORIO_SOCIAL_DEFAULTS || {};
  if (!state.social.config.url && defaults.url) state.social.config.url = normalizeSocialUrl(defaults.url);
  if (!state.social.config.publicKey && defaults.publicKey) state.social.config.publicKey = String(defaults.publicKey).trim();
  saveState();
  renderSocialUi();
  if (hasSocialConfig() && state.social.session) resumeSocialSession();
}

function bindSocialEvents() {
  $("#saveSocialConfigButton")?.addEventListener("click", saveSocialConfig);
  $("#socialLoginButton")?.addEventListener("click", socialLogin);
  $("#socialSignupButton")?.addEventListener("click", socialSignup);
  $("#socialLogoutButton")?.addEventListener("click", socialLogout);
  $("#createSocialGroupButton")?.addEventListener("click", createSocialGroup);
  $("#joinSocialGroupButton")?.addEventListener("click", joinSocialGroup);
  $("#syncSocialActivitiesButton")?.addEventListener("click", syncAllSocialActivities);
  $("#refreshSocialButton")?.addEventListener("click", refreshSocialCommunity);
  $("#groupDistanceRankingButton")?.addEventListener("click", () => setGroupRankingMode("distance"));
  $("#groupConquestRankingButton")?.addEventListener("click", () => setGroupRankingMode("conquest"));
  $("#shareExactRoutes")?.addEventListener("change", handleRouteSharingChange);
  $("#toggleSocialLayerButton")?.addEventListener("click", toggleSocialMapLayer);
}

function hasSocialConfig() {
  return Boolean(state.social.config.url && state.social.config.publicKey);
}

function hasSocialSession() {
  return Boolean(hasSocialConfig() && state.social.session?.accessToken && state.social.session?.userId);
}

function normalizeSocialUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function validateSocialConfig(url, publicKey) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("La URL del proyecto debe ser una dirección https válida.");
  }
  if (!publicKey || publicKey.length < 20) throw new Error("La clave pública no parece válida.");
  if (/service[_-]?role|secret/i.test(publicKey)) throw new Error("No uses una clave secret o service_role en la aplicación.");
}

function saveSocialConfig() {
  try {
    const url = normalizeSocialUrl($("#socialProjectUrl").value);
    const publicKey = $("#socialPublicKey").value.trim();
    validateSocialConfig(url, publicKey);
    state.social.config = { url, publicKey };
    state.social.session = null;
    state.social.group = null;
    saveState();
    setSocialMessage("Conexión guardada. Ya puedes crear una cuenta.", "success");
    renderSocialUi();
  } catch (error) {
    setSocialMessage(error.message, "error");
  }
}

function socialHeaders({ authenticated = true, prefer = "" } = {}) {
  const headers = {
    apikey: state.social.config.publicKey,
    "Content-Type": "application/json"
  };
  if (authenticated && state.social.session?.accessToken) {
    headers.Authorization = `Bearer ${state.social.session.accessToken}`;
  }
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function socialRequest(path, options = {}, retry = true) {
  if (!hasSocialConfig()) throw new Error("Configura primero la conexión pública del grupo.");
  const response = await fetch(`${state.social.config.url}${path}`, {
    method: options.method || "GET",
    headers: socialHeaders({ authenticated: options.authenticated !== false, prefer: options.prefer }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (response.status === 401 && retry && options.authenticated !== false && state.social.session?.refreshToken) {
    await refreshSocialSession();
    return socialRequest(path, options, false);
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || `Error del servidor (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function saveSocialSession(payload, fallbackEmail = "") {
  if (!payload?.access_token || !payload?.user?.id) return false;
  state.social.session = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    userId: payload.user.id,
    email: payload.user.email || fallbackEmail
  };
  saveState();
  return true;
}

async function refreshSocialSession() {
  const refreshToken = state.social.session?.refreshToken;
  if (!refreshToken) throw new Error("La sesión ha caducado. Vuelve a entrar.");
  const payload = await socialRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    authenticated: false,
    body: { refresh_token: refreshToken }
  }, false);
  if (!saveSocialSession(payload, state.social.session?.email)) throw new Error("No se pudo renovar la sesión.");
}

async function socialSignup() {
  const credentials = readSocialCredentials();
  if (!credentials) return;
  await withSocialBusy(async () => {
    const payload = await socialRequest("/auth/v1/signup", {
      method: "POST",
      authenticated: false,
      body: {
        email: credentials.email,
        password: credentials.password,
        data: { display_name: state.profile.name || "Explorador", city: credentials.city }
      }
    });
    if (!saveSocialSession(payload, credentials.email)) {
      setSocialMessage("Cuenta creada. Revisa tu correo para confirmarla y después pulsa Entrar.", "success");
      return;
    }
    state.profile.city = credentials.city;
    await updateSocialProfile(true);
    await loadSocialGroup();
    setSocialMessage("Cuenta creada. Ahora crea un grupo o introduce una invitación.", "success");
    renderSocialUi();
  });
}

async function socialLogin() {
  const credentials = readSocialCredentials();
  if (!credentials) return;
  await withSocialBusy(async () => {
    const payload = await socialRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      authenticated: false,
      body: { email: credentials.email, password: credentials.password }
    });
    if (!saveSocialSession(payload, credentials.email)) throw new Error("No se pudo iniciar sesión.");
    state.profile.city = credentials.city || state.profile.city;
    await updateSocialProfile(true);
    await loadSocialGroup();
    setSocialMessage("Sesión iniciada.", "success");
    renderSocialUi();
    if (state.social.group) await refreshSocialCommunity();
  });
}

function readSocialCredentials() {
  const email = $("#socialEmail").value.trim().toLowerCase();
  const password = $("#socialPassword").value;
  const city = $("#socialCity").value.trim();
  if (!hasSocialConfig()) {
    setSocialMessage("Guarda primero la conexión del grupo.", "error");
    return null;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setSocialMessage("Escribe un correo válido.", "error");
    return null;
  }
  if (password.length < 6) {
    setSocialMessage("La contraseña debe tener al menos 6 caracteres.", "error");
    return null;
  }
  return { email, password, city };
}

async function resumeSocialSession() {
  try {
    if (Number(state.social.session.expiresAt || 0) < Date.now() + 30000) await refreshSocialSession();
    await updateSocialProfile(true);
    await loadSocialGroup();
    renderSocialUi();
    if (state.social.group) await refreshSocialCommunity();
  } catch (error) {
    if (/session|sesión|jwt|token|refresh/i.test(error.message)) {
      state.social.session = null;
      state.social.group = null;
      saveState();
    }
    setSocialMessage(`Modo local activo: ${friendlySocialError(error)}`, "error");
    renderSocialUi();
  }
}

function socialLogout() {
  state.social.session = null;
  state.social.group = null;
  socialActivities = [];
  saveState();
  socialLayer?.clearLayers();
  setSocialMessage("Sesión cerrada. Tus actividades locales siguen en el teléfono.");
  renderSocialUi();
}

async function updateSocialProfile(silent = false) {
  if (!hasSocialSession()) return;
  try {
    await socialRequest("/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        id: state.social.session.userId,
        display_name: state.profile.name || "Explorador",
        city: state.profile.city || "",
        color: colorForUser(state.social.session.userId)
      }
    });
    if (!silent) setSocialMessage("Nombre actualizado para el grupo.", "success");
  } catch (error) {
    if (!silent) setSocialMessage(friendlySocialError(error), "error");
  }
}

async function loadSocialGroup() {
  if (!hasSocialSession()) return null;
  const userId = encodeURIComponent(state.social.session.userId);
  const rows = await socialRequest(`/rest/v1/group_members?select=group_id,groups(id,name,invite_code)&user_id=eq.${userId}&order=joined_at.asc&limit=1`);
  const group = Array.isArray(rows) ? rows[0]?.groups : null;
  state.social.group = group ? { id: group.id, name: group.name, inviteCode: group.invite_code } : null;
  saveState();
  return state.social.group;
}

async function createSocialGroup() {
  const name = $("#socialNewGroupName").value.trim();
  if (!name) {
    setSocialMessage("Escribe un nombre para el grupo.", "error");
    return;
  }
  let created = false;
  await withSocialBusy(async () => {
    const group = await socialRequest("/rest/v1/rpc/create_trial_group", { method: "POST", body: { p_name: name } });
    state.social.group = normalizeReturnedGroup(group);
    created = true;
    saveState();
    renderSocialUi();
    setSocialMessage(`Grupo creado. Comparte el código ${state.social.group.inviteCode}.`, "success");
  });
  if (created) await syncAllSocialActivities(true);
}

async function joinSocialGroup() {
  const code = $("#socialInviteCode").value.trim().toUpperCase().replace(/\s/g, "");
  if (!code) {
    setSocialMessage("Escribe el código de invitación.", "error");
    return;
  }
  let joined = false;
  await withSocialBusy(async () => {
    const group = await socialRequest("/rest/v1/rpc/join_group_by_code", { method: "POST", body: { p_code: code } });
    state.social.group = normalizeReturnedGroup(group);
    joined = true;
    saveState();
    renderSocialUi();
    setSocialMessage(`Ya formas parte de ${state.social.group.name}.`, "success");
  });
  if (joined) await syncAllSocialActivities(true);
}

function normalizeReturnedGroup(value) {
  const group = Array.isArray(value) ? value[0] : value;
  if (!group?.id || !group?.name || !(group.invite_code || group.inviteCode)) throw new Error("El servidor no devolvió un grupo válido.");
  return { id: group.id, name: group.name, inviteCode: group.invite_code || group.inviteCode };
}

function socialActivityPayload(activity) {
  const points = state.social.shareExactRoutes ? simplifySocialPath(activity.points || []) : null;
  return {
    user_id: state.social.session.userId,
    group_id: state.social.group.id,
    client_activity_id: String(activity.id),
    mode: MODE_DATA[activity.mode] ? activity.mode : "run",
    source: String(activity.source || "gps").slice(0, 40),
    start_time: new Date(activity.startTime || Date.now()).toISOString(),
    end_time: new Date(activity.endTime || activity.startTime || Date.now()).toISOString(),
    distance_m: Math.max(0, Math.round(Number(activity.distanceMeters) || 0)),
    new_area_sqm: Math.max(0, Math.round(Number(activity.newAreaSqm) || 0)),
    new_linear_m: Math.max(0, Math.round(Number(activity.newLinearMeters) || 0)),
    conquest_points: Math.max(0, conquestPointsForActivity(activity)),
    route_type: activity.conquestType === "area" ? "area" : "line",
    public_path: points?.length > 1 ? points : null
  };
}

function simplifySocialPath(points) {
  const valid = points.filter(point => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
  if (valid.length <= 400) return valid.map(point => [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))]);
  const step = Math.ceil(valid.length / 400);
  return valid
    .filter((_, index) => index % step === 0 || index === valid.length - 1)
    .map(point => [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))]);
}

async function syncActivitySocial(activity, silent = true) {
  if (!hasSocialSession() || !state.social.group || activity?.demo) return false;
  try {
    await socialRequest("/rest/v1/activities?on_conflict=user_id,client_activity_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: socialActivityPayload(activity)
    });
    state.social.lastSyncAt = Date.now();
    saveState();
    if (!silent) setSocialMessage("Actividad sincronizada.", "success");
    return true;
  } catch (error) {
    if (!silent) setSocialMessage(friendlySocialError(error), "error");
    return false;
  }
}

async function syncAllSocialActivities(silent = false) {
  if (!hasSocialSession() || !state.social.group) {
    if (!silent) setSocialMessage("Entra en un grupo antes de sincronizar.", "error");
    return;
  }
  await withSocialBusy(async () => {
    const activities = state.activities.filter(activity => !activity.demo);
    let synced = 0;
    for (const activity of activities) {
      if (await syncActivitySocial(activity, true)) synced += 1;
    }
    state.social.lastSyncAt = Date.now();
    saveState();
    if (!silent) setSocialMessage(`${synced} actividades sincronizadas.`, "success");
    await refreshSocialCommunity(true);
  }, silent);
}

async function handleRouteSharingChange(event) {
  state.social.shareExactRoutes = Boolean(event.currentTarget.checked);
  saveState();
  setSocialMessage(state.social.shareExactRoutes
    ? "Se compartirán tus trazados al sincronizar. Evita rutas que revelen tu domicilio."
    : "Trazados desactivados. Sincroniza para retirarlos del mapa del grupo.");
  await syncAllSocialActivities();
}

async function refreshSocialCommunity(silent = false) {
  renderSocialUi();
  if (!hasSocialSession() || !state.social.group) return;
  try {
    const since = encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString());
    const groupId = encodeURIComponent(state.social.group.id);
    const select = "id,user_id,mode,source,start_time,distance_m,new_area_sqm,new_linear_m,conquest_points,route_type,public_path,profiles!activities_user_id_fkey(display_name,city,color)";
    const path = `/rest/v1/activities?select=${encodeURIComponent(select)}&group_id=eq.${groupId}&start_time=gte.${since}&order=start_time.desc&limit=250`;
    socialActivities = await socialRequest(path) || [];
    renderSocialCommunity();
    renderSocialMap();
    if (!silent) setSocialMessage("Grupo actualizado.", "success");
  } catch (error) {
    setSocialMessage(`No se pudo actualizar: ${friendlySocialError(error)}`, "error");
  }
}

function setGroupRankingMode(mode) {
  groupRankingMode = mode === "conquest" ? "conquest" : "distance";
  renderSocialCommunity();
}

function renderSocialUi() {
  if (!$("#socialDisconnectedPanel")) return;
  const configured = hasSocialConfig();
  const authenticated = hasSocialSession();
  const inGroup = authenticated && Boolean(state.social.group);
  $("#socialDisconnectedPanel").hidden = configured;
  $("#socialAuthPanel").hidden = !configured || authenticated;
  $("#socialGroupPanel").hidden = !authenticated;
  $("#socialNoGroupPanel").hidden = !authenticated || inGroup;
  $("#socialActiveGroupPanel").hidden = !inGroup;
  $("#toggleSocialLayerButton").hidden = !inGroup;
  $("#socialProjectUrl").value = state.social.config.url || "";
  $("#socialPublicKey").value = state.social.config.publicKey || "";
  $("#socialCity").value = state.profile.city || "";
  $("#shareExactRoutes").checked = Boolean(state.social.shareExactRoutes);

  const name = state.profile.name || "Explorador";
  $("#socialUserName").textContent = name;
  $("#socialUserAvatar").textContent = name.trim().charAt(0).toUpperCase() || "E";
  $("#socialUserEmail").textContent = state.social.session?.email || "";
  $("#profileSocialGroupName").textContent = state.social.group?.name || "—";
  $("#profileSocialInviteCode").textContent = state.social.group?.inviteCode || "—";
  $("#socialGroupName").textContent = state.social.group?.name || (authenticated ? "Sin grupo" : "Sin conectar");
  $("#socialGroupDetail").textContent = inGroup
    ? `${socialActivities.length} actividades en los últimos 30 días`
    : configured ? "Crea un grupo o introduce un código desde Perfil" : "Configura la beta desde tu perfil";
  $("#socialStatusBadge").textContent = inGroup ? "EN LÍNEA" : "LOCAL";
  $("#socialStatusBadge").classList.toggle("online", inGroup);
  renderSocialCommunity();
}

function renderSocialCommunity() {
  const distanceButton = $("#groupDistanceRankingButton");
  const conquestButton = $("#groupConquestRankingButton");
  if (!distanceButton || !conquestButton) return;
  distanceButton.classList.toggle("active", groupRankingMode === "distance");
  conquestButton.classList.toggle("active", groupRankingMode === "conquest");
  distanceButton.setAttribute("aria-selected", String(groupRankingMode === "distance"));
  conquestButton.setAttribute("aria-selected", String(groupRankingMode === "conquest"));

  const ranking = aggregateSocialRanking();
  $("#groupRankingList").innerHTML = ranking.length ? ranking.map((person, index) => {
    const value = groupRankingMode === "distance"
      ? `${formatNumber(person.distance / 1000, 2)} km`
      : `${formatInteger(person.conquest)} pts`;
    return `<article class="ranking-row ${person.userId === state.social.session?.userId ? "current" : ""}">
      <span class="ranking-position">${index + 1}</span>
      <span class="ranking-avatar" style="--avatar-color:${escapeHtml(person.color)}">${escapeHtml(person.name.charAt(0).toUpperCase())}</span>
      <span class="ranking-copy"><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.city || "Miembro del grupo")}</small></span>
      <strong class="ranking-value">${value}</strong>
    </article>`;
  }).join("") : `<div class="empty-state">${state.social.group ? "Todavía no hay actividades sincronizadas en los últimos 30 días." : "Inicia sesión y entra en un grupo para ver la clasificación."}</div>`;

  $("#socialFeed").innerHTML = socialActivities.length ? socialActivities.slice(0, 15).map(activity => {
    const profile = socialProfileFor(activity);
    const mode = MODE_DATA[activity.mode] || MODE_DATA.run;
    const conquest = activity.route_type === "area"
      ? `${formatArea(activity.new_area_sqm || 0)} nuevos`
      : `${formatNumber((activity.new_linear_m || 0) / 1000, 2)} km nuevos`;
    return `<article class="social-feed-item">
      <span class="social-feed-avatar" style="--avatar-color:${escapeHtml(profile.color)}">${escapeHtml(profile.name.charAt(0).toUpperCase())}</span>
      <span class="social-feed-copy"><strong>${escapeHtml(profile.name)} · ${mode.icon} ${mode.label}</strong><small>${formatDate(activity.start_time)} · ${escapeHtml(sourceLabel({ source: activity.source }))} · ${conquest}</small></span>
      <span class="social-feed-value">${formatNumber((activity.distance_m || 0) / 1000, 2)} km</span>
    </article>`;
  }).join("") : `<div class="empty-state">Las conquistas compartidas aparecerán aquí.</div>`;
}

function aggregateSocialRanking() {
  const people = new Map();
  socialActivities.forEach(activity => {
    const profile = socialProfileFor(activity);
    const current = people.get(activity.user_id) || {
      userId: activity.user_id,
      name: profile.name,
      city: profile.city,
      color: profile.color,
      distance: 0,
      conquest: 0
    };
    current.distance += Number(activity.distance_m) || 0;
    current.conquest += Number(activity.conquest_points) || 0;
    people.set(activity.user_id, current);
  });
  return [...people.values()].sort((a, b) => {
    const metric = groupRankingMode === "distance" ? "distance" : "conquest";
    return b[metric] - a[metric] || a.name.localeCompare(b.name, "es");
  });
}

function socialProfileFor(activity) {
  const relation = Array.isArray(activity.profiles) ? activity.profiles[0] : activity.profiles;
  return {
    name: relation?.display_name || "Explorador",
    city: relation?.city || "",
    color: relation?.color || colorForUser(activity.user_id)
  };
}

function renderSocialMap() {
  if (!socialLayer) return;
  socialLayer.clearLayers();
  if (!socialLayerVisible) return;
  socialActivities.forEach(activity => {
    if (activity.user_id === state.social.session?.userId || !Array.isArray(activity.public_path) || activity.public_path.length < 2) return;
    const points = activity.public_path
      .map(point => [Number(point[0]), Number(point[1])])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (points.length < 2) return;
    const profile = socialProfileFor(activity);
    const options = { color: profile.color, weight: 5, opacity: .78, lineCap: "round" };
    const shape = activity.route_type === "area"
      ? L.polygon(points, { ...options, fillColor: profile.color, fillOpacity: .12 })
      : L.polyline(points, options);
    shape.bindPopup(`<strong>${escapeHtml(profile.name)}</strong>${escapeHtml(MODE_DATA[activity.mode]?.label || "Actividad")} · ${formatNumber((activity.distance_m || 0) / 1000, 2)} km`);
    shape.addTo(socialLayer);
  });
}

function toggleSocialMapLayer() {
  socialLayerVisible = !socialLayerVisible;
  const button = $("#toggleSocialLayerButton");
  button.setAttribute("aria-pressed", String(socialLayerVisible));
  button.classList.toggle("muted", !socialLayerVisible);
  renderSocialMap();
}

function clearSocialRuntime() {
  socialActivities = [];
  socialLayer?.clearLayers();
  renderSocialUi();
}

function colorForUser(userId) {
  const palette = ["#4ce0b3", "#6fc4ff", "#ffca69", "#f18ac5", "#b9a4ff", "#ff8a65", "#c9f35b"];
  let hash = 0;
  for (const character of String(userId || "explorador")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function setSocialMessage(message = "", type = "") {
  const element = $("#socialMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `social-message ${type}`.trim();
}

async function withSocialBusy(task, silent = false) {
  if (socialBusy) return;
  socialBusy = true;
  document.body.classList.add("social-busy");
  try {
    await task();
  } catch (error) {
    if (!silent) setSocialMessage(friendlySocialError(error), "error");
  } finally {
    socialBusy = false;
    document.body.classList.remove("social-busy");
  }
}

function friendlySocialError(error) {
  const message = String(error?.message || "No se pudo conectar con el grupo.");
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "sin conexión con el servidor; el modo local sigue disponible.";
  if (/invalid login credentials/i.test(message)) return "correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(message)) return "confirma primero el correo de registro.";
  if (/already registered|already been registered/i.test(message)) return "ese correo ya tiene una cuenta.";
  return message;
}
