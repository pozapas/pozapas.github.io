// CoCorridor-AI: Application Controller (3D Digital Twin, Google Street View, & YOLO26 Edge Analytics)

// Global State
let activeScenario = 'default';

// Telemetry state variables
let currentSpeed = 68;
let currentVolume = 3850;
let activeZonesCount = 0;
let currentRisk = "Very Low";

// CCTV Animation States
let canvas, ctx;
let animationId;
let vehicles = [];
let pedestrians = [];
let rainDrops = [];
let nearMissCount = 0;
let systemTime = new Date();

// Mapbox and Google Panorama states
let map = null;
let panorama = null;
let streetViewTabActive = false;
let activeHUDMarker = null;
let customStreetViewCoords = null; // Stored target from map click clicks

function getMapboxAccessToken() {
    const configToken = window.COCORRIDOR_DEMO_CONFIG?.mapboxToken?.trim();
    if (configToken) return configToken;

    const legacyToken = window.MAPBOX_TOKEN?.trim();
    if (legacyToken) return legacyToken;

    return '';
}

// Map Weather Canvas states
let weatherCanvas, weatherCtx;
let rainParticles = [];
let showRainEffect = false;
let rainAlpha = 0;

// Sparkline chart instances
let speedSparkline = null;
let volumeSparkline = null;

// Cascade scenario phasing
let cascadePhase = 0;
let cascadeTimers = [];
let autoAdvanceCascade = false; // true = auto-advance phases, false = manual button

// -------------------------------------------------------------
// SPARKLINE CHART CLASS (Rolling Mini-Chart)
// Must be defined before DOMContentLoaded since classes are not hoisted.
// -------------------------------------------------------------
class SparklineChart {
    constructor(canvasId, opts = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.data = [];
        this.maxPoints = opts.maxPoints || 30;
        this.color = opts.color || '#00e676';
        this.max = opts.max || 100;
        this.min = opts.min || 0;
    }

    push(value) {
        if (!this.canvas) return;
        this.data.push(value);
        if (this.data.length > this.maxPoints) this.data.shift();
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        if (this.data.length < 2) return;
        
        const stepX = w / (this.maxPoints - 1);
        const range = this.max - this.min;
        
        // Draw filled area
        ctx.beginPath();
        ctx.moveTo(0, h);
        
        this.data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - ((val - this.min) / range) * (h - 4) - 2;
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        });
        
        ctx.lineTo((this.data.length - 1) * stepX, h);
        ctx.closePath();
        
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, this.color + '40');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw line
        ctx.beginPath();
        this.data.forEach((val, i) => {
            const x = i * stepX;
            const y = h - ((val - this.min) / range) * (h - 4) - 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Draw current value dot
        const lastVal = this.data[this.data.length - 1];
        const lastX = (this.data.length - 1) * stepX;
        const lastY = h - ((lastVal - this.min) / range) * (h - 4) - 2;
        
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// Coordinates Manifest (Selma to Buda on I-35 corridor)
const MAP_CENTER = [-98.05, 29.83]; // Aggregated corridor center

const cities = [
    { name: 'Buda (Exit 220)', coords: [-97.8436, 30.0841], id: 'buda' },
    { name: 'Kyle (Exit 213)', coords: [-97.8597, 29.9869], id: 'kyle' },
    { name: 'San Marcos (Exit 205)', coords: [-97.9414, 29.8833], id: 'sm' },
    { name: 'New Braunfels (Exit 186)', coords: [-98.1245, 29.7030], id: 'nb' },
    { name: 'Selma (Exit 174)', coords: [-98.3039, 29.5852], id: 'selma' }
];

const cameras = [
    { name: 'ITS Sensor Node: Buda', coords: [-97.8480, 30.0650], id: 'buda', isSensor: true },
    { name: 'ITS Sensor Node: Kyle', coords: [-97.8650, 29.9650], id: 'kyle', isSensor: true },
    { name: 'Frontage Camera Node: SM205', coords: [-97.9414, 29.8833], id: 'sm', isSensor: false },
    { name: 'ITS Sensor Node: NB', coords: [-98.1150, 29.7150], id: 'nb', isSensor: true }
];

// High-Accuracy Route Data
let i35RouteCoords = []; // Array of [lng, lat] along I-35
let detourRouteCoords = []; // Array of [lng, lat] along frontage road
let budaDetourCoords = []; // Array of [lng, lat] along FM 967 detour

// Traffic Particle Flow System
let trafficParticles = [];
let trafficAnimationId = null;

// Route Line Breathing Pulse Animation State
let i35GlowPulseWidth = 8;
let i35GlowPulseDir = 0.06;
let animationTick = 0; // Tick for marching detours & flashing roadblocks

// Camera Cinematic Orbit State
let orbitAnimationActive = false;
let orbitBearing = -55;

// Sidebar Checklist configurations
const checklistItems = {
    default: [
        { text: "NTCIP 1202 Signal Coordination active", status: "active" },
        { text: "Google RMI Speed Feeds ingesting", status: "active" },
        { text: "YOLO26 Camera Edge Nodes online", status: "active" },
        { text: "WZDx Data Broker listener idle", status: "pending" }
    ],
    flood: [
        { text: "FM 967 Flood Alert broadcasted", status: "alert" },
        { text: "Dynamic VMS Speed warning (45mph)", status: "alert" },
        { text: "Google Maps Immersive warning pushed", status: "active" },
        { text: "Arterial Signal Timing plan engaged", status: "active" }
    ],
    incident: [
        { text: "Secondary Collision warning active", status: "danger" },
        { text: "Project Green Light arterial plan on", status: "danger" },
        { text: "Frontage Road Detour routing engaged", status: "active" },
        { text: "CAM-SM205 YOLO26 crash alert synced", status: "danger" }
    ],
    workzone: [
        { text: "WZDx Construction Feed active", status: "warning" },
        { text: "Kyle MM213 Lane 3 Closure posted", status: "warning" },
        { text: "Reduced Speed Limit enforced (55mph)", status: "warning" },
        { text: "In-Cab connected warning notifications", status: "active" }
    ],
    cascade: [
        { text: "PHASE 1: Flash Flood Warning (Buda)", status: "alert" },
        { text: "PHASE 2: Secondary Collision (Kyle)", status: "danger" },
        { text: "PHASE 3: Emergency Work Zone deployed", status: "warning" },
        { text: "Full corridor reroute engaged", status: "danger" }
    ]
};

// Initialize application on load
window.addEventListener('DOMContentLoaded', () => {
    // Canvas setup
    canvas = document.getElementById('canvas-video-feed');
    ctx = canvas.getContext('2d');
    
    // Initialize Mapbox GL JS map
    initMapboxMap();

    // Initialize full-map rain weather overlay
    initWeatherCanvas();
    animateWeather();

    // Initialize log stream with default messages
    initLogStream();
    
    // Start CCTV simulation loop
    initCCTVSimulation();
    animateCCTV();
    
    // Periodic updates
    setInterval(updateSystemTime, 1000);
    setInterval(generatePeriodicLogs, 4000);
    setInterval(simulateTelemetryDrift, 3000);

    // Initialize sparkline charts
    speedSparkline = new SparklineChart('speed-sparkline', { color: '#00e676', max: 85 });
    volumeSparkline = new SparklineChart('volume-sparkline', { color: '#00b0ff', max: 5000 });
    for (let i = 0; i < 20; i++) { speedSparkline.push(68 + (Math.random() * 4 - 2)); volumeSparkline.push(3850 + (Math.random() * 60 - 30)); }
    setInterval(() => { speedSparkline.push(currentSpeed); volumeSparkline.push(currentVolume); }, 3000);

    // Set initial map legend
    updateMapLegend('default');

    // Initialize status bar clock
    updateStatusBarClock();
    setInterval(updateStatusBarClock, 1000);

    // Set initial timeline
    updateScenarioTimeline('default');
});

// -------------------------------------------------------------
// WEATHER ENVIRONMENTAL RAIN ANIMATION (FULL MAP CANVAS)
// -------------------------------------------------------------
function initWeatherCanvas() {
    weatherCanvas = document.getElementById('weather-canvas');
    weatherCtx = weatherCanvas.getContext('2d');
    resizeWeatherCanvas();
    
    // Spawn rain particles
    rainParticles = [];
    for (let i = 0; i < 150; i++) {
        rainParticles.push({
            x: Math.random() * weatherCanvas.width,
            y: Math.random() * weatherCanvas.height,
            len: 12 + Math.random() * 18,
            speed: 9 + Math.random() * 8,
            opacity: 0.12 + Math.random() * 0.22
        });
    }
    
    window.addEventListener('resize', resizeWeatherCanvas);
}

function resizeWeatherCanvas() {
    if (weatherCanvas) {
        weatherCanvas.width = weatherCanvas.parentElement.clientWidth;
        weatherCanvas.height = weatherCanvas.parentElement.clientHeight;
    }
}

function animateWeather() {
    if (!weatherCtx) return;
    
    // Smooth transition for rain opacity
    if (showRainEffect) {
        if (rainAlpha < 1) rainAlpha += 0.04;
    } else {
        if (rainAlpha > 0) rainAlpha -= 0.04;
    }
    
    weatherCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
    
    if (rainAlpha > 0) {
        weatherCtx.strokeStyle = `rgba(0, 176, 255, ${rainAlpha * 0.45})`;
        weatherCtx.lineWidth = 1.5;
        weatherCtx.lineCap = 'round';
        
        rainParticles.forEach(p => {
            weatherCtx.beginPath();
            weatherCtx.moveTo(p.x, p.y);
            weatherCtx.lineTo(p.x - 3, p.y + p.len); // Wind angle
            weatherCtx.stroke();
            
            // Move drops down
            p.y += p.speed;
            p.x -= p.speed * 0.12;
            
            if (p.y > weatherCanvas.height) {
                p.y = -p.len;
                p.x = Math.random() * weatherCanvas.width;
            }
        });
    }
    
    requestAnimationFrame(animateWeather);
}

// -------------------------------------------------------------
// MAPBOX MAP INITIALIZATION & OVERLAYS (STANDARD 3D)
// -------------------------------------------------------------
function initMapboxMap() {
    const mapboxAccessToken = getMapboxAccessToken();
    if (!mapboxAccessToken) {
        pushLog('ERROR', 'Mapbox token is missing. Provide it through cocorridor-demo/config.js or window.MAPBOX_TOKEN.');
        return;
    }

    mapboxgl.accessToken = mapboxAccessToken;
    
    // Use Mapbox Standard style for immersive photorealistic 3D buildings, dynamic shadows, vegetation, and terrain
    map = new mapboxgl.Map({
        container: 'corridor-map-container',
        style: 'mapbox://styles/mapbox/standard', 
        center: [-98.02, 29.84], // Centered on SM/Kyle section of the corridor
        zoom: 10.1,
        pitch: 55, // Immersive tilt
        bearing: -15
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Handle user map interactions to stop cinematic orbits
    map.on('dragstart', stopCameraOrbit);
    map.on('zoomstart', stopCameraOrbit);
    map.on('rotatestart', stopCameraOrbit);
    map.on('pitchstart', stopCameraOrbit);

    // Snaps Street View to any coordinate the user clicks on the map!
    map.on('click', (e) => {
        const coords = e.lngLat;
        pushLog("INFO", `Map Sync: Snapping Street View to clicked coordinates [${coords.lng.toFixed(4)}, ${coords.lat.toFixed(4)}]...`);
        customStreetViewCoords = { lat: coords.lat, lng: coords.lng };
        
        // Auto-switch to Street View tab to show the snapped coordinate view
        switchFeedTab('google');
    });

    map.on('style.load', () => {
        // Set dynamic light preset for Standard style
        map.setConfigProperty('basemap', 'lightPreset', 'dusk'); // Default sunset ambient glow
    });

    map.on('load', async () => {
        pushLog("INFO", "Fetching corridor geometries from Mapbox Directions API...");
        
        // Load high-accuracy routes from Directions API
        await loadDirectionsRoutes();
        
        // Enable 3D terrain for realistic elevation
        map.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
        });
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.2 });
        
        // Add layers for I-35 route and detour
        addRouteLayers();
        
        // Setup traffic particles
        initTrafficParticles();
        
        // Start particle animation loop
        animateTrafficFlow();

        // Populate initial checklist
        updateResponseChecklist('default');

        // Add flood hazard zone polygon source (around Buda/Kyle)
        map.addSource('flood-zone', {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'properties': {},
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': [[
                        [-97.88, 30.12],
                        [-97.80, 30.12],
                        [-97.80, 30.03],
                        [-97.88, 30.03],
                        [-97.88, 30.12]
                    ]]
                }
            }
        });

        // Add flood hazard fill layer
        map.addLayer({
            'id': 'flood-zone-layer',
            'type': 'fill',
            'source': 'flood-zone',
    
            'paint': {
                'fill-color': '#00b0ff',
                'fill-opacity': 0, // Hidden initially
                'fill-outline-color': '#00b0ff'
            }
        });

        // Add incident marker source (Exit 205 San Marcos)
        map.addSource('incident-zone', {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'properties': {},
                'geometry': {
                    'type': 'Point',
                    'coordinates': [-97.9414, 29.8833]
                }
            }
        });

        // Pulse circle for incident location
        map.addLayer({
            'id': 'incident-zone-pulse',
            'type': 'circle',
            'source': 'incident-zone',
    
            'paint': {
                'circle-radius': 24,
                'circle-color': '#ff1744',
                'circle-opacity': 0, // Hidden initially
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0
            }
        });

        // Load City Markers (Green Status dots)
        cities.forEach(city => {
            const el = document.createElement('div');
            el.className = 'city-map-marker';
            el.innerHTML = `
                <div class="marker-dot green" id="marker-dot-${city.id}"></div>
                <div class="marker-label">${city.name}</div>
            `;
            new mapboxgl.Marker(el)
                .setLngLat(city.coords)
                .addTo(map);
        });

        // Load Camera & Sensor Markers
        cameras.forEach(cam => {
            const el = document.createElement('div');
            const activeClass = cam.id === 'sm' ? 'active-cam-marker' : '';
            const typeClass = cam.isSensor ? 'sensor-marker' : 'camera-marker';
            
            el.className = `cam-map-marker ${activeClass} ${typeClass}`;
            el.id = `cam-marker-${cam.id}`;
            
            const dotColorClass = cam.isSensor ? 'blue-dot' : 'green-dot';
            el.innerHTML = `<div class="cam-dot ${dotColorClass}"></div>`;
            
            el.addEventListener('click', () => {
                if (cam.isSensor) {
                    pushLog("INFO", `ITS Link Activated: Interfacing corridor telemetry sensor ${cam.name}.`);
                } else {
                    pushLog("INFO", `CCTV Link Activated: Interfacing intersection camera node ${cam.name}.`);
                }
                document.querySelectorAll('.cam-map-marker').forEach(c => c.classList.remove('active-cam-marker'));
                el.classList.add('active-cam-marker');
            });

            new mapboxgl.Marker(el)
                .setLngLat(cam.coords)
                .addTo(map);
        });
        
        pushLog("SUCCESS", "Immersive 3D Digital Twin Loaded successfully.");
    });
}

// -------------------------------------------------------------
// DIRECTIONS ROUTE FETCHING & ROUTE GLOW LAYERS
// -------------------------------------------------------------
async function loadDirectionsRoutes() {
    const Buda = [-97.8436, 30.0841];
    const Kyle = [-97.8597, 29.9869];
    const SM = [-97.9414, 29.8833];
    const NB = [-98.1245, 29.7030];
    const Selma = [-98.3039, 29.5852];
    
    // 1. Fetch main I-35 SB route (Buda -> Kyle -> San Marcos -> New Braunfels -> Selma)
    const routeCoordsString = [Buda, Kyle, SM, NB, Selma].map(c => c.join(',')).join(';');
    const mainRouteUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${routeCoordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
    
    try {
        const response = await fetch(mainRouteUrl);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            i35RouteCoords = data.routes[0].geometry.coordinates;
        } else {
            console.warn("Directions API returned empty route, falling back to straight lines.");
            i35RouteCoords = interpolateFallbackRoute([Buda, Kyle, SM, NB, Selma], 150);
        }
    } catch (e) {
        console.error("Failed to fetch route from directions API", e);
        i35RouteCoords = interpolateFallbackRoute([Buda, Kyle, SM, NB, Selma], 150);
    }
    
    // 2. Fetch Detour Route (Exit 205 frontage road bypass in San Marcos)
    const detourStart = [-97.9310, 29.8960];
    const detourWaypoint = [-97.9395, 29.8830];
    const detourEnd = [-97.9520, 29.8660];
    
    const detourCoordsString = [detourStart, detourWaypoint, detourEnd].map(c => c.join(',')).join(';');
    const detourUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${detourCoordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
    
    try {
        const response = await fetch(detourUrl);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            detourRouteCoords = data.routes[0].geometry.coordinates;
        } else {
            detourRouteCoords = interpolateFallbackRoute([detourStart, detourWaypoint, detourEnd], 40);
        }
    } catch (e) {
        console.error("Failed to fetch detour route from directions API", e);
        detourRouteCoords = interpolateFallbackRoute([detourStart, detourWaypoint, detourEnd], 40);
    }

    // 3. Fetch Buda detour route (FM 967 frontage road bypass)
    const budaDetourStart = [-97.8340, 30.0980];
    const budaDetourWaypoint = [-97.8430, 30.0820];
    const budaDetourEnd = [-97.8520, 30.0620];
    
    const budaDetourCoordsString = [budaDetourStart, budaDetourWaypoint, budaDetourEnd].map(c => c.join(',')).join(';');
    const budaDetourUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${budaDetourCoordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
    
    try {
        const response = await fetch(budaDetourUrl);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            budaDetourCoords = data.routes[0].geometry.coordinates;
        } else {
            budaDetourCoords = interpolateFallbackRoute([budaDetourStart, budaDetourWaypoint, budaDetourEnd], 40);
        }
    } catch (e) {
        console.error("Failed to fetch Buda detour route from directions API", e);
        budaDetourCoords = interpolateFallbackRoute([budaDetourStart, budaDetourWaypoint, budaDetourEnd], 40);
    }
    
    // Debug: Log route data status
    console.log(`[CoCorridor] Route Data Loaded:`);
    console.log(`  i35RouteCoords: ${i35RouteCoords.length} points`);
    console.log(`  detourRouteCoords: ${detourRouteCoords.length} points`);
    console.log(`  budaDetourCoords: ${budaDetourCoords.length} points`);
}

function interpolateFallbackRoute(waypoints, segmentsPerLeg) {
    let route = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const p1 = waypoints[i];
        const p2 = waypoints[i+1];
        for (let j = 0; j < segmentsPerLeg; j++) {
            const ratio = j / segmentsPerLeg;
            route.push([
                p1[0] + ratio * (p2[0] - p1[0]),
                p1[1] + ratio * (p2[1] - p1[1])
            ]);
        }
    }
    route.push(waypoints[waypoints.length - 1]);
    return route;
}

// Slice route coords based on start and end ratio
function sliceRoute(coords, startRatio, endRatio) {
    if (!coords || coords.length === 0) return [];
    const startIdx = Math.floor(coords.length * startRatio);
    const endIdx = Math.floor(coords.length * endRatio);
    return coords.slice(startIdx, endIdx + 1);
}

// Dynamic dash array shift to simulate traffic flow along detour roads
function getMovingDashArray(tick) {
    const step = Math.floor(tick / 6) % 4;
    if (step === 0) return [2, 4];
    if (step === 1) return [0.1, 1, 1.9, 3];
    if (step === 2) return [0.1, 2, 1.9, 2];
    if (step === 3) return [0.1, 3, 1.9, 1];
    return [2, 4];
}

// Get interpolated [lng, lat] coordinate at a given 0-1 ratio along a route
function getCoordinateAtRatio(coords, ratio) {
    if (!coords || coords.length === 0) return [0, 0];
    if (coords.length === 1) return coords[0];
    
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const totalSegments = coords.length - 1;
    const exactIndex = clampedRatio * totalSegments;
    const segIndex = Math.floor(exactIndex);
    const segProgress = exactIndex - segIndex;
    
    // Clamp to last valid segment
    const i = Math.min(segIndex, totalSegments - 1);
    const p1 = coords[i];
    const p2 = coords[i + 1];
    
    return [
        p1[0] + (p2[0] - p1[0]) * segProgress,
        p1[1] + (p2[1] - p1[1]) * segProgress
    ];
}

function addRouteLayers() {
    // Slice mainlane route for localized hazard segments
    const budaFloodCoords = sliceRoute(i35RouteCoords, 0.05, 0.18);
    const kyleWorkzoneCoords = sliceRoute(i35RouteCoords, 0.22, 0.35);
    const smRoadblockCoords = sliceRoute(i35RouteCoords, 0.40, 0.50);
    
    console.log(`[CoCorridor] Layer Segment Coords:`);
    console.log(`  budaFloodCoords: ${budaFloodCoords.length} points`);
    console.log(`  kyleWorkzoneCoords: ${kyleWorkzoneCoords.length} points`);
    console.log(`  smRoadblockCoords: ${smRoadblockCoords.length} points`);

    // Add sources for overlays
    map.addSource('buda-flood-segment-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': budaFloodCoords }
        }
    });
    
    map.addSource('kyle-workzone-segment-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': kyleWorkzoneCoords }
        }
    });
    
    map.addSource('sm-roadblock-segment-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': smRoadblockCoords }
        }
    });
    
    // Add Buda detour source
    map.addSource('buda-detour-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': budaDetourCoords }
        }
    });

    // I-35 mainlane route source with lineMetrics enabled to support glowing gradients!
    map.addSource('i35-route-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': i35RouteCoords
            }
        },
        'lineMetrics': true // Required for line gradients!
    });

    // Route casing/shadow layer (realistic traffic overlay)
    map.addLayer({
        'id': 'i35-highway-glow',
        'type': 'line',
        'source': 'i35-route-source',

        'paint': {
            'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, '#4CAF50',
                1, '#4CAF50'
            ],
            'line-width': 8,
            'line-opacity': 0.35,
            'line-blur': 2
        }
    });

    // Core route layer (standard traffic colors)
    map.addLayer({
        'id': 'i35-highway-core',
        'type': 'line',
        'source': 'i35-route-source',

        'paint': {
            'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, '#4CAF50',
                1, '#4CAF50'
            ],
            'line-width': 4.0,
            'line-opacity': 0.9
        }
    });

    // Detour route source
    map.addSource('detour-route-source', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': detourRouteCoords
            }
        }
    });

    // Diversion route layer
    map.addLayer({
        'id': 'diversion-route-layer',
        'type': 'line',
        'source': 'detour-route-source',
        'paint': {
            'line-color': '#FFC107',
            'line-width': 5,
            'line-opacity': 0,
            'line-blur': 0
        }
    });

    // Buda FM 967 detour layer
    map.addLayer({
        'id': 'buda-detour-layer',
        'type': 'line',
        'source': 'buda-detour-source',
        'paint': {
            'line-color': '#2196F3',
            'line-width': 5,
            'line-opacity': 0,
            'line-blur': 0
        }
    });

    // Flood block overlay (blue)
    map.addLayer({
        'id': 'flood-block-layer',
        'type': 'line',
        'source': 'buda-flood-segment-source',
        'paint': {
            'line-color': '#1565C0',
            'line-width': 8,
            'line-opacity': 0,
            'line-blur': 1
        }
    });

    // Kyle construction casing glow
    map.addLayer({
        'id': 'kyle-workzone-glow',
        'type': 'line',
        'source': 'kyle-workzone-segment-source',
        'paint': {
            'line-color': '#FF9800',
            'line-width': 12,
            'line-opacity': 0,
            'line-blur': 2
        }
    });

    // Kyle construction base (dark)
    map.addLayer({
        'id': 'kyle-workzone-base',
        'type': 'line',
        'source': 'kyle-workzone-segment-source',
        'paint': {
            'line-color': '#212121',
            'line-width': 8,
            'line-opacity': 0
        }
    });

    // Kyle construction orange stripes
    map.addLayer({
        'id': 'kyle-workzone-layer',
        'type': 'line',
        'source': 'kyle-workzone-segment-source',
        'paint': {
            'line-color': '#FF9800',
            'line-width': 8,
            'line-opacity': 0,
            'line-dasharray': [3, 3]
        }
    });

    // Incident roadblock casing glow
    map.addLayer({
        'id': 'sm-roadblock-glow',
        'type': 'line',
        'source': 'sm-roadblock-segment-source',
        'paint': {
            'line-color': '#D32F2F',
            'line-width': 12,
            'line-opacity': 0,
            'line-blur': 2
        }
    });

    // Incident roadblock base (white)
    map.addLayer({
        'id': 'sm-roadblock-base',
        'type': 'line',
        'source': 'sm-roadblock-segment-source',
        'paint': {
            'line-color': '#ffffff',
            'line-width': 8,
            'line-opacity': 0
        }
    });

    // Incident roadblock red stripes
    map.addLayer({
        'id': 'sm-roadblock-layer',
        'type': 'line',
        'source': 'sm-roadblock-segment-source',
        'paint': {
            'line-color': '#D32F2F',
            'line-width': 8,
            'line-opacity': 0,
            'line-dasharray': [3, 3]
        }
    });

    // Traffic Particles Source
    map.addSource('traffic-particles-source', {
        'type': 'geojson',
        'data': {
            'type': 'FeatureCollection',
            'features': []
        }
    });

    // Traffic flow particles (subtle, realistic vehicle proxies)
    map.addLayer({
        'id': 'traffic-particles-layer',
        'type': 'circle',
        'source': 'traffic-particles-source',
        'paint': {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                9, 2.5,
                14, 4.5
            ],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.7,
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(255,255,255,0.4)',
            'circle-blur': 0.25
        }
    });
    
    // Debug: Verify all layers were added
    const overlayLayers = [
        'i35-highway-glow', 'i35-highway-core', 'diversion-route-layer', 
        'buda-detour-layer', 'flood-block-layer', 'kyle-workzone-glow', 
        'kyle-workzone-base', 'kyle-workzone-layer', 'sm-roadblock-glow', 
        'sm-roadblock-base', 'sm-roadblock-layer', 'traffic-particles-layer'
    ];
    console.log(`[CoCorridor] Layer Status After addRouteLayers():`);
    overlayLayers.forEach(id => {
        console.log(`  ${id}: ${map.getLayer(id) ? '✅ ADDED' : '❌ MISSING'}`);
    });
}

// -------------------------------------------------------------
// DYNAMIC ROAD GRADIENT DENSITY HEATMAP
// -------------------------------------------------------------
function updateRouteGradient(scenario) {
    if (!map || !map.isStyleLoaded() || !map.getLayer('i35-highway-core')) return;
    
    let gradient;
    
    if (scenario === 'default') {
        gradient = [
            'interpolate', ['linear'], ['line-progress'],
            0, '#4CAF50',
            1, '#4CAF50'
        ];
    } else if (scenario === 'flood') {
        gradient = [
            'interpolate', ['linear'], ['line-progress'],
            0, '#2196F3',
            0.14, '#1565C0',
            0.28, '#4CAF50',
            1, '#4CAF50'
        ];
    } else if (scenario === 'incident') {
        gradient = [
            'interpolate', ['linear'], ['line-progress'],
            0, '#4CAF50',
            0.32, '#FFC107',
            0.40, '#D32F2F',
            0.50, '#D32F2F',
            0.56, '#FFC107',
            0.64, '#4CAF50',
            1, '#4CAF50'
        ];
    } else if (scenario === 'workzone') {
        gradient = [
            'interpolate', ['linear'], ['line-progress'],
            0, '#4CAF50',
            0.18, '#FF9800',
            0.34, '#FF9800',
            0.42, '#4CAF50',
            1, '#4CAF50'
        ];
    } else if (scenario === 'cascade') {
        gradient = [
            'interpolate', ['linear'], ['line-progress'],
            0, '#1565C0',
            0.14, '#1565C0',
            0.20, '#FF9800',
            0.34, '#FF9800',
            0.38, '#D32F2F',
            0.50, '#D32F2F',
            0.56, '#FF9800',
            0.64, '#4CAF50',
            1, '#4CAF50'
        ];
    }
    
    map.setPaintProperty('i35-highway-glow', 'line-gradient', gradient);
    map.setPaintProperty('i35-highway-core', 'line-gradient', gradient);
}

// -------------------------------------------------------------
// LAYER VISIBILITY (Static — No Animation)
// -------------------------------------------------------------
function initTrafficParticles() {
    // No-op: particles removed for clean digital twin
    trafficParticles = [];
}

// Static layer state updater — called once per scenario change
function updateLayerVisibility() {
    if (!map || !map.isStyleLoaded()) return;

    const isFloodActive = activeScenario === 'flood' || activeScenario === 'cascade';
    const isIncidentActive = activeScenario === 'incident' || (activeScenario === 'cascade' && cascadePhase >= 2);
    const isWorkzoneActive = activeScenario === 'workzone' || (activeScenario === 'cascade' && cascadePhase >= 3);

    // Flood block overlay
    setLayerOpacity('flood-block-layer', 'line-opacity', isFloodActive ? 0.8 : 0);
    
    // Workzone overlays
    setLayerOpacity('kyle-workzone-glow', 'line-opacity', isWorkzoneActive ? 0.45 : 0);
    setLayerOpacity('kyle-workzone-layer', 'line-opacity', isWorkzoneActive ? 1.0 : 0);
    setLayerOpacity('kyle-workzone-base', 'line-opacity', isWorkzoneActive ? 0.85 : 0);

    // Incident roadblock overlays
    setLayerOpacity('sm-roadblock-glow', 'line-opacity', isIncidentActive ? 0.45 : 0);
    setLayerOpacity('sm-roadblock-layer', 'line-opacity', isIncidentActive ? 1.0 : 0);
    setLayerOpacity('sm-roadblock-base', 'line-opacity', isIncidentActive ? 0.85 : 0);

    // Detour routes
    setLayerOpacity('buda-detour-layer', 'line-opacity', isFloodActive ? 0.9 : 0);
    setLayerOpacity('diversion-route-layer', 'line-opacity', isIncidentActive ? 0.9 : 0);
    
    // Hide traffic particles
    setLayerOpacity('traffic-particles-layer', 'circle-opacity', 0);
}

// Legacy wrapper — called from map.on('load')
function animateTrafficFlow() {
    updateLayerVisibility();
}

// -------------------------------------------------------------
// DYNAMIC IMMERSIVE GLASSMORPHIC HUD WIDGETS
// -------------------------------------------------------------
function updateHUDMarkers(scenario) {
    // Clear existing HUD marker
    if (activeHUDMarker) {
        activeHUDMarker.remove();
        activeHUDMarker = null;
    }
    
    if (scenario === 'flood') {
        const el = document.createElement('div');
        el.className = 'hud-marker warning-hud';
        el.innerHTML = `
            <div class="hud-glass-card">
                <div class="hud-badge">FLOOD WARNING</div>
                <div class="hud-body">
                    <strong>Exit 220 Buda Underpass</strong>
                    <span>Active Water Level: 2.3 inches</span>
                    <span>Predictive Safety Model Risk: 84%</span>
                    <span>frontage diversion plan active</span>
                </div>
            </div>
            <div class="hud-pulse-ring">
                <div class="ring-pulse r1"></div>
                <div class="ring-pulse r2"></div>
            </div>
        `;
        activeHUDMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([-97.8436, 30.0841])
            .addTo(map);
            
    } else if (scenario === 'incident') {
        const el = document.createElement('div');
        el.className = 'hud-marker alert-hud';
        el.innerHTML = `
            <div class="hud-glass-card">
                <div class="hud-badge">CRASH DETECTED</div>
                <div class="hud-body">
                    <strong>Exit 205 SB San Marcos</strong>
                    <span>Multi-Vehicle Collision Blockage</span>
                    <span>Est. Segment Delay: 18 mins</span>
                    <span>Active detour routing engaged</span>
                </div>
            </div>
            <div class="hud-pulse-ring">
                <div class="ring-pulse r1"></div>
                <div class="ring-pulse r2"></div>
            </div>
        `;
        activeHUDMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([-97.9414, 29.8833])
            .addTo(map);
            
    } else if (scenario === 'workzone') {
        const el = document.createElement('div');
        el.className = 'hud-marker info-hud';
        el.innerHTML = `
            <div class="hud-glass-card">
                <div class="hud-badge">ACTIVE WORK ZONE</div>
                <div class="hud-body">
                    <strong>Exit 213 SB Kyle</strong>
                    <span>Right Lane Closed (repaving)</span>
                    <span>WZDx streaming data stream active</span>
                    <span>Speed limit reduced to 55 mph</span>
                </div>
            </div>
            <div class="hud-pulse-ring">
                <div class="ring-pulse r1"></div>
                <div class="ring-pulse r2"></div>
            </div>
        `;
        activeHUDMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([-97.8597, 29.9869])
            .addTo(map);
    }
}

// -------------------------------------------------------------
// DYNAMIC CHECKLIST & RISK GAUGE WIDGETS
// -------------------------------------------------------------
function updateResponseChecklist(scenario) {
    const listContainer = document.getElementById('response-checklist');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    const items = checklistItems[scenario] || [];
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'checklist-item';
        
        let statusClass = 'pending';
        if (item.status === 'active') statusClass = 'active';
        if (item.status === 'alert') statusClass = 'alert';
        if (item.status === 'danger') statusClass = 'danger';
        if (item.status === 'warning') statusClass = 'warning';
        
        div.innerHTML = `
            <span class="check-dot ${statusClass}"></span>
            <span>${item.text}</span>
        `;
        listContainer.appendChild(div);
    });
}

// -------------------------------------------------------------
// CAMERA CINEMATIC ORBITING
// -------------------------------------------------------------
function startCameraOrbit(targetCenter) {
    stopCameraOrbit();
    orbitAnimationActive = true;
    orbitBearing = map.getBearing();
    
    function orbitLoop() {
        if (!orbitAnimationActive || !map) return;
        
        orbitBearing = (orbitBearing + 0.04) % 360; // Rotate slowly
        map.setBearing(orbitBearing);
        
        requestAnimationFrame(orbitLoop);
    }
    
    requestAnimationFrame(orbitLoop);
}

function stopCameraOrbit() {
    orbitAnimationActive = false;
}

// -------------------------------------------------------------
// SIMULATION SCENARIO CONTROLS (DIGITAL TWIN)
// -------------------------------------------------------------

// Helper: safely set a single paint property on a layer (with debug logging)
function setLayerOpacity(layerId, prop, value) {
    if (!map) return;
    if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, prop, value);
    } else {
        console.warn(`[CoCorridor] Layer '${layerId}' not found when setting ${prop}=${value}`);
    }
}

// Helper: hide ALL overlay layers (called on every scenario switch to ensure clean state)
function hideAllOverlayLayers() {
    if (!map) return;
    // Flood overlays
    setLayerOpacity('flood-zone-layer', 'fill-opacity', 0);
    setLayerOpacity('flood-block-layer', 'line-opacity', 0);
    setLayerOpacity('buda-detour-layer', 'line-opacity', 0);
    // Incident overlays
    setLayerOpacity('incident-zone-pulse', 'circle-opacity', 0);
    setLayerOpacity('incident-zone-pulse', 'circle-stroke-opacity', 0);
    setLayerOpacity('diversion-route-layer', 'line-opacity', 0);
    setLayerOpacity('sm-roadblock-glow', 'line-opacity', 0);
    setLayerOpacity('sm-roadblock-base', 'line-opacity', 0);
    setLayerOpacity('sm-roadblock-layer', 'line-opacity', 0);
    // Workzone overlays
    setLayerOpacity('kyle-workzone-glow', 'line-opacity', 0);
    setLayerOpacity('kyle-workzone-base', 'line-opacity', 0);
    setLayerOpacity('kyle-workzone-layer', 'line-opacity', 0);
}

// Manual cascade phase advancement
function advanceCascadePhase() {
    if (activeScenario !== 'cascade') return;
    
    if (cascadePhase === 1) {
        // Advance to Phase 2: Secondary collision at Kyle
        cascadePhase = 2;
        currentSpeed = 18;
        currentVolume = 1600;
        currentRisk = "Critical (92%)";
        
        const smDot = document.getElementById('marker-dot-sm');
        if (smDot) smDot.className = 'marker-dot red';
        
        const incidentAlertPanel = document.getElementById('incident-alert-panel');
        if (incidentAlertPanel) incidentAlertPanel.style.display = 'flex';
        
        if (map) {
            setLayerOpacity('incident-zone-pulse', 'circle-opacity', 0.45);
            setLayerOpacity('incident-zone-pulse', 'circle-stroke-opacity', 1);
        }
        
        pushLog("ALERT", "CASCADE PHASE 2: Secondary collision at Kyle (Exit 213) due to wet road conditions.");
        pushLog("SUCCESS", "Emergency response deployed. Frontage road detour routing engaged.");
        
        triggerCCTVIncident();
        updateRouteGradient('incident');
        updateLayerVisibility();
        updateTelemetryDisplay();
        updateScenarioTimeline('cascade');
        updateScenarioCaption('cascade');
        
        if (map) {
            map.flyTo({ center: [-97.8597, 29.9869], zoom: 13.5, pitch: 58, bearing: -30, duration: 2500 });
        }
        
        showNextPhaseButton();
        
    } else if (cascadePhase === 2) {
        // Advance to Phase 3: Emergency work zone
        cascadePhase = 3;
        currentSpeed = 8;
        currentVolume = 1200;
        activeZonesCount = 2;
        currentRisk = "Extreme (97%)";
        
        pushLog("ALERT", "CASCADE PHASE 3: Emergency work zone established. Full corridor reroute activated.");
        pushLog("SUCCESS", "All 5 municipalities notified. Signal timing plans adjusted corridor-wide.");
        
        updateRouteGradient('cascade');
        updateLayerVisibility();
        updateTelemetryDisplay();
        updateScenarioTimeline('cascade');
        updateScenarioCaption('cascade');
        updateStatusBar('cascade');
        
        if (map) {
            map.flyTo({ center: [-98.02, 29.84], zoom: 10.5, pitch: 50, bearing: -15, duration: 3000 });
        }
        
        hideNextPhaseButton();
    }
}

// Show/hide the manual "Next Phase" button
function showNextPhaseButton() {
    const btn = document.getElementById('next-phase-btn');
    if (btn) {
        btn.style.display = 'inline-flex';
        if (cascadePhase === 1) {
            btn.textContent = '▶ Phase 2: Collision';
        } else if (cascadePhase === 2) {
            btn.textContent = '▶ Phase 3: Work Zone';
        }
    }
}

function hideNextPhaseButton() {
    const btn = document.getElementById('next-phase-btn');
    if (btn) btn.style.display = 'none';
}

// Manual camera fly-to for any scenario
function flyToScenarioView(scenario) {
    if (!map) return;
    stopCameraOrbit();
    
    const views = {
        default: { center: [-97.94, 29.95], zoom: 10.8, pitch: 45, bearing: -15 },
        flood:   { center: [-97.8436, 30.0841], zoom: 13.8, pitch: 60, bearing: 210 },
        incident:{ center: [-97.8597, 29.9869], zoom: 13.5, pitch: 52, bearing: 15 },
        workzone:{ center: [-97.8597, 29.9869], zoom: 13.5, pitch: 52, bearing: 15 },
        cascade: { center: [-97.8436, 30.0841], zoom: 13.0, pitch: 60, bearing: 210 }
    };
    
    const view = views[scenario] || views.default;
    map.flyTo({ ...view, duration: 2000, essential: true });
}

function triggerScenario(scenario) {
    activeScenario = scenario;
    customStreetViewCoords = null; // Clear manual clicked coordinates to restore scenario defaults!
    
    // Clear any active cascade phase timers
    cascadeTimers.forEach(t => clearTimeout(t));
    cascadeTimers = [];
    cascadePhase = 0;
    
    // Update Active Segment Description
    const mapStatusDesc = document.getElementById('map-status-desc');
    if (mapStatusDesc) {
        if (scenario === 'default') {
            mapStatusDesc.innerText = "Active Segment: Buda (Exit 220) to Selma (Exit 174)";
        } else if (scenario === 'flood') {
            mapStatusDesc.innerText = "Active Segment: Buda (Exit 220)";
        } else if (scenario === 'incident') {
            mapStatusDesc.innerText = "Active Segment: San Marcos (Exit 205)";
        } else if (scenario === 'workzone') {
            mapStatusDesc.innerText = "Active Segment: Kyle (Exit 213)";
        } else if (scenario === 'cascade') {
            mapStatusDesc.innerText = "Active Segment: Full Corridor — Multi-Hazard Cascade";
        }
    }

    // Update Floating Map Legend
    updateMapLegend(scenario);
    
    // Stop any active camera cinematic orbit
    stopCameraOrbit();
    
    // Update button highlights
    const buttons = document.querySelectorAll('.scenario-btn');
    buttons.forEach(btn => btn.classList.remove('active-scenario'));
    
    const activeBtn = document.getElementById(`scenario-${scenario}`);
    if (activeBtn) activeBtn.classList.add('active-scenario');
    
    // Get overlay banners
    const floodAlertPanel = document.getElementById('flood-alert-panel');
    const incidentAlertPanel = document.getElementById('incident-alert-panel');
    
    floodAlertPanel.style.display = 'none';
    incidentAlertPanel.style.display = 'none';
    showRainEffect = false; // Reset rain particle canvas overlay
    hideNextPhaseButton();
    
    // Reset city status marker colors to green
    document.querySelectorAll('.marker-dot').forEach(dot => {
        dot.className = 'marker-dot green';
    });

    // Update dynamic 3D operations HUD widget
    updateHUDMarkers(scenario);

    // Reset particles on scenario trigger to re-align flow
    initTrafficParticles();

    // Update the Sidebar Checklist
    updateResponseChecklist(scenario);

    // Update Map Route Color Gradient
    updateRouteGradient(scenario);

    if (scenario === 'default') {
        currentSpeed = 68;
        currentVolume = 3850;
        activeZonesCount = 0;
        currentRisk = "Very Low";
        
        pushLog("SUCCESS", "AIT Lab Broker diagnostic OK. Multi-jurisdictional Connected Corridor streams synced.");
        pushLog("INFO", "Google RMI Speed Engine: I-35 Selma-Buda corridor velocities averaging 68 mph.");
        
        // Reset CCTV vehicles
        initCCTVSimulation();
        
        if (map) {
            // Restore basemap sunset atmosphere config
            map.setConfigProperty('basemap', 'lightPreset', 'dusk');
            
            // Explicitly hide ALL overlay layers
            hideAllOverlayLayers();
            updateLayerVisibility();

            // Fly Mapbox back to full overview of corridor
            map.flyTo({
                center: [-98.02, 29.84],
                zoom: 10.1,
                pitch: 55,
                bearing: -15,
                duration: 2000
            });
        }
        
    } else if (scenario === 'flood') {
        currentSpeed = 44;
        currentVolume = 2950;
        activeZonesCount = 0;
        currentRisk = "High (84%)";
        
        floodAlertPanel.style.display = 'flex';
        showRainEffect = true; // Trigger full-map rain particle animation!
        
        // Update Buda/Kyle marker dots to warning yellow
        const bDot = document.getElementById('marker-dot-buda');
        const kDot = document.getElementById('marker-dot-kyle');
        if (bDot) bDot.className = 'marker-dot yellow';
        if (kDot) kDot.className = 'marker-dot yellow';
        
        if (map) {
            // Dark night/storm configuration
            map.setConfigProperty('basemap', 'lightPreset', 'night');
            
            // First hide all overlays, then show flood-specific ones
            hideAllOverlayLayers();
            updateLayerVisibility();
            
            // Activate flood-specific layers
            setLayerOpacity('flood-zone-layer', 'fill-opacity', 0.40);
            setLayerOpacity('flood-block-layer', 'line-opacity', 0.85);
            setLayerOpacity('buda-detour-layer', 'line-opacity', 0.95);
        }

        pushLog("ALERT", "METEOROLOGICAL WARNING: Dense localized flash precipitation near Buda (Exit 220).");
        pushLog("INFO", "Predictive safety model calculates high friction-loss crash probability (84%) near Buda.");
        pushLog("SUCCESS", "AUTOMATED RESPONSES: Speed warnings (45 mph) pushed to local variable message signs & Google Maps API.");
        
        // Spawn rain in CCTV canvas
        spawnRain();
        
        // Fly Map to Buda flood zone
        if (map) {
            map.flyTo({
                center: [-97.8436, 30.0841],
                zoom: 13.8,
                pitch: 60,
                bearing: 210, 
                duration: 2200,
                essential: true
            });
        }
        
    } else if (scenario === 'incident') {
        currentSpeed = 12;
        currentVolume = 1800;
        activeZonesCount = 0;
        currentRisk = "Critical (94%)";
        
        incidentAlertPanel.style.display = 'flex';
        
        // Set San Marcos marker to red
        const smDot = document.getElementById('marker-dot-sm');
        if (smDot) smDot.className = 'marker-dot red';
        
        if (map) {
            // Dark night/emergency configuration
            map.setConfigProperty('basemap', 'lightPreset', 'night');
            
            // First hide all overlays, then show incident-specific ones
            hideAllOverlayLayers();
            updateLayerVisibility();
            
            // Activate incident-specific layers
            setLayerOpacity('incident-zone-pulse', 'circle-opacity', 0.45);
            setLayerOpacity('incident-zone-pulse', 'circle-stroke-opacity', 1);
            setLayerOpacity('diversion-route-layer', 'line-opacity', 0.95);
            setLayerOpacity('sm-roadblock-glow', 'line-opacity', 0.55);
            setLayerOpacity('sm-roadblock-base', 'line-opacity', 0.85);
            setLayerOpacity('sm-roadblock-layer', 'line-opacity', 1.0);
        }

        pushLog("ALERT", "INCIDENT REPORTED: Multi-vehicle collision on I-35 SB at Exit 205 (San Marcos).");
        pushLog("SUCCESS", "COORDINATION PROTOCOL: Google Maps Immersive Route Navigation diversion pushed to vehicles.");
        pushLog("SUCCESS", "SIGNAL ADJUSTMENT: Project Green Light plan active. City of San Marcos adapts frontage road signals (capacity +18%).");
        pushLog("ALERT", "Queue hazard detected. Edge CCTV analytics active for secondary crash near-miss warning.");
        
        // Trigger slow-down / backup in CCTV
        triggerCCTVIncident();
        
        // CINEMATIC 3D FLY-THROUGH CAMERA SWOOP (Dramatic camera dip and rotation following I-35 orientation)
        if (map) {
            // First fly to overhead approach
            map.flyTo({
                center: [-97.8800, 29.9500],
                zoom: 12.0,
                pitch: 50,
                bearing: -10,
                duration: 1200
            });
            
            // Then sweep down into Exit 205 (tilt to 62 degrees and rotate to align with I-35 heading)
            setTimeout(() => {
                if (activeScenario !== 'incident') return; // Cancel if user switched scenario
                map.flyTo({
                    center: [-97.9414, 29.8833],
                    zoom: 14.8,
                    pitch: 62, 
                    bearing: -55,
                    duration: 2500,
                    essential: true
                });
            }, 1200);
        }
        
    } else if (scenario === 'workzone') {
        currentSpeed = 54;
        currentVolume = 3200;
        activeZonesCount = 1;
        currentRisk = "Moderate (18%)";
        
        // Set Kyle marker to warning yellow
        const kDot = document.getElementById('marker-dot-kyle');
        if (kDot) kDot.className = 'marker-dot yellow';
        
        if (map) {
            // Early morning dawn configuration
            map.setConfigProperty('basemap', 'lightPreset', 'dawn');
            
            // First hide all overlays, then show workzone-specific ones
            hideAllOverlayLayers();
            updateLayerVisibility();
            
            // Activate workzone-specific layers
            setLayerOpacity('kyle-workzone-glow', 'line-opacity', 0.55);
            setLayerOpacity('kyle-workzone-base', 'line-opacity', 0.85);
            setLayerOpacity('kyle-workzone-layer', 'line-opacity', 1.0);
        }

        pushLog("INFO", "CONSTRUCTION DETECTED: Active lane closure SB near Kyle (Exit 213).");
        
        // Stream WZDx JSON packet
        const wzdxPacket = {
            feed_info: { publisher: "TxDOT Austin District", version: "4.0" },
            road_event_feed: [
                {
                    id: "WZ-I35SB-KYLE-1092",
                    type: "WorkZone",
                    geometry: { type: "LineString", coordinates: [[-97.86, 29.98], [-97.87, 29.97]] },
                    properties: {
                        road_name: "I-35 Southbound",
                        start_date: "2026-05-27T22:00:00Z",
                        end_date: "2026-05-28T05:00:00Z",
                        lanes_closed: [3],
                        total_lanes: 4,
                        restrictions: { speed_limit: 55 }
                    }
                }
            ]
        };
        
        pushLog("WZDX", `WZDx PUBLISH: ${JSON.stringify(wzdxPacket)}`);
        pushLog("SUCCESS", "WZDx lane closure parsed & broadcasted to Google Maps & CapMetro transit.");
        
        // Trigger laneshift in CCTV
        triggerCCTVWorkzone();
        
        // Fly Map to Kyle work zone
        if (map) {
            map.flyTo({
                center: [-97.8597, 29.9869],
                zoom: 13.5,
                pitch: 52,
                bearing: 15,
                duration: 2000
            });
        }
    } else if (scenario === 'cascade') {
        // MULTI-HAZARD CASCADE — Phase 1 starts immediately
        cascadePhase = 1;
        currentSpeed = 44;
        currentVolume = 2950;
        activeZonesCount = 0;
        currentRisk = "High (84%)";
        
        const floodAlertPanel = document.getElementById('flood-alert-panel');
        floodAlertPanel.style.display = 'flex';
        showRainEffect = true;
        
        const bDot = document.getElementById('marker-dot-buda');
        const kDot = document.getElementById('marker-dot-kyle');
        if (bDot) bDot.className = 'marker-dot yellow';
        if (kDot) kDot.className = 'marker-dot yellow';
        
        if (map) {
            map.setConfigProperty('basemap', 'lightPreset', 'night');
            if (map.getLayer('flood-zone-layer')) map.setPaintProperty('flood-zone-layer', 'fill-opacity', 0.40);
        }
        
        pushLog("ALERT", "CASCADE PHASE 1: Flash flood detected at Buda (Exit 220). Multi-hazard protocol initiated.");
        spawnRain();
        
        if (map) {
            map.flyTo({ center: [-97.8436, 30.0841], zoom: 13.0, pitch: 60, bearing: 210, duration: 2200 });
        }
        
        updateRouteGradient('flood');
        updateLayerVisibility();
        showNextPhaseButton();
        
        // Auto-advance after 10s if auto mode is on
        if (autoAdvanceCascade) {
            cascadeTimers.push(setTimeout(() => { if (activeScenario === 'cascade' && cascadePhase < 2) advanceCascadePhase(); }, 10000));
            cascadeTimers.push(setTimeout(() => { if (activeScenario === 'cascade' && cascadePhase < 3) advanceCascadePhase(); }, 20000));
        }
    }
    
    // Update telemetry display
    updateTelemetryDisplay();
    
    // Update YOLO Info and Twitter Popup
    updateYOLOEdgeInfo(scenario);
    updateTwitterPopup(scenario);
    
    // Update timeline, caption, and status bar
    updateScenarioTimeline(scenario);
    updateScenarioCaption(scenario);
    updateStatusBar(scenario);
    
    // Automatically update Google Street View Panorama position if active
    if (streetViewTabActive) {
        initOrUpdatePanorama();
    }
}

function updateTelemetryDisplay() {
    document.getElementById('tel-speed').innerText = `${currentSpeed} mph`;
    document.getElementById('tel-volume').innerText = `${currentVolume.toLocaleString()} veh/hr`;
    document.getElementById('tel-zones').innerText = `${activeZonesCount} zone${activeZonesCount !== 1 ? 's' : ''}`;
    document.getElementById('tel-risk').innerText = currentRisk;
    
    // Update trends
    const speedTrend = document.getElementById('tel-speed-trend');
    const volTrend = document.getElementById('tel-volume-trend');
    const zoneTrend = document.getElementById('tel-zones-status');
    const riskTrend = document.getElementById('tel-risk-trend');
    
    if (activeScenario === 'default') {
        speedTrend.className = "tel-trend pos";
        speedTrend.innerHTML = "&bull; Optimal";
        volTrend.className = "tel-trend pos";
        volTrend.innerHTML = "&bull; Stable";
        zoneTrend.className = "tel-trend";
        zoneTrend.innerHTML = "No closures";
        riskTrend.className = "tel-trend pos";
        riskTrend.innerHTML = "Normal";
    } else if (activeScenario === 'flood') {
        speedTrend.className = "tel-trend neg";
        speedTrend.innerHTML = "&darr; Weather slow-down";
        volTrend.className = "tel-trend warning";
        volTrend.innerHTML = "&darr; Drop in demand";
        zoneTrend.className = "tel-trend";
        zoneTrend.innerHTML = "Weather hazard active";
        riskTrend.className = "tel-trend neg";
        riskTrend.innerHTML = "High Risk";
    } else if (activeScenario === 'incident') {
        speedTrend.className = "tel-trend neg";
        speedTrend.innerHTML = "&darr; Bottleneck gridlock";
        volTrend.className = "tel-trend neg";
        volTrend.innerHTML = "&darr; Critical flow disruption";
        zoneTrend.className = "tel-trend";
        zoneTrend.innerHTML = "Incident response active";
        riskTrend.className = "tel-trend neg";
        riskTrend.innerHTML = "Critical";
    } else if (activeScenario === 'workzone') {
        speedTrend.className = "tel-trend warning";
        speedTrend.innerHTML = "&darr; Work zone limit (55mph)";
        volTrend.className = "tel-trend warning";
        volTrend.innerHTML = "&bull; Steady flow";
        zoneTrend.className = "tel-trend warning";
        zoneTrend.innerHTML = "SB right lane closed";
        riskTrend.className = "tel-trend warning";
        riskTrend.innerHTML = "Moderate";
    } else if (activeScenario === 'cascade') {
        speedTrend.className = "tel-trend neg";
        speedTrend.innerHTML = "&darr; Multi-hazard shutdown";
        volTrend.className = "tel-trend neg";
        volTrend.innerHTML = "&darr; Corridor-wide disruption";
        zoneTrend.className = "tel-trend neg";
        zoneTrend.innerHTML = cascadePhase >= 3 ? "2 emergency zones" : "Cascade escalating";
        riskTrend.className = "tel-trend neg";
        riskTrend.innerHTML = "Extreme";
    }

    // Update Risk Bar width and color dynamically
    const riskBar = document.getElementById('risk-bar');
    if (riskBar) {
        if (activeScenario === 'default') {
            riskBar.style.width = '5%';
            riskBar.style.backgroundColor = 'var(--status-green)';
            riskBar.style.boxShadow = '0 0 6px var(--status-green)';
        } else if (activeScenario === 'flood') {
            riskBar.style.width = '84%';
            riskBar.style.backgroundColor = 'var(--status-blue)';
            riskBar.style.boxShadow = '0 0 6px var(--status-blue)';
        } else if (activeScenario === 'incident') {
            riskBar.style.width = '94%';
            riskBar.style.backgroundColor = 'var(--status-red)';
            riskBar.style.boxShadow = '0 0 6px var(--status-red)';
        } else if (activeScenario === 'workzone') {
            riskBar.style.width = '18%';
            riskBar.style.backgroundColor = 'var(--status-orange)';
            riskBar.style.boxShadow = '0 0 6px var(--status-orange)';
        } else if (activeScenario === 'cascade') {
            riskBar.style.width = cascadePhase >= 3 ? '97%' : cascadePhase >= 2 ? '92%' : '84%';
            riskBar.style.backgroundColor = 'var(--status-red)';
            riskBar.style.boxShadow = '0 0 10px var(--status-red)';
        }
    }
}

function simulateTelemetryDrift() {
    if (map === null) return;
    
    // Add tiny random changes to speed and volume
    const speedChange = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
    const volChange = Math.floor(Math.random() * 40) - 20; // -20 to 20
    
    let baseSpeed = 68;
    let baseVol = 3850;
    
    if (activeScenario === 'flood') {
        baseSpeed = 44;
        baseVol = 2950;
    } else if (activeScenario === 'incident') {
        baseSpeed = 12;
        baseVol = 1800;
    } else if (activeScenario === 'workzone') {
        baseSpeed = 54;
        baseVol = 3200;
    } else if (activeScenario === 'cascade') {
        if (cascadePhase >= 3) { baseSpeed = 8; baseVol = 1200; }
        else if (cascadePhase >= 2) { baseSpeed = 18; baseVol = 1600; }
        else { baseSpeed = 44; baseVol = 2950; }
    }
    
    currentSpeed = Math.max(5, Math.min(80, baseSpeed + speedChange));
    currentVolume = Math.max(500, baseVol + volChange);
    
    document.getElementById('tel-speed').innerText = `${currentSpeed} mph`;
    document.getElementById('tel-volume').innerText = `${currentVolume.toLocaleString()} veh/hr`;
}

// -------------------------------------------------------------
// EDGE CAMERA VS GOOGLE PANORAMA TAB SWITCHER
// -------------------------------------------------------------
function switchFeedTab(tabName) {
    const tabEdge = document.getElementById('tab-edge');
    const tabGoogle = document.getElementById('tab-google');
    
    const canvasFeed = document.getElementById('canvas-video-feed');
    const googleFeed = document.getElementById('google-street-view');
    const hudOverlay = document.getElementById('hud-overlay-text');
    const alarmEl = document.getElementById('hud-near-miss-alarm');
    
    // Remove active classes
    tabEdge.classList.remove('active');
    tabGoogle.classList.remove('active');
    
    // Hide all feeds
    canvasFeed.style.display = 'none';
    googleFeed.style.display = 'none';
    hudOverlay.style.display = 'none';
    if (alarmEl) alarmEl.style.display = 'none';
    
    streetViewTabActive = false;
    
    if (tabName === 'edge') {
        tabEdge.classList.add('active');
        canvasFeed.style.display = 'block';
        hudOverlay.style.display = 'flex';
        
    } else if (tabName === 'google') {
        tabGoogle.classList.add('active');
        googleFeed.style.display = 'block';
        streetViewTabActive = true;
        
        // Query and snap Street View
        setTimeout(() => {
            initOrUpdatePanorama();
        }, 50);
    }
    
    // Update title and meta description dynamically
    updateYOLOEdgeInfo(activeScenario);
}

function updateYOLOEdgeInfo(scenario) {
    const titleEl = document.getElementById('panel-feed-title');
    const metaEl = document.getElementById('camera-feed-meta');
    const labelEl = document.getElementById('hud-camera-label');
    
    if (!titleEl || !metaEl || !labelEl) return;
    
    const isGoogle = document.getElementById('tab-google').classList.contains('active');
    
    let title, desc, label;
    
    if (scenario === 'default') {
        title = "Edge Node: Corridor Overview";
        desc = "<span>YOLO26 Edge Node Network: Real-time traffic flow monitoring and conflict analytics across I-35 corridor.</span>";
        label = "ITS-CORRIDOR-OVERVIEW";
    } else if (scenario === 'flood') {
        title = "Edge Node: Buda (CAM-I35-Buda)";
        desc = "<span>YOLO26 Edge Node: Monitoring Buda underpass pooling levels and vehicle splash-deceleration patterns.</span>";
        label = "CAM-I35-BUDA";
    } else if (scenario === 'incident') {
        title = "Edge Node: San Marcos (CAM-I35-SM205)";
        desc = "<span>YOLO26 Edge Node: Tracking secondary collision risk, vehicle-to-vehicle gaps, and pedestrian near-misses.</span>";
        label = "CAM-I35-SM205";
    } else if (scenario === 'workzone') {
        title = "Edge Node: Kyle (CAM-I35-Kyle)";
        desc = "<span>YOLO26 Edge Node: Analyzing lane-merging compliance, speed limits, and construction barrier safety zones.</span>";
        label = "CAM-I35-KYLE";
    } else if (scenario === 'cascade') {
        title = "Edge Node: Corridor-Wide (MULTI-HAZARD)";
        desc = "<span>YOLO26 Edge Node: Multi-hazard cascade mode — monitoring flood, collision, and work zone events simultaneously.</span>";
        label = "CASCADE-MULTI-HAZ";
    }
    
    // Update UI elements depending on active feed tab
    if (isGoogle) {
        titleEl.innerText = "Google Immersive Street View";
        metaEl.innerHTML = "<span>Live Google Maps Street View Panorama linked to active incident corridor coordinates.</span>";
    } else {
        titleEl.innerText = title;
        metaEl.innerHTML = desc;
    }
    
    labelEl.innerText = label;
}

function updateTwitterPopup(scenario) {
    const popupEl = document.getElementById('twitter-alert-popup');
    const textEl = document.getElementById('tweet-text');
    if (!popupEl || !textEl) return;
    
    if (scenario === 'default') {
        popupEl.style.display = 'none';
        return;
    }
    
    let text;
    if (scenario === 'flood') {
        text = "🚨 FLOOD WARNING: I-35 Frontage Road at Buda Underpass (Exit 220) closed due to high water levels. Detours active. Please bypass via FM 967 frontage. Drive with caution! #BudaTraffic #TxDOT";
    } else if (scenario === 'incident') {
        text = "💥 CRASH ALERT: Multi-vehicle collision blocking I-35 SB mainlanes at Exit 205 (San Marcos). Detour frontage routing engaged. Signal timing plans active. Expect heavy delays! #SMTraffic #I35SB";
    } else if (scenario === 'workzone') {
        text = "🚧 WORK ZONE: Construction crew lane closures on I-35 SB near Kyle Exit 213. Right lane closed. Speed limit reduced to 55 mph. Slow down for workers. #KyleConstruction #TxDOT";
    } else if (scenario === 'cascade') {
        text = "🚨🌊💥 MULTI-HAZARD ALERT: Flash flood + secondary collision + emergency work zone across I-35 Buda-Kyle-San Marcos corridor. ALL mainlanes impacted. Seek alternate routes. Full reroute active. #I35Emergency #TxDOT";
    }
    
    textEl.innerText = text;
    popupEl.style.display = 'block';
}

function initOrUpdatePanorama() {
    if (!streetViewTabActive) return;
    
    let lat, lng;
    let heading = 180;
    let pitch = -5;
    
    // Snaps dynamically to where user clicked on map if active!
    if (customStreetViewCoords) {
        lat = customStreetViewCoords.lat;
        lng = customStreetViewCoords.lng;
    } else {
        // Choose coordinate based on active scenario (Exit spots with Street View coverage on I-35)
        lat = 29.8825;
        lng = -97.9405; // San Marcos Exit 205
        heading = 180;
        pitch = -10;
        
        if (activeScenario === 'flood') {
            lat = 30.0844;
            lng = -97.8423; // Buda Exit 220
            heading = 210;
            pitch = -5;
        } else if (activeScenario === 'workzone') {
            lat = 29.9855;
            lng = -97.8615; // Kyle Exit 213
            heading = 45;
            pitch = 0;
        } else if (activeScenario === 'default') {
            lat = 29.5885;
            lng = -98.3015; // Selma Exit 174
            heading = 220;
            pitch = -5;
        } else if (activeScenario === 'cascade') {
            // Show Buda during phase 1, Kyle during 2/3
            if (cascadePhase >= 2) {
                lat = 29.9855;
                lng = -97.8615;
                heading = 180;
                pitch = -5;
            } else {
                lat = 30.0844;
                lng = -97.8423;
                heading = 210;
                pitch = -5;
            }
        }
    }
    
    const container = document.getElementById('google-street-view');
    
    try {
        // Use Google's StreetViewService to snap to the closest actual Street View photo on the road!
        const svService = new google.maps.StreetViewService();
        svService.getPanorama({
            location: { lat: lat, lng: lng },
            radius: 150, // Search within 150 meters
            sources: [google.maps.StreetViewSource.OUTDOOR]
        }, (data, status) => {
            if (status === google.maps.StreetViewStatus.OK) {
                const snappedPosition = data.location.latLng;
                if (!panorama) {
                    panorama = new google.maps.StreetViewPanorama(
                        container,
                        {
                            position: snappedPosition,
                            pov: { heading: heading, pitch: pitch },
                            zoom: 0.8,
                            addressControl: false,
                            linksControl: false,
                            panControl: false,
                            enableCloseButton: false
                        }
                    );
                } else {
                    panorama.setPosition(snappedPosition);
                    panorama.setPov({ heading: heading, pitch: pitch });
                }
                
                // Force resize event trigger to ensure Street View rendering doesn't get cut
                setTimeout(() => {
                    google.maps.event.trigger(panorama, 'resize');
                }, 100);
            } else {
                console.warn("StreetViewService did not find a snapped photo near", lat, lng, "falling back.");
                if (!panorama) {
                    panorama = new google.maps.StreetViewPanorama(
                        container,
                        {
                            position: { lat: lat, lng: lng },
                            pov: { heading: heading, pitch: pitch },
                            zoom: 0.8,
                            addressControl: false,
                            linksControl: false,
                            panControl: false,
                            enableCloseButton: false
                        }
                    );
                } else {
                    panorama.setPosition({ lat: lat, lng: lng });
                    panorama.setPov({ heading: heading, pitch: pitch });
                }
            }
        });
    } catch (e) {
        console.error("Google Street View initialization failed", e);
        pushLog("ALERT", "Google Maps Street View Panorama API Error: check billing or key parameters.");
    }
}

// -------------------------------------------------------------
// CLOUD DATA BROKER LOG STREAM
// -------------------------------------------------------------
function initLogStream() {
    const stream = document.getElementById('log-stream');
    stream.innerHTML = '';
    
    pushLog("SUCCESS", "AIT Lab CoCorridor-AI broker successfully initialized.");
    pushLog("INFO", "Establishing secure WebSockets links to municipal NTCIP nodes...");
    pushLog("SUCCESS", "Connected: City of Buda Signal Center (NTCIP 1202)");
    pushLog("SUCCESS", "Connected: City of Kyle Operations (NTCIP 1202)");
    pushLog("SUCCESS", "Connected: City of San Marcos Traffic (NTCIP 1202)");
    pushLog("SUCCESS", "Connected: City of Selma Systems (NTCIP 1202)");
    pushLog("INFO", "Google Mobility AI Road Insights API listener verified. Stream active.");
    pushLog("SUCCESS", "Edge Camera YOLO26 NMS-Free inference engine initialized. Processing feeds.");
}

function pushLog(type, message) {
    const stream = document.getElementById('log-stream');
    if (!stream) return;
    const entry = document.createElement('div');
    
    let typeClass = 'log-info';
    if (type === 'SUCCESS') typeClass = 'log-success';
    if (type === 'ALERT') typeClass = 'log-alert';
    if (type === 'WZDX') typeClass = 'log-wzdx';
    
    entry.className = `log-entry ${typeClass}`;
    
    const timestamp = getFormattedTime();
    entry.innerHTML = `<span class="log-time">[${timestamp}]</span> <span class="log-msg">${escapeHtml(message)}</span>`;
    
    stream.appendChild(entry);
    adjustLogScroll();
}

function adjustLogScroll() {
    const stream = document.getElementById('log-stream');
    if (stream) {
        stream.scrollTop = stream.scrollHeight;
    }
}

function generatePeriodicLogs() {
    if (map === null) return;
    
    if (activeScenario === 'default') {
        const rand = Math.random();
        if (rand < 0.3) {
            pushLog("INFO", `Google RMI updates: travel time Selma to Buda remains constant (24 mins).`);
        } else if (rand < 0.6) {
            pushLog("INFO", `YOLO26 Node CAM-I35-SM205 reports 0 active pedestrian conflicts.`);
        } else {
            pushLog("SUCCESS", `NTCIP Signal Sync verifies green wave pattern active on San Marcos frontage roads.`);
        }
    } else if (activeScenario === 'flood') {
        const rand = Math.random();
        if (rand < 0.5) {
            pushLog("INFO", `Speed sensors at Kyle/Buda segment recording speed drops of up to 35%. Dynamic route recommendations active.`);
        } else {
            pushLog("WZDX", `WZDx Publish: Event WZ-I35SB-FL220 speed restriction remains in effect.`);
        }
    } else if (activeScenario === 'incident') {
        const rand = Math.random();
        if (rand < 0.5) {
            pushLog("ALERT", `Incident Queue Warning: Mainlane backups now extend 2.1 miles. Dynamic speed warning activated.`);
        } else {
            pushLog("INFO", `Project Green Light optimization cycle: signal green time on Loop 82 arterial increased by 15s.`);
        }
    } else if (activeScenario === 'workzone') {
        const rand = Math.random();
        if (rand < 0.5) {
            pushLog("WZDX", `WZDx active stream: lane closure verification check positive. Lane 3 closed at mile marker 213.`);
        } else {
            pushLog("INFO", `Frontage signal coordination at Kyle updated to accommodate merging lane 3 vehicles.`);
        }
    } else if (activeScenario === 'cascade') {
        const rand = Math.random();
        if (cascadePhase >= 3 && rand < 0.33) {
            pushLog("ALERT", `CASCADE: All 5 municipal signal systems operating under emergency timing plan. Recovery estimated 45+ mins.`);
        } else if (cascadePhase >= 2 && rand < 0.66) {
            pushLog("ALERT", `CASCADE: Secondary collision queue extending to Buda (Exit 220). Full corridor gridlock imminent.`);
        } else {
            pushLog("INFO", `CASCADE: Multi-agency coordination active. TxDOT, CTRMA, and 5 municipalities sharing real-time feeds.`);
        }
    }
}

function updateSystemTime() {
    const now = new Date();
    const timeEl = document.getElementById('hud-time');
    if (timeEl) timeEl.innerText = now.toTimeString().split(' ')[0];
}

function getFormattedTime() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// -------------------------------------------------------------
// CCTV LIVE ANOMALY SIMULATION (HTML5 CANVAS) - ADVANCED PHYSICS
// -------------------------------------------------------------
function initCCTVSimulation() {
    vehicles = [];
    pedestrians = [];
    rainDrops = [];
    nearMissCount = 0;
    
    const nearMissEl = document.getElementById('near-miss-cnt');
    if (nearMissEl) nearMissEl.innerText = "0";
    const alarmEl = document.getElementById('hud-near-miss-alarm');
    if (alarmEl) alarmEl.style.display = "none";
    
    // Spawn initial vehicles
    const laneX = [110, 160, 210, 300];
    
    for (let i = 0; i < 6; i++) {
        const lane = i % 4;
        const bSpeed = 1.2 + Math.random() * 0.8;
        vehicles.push({
            x: laneX[lane],
            y: Math.random() * 200,
            speed: bSpeed,
            baseSpeed: bSpeed,
            width: 24,
            height: 40,
            color: '#00e676',
            lane: lane,
            isEmergency: false,
            isIncident: false,
            blinkTimer: 0,
            blinkOn: false,
            merging: false,
            targetX: laneX[lane]
        });
    }
    
    pedestrians.push({
        x: 60,
        y: 120,
        targetX: 260,
        speed: 0.6,
        radius: 4,
        color: '#ffd700',
        active: false
    });
}

function spawnRain() {
    rainDrops = [];
    for (let i = 0; i < 40; i++) {
        rainDrops.push({
            x: Math.random() * 360,
            y: Math.random() * 200,
            length: 8 + Math.random() * 10,
            speed: 5 + Math.random() * 5
        });
    }
}

function triggerCCTVIncident() {
    vehicles = [];
    
    // Incident vehicles (stopped in lane 1)
    vehicles.push({ x: 160, y: 115, speed: 0, baseSpeed: 0, width: 24, height: 40, color: '#ff1744', lane: 1, isIncident: true, targetX: 160 });
    vehicles.push({ x: 160, y: 85, speed: 0, baseSpeed: 0, width: 24, height: 35, color: '#ff1744', lane: 1, isIncident: true, targetX: 160 });

    // Queue of cars behind incident (moving very slowly or stopping)
    vehicles.push({ x: 160, y: 25, speed: 0.1, baseSpeed: 1.5, width: 24, height: 40, color: '#ff9100', lane: 1, targetX: 160 });
    vehicles.push({ x: 210, y: 70, speed: 0.2, baseSpeed: 1.6, width: 24, height: 40, color: '#ff9100', lane: 2, targetX: 210 });
    vehicles.push({ x: 210, y: 20, speed: 0.1, baseSpeed: 1.4, width: 24, height: 40, color: '#ff9100', lane: 2, targetX: 210 });
    
    // Active traffic in open lane 0
    vehicles.push({ x: 110, y: 150, speed: 2.2, baseSpeed: 2.2, width: 24, height: 40, color: '#00e676', lane: 0, targetX: 110 });
    vehicles.push({ x: 110, y: 10, speed: 1.8, baseSpeed: 1.8, width: 24, height: 40, color: '#00e676', lane: 0, targetX: 110 });
    
    // Emergency response vehicle moving up on frontage road (lane 3)
    vehicles.push({
        x: 300,
        y: 190,
        speed: -2.5,
        baseSpeed: -2.5,
        width: 24,
        height: 40,
        color: '#ff1744',
        lane: 3,
        isEmergency: true,
        flash: true,
        targetX: 300
    });
    
    // Activate pedestrian near crosswalk to trigger alarm
    pedestrians = [{
        x: 230,
        y: 120,
        targetX: 60,
        speed: -0.5,
        radius: 4,
        color: '#ff1744',
        active: true
    }];
}

function triggerCCTVWorkzone() {
    initCCTVSimulation();
    // Kyle lane 2 (x=210) is closed! Merge vehicles into lane 1 (x=160)
    vehicles.forEach(v => {
        v.baseSpeed = v.baseSpeed * 0.6; // slow down base speed
        v.speed = v.baseSpeed;
        if (v.lane === 2) {
            v.targetX = 160; // merge from closed lane 2 to lane 1
            v.merging = true;
        }
    });
}

function updateVehicleSpeeds() {
    vehicles.forEach(v => {
        if (v.isIncident) {
            v.speed = 0;
            return;
        }
        
        let lead = null;
        let minGap = 999;
        
        // Find lead vehicle in the same lane (traveling in same direction)
        vehicles.forEach(other => {
            if (other === v) return;
            if (other.lane === v.lane) {
                if (v.speed >= 0 && other.y > v.y) {
                    // SB travel direction
                    const gap = other.y - v.y;
                    if (gap < minGap) {
                        minGap = gap;
                        lead = other;
                    }
                } else if (v.speed < 0 && other.y < v.y) {
                    // NB travel direction
                    const gap = v.y - other.y;
                    if (gap < minGap) {
                        minGap = gap;
                        lead = other;
                    }
                }
            }
        });
        
        let targetSpeed = v.baseSpeed;
        
        // 1. Follow lead vehicle (microscopic car-following gap checking)
        if (lead) {
            const actualGap = minGap - (v.height/2 + lead.height/2);
            if (actualGap < 18) {
                targetSpeed = 0; // stop to avoid collision!
            } else if (actualGap < 60) {
                // Smooth deceleration matching the lead's velocity
                targetSpeed = Math.min(v.baseSpeed, lead.speed * (actualGap / 60));
            }
        }
        
        // 2. Slow down for pedestrians at crosswalk
        pedestrians.forEach(p => {
            if (!p.active) return;
            // Crosswalk is at y=120, SB vehicles approach from top (y < 120)
            if (v.speed >= 0 && v.y < 120 && v.y > 60) {
                // If pedestrian is crossing and close to this vehicle's lane
                if (Math.abs(p.x - v.x) < 35) {
                    const distToCrosswalk = 120 - v.y;
                    if (distToCrosswalk < 25) {
                        targetSpeed = 0; // stop before hitting pedestrian!
                    } else {
                        targetSpeed = Math.min(targetSpeed, 0.6); // slow down approach
                    }
                }
            }
        });
        
        // Apply acceleration/deceleration smoothly
        v.speed = v.speed * 0.85 + targetSpeed * 0.15;
    });
}

function animateCCTV() {
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = '#11141e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    // Scale logically from 360x200 design size to physical canvas size
    ctx.scale(canvas.width / 360, canvas.height / 200);
    
    // Draw Road Background Layout
    drawRoadBackground();
    
    // Draw Weather Effects
    if (activeScenario === 'flood') {
        drawRain();
    }
    
    // Draw Construction Elements if Workzone
    if (activeScenario === 'workzone') {
        drawWorkzoneBarriers();
    }
    
    // Update and Draw Pedestrians
    drawPedestrians();
    
    // Update vehicle speeds using collision avoidance model
    updateVehicleSpeeds();
    
    // Update and Draw Vehicles
    drawVehicles();
    
    // Check and Draw Near-Miss Conflicts (YOLO26 simulation overlay)
    checkNearMisses();

    ctx.restore();
    animationId = requestAnimationFrame(animateCCTV);
}

function drawRoadBackground() {
    ctx.fillStyle = '#1b1e28';
    ctx.fillRect(80, 0, 160, 200); // SB Main lanes (3 lanes)
    ctx.fillRect(280, 0, 50, 200); // Frontage lane
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    
    // SB Lane lines
    ctx.setLineDash([10, 15]);
    ctx.beginPath();
    ctx.moveTo(135, 0); ctx.lineTo(135, 200);
    ctx.moveTo(185, 0); ctx.lineTo(185, 200);
    ctx.stroke();
    
    // Solid line separating highway from frontage
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(215, 189, 138, 0.3)'; // Gold divider
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(250, 0); ctx.lineTo(250, 200);
    ctx.stroke();
    
    // Crosswalk (at y=120)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(80, 120); ctx.lineTo(240, 120);
    ctx.moveTo(280, 120); ctx.lineTo(330, 120);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawRain() {
    ctx.strokeStyle = 'rgba(0, 198, 255, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    
    rainDrops.forEach(drop => {
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x - 2, drop.y + drop.length);
        ctx.stroke();
        
        drop.y += drop.speed;
        drop.x -= 1;
        if (drop.y > 200) {
            drop.y = -10;
            drop.x = Math.random() * 360;
        }
    });
}

function drawWorkzoneBarriers() {
    ctx.fillStyle = '#ff9100'; // Cones
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    
    for (let y = 60; y < 200; y += 30) {
        ctx.beginPath();
        ctx.moveTo(210, y);
        ctx.lineTo(205, y + 10);
        ctx.lineTo(215, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    
    ctx.fillStyle = '#d7bd8a';
    ctx.fillRect(215, 120, 8, 40);
    ctx.fillStyle = '#000000';
    ctx.fillRect(217, 122, 4, 36);
}

function drawPedestrians() {
    pedestrians.forEach(p => {
        if (!p.active) return;
        
        p.x += p.speed;
        if (p.speed > 0 && p.x > p.targetX) {
            p.speed = -p.speed;
        } else if (p.speed < 0 && p.x < p.targetX) {
            p.speed = -p.speed;
        }
        
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - 7, p.y - 12, 14, 24);
        
        ctx.fillStyle = p.color;
        ctx.font = '7px monospace';
        ctx.fillText("PED", p.x - 7, p.y - 14);
    });
}

function drawVehicles() {
    vehicles.forEach(v => {
        // Merging logic around stopped incident crash block in Scenario B
        if (activeScenario === 'incident' && v.lane === 1 && !v.isIncident && !v.isEmergency) {
            // Merge to Lane 0 (x=110) if approaching the crash (y between 10 and 65)
            if (v.y > 10 && v.y < 70 && !v.merging) {
                v.merging = true;
                v.targetX = 110;
            }
        }
        
        // Smoothly interpolate x coordinate towards targetX for active merges
        if (v.x !== v.targetX) {
            const dx = v.targetX - v.x;
            v.x += Math.sign(dx) * Math.min(Math.abs(dx), 1.5); // Steer towards target lane center
            if (Math.abs(v.x - v.targetX) < 1) {
                v.x = v.targetX;
                v.lane = v.targetX === 110 ? 0 : v.targetX === 160 ? 1 : v.targetX === 210 ? 2 : v.lane;
                v.merging = false;
            }
        }

        // Standard movement
        if (v.isEmergency) {
            v.y += v.speed;
            if (v.y < -40) v.y = 220;
        } else if (!v.isIncident) {
            v.y += v.speed;
            // Recycle vehicles when they drive off canvas
            if (v.y > 240) {
                v.y = -40;
                v.merging = false;
                if (activeScenario !== 'workzone') {
                    const laneX = [110, 160, 210, 300];
                    const randLane = Math.floor(Math.random() * 4);
                    v.x = laneX[randLane];
                    v.targetX = laneX[randLane];
                    v.lane = randLane;
                    // Reset speed and color to green
                    v.color = '#00e676';
                    v.baseSpeed = 1.2 + Math.random() * 0.8;
                    v.speed = v.baseSpeed;
                } else {
                    const laneX = [110, 160, 300]; // Closed lane 2 (210) bypassed
                    const randLane = Math.floor(Math.random() * 3);
                    v.x = laneX[randLane];
                    v.targetX = laneX[randLane];
                    v.lane = randLane === 2 ? 3 : randLane;
                    v.color = '#ff9100'; // Orange caution color
                    v.baseSpeed = 0.6 + Math.random() * 0.4; // slowed down
                    v.speed = v.baseSpeed;
                }
            }
        }
        
        ctx.fillStyle = v.color;
        ctx.fillRect(v.x - v.width/2, v.y - v.height/2, v.width, v.height);
        
        ctx.fillStyle = '#0a0c10';
        if (v.speed >= 0) {
            ctx.fillRect(v.x - v.width/2 + 3, v.y + v.height/2 - 12, v.width - 6, 6);
        } else {
            ctx.fillRect(v.x - v.width/2 + 3, v.y - v.height/2 + 6, v.width - 6, 6);
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(v.x - v.width/2 + 2, v.y + v.height/2 - 2, 4, 2);
        ctx.fillRect(v.x + v.width/2 - 6, v.y + v.height/2 - 2, 4, 2);
        
        ctx.fillStyle = '#ff1744';
        ctx.fillRect(v.x - v.width/2 + 2, v.y - v.height/2, 4, 2);
        ctx.fillRect(v.x + v.width/2 - 6, v.y - v.height/2, 4, 2);
        
        if (v.isEmergency) {
            v.flashState = !v.flashState;
            ctx.fillStyle = v.flashState ? '#00b0ff' : '#ff1744';
            ctx.fillRect(v.x - 4, v.y - 4, 8, 8);
        }

        // Draw left blinker if merging left
        if (v.merging && v.targetX < v.x) {
            v.blinkTimer = (v.blinkTimer + 1) % 20;
            if (v.blinkTimer < 10) {
                ctx.fillStyle = '#ff9100'; // Amber blinker
                ctx.beginPath();
                ctx.arc(v.x - v.width/2, v.y + v.height/2 - 2, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Draw YOLO26 vehicle bounding box
        ctx.strokeStyle = v.isEmergency || v.isIncident ? '#ff1744' : v.color === '#ff9100' ? '#ff9100' : '#00e676';
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x - v.width/2 - 2, v.y - v.height/2 - 2, v.width + 4, v.height + 4);
        
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = '7px monospace';
        ctx.fillText(v.isEmergency ? "EMERG" : v.isIncident ? "CRASH" : "VEH", v.x - v.width/2 - 2, v.y - v.height/2 - 5);
    });
}

function checkNearMisses() {
    const alarmEl = document.getElementById('hud-near-miss-alarm');
    let alarmActive = false;
    
    vehicles.forEach(v => {
        pedestrians.forEach(p => {
            if (!p.active) return;
            
            const dx = v.x - p.x;
            const dy = v.y - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 45) {
                ctx.strokeStyle = '#ff1744';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([2, 3]);
                ctx.beginPath();
                ctx.moveTo(v.x, v.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                ctx.setLineDash([]);
                
                ctx.fillStyle = 'rgba(255, 23, 68, 0.15)';
                ctx.beginPath();
                ctx.arc((v.x + p.x)/2, (v.y + p.y)/2, 20, 0, Math.PI * 2);
                ctx.fill();
                
                alarmActive = true;
            }
        });
    });
    
    if (alarmActive) {
        if (alarmEl) alarmEl.style.display = "block";
        
        if (Math.random() < 0.015) {
            nearMissCount++;
            const nearMissEl = document.getElementById('near-miss-cnt');
            if (nearMissEl) nearMissEl.innerText = nearMissCount;
            pushLog("ALERT", `YOLO26 NEAR-MISS DETECTION: Conflict score critical (8.8/10) at Exit 205 frontage. Overriding local signal timings.`);
        }
    } else {
        if (alarmEl) alarmEl.style.display = "none";
    }
}

function updateMapLegend(scenario) {
    const legendCard = document.getElementById('map-legend-card');
    if (!legendCard) return;
    
    let html = '';
    if (scenario === 'default') {
        html = `
            <h4>Normal Operations</h4>
            <div class="legend-card-list">
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-green"></span>
                    <span class="legend-row-desc">I-35 Mainlanes: Normal Flow (65+ mph)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-node-preview node-sensor"></span>
                    <span class="legend-row-desc">ITS Mainlane Sensor Node</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-node-preview node-camera"></span>
                    <span class="legend-row-desc">Frontage Camera Node (YOLO26)</span>
                </div>
            </div>
        `;
    } else if (scenario === 'flood') {
        html = `
            <h4>Scenario A: Buda Flash Flood</h4>
            <div class="legend-card-list">
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-blue"></span>
                    <span class="legend-row-desc">Buda Frontage Road: Flooded & Closed</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview dash-cyan"></span>
                    <span class="legend-row-desc">FM 967 Evacuation Detour Route</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-green"></span>
                    <span class="legend-row-desc">I-35 Mainlanes: Normal Flow (65+ mph)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-dot-preview status-yellow"></span>
                    <span class="legend-row-desc">Buda/Kyle City Status (Caution)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-node-preview node-sensor"></span>
                    <span class="legend-row-desc">ITS Mainlane Sensor Node</span>
                </div>
            </div>
        `;
    } else if (scenario === 'incident') {
        html = `
            <h4>Scenario B: I-35 Incident</h4>
            <div class="legend-card-list">
                <div class="legend-card-row">
                    <span class="legend-line-preview hazard-red-white"></span>
                    <span class="legend-row-desc">I-35 Mainlanes: Roadblock Closure</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-red"></span>
                    <span class="legend-row-desc">Incident Site Gridlock (0-10 mph)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-orange"></span>
                    <span class="legend-row-desc">Congested Queue Slowdown (20-45 mph)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview dash-gold"></span>
                    <span class="legend-row-desc">Frontage Road Detour (Marching Ants)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-dot-preview status-red"></span>
                    <span class="legend-row-desc">San Marcos City Status (Critical Alert)</span>
                </div>
            </div>
        `;
    } else if (scenario === 'workzone') {
        html = `
            <h4>Scenario C: Work Zone</h4>
            <div class="legend-card-list">
                <div class="legend-card-row">
                    <span class="legend-line-preview hazard-orange-black"></span>
                    <span class="legend-row-desc">I-35 SB Lane 3: Active Work Zone</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-orange"></span>
                    <span class="legend-row-desc">Construction Slowdown (40-50 mph)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-green"></span>
                    <span class="legend-row-desc">I-35 Normal Segments</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-dot-preview status-yellow"></span>
                    <span class="legend-row-desc">Kyle City Status (Caution)</span>
                </div>
            </div>
        `;
    } else if (scenario === 'cascade') {
        html = `
            <h4>Scenario D: Multi-Hazard Cascade</h4>
            <div class="legend-card-list">
                <div class="legend-card-row">
                    <span class="legend-line-preview glow-blue"></span>
                    <span class="legend-row-desc">Phase 1: Flash Flood Zone (Buda)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview hazard-red-white"></span>
                    <span class="legend-row-desc">Phase 2: Secondary Collision (Kyle)</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview hazard-orange-black"></span>
                    <span class="legend-row-desc">Phase 3: Emergency Work Zone</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-line-preview dash-gold"></span>
                    <span class="legend-row-desc">Full Corridor Detour Active</span>
                </div>
                <div class="legend-card-row">
                    <span class="legend-dot-preview status-red"></span>
                    <span class="legend-row-desc">Multi-City Alert Status</span>
                </div>
            </div>
        `;
    }
    legendCard.innerHTML = html;
}

// -------------------------------------------------------------
// SCENARIO EVENT TIMELINE
// -------------------------------------------------------------
function updateScenarioTimeline(scenario) {
    const container = document.getElementById('scenario-timeline');
    if (!container) return;
    
    const timelines = {
        default: [
            { label: 'Systems Online', dot: 'green' },
            { label: 'NTCIP Sync', dot: 'green' },
            { label: 'YOLO26 Active', dot: 'green' },
            { label: 'Google RMI Feed', dot: 'green' },
            { label: 'Normal Ops', dot: 'green', active: true }
        ],
        flood: [
            { label: 'Rain Detected', dot: 'blue' },
            { label: 'Flood Model 84%', dot: 'blue' },
            { label: 'VMS Speed Alert', dot: 'orange' },
            { label: 'FM 967 Detour', dot: 'blue' },
            { label: 'Google Maps Push', dot: 'green', active: true }
        ],
        incident: [
            { label: 'Crash Detected', dot: 'red' },
            { label: 'Queue Warning', dot: 'orange' },
            { label: 'Signal Retiming', dot: 'green' },
            { label: 'Detour Active', dot: 'gold' },
            { label: 'Recovery Mode', dot: 'green', active: true }
        ],
        workzone: [
            { label: 'WZDx Feed', dot: 'orange' },
            { label: 'Lane Closure', dot: 'orange' },
            { label: 'Speed Limit 55', dot: 'orange' },
            { label: 'In-Cab Alerts', dot: 'green' },
            { label: 'Monitoring', dot: 'green', active: true }
        ],
        cascade: (() => {
            const steps = [
                { label: 'Flash Flood', dot: 'blue', active: cascadePhase === 1 },
                { label: 'Wet Road Alert', dot: 'blue' },
                { label: 'Secondary Crash', dot: 'red', active: cascadePhase === 2 },
                { label: 'Work Zone Deploy', dot: 'orange', active: cascadePhase === 3 },
                { label: 'Full Reroute', dot: 'red', active: cascadePhase >= 3 }
            ];
            return steps;
        })()
    };
    
    const steps = timelines[scenario] || timelines.default;
    container.innerHTML = '';
    
    steps.forEach((step, i) => {
        const event = document.createElement('div');
        event.className = 'timeline-event';
        event.style.animationDelay = `${i * 0.15}s`;
        
        const node = document.createElement('div');
        node.className = `timeline-node${step.active ? ' active-step' : ''}`;
        node.innerHTML = `<span class="tl-dot ${step.dot}"></span><span class="tl-label">${step.label}</span>`;
        event.appendChild(node);
        
        if (i < steps.length - 1) {
            const connector = document.createElement('div');
            connector.className = 'timeline-connector';
            const fill = document.createElement('div');
            fill.className = 'connector-fill';
            fill.style.backgroundColor = step.dot === 'red' ? '#D32F2F' : step.dot === 'blue' ? '#2196F3' : step.dot === 'orange' ? '#FF9800' : '#4CAF50';
            fill.style.animationDelay = `${i * 0.15 + 0.2}s`;
            connector.appendChild(fill);
            event.appendChild(connector);
        }
        
        container.appendChild(event);
    });
}

// -------------------------------------------------------------
// ON-SCREEN SCENARIO CAPTION
// -------------------------------------------------------------
function updateScenarioCaption(scenario) {
    const captionEl = document.getElementById('scenario-caption');
    const iconEl = document.getElementById('caption-icon');
    const textEl = document.getElementById('caption-text');
    if (!captionEl || !iconEl || !textEl) return;
    
    const captions = {
        default: null, // No caption for normal ops
        flood: {
            icon: '🌊',
            text: '<strong>Scenario A: Flash Flood</strong> — Predictive Safety Model detects 84% crash risk at Buda underpass. Automated speed warnings and FM 967 detour activated.'
        },
        incident: {
            icon: '💥',
            text: '<strong>Scenario B: I-35 Incident</strong> — Multi-vehicle collision at Exit 205. Project Green Light signal coordination and frontage road detour routing engaged.'
        },
        workzone: {
            icon: '🚧',
            text: '<strong>Scenario C: Work Zone</strong> — WZDx data feed streams lane closure info. In-cab connected vehicle warnings active. Speed limit reduced to 55 mph.'
        },
        cascade: (() => {
            if (cascadePhase >= 3) return { icon: '🔴', text: '<strong>Cascade Phase 3</strong> — Emergency work zone deployed. Full corridor reroute active across 5 municipalities. Recovery protocol initiated.' };
            if (cascadePhase >= 2) return { icon: '💥', text: '<strong>Cascade Phase 2</strong> — Secondary collision at Kyle due to wet roads. Detour routing engaged. Queue warning broadcast.' };
            return { icon: '🌊', text: '<strong>Cascade Phase 1</strong> — Flash flood detected at Buda. Multi-hazard cascade protocol initiated. Monitoring for secondary incidents.' };
        })()
    };
    
    const caption = captions[scenario];
    if (!caption) {
        captionEl.style.display = 'none';
        return;
    }
    
    iconEl.innerText = caption.icon;
    textEl.innerHTML = caption.text;
    captionEl.style.display = 'flex';
    
    // Re-trigger animation
    captionEl.style.animation = 'none';
    captionEl.offsetHeight; // Force reflow
    captionEl.style.animation = '';
}

// -------------------------------------------------------------
// BOTTOM STATUS BAR
// -------------------------------------------------------------
function updateStatusBar(scenario) {
    const healthEl = document.getElementById('health-grade');
    const agenciesEl = document.getElementById('active-agencies');
    const tickerEl = document.getElementById('ticker-scroll');
    if (!healthEl || !agenciesEl || !tickerEl) return;
    
    const configs = {
        default: { grade: 'A', gradeClass: 'grade-a', agencies: 5, ticker: 'I-35 Connected Corridor — All systems nominal — 5 cities connected — Real-time EDC-8 Digital Twin Active — YOLO26 Edge Analytics Online' },
        flood: { grade: 'C', gradeClass: 'grade-c', agencies: 5, ticker: '⚠️ FLASH FLOOD WARNING — Buda Exit 220 — Speed reduced to 45 mph — FM 967 detour active — Google Maps alerts pushed — Predictive Risk: 84%' },
        incident: { grade: 'D', gradeClass: 'grade-d', agencies: 7, ticker: '🚨 INCIDENT ACTIVE — I-35 SB Exit 205 San Marcos — Multi-vehicle collision — Frontage detour routing — Secondary crash prevention — Signal retiming active' },
        workzone: { grade: 'B', gradeClass: 'grade-b', agencies: 5, ticker: '🚧 WORK ZONE — Kyle Exit 213 — Lane 3 closed — Speed limit 55 mph — WZDx feed active — In-cab connected vehicle warnings broadcasting' },
        cascade: { grade: 'F', gradeClass: 'grade-f', agencies: 8, ticker: '🔴 MULTI-HAZARD CASCADE — PHASE ' + cascadePhase + ' ACTIVE — Flash flood + collision + work zone — Full corridor reroute — 8 agencies coordinating — Emergency protocol engaged' }
    };
    
    const config = configs[scenario] || configs.default;
    
    healthEl.innerText = config.grade;
    healthEl.className = `health-grade ${config.gradeClass}`;
    agenciesEl.innerHTML = `Active Agencies: <strong>${config.agencies}</strong>`;
    tickerEl.innerHTML = `<span class="ticker-item">${config.ticker}</span>`;
    
    // Restart ticker animation
    tickerEl.style.animation = 'none';
    tickerEl.offsetHeight;
    tickerEl.style.animation = '';
}

function updateStatusBarClock() {
    const clockEl = document.getElementById('system-clock');
    if (clockEl) {
        clockEl.innerText = new Date().toTimeString().split(' ')[0];
    }
}

// -------------------------------------------------------------
// ENHANCED CCTV VEHICLE RENDERING
// -------------------------------------------------------------
// Override drawVehicles with enhanced rendering (rounded rects, headlights, shadows)
const _originalDrawVehicles = typeof drawVehicles === 'function' ? drawVehicles : null;

// Utility: draw rounded rectangle
function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// We replace drawVehicles inline — the original function reference is in the global scope
// so we just redefine it:
drawVehicles = function() {
    vehicles.forEach(v => {
        // Merging logic around stopped incident crash block in Scenario B
        if ((activeScenario === 'incident' || activeScenario === 'cascade') && v.lane === 1 && !v.isIncident && !v.isEmergency) {
            if (v.y > 10 && v.y < 70 && !v.merging) {
                v.merging = true;
                v.targetX = 110;
            }
        }
        
        // Smoothly interpolate x for lane merges
        if (v.x !== v.targetX) {
            const dx = v.targetX - v.x;
            v.x += Math.sign(dx) * Math.min(Math.abs(dx), 1.5);
            if (Math.abs(v.x - v.targetX) < 1) {
                v.x = v.targetX;
                v.lane = v.targetX === 110 ? 0 : v.targetX === 160 ? 1 : v.targetX === 210 ? 2 : v.lane;
                v.merging = false;
            }
        }

        // Movement
        if (v.isEmergency) {
            v.y += v.speed;
            if (v.y < -40) v.y = 220;
        } else if (!v.isIncident) {
            v.y += v.speed;
            if (v.y > 240) {
                v.y = -40;
                v.merging = false;
                if (activeScenario !== 'workzone') {
                    const laneX = [110, 160, 210, 300];
                    const randLane = Math.floor(Math.random() * 4);
                    v.x = laneX[randLane];
                    v.targetX = laneX[randLane];
                    v.lane = randLane;
                    v.color = '#00e676';
                    v.baseSpeed = 1.2 + Math.random() * 0.8;
                    v.speed = v.baseSpeed;
                } else {
                    const laneX = [110, 160, 300];
                    const randLane = Math.floor(Math.random() * 3);
                    v.x = laneX[randLane];
                    v.targetX = laneX[randLane];
                    v.lane = randLane === 2 ? 3 : randLane;
                    v.color = '#ff9100';
                    v.baseSpeed = 0.6 + Math.random() * 0.4;
                    v.speed = v.baseSpeed;
                }
            }
        }
        
        const vx = v.x - v.width/2;
        const vy = v.y - v.height/2;
        
        // Shadow underneath
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        roundedRect(ctx, vx + 2, vy + 3, v.width, v.height, 4);
        ctx.fill();
        
        // Motion blur streaks for fast vehicles
        if (Math.abs(v.speed) > 1.5 && !v.isIncident) {
            const streakAlpha = Math.min(0.3, Math.abs(v.speed) * 0.08);
            ctx.fillStyle = `rgba(${v.color === '#00e676' ? '0,230,118' : v.color === '#ff9100' ? '255,145,0' : '255,23,68'}, ${streakAlpha})`;
            const dir = v.speed >= 0 ? -1 : 1;
            for (let s = 1; s <= 3; s++) {
                roundedRect(ctx, vx, vy + dir * s * 6, v.width, v.height * 0.6, 3);
                ctx.fill();
            }
        }
        
        // Vehicle body (rounded rectangle with gradient)
        const bodyGrad = ctx.createLinearGradient(vx, vy, vx + v.width, vy + v.height);
        bodyGrad.addColorStop(0, v.color);
        bodyGrad.addColorStop(1, shadeColor(v.color, -30));
        ctx.fillStyle = bodyGrad;
        roundedRect(ctx, vx, vy, v.width, v.height, 4);
        ctx.fill();
        
        // Windshield
        ctx.fillStyle = 'rgba(10, 12, 16, 0.6)';
        if (v.speed >= 0) {
            roundedRect(ctx, vx + 3, vy + v.height - 14, v.width - 6, 8, 2);
        } else {
            roundedRect(ctx, vx + 3, vy + 6, v.width - 6, 8, 2);
        }
        ctx.fill();
        
        // Headlights (front glow)
        ctx.fillStyle = '#ffffff';
        const hlY = v.speed >= 0 ? vy + v.height - 3 : vy + 1;
        ctx.beginPath();
        ctx.arc(vx + 3, hlY, 2, 0, Math.PI * 2);
        ctx.arc(vx + v.width - 3, hlY, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Headlight glow cone
        if (Math.abs(v.speed) > 0.3) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath();
            const coneDir = v.speed >= 0 ? 1 : -1;
            ctx.moveTo(vx + 1, hlY);
            ctx.lineTo(vx - 4, hlY + coneDir * 20);
            ctx.lineTo(vx + 8, hlY + coneDir * 20);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(vx + v.width - 1, hlY);
            ctx.lineTo(vx + v.width - 8, hlY + coneDir * 20);
            ctx.lineTo(vx + v.width + 4, hlY + coneDir * 20);
            ctx.closePath();
            ctx.fill();
        }
        
        // Taillights (red glow at rear)
        ctx.fillStyle = '#ff1744';
        const tlY = v.speed >= 0 ? vy + 1 : vy + v.height - 3;
        ctx.beginPath();
        ctx.arc(vx + 3, tlY, 1.5, 0, Math.PI * 2);
        ctx.arc(vx + v.width - 3, tlY, 1.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Emergency vehicle flashing lights
        if (v.isEmergency) {
            v.flashState = !v.flashState;
            ctx.fillStyle = v.flashState ? '#00b0ff' : '#ff1744';
            ctx.beginPath();
            ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
            ctx.fill();
            // Glow
            ctx.fillStyle = v.flashState ? 'rgba(0, 176, 255, 0.3)' : 'rgba(255, 23, 68, 0.3)';
            ctx.beginPath();
            ctx.arc(v.x, v.y, 10, 0, Math.PI * 2);
            ctx.fill();
        }

        // Blinker for merging vehicles
        if (v.merging && v.targetX < v.x) {
            v.blinkTimer = (v.blinkTimer || 0 + 1) % 20;
            if (v.blinkTimer < 10) {
                ctx.fillStyle = '#ff9100';
                ctx.beginPath();
                ctx.arc(vx, vy + v.height - 3, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // YOLO26 bounding box
        const boxColor = v.isEmergency || v.isIncident ? '#ff1744' : v.color === '#ff9100' ? '#ff9100' : '#00e676';
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        roundedRect(ctx, vx - 3, vy - 3, v.width + 6, v.height + 6, 5);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // YOLO26 label
        ctx.fillStyle = boxColor;
        ctx.font = '7px monospace';
        const label = v.isEmergency ? 'EMERG' : v.isIncident ? 'CRASH' : 'VEH';
        ctx.fillText(label, vx - 2, vy - 6);
    });
};

// Helper: shade a hex color darker/lighter
function shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

// Enhanced pedestrian rendering with animated stick figure
const _origDrawPedestrians = typeof drawPedestrians === 'function' ? drawPedestrians : null;
drawPedestrians = function() {
    pedestrians.forEach(p => {
        if (!p.active) return;
        
        p.x += p.speed;
        if (p.speed > 0 && p.x > p.targetX) {
            p.speed = -p.speed;
        } else if (p.speed < 0 && p.x < p.targetX) {
            p.speed = -p.speed;
        }
        
        // Animated stick figure
        const walkPhase = (Date.now() / 200) % 2;
        const legSpread = Math.sin(walkPhase * Math.PI) * 4;
        
        // Head
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 8, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Body
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x, p.y + 3);
        ctx.stroke();
        
        // Arms
        ctx.beginPath();
        ctx.moveTo(p.x - 4, p.y - 2);
        ctx.lineTo(p.x + 4, p.y - 2);
        ctx.stroke();
        
        // Legs (animated)
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + 3);
        ctx.lineTo(p.x - legSpread, p.y + 9);
        ctx.moveTo(p.x, p.y + 3);
        ctx.lineTo(p.x + legSpread, p.y + 9);
        ctx.stroke();
        
        // YOLO label
        ctx.fillStyle = p.color;
        ctx.font = '7px monospace';
        ctx.fillText('PED', p.x - 7, p.y - 14);
        
        // Detection box
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(p.x - 8, p.y - 12, 16, 24);
        ctx.setLineDash([]);
    });
};

// Handle cascade scenario in traffic particle colors
const _origAnimateTrafficFlow = animateTrafficFlow;
const origTrafficColorLogic = true; // Flag to indicate enhanced logic is active

