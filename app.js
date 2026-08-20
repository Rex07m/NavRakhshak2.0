/* ==========================================================================
   NAVRAKSHAK — SHARED CONTROL HUB LOGIC
   Ported 1:1 from the original single-page build. No Firebase paths,
   command strings, PIN values, or storage keys have been changed —
   only reorganized so every page can share the same brain.
   ========================================================================== */

/* ---- FIREBASE (unchanged) ---- */
const firebaseConfig = {
    apiKey: "AIzaSyCxrvcgU0cnZsthDZp3eRKKeO0QQWYdDoA",
    authDomain: "navrakhshak-web.firebaseapp.com",
    databaseURL: "https://navrakhshak-web-default-rtdb.firebaseio.com",
    projectId: "navrakhshak-web",
    storageBucket: "navrakhshak-web.appspot.com",
    messagingSenderId: "690586658424",
    appId: "1:690586658424:web:be9438d65035863783af8d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ---- STATE (unchanged defaults) ---- */
let fenceLat = parseFloat(localStorage.getItem('fLat')) || 23.13161;
let fenceLon = parseFloat(localStorage.getItem('fLon')) || 88.54735;
let fenceRad = parseFloat(localStorage.getItem('fRad')) || 50;
let lastWeatherCheckTime = 0;
let lastLat = 0, lastLon = 0;

/* ---- MAP (only present on the Surveillance page — guarded) ---- */
let map = null, boatPath = null, boatIcon = null, visualFence = null;

function initMapIfPresent() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([fenceLat, fenceLon], 15);

    L.tileLayer('https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}.jpg?key=tbCji5PsF2IBPBis0LYU', {
        maxZoom: 20,
        crossOrigin: true
    }).addTo(map);

    boatPath = L.polyline([], { color: '#f25a22', weight: 4, opacity: 0.8, dashArray: '5, 10' }).addTo(map);
    boatIcon = L.circleMarker([fenceLat, fenceLon], { radius: 8, color: '#fff', fillColor: '#012b5d', fillOpacity: 1, weight: 3 }).addTo(map);
    visualFence = L.circle([fenceLat, fenceLon], { radius: fenceRad, color: '#ff0055', weight: 1.5, fillOpacity: 0.04, dashArray: '4, 4' }).addTo(map);

    window.addEventListener('resize', () => { map.invalidateSize(); });
    setTimeout(() => { map.invalidateSize(); }, 200);
}

/* ---- COMMAND FORM (only present on the Command page — guarded) ---- */
function primeCommandForm() {
    const cmdLat = document.getElementById('cmdLat');
    const cmdLon = document.getElementById('cmdLon');
    const cmdRad = document.getElementById('cmdRad');
    const cmdBuf = document.getElementById('cmdBuf');
    if (!cmdLat) return;

    cmdLat.value = fenceLat;
    cmdLon.value = fenceLon;
    cmdRad.value = fenceRad;
    cmdBuf.value = parseFloat(localStorage.getItem('fBuf')) || 10;
}

/* ---- SHARED HELPERS (unchanged logic) ---- */
function syncVisuals(lat, lon, rad, buf) {
    if (visualFence) {
        visualFence.setLatLng([lat, lon]);
        visualFence.setRadius(rad);
    }
    localStorage.setItem('fLat', lat);
    localStorage.setItem('fLon', lon);
    localStorage.setItem('fRad', rad);
    localStorage.setItem('fBuf', buf);
}

function fetchLocationWeather(lat, lon) {
    if (Date.now() - lastWeatherCheckTime < 60000) return;
    lastWeatherCheckTime = Date.now();

    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(res => res.json())
        .then(weather => {
            if (weather && weather.current_weather) {
                const temp = weather.current_weather.temperature;
                const windSpeed = weather.current_weather.windspeed;
                const wCode = weather.current_weather.weathercode;

                const elTemp = document.getElementById('weatherTemp');
                const elWind = document.getElementById('weatherWind');
                const elStorm = document.getElementById('weatherStorm');
                const elDesc = document.getElementById('weatherDesc');
                const badge = document.getElementById('statusBadge');

                if (elTemp) elTemp.innerText = `${temp}°C`;
                if (elWind) elWind.innerText = `${windSpeed} km/h`;

                let stormStatus = "NORMAL";
                if (windSpeed > 35.0 || wCode >= 96) {
                    stormStatus = "CRITICAL STORM DETECTED";
                    if (elStorm) elStorm.style.color = "var(--neon-danger)";
                    if (badge) {
                        badge.innerText = "WEATHER ALERT: SEVERE GALES";
                        badge.className = "status-badge pulse-alarm";
                    }
                    db.ref('config/syncCommand').set("WEATHER_ALERT");
                } else {
                    if (elStorm) elStorm.style.color = "var(--brand-orange)";
                    if (badge && badge.innerText.includes("WEATHER ALERT")) {
                        badge.innerText = "LINK: SECURE / SAFE";
                        badge.className = "status-badge";
                    }
                }
                if (elStorm) elStorm.innerText = stormStatus;
                if (elDesc) elDesc.innerText = `Weather Code Status Index Reference: ${wCode}`;

                db.ref('weather_live').set({
                    temperature: temp,
                    wind: windSpeed,
                    storm_index: stormStatus
                });
            }
        }).catch(err => console.log("Meteorological data drop error: ", err));
}

function initializeFirebaseListeners() {
    db.ref('boat').on('value', (snapshot) => {
        const data = snapshot.val();
        let badge = document.getElementById('statusBadge');
        let sosBtn = document.getElementById('sosNavBtn');

        if (!data) {
            if (badge) badge.innerText = "LINK: OFFLINE";
            return;
        }

        const cLat = parseFloat(data.latitude);
        const cLon = parseFloat(data.longitude);
        const statusMsg = String(data.status || "WAITING").toUpperCase();
        const borderDist = parseFloat(data.distanceToBorder || 0.0);

        if (!isNaN(cLat) && !isNaN(cLon) && cLat !== 0 && cLon !== 0) {
            lastLat = cLat; lastLon = cLon;

            if (map && boatIcon) {
                boatIcon.setLatLng([lastLat, lastLon]);
                boatPath.addLatLng([lastLat, lastLon]);
                map.panTo([lastLat, lastLon]);
            }

            const coordsEl = document.getElementById('boatCoords');
            if (coordsEl) coordsEl.innerText = `${lastLat.toFixed(6)}, ${lastLon.toFixed(6)}`;

            fetchLocationWeather(lastLat, lastLon);
        }

        const syncTimeEl = document.getElementById('syncTime');
        if (syncTimeEl) syncTimeEl.innerText = `DIST TO EDGE: ${borderDist.toFixed(1)} m`;

        if (statusMsg.includes("SOS") || statusMsg.includes("ALERT") || data.isAlertActive === true) {
            if (badge && !badge.innerText.includes("WEATHER ALERT")) {
                badge.innerText = `ALARM: ${statusMsg}`;
                badge.className = 'status-badge pulse-alarm';
            }
            if (sosBtn) sosBtn.classList.add('pulse-alarm');
            if (boatIcon) boatIcon.setStyle({ fillColor: '#ff0055' });
        } else {
            if (badge && !badge.innerText.includes("WEATHER ALERT")) {
                badge.innerText = `LINK: SECURE / ${statusMsg}`;
                badge.className = 'status-badge';
            }
            if (sosBtn) sosBtn.classList.remove('pulse-alarm');
            if (boatIcon) boatIcon.setStyle({ fillColor: '#012b5d' });
        }
    });

    db.ref('preferences').on('value', (snapshot) => {
        const prefs = snapshot.val();
        if (prefs && prefs.lat && prefs.lon) {
            syncVisuals(parseFloat(prefs.lat), parseFloat(prefs.lon), parseFloat(prefs.rad), parseFloat(prefs.buf));
            const cmdLat = document.getElementById('cmdLat');
            if (cmdLat) {
                document.getElementById('cmdLat').value = prefs.lat;
                document.getElementById('cmdLon').value = prefs.lon;
                document.getElementById('cmdRad').value = prefs.rad;
                document.getElementById('cmdBuf').value = prefs.buf;
            }
        }
    });
}

/* ---- FIX: DESPATCH COMMAND TO NESTED PATH CONFIG BOUNDS (unchanged) ---- */
function updateGeofence() {
    const lat = parseFloat(document.getElementById('cmdLat').value);
    const lon = parseFloat(document.getElementById('cmdLon').value);
    const rad = parseFloat(document.getElementById('cmdRad').value);
    const buf = parseFloat(document.getElementById('cmdBuf').value);

    if (isNaN(lat) || isNaN(lon) || isNaN(rad)) return alert("Please enter valid parameters.");

    syncVisuals(lat, lon, rad, buf);
    db.ref('preferences').set({ lat: lat, lon: lon, rad: rad, buf: buf });

    const commandString = `SET:${lat},${lon},${rad},${buf}`;
    db.ref('config/syncCommand').set(commandString).then(() => {
        alert("BOUNDARY DISPATCHED TO GATEWAY.");
    });
}

function acknowledgeSOS() {
    const enteredPin = document.getElementById('rescuePin').value;
    if (enteredPin != "1234") return alert("Invalid Authentication Code.");

    db.ref('config/syncCommand').set("ACK_SOS").then(() => {
        alert("RESCUE ACK COMMAND DISPATCHED.");
        document.getElementById('rescuePin').value = "";
    });
}

function triggerManualMute() {
    db.ref('config/syncCommand').set("MUTE_ALL").then(() => {
        alert("MANUAL MUTE INSTRUCTION DISPATCHED TO RECEIVER.");
    });
}

function triggerManualWeatherAlert() {
    db.ref('config/syncCommand').set("WEATHER_ALERT").then(() => {
        alert("MANUAL WEATHER ALERT BROADCAST TRANSMITTED.");
    });
}

function checkAuth() {
    const enteredPin = document.getElementById('adminPin').value;
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.disabled = (enteredPin != "1234");
}

function clearPath() {
    if (boatPath) boatPath.setLatLngs([]);
    alert("MAP TRAIL PURGED.");
}

/* ---- NAV: mark the active link based on the current file (multipage) ---- */
function markActiveNav() {
    const current = window.location.pathname.split('/').pop() || 'surveillance.html';
    document.querySelectorAll('.nav-item[data-page]').forEach(link => {
        if (link.dataset.page === current) link.classList.add('active');
        else link.classList.remove('active');
    });
}

/* ---- BOOT ---- */
window.addEventListener('DOMContentLoaded', () => {
    initMapIfPresent();
    primeCommandForm();
    markActiveNav();
    initializeFirebaseListeners();

    const pinInput = document.getElementById('adminPin');
    if (pinInput) pinInput.addEventListener('input', checkAuth);
});
