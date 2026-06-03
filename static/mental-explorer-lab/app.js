const CAT_COLORS = {
  human_behavior: "#5eead4",
  rider_behavior: "#5eead4",
  pedestrian_behavior: "#43d9ad",
  driver_behavior: "#fb923c",
  infrastructure: "#fbbf24",
  environment: "#60a5fa",
  vehicle_context: "#c084fc",
  vehicle_factors: "#c084fc",
  post_crash: "#fb7185",
  outcome: "#f87171",
  evidence_source: "#a3e635",
};

const CAT_LABELS = {
  human_behavior: "Human Behavior",
  driver_behavior: "Driver Behavior",
  pedestrian_behavior: "Pedestrian Behavior",
  infrastructure: "Infrastructure",
  environment: "Environment",
  vehicle_context: "Vehicle / Device",
  post_crash: "Post-crash",
  outcome: "Outcome",
  evidence_source: "Evidence Source",
};

const STATUS_LABELS = {
  confirmed_by_cris: "Confirmed by CRIS",
  narrative_only: "Narrative-only",
  contradicts_cris: "Contradicts CRIS",
  duplicate_of_cris: "Duplicate of CRIS",
  unknown: "Unknown",
};

const TABS = [
  ["graph", "Network"],
  ["mental", "Mental Model"],
  ["stories", "Stories"],
  ["validation", "CRIS Validation"],
  ["review", "Review Queue"],
  ["heatmap", "Co-occurrence"],
  ["crashes", "Crash Browser"],
];

let MANIFEST = null;
let DATA = null;
let CURRENT_DATASET = "escooter";
let simulation = null;
let svgG = null;
let zoomBehavior = null;
let activeFilters = new Set();
let activeStory = null;
let selectedCrashId = null;
let selectedCoocKey = null;
let _nodes = [];
let _links = [];
let _nodeG = null;
let _linkG = null;
let caseIndexCache = {};
let cardPageCache = {};
let detailPageCache = {};
let summaryCache = {};
let currentCaseResults = [];
let currentCasePage = 0;
let caseFilters = { query: "", year: "", severity: "", city: "" };
let crashListBuildSeq = 0;
let coocState = { metric: "count", factorLimit: 24, minCount: 1, query: "", category: "all", sortMode: "cooccurrence", viewMode: "triangle" };

const PAGE_SIZE = 80;

init().catch(error => {
  document.body.innerHTML = `<p class="load-error">Error loading lab app: ${escapeHtml(error.message)}</p>`;
  console.error(error);
});

async function init() {
  MANIFEST = await fetchJson("datasets/index.json");
  const initial = new URLSearchParams(location.search).get("dataset") || "escooter";
  await Promise.all(MANIFEST.datasets.map(d => loadSummary(d.id)));
  setupShell();
  await switchDataset(initial, { keepIntro: true });
  renderIntro();
  startEntropySimulation();
  document.body.classList.add("modal-open");
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json();
}

function byId(id) {
  return document.getElementById(id);
}

function datasetDef(id = CURRENT_DATASET) {
  return MANIFEST.datasets.find(item => item.id === id);
}

async function loadSummary(datasetId = CURRENT_DATASET) {
  if (!summaryCache[datasetId]) {
    const def = datasetDef(datasetId);
    if (!def) throw new Error(`Unknown dataset: ${datasetId}`);
    summaryCache[datasetId] = await fetchJson(def.summary);
  }
  return summaryCache[datasetId];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\w\S*/g, s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

function fmt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US").format(n) : escapeHtml(value ?? "--");
}

function safeValue(value) {
  if (value === null || value === undefined || value === "") return '<span class="muted">not available</span>';
  return escapeHtml(value);
}

function statusLabel(status) {
  return STATUS_LABELS[status] || titleCase(status || "unknown");
}

function badge(text, cls = "") {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function factorBadge(factor) {
  const cls = `badge-${factor.category || "human_behavior"}`;
  const status = factor.validation_status ? ` / ${statusLabel(factor.validation_status)}` : "";
  return `<span class="badge ${cls}" title="${escapeHtml(statusLabel(factor.validation_status))}">${escapeHtml(factor.label || titleCase(factor.factor))}${escapeHtml(status)}</span>`;
}

function statusBadge(status) {
  return badge(statusLabel(status), `status-${status || "unknown"}`);
}

function redactedNarrative(record) {
  return record.deidentified_narrative || record.public_safe_text || record.redacted_narrative || "";
}

function safetyText(record) {
  return record.safety_summary?.text || record.public_safe_text || record.deidentified_narrative || "";
}

function setupShell() {
  byId("datasetSwitcher").innerHTML = MANIFEST.datasets
    .map(d => `<button data-dataset="${d.id}">${escapeHtml(d.label)}</button>`)
    .join("");
  document.querySelectorAll("[data-dataset]").forEach(btn => {
    btn.addEventListener("click", () => switchDataset(btn.dataset.dataset));
  });

  byId("viewTabs").innerHTML = TABS.map(([id, label]) => `<button class="tab-btn" data-tab="${id}">${escapeHtml(label)}</button>`).join("");
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  byId("openIntroBtn").addEventListener("click", openIntro);
  byId("introTopBtn").addEventListener("click", openIntro);
  byId("closeIntroBtn").addEventListener("click", closeIntro);
  byId("closeInspectorBtn").addEventListener("click", () => byId("inspector").classList.remove("open"));
  byId("commandBtn").addEventListener("click", () => {
    switchTab("crashes");
    byId("caseQuery")?.focus();
  });
}

async function switchDataset(datasetId, options = {}) {
  if (!datasetDef(datasetId)) datasetId = "escooter";
  CURRENT_DATASET = datasetId;
  activeFilters.clear();
  activeStory = null;
  selectedCrashId = null;
  selectedCoocKey = null;
  currentCasePage = 0;
  caseFilters = { query: "", year: "", severity: "", city: "" };

  const def = datasetDef();
  document.documentElement.style.setProperty("--accent", def.accent || "#5eead4");
  DATA = await loadSummary(CURRENT_DATASET);

  byId("headerSubtitle").textContent = `${DATA.meta.subject} dataset - ${fmt(DATA.meta.total_unique_crashes)} deidentified cases`;
  document.querySelectorAll("[data-dataset]").forEach(btn => btn.classList.toggle("active", btn.dataset.dataset === CURRENT_DATASET));
  renderStats();
  renderFilterRail();
  switchTab("graph");
  if (!options.keepIntro) toast(`${def.label} mental-model explorer loaded`);
}

function renderStats() {
  const s = DATA.aggregate_graph.stats;
  byId("headerStats").innerHTML = [
    `<div class="stat-pill"><span class="sv">${fmt(DATA.meta.total_unique_crashes)}</span>Crashes</div>`,
    `<div class="stat-pill"><span class="sv">${fmt(s.total_unique_factors)}</span>Factors</div>`,
    `<div class="stat-pill"><span class="sv">${fmt(DATA.story_archetypes.length)}</span>Stories</div>`,
    `<div class="stat-pill"><span class="sv">${fmt(DATA.validation_overview.contradiction_count || 0)}</span>Contradictions</div>`,
    `<div class="stat-pill"><span class="sv">${fmt(DATA.review_queue.length)}</span>Review</div>`,
    `<div class="stat-pill"><span class="sv">PII</span>Deidentified</div>`,
  ].join("");
}

function renderIntro() {
  const totalCases = MANIFEST.datasets.reduce((sum, d) => sum + (summaryCache[d.id]?.meta.total_unique_crashes || 0), 0);
  const totalFactors = new Set(MANIFEST.datasets.flatMap(d => (summaryCache[d.id]?.aggregate_graph.nodes || []).map(n => n.id))).size;
  const introCasesEl = byId("introCases");
  const introNodesEl = byId("introNodes");
  if (introCasesEl) introCasesEl.textContent = totalCases ? fmt(totalCases) : "--";
  if (introNodesEl) introNodesEl.textContent = totalFactors ? fmt(totalFactors) : "--";
  byId("introDatasetCards").innerHTML = MANIFEST.datasets
    .map(def => {
      const active = def.id === CURRENT_DATASET ? " active" : "";
      const current = summaryCache[def.id] || null;
      const label = def.id === "escooter" ? "Mental-model e-scooter crash explorer." : "Pedestrian mental-model explorer with lazy case shards.";
      return `
        <article class="dataset-card${active}" data-intro-dataset="${def.id}">
          <h3>${escapeHtml(def.label)}</h3>
          <p>${escapeHtml(label)}</p>
          <div class="stats">
            <div><strong>${current ? fmt(current.meta.total_unique_crashes) : "load"}</strong><span>cases</span></div>
            <div><strong>${current ? fmt(current.aggregate_graph.stats.total_unique_factors) : "on"}</strong><span>factors</span></div>
            <div><strong>${current ? fmt(current.story_archetypes.length) : "demand"}</strong><span>stories</span></div>
            <div><strong>PII</strong><span>deidentified</span></div>
          </div>
        </article>`;
    })
    .join("");
  document.querySelectorAll("[data-intro-dataset]").forEach(card => {
    card.addEventListener("click", async () => {
      await switchDataset(card.dataset.introDataset);
      closeIntro();
    });
  });
}

function openIntro() {
  renderIntro();
  startEntropySimulation();
  byId("introBackdrop").classList.add("visible");
  document.body.classList.add("modal-open");
}

function closeIntro() {
  stopEntropySimulation();
  byId("introBackdrop").classList.remove("visible");
  document.body.classList.remove("modal-open");
}

function renderFilterRail() {
  const cats = Object.entries(DATA.aggregate_graph.stats.category_distribution || {}).sort((a, b) => b[1] - a[1]);
  const stories = DATA.story_archetypes.slice(0, 7);
  const cities = Object.entries(DATA.facets?.city || {}).slice(0, 7);
  byId("filterRail").innerHTML = `
    <div class="filter-block">
      <h3>Dataset</h3>
      <div class="metric-card">
        <span>${escapeHtml(DATA.meta.subject)}</span>
        <strong>${fmt(DATA.meta.total_unique_crashes)}</strong>
        <p class="muted">deidentified cases</p>
      </div>
    </div>
    <div class="filter-block">
      <h3>Factor categories</h3>
      <div class="chip-list">
        ${cats
          .map(([cat, count]) => `<button class="chip ${activeFilters.has(cat) ? "active" : ""}" data-cat="${cat}"><span class="dot" style="background:${CAT_COLORS[cat] || "#888"}"></span>${escapeHtml(CAT_LABELS[cat] || titleCase(cat))} ${fmt(count)}</button>`)
          .join("")}
      </div>
    </div>
    <div class="filter-block">
      <h3>Top stories</h3>
      ${stories.map(s => `<button class="rail-row" data-story="${s.id}"><span>${escapeHtml(s.label)}</span><strong>${fmt(s.frequency)}</strong></button>`).join("")}
    </div>
    <div class="filter-block">
      <h3>Top cities</h3>
      ${cities.map(([city, count]) => `<div class="rail-row"><span>${escapeHtml(city)}</span><strong>${fmt(count)}</strong></div>`).join("")}
    </div>
  `;
  document.querySelectorAll("[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      if (activeFilters.has(cat)) activeFilters.delete(cat);
      else activeFilters.add(cat);
      renderFilterRail();
      buildGraph();
    });
  });
  document.querySelectorAll("[data-story]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeStory = btn.dataset.story;
      switchTab("crashes");
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll("[data-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  const host = byId("viewHost");
  if (tab === "graph") return renderGraphTab(host);
  if (tab === "mental") return renderMentalTab(host);
  if (tab === "stories") return renderStoriesTab(host);
  if (tab === "validation") return renderValidationTab(host);
  if (tab === "review") return renderReviewTab(host);
  if (tab === "heatmap") return renderHeatmapTab(host);
  if (tab === "crashes") return renderCrashTab(host);
  return renderGraphTab(host);
}

function renderGraphTab(host) {
  host.innerHTML = `
    <section class="tab-content active">
      <div class="graph-canvas" id="graphCanvas">
        <div class="float-controls">
          <button class="float-btn" onclick="zoomIn()" title="Zoom in">+</button>
          <button class="float-btn" onclick="zoomOut()" title="Zoom out">-</button>
          <button class="float-btn" onclick="resetZoom()" title="Reset view">R</button>
        </div>
        <div class="filter-row" id="filterBar"></div>
        <svg id="graphSvg"></svg>
        <div class="float-legend" id="legend"></div>
      </div>
      <aside class="detail-panel" id="graphDetailPanel">
        <div class="dp-header"><span>Validated Factor</span><button class="dp-close" onclick="closePanel('graphDetailPanel')">x</button></div>
        <div class="dp-body" id="nodeDetails"></div>
      </aside>
    </section>`;
  buildLegend();
  buildFilters();
  buildGraph();
}

function buildGraph() {
  const canvas = byId("graphCanvas");
  if (!canvas) return;
  const W = canvas.clientWidth || 1200;
  const H = canvas.clientHeight || 760;
  const svg = d3.select("#graphSvg");
  svg.selectAll("*").remove();
  svg.attr("width", W).attr("height", H);

  _nodes = DATA.aggregate_graph.nodes
    .filter(n => !activeFilters.size || activeFilters.has(n.category))
    .slice(0, CURRENT_DATASET === "pedestrian" ? 56 : 80)
    .map(d => ({ ...d }));
  const nodeIds = new Set(_nodes.map(n => n.id));
  _links = DATA.aggregate_graph.edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target) && e.weight >= (CURRENT_DATASET === "pedestrian" ? 8 : 2))
    .slice(0, 420)
    .map(e => ({ source: e.source, target: e.target, weight: e.weight, crash_ids: e.crash_ids || [] }));

  const rScale = d3.scaleSqrt().domain([1, d3.max(_nodes, d => d.frequency) || 1]).range([8, 42]);
  const wScale = d3.scaleLinear().domain([1, d3.max(_links, d => d.weight) || 1]).range([0.7, 5.5]);
  const labelLimit = CURRENT_DATASET === "pedestrian" ? 18 : 24;
  const labelIds = new Set(_nodes.slice().sort((a, b) => b.frequency - a.frequency).slice(0, labelLimit).map(d => d.id));

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 15)
    .attr("refY", 0)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "rgba(244,241,232,.45)");

  svgG = svg.append("g");
  zoomBehavior = d3.zoom().scaleExtent([0.2, 6]).on("zoom", e => svgG.attr("transform", e.transform));
  svg.call(zoomBehavior);

  _linkG = svgG
    .append("g")
    .selectAll("line")
    .data(_links)
    .enter()
    .append("line")
    .attr("stroke", d => CAT_COLORS[(_nodes.find(n => n.id === d.source) || {}).category] || "#334155")
    .attr("stroke-opacity", 0.18)
    .attr("stroke-width", d => wScale(d.weight))
    .attr("marker-end", "url(#arrow)");

  _nodeG = svgG
    .append("g")
    .selectAll("g")
    .data(_nodes)
    .enter()
    .append("g")
    .attr("cursor", "pointer")
    .call(
      d3
        .drag()
        .on("start", (e, d) => {
          if (!e.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  _nodeG.append("circle").attr("r", d => rScale(d.frequency) + 7).attr("fill", d => CAT_COLORS[d.category] || "#64748b").attr("opacity", 0.09);
  _nodeG.append("circle").attr("r", d => rScale(d.frequency)).attr("fill", d => CAT_COLORS[d.category] || "#64748b").attr("stroke", "#f8fafc").attr("stroke-width", 0.7).attr("stroke-opacity", 0.32);
  _nodeG
    .filter(d => labelIds.has(d.id))
    .append("text")
    .text(d => shortLabel(d.label))
    .append("title")
    .text(d => d.label);

  _nodeG
    .filter(d => labelIds.has(d.id))
    .select("text")
    .attr("text-anchor", "middle")
    .attr("dy", d => rScale(d.frequency) + 16)
    .attr("class", "node-label")
    .attr("fill", "#f3f0e8")
    .attr("font-size", "10px")
    .attr("font-weight", "800")
    .attr("letter-spacing", "0");

  _nodeG.on("click", (e, d) => {
    showNodeDetails(d);
    openPanel("graphDetailPanel");
  });

  simulation = d3
    .forceSimulation(_nodes)
    .force("link", d3.forceLink(_links).id(d => d.id).distance(CURRENT_DATASET === "pedestrian" ? 156 : 124).strength(0.16))
    .force("charge", d3.forceManyBody().strength(d => -Math.max(160, rScale(d.frequency) * 36)))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("x", d3.forceX(W / 2).strength(0.025))
    .force("y", d3.forceY(H / 2).strength(0.025))
    .force("collision", d3.forceCollide().radius(d => rScale(d.frequency) + (labelIds.has(d.id) ? 36 : 20)))
    .on("tick", () => {
      _linkG.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      _nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

function shortLabel(label, limit = 24) {
  const text = String(label || "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}...`;
}

function buildLegend() {
  byId("legend").innerHTML =
    `<div class="leg-title">Factor categories</div>` +
    Object.entries(CAT_LABELS)
      .filter(([key]) => DATA.aggregate_graph.stats.category_distribution[key])
      .map(([key, label]) => `<div class="leg-item"><div class="leg-dot" style="background:${CAT_COLORS[key]}"></div>${escapeHtml(label)}</div>`)
      .join("");
}

function buildFilters() {
  byId("filterBar").innerHTML = Object.entries(CAT_LABELS)
    .filter(([key]) => DATA.aggregate_graph.stats.category_distribution[key])
    .map(([key, label]) => `<button class="chip ${activeFilters.has(key) ? "active" : ""}" onclick="toggleFilter('${key}', this)">${escapeHtml(label)}</button>`)
    .join("");
}

function toggleFilter(cat) {
  if (activeFilters.has(cat)) activeFilters.delete(cat);
  else activeFilters.add(cat);
  renderFilterRail();
  buildFilters();
  buildGraph();
}

function showNodeDetails(node) {
  const connected = _links
    .filter(edge => {
      const source = typeof edge.source === "object" ? edge.source.id : edge.source;
      const target = typeof edge.target === "object" ? edge.target.id : edge.target;
      return source === node.id || target === node.id;
    })
    .sort((a, b) => b.weight - a.weight);
  byId("nodeDetails").innerHTML = `
    <div class="detail-title" style="color:${CAT_COLORS[node.category] || "#f8fafc"}">${escapeHtml(node.label)}</div>
    <div class="muted">${escapeHtml(node.category_label)}</div>
    <div class="stat-row">
      <div class="stat-box"><div class="sb-val">${fmt(node.frequency)}</div><div class="sb-label">crashes</div></div>
      <div class="stat-box"><div class="sb-val">${node.percentage}%</div><div class="sb-label">sample</div></div>
      <div class="stat-box"><div class="sb-val">${connected.length}</div><div class="sb-label">links</div></div>
    </div>
    <div class="section-kicker">Connected factors</div>
    ${connected
      .slice(0, 12)
      .map(edge => {
        const source = typeof edge.source === "object" ? edge.source.id : edge.source;
        const target = typeof edge.target === "object" ? edge.target.id : edge.target;
        const otherId = source === node.id ? target : source;
        const other = _nodes.find(n => n.id === otherId);
        return `<div class="card compact-card"><div class="card-title">${source === node.id ? "to" : "from"} ${escapeHtml(other ? other.label : titleCase(otherId))}</div><div class="card-sub">weight ${fmt(edge.weight)}</div></div>`;
      })
      .join("") || emptyState("No connected factors above the display threshold.")}
    <div class="section-kicker">Sample cases</div>
    <div class="badge-row">${(node.sample_crash_ids || []).slice(0, 12).map(id => `<button class="chip" onclick="openRecordById('${id}')">${escapeHtml(id)}</button>`).join("")}</div>
  `;
}

function zoomIn() {
  d3.select("#graphSvg").transition().duration(300).call(zoomBehavior.scaleBy, 1.5);
}
function zoomOut() {
  d3.select("#graphSvg").transition().duration(300).call(zoomBehavior.scaleBy, 0.67);
}
function resetZoom() {
  d3.select("#graphSvg").transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity);
}
function openPanel(id) {
  byId(id)?.classList.add("open");
}
function closePanel(id) {
  byId(id)?.classList.remove("open");
}

async function ensureCaseIndex() {
  if (caseIndexCache[CURRENT_DATASET]) return caseIndexCache[CURRENT_DATASET];
  const raw = await fetchJson(datasetDef().index);
  const records = raw.records.map(row => {
    const obj = {};
    raw.columns.forEach((column, index) => {
      obj[column] = row[index];
    });
    return obj;
  });
  caseIndexCache[CURRENT_DATASET] = { ...raw, records };
  return caseIndexCache[CURRENT_DATASET];
}

async function loadCardPage(page) {
  const key = `${CURRENT_DATASET}:${page}`;
  if (!cardPageCache[key]) {
    cardPageCache[key] = await fetchJson(`${datasetDef().cards_dir}/cards-${String(page).padStart(3, "0")}.json`);
  }
  return cardPageCache[key];
}

async function loadDetailPage(page) {
  const key = `${CURRENT_DATASET}:${page}`;
  if (!detailPageCache[key]) {
    detailPageCache[key] = await fetchJson(`${datasetDef().records_dir}/records-${String(page).padStart(3, "0")}.json`);
  }
  return detailPageCache[key];
}

async function loadRecord(itemOrId) {
  const index = await ensureCaseIndex();
  const item = typeof itemOrId === "string" ? index.records.find(r => r.crash_id === itemOrId) : itemOrId;
  if (!item) return null;
  const payload = await loadDetailPage(Number(item.page));
  return payload.records.find(r => r.crash_id === item.crash_id) || null;
}

async function openRecordById(id, target = "crashes") {
  if (target === "crashes") switchTab("crashes");
  const record = await loadRecord(id);
  if (record) showCrashDetailRecord(record);
}

async function renderMentalTab(host) {
  host.innerHTML = `
    <section class="mental-layout">
      <aside class="list-pane">
        <div class="section-header"><h2>Mental Model</h2><p>Unit-level before, during, and after crash interpretation.</p></div>
        <input type="text" class="search-input" id="mentalSearch" placeholder="Search crash id, story, factor, city">
        <div class="mini-count" id="mentalCount"></div>
        <div class="record-list" id="mentalList"></div>
      </aside>
      <section class="detail-pane" id="mentalDetails"></section>
    </section>`;
  byId("mentalSearch").addEventListener("input", () => buildMentalModel());
  await buildMentalModel();
}

async function getFilteredIndex(query = "", storyId = null) {
  const index = await ensureCaseIndex();
  const q = query.trim().toLowerCase();
  return index.records.filter(record => {
    if (storyId && record.story_label !== (DATA.story_archetypes.find(s => s.id === storyId)?.label || storyId) && record.story_id !== storyId) return false;
    if (!q) return true;
    return [record.crash_id, record.year, record.city, record.county, record.severity, record.story_label, ...(record.factors || []), ...(record.factor_labels || [])]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

async function buildMentalModel() {
  const query = byId("mentalSearch")?.value || "";
  const records = await getFilteredIndex(query);
  byId("mentalCount").textContent = `${fmt(records.length)} crashes`;
  const page = records.slice(0, 120);
  const cardMap = await cardsForRecords(page);
  byId("mentalList").innerHTML =
    page.map(item => recordButton(cardMap.get(item.crash_id) || item, "mental")).join("") || emptyState("No matching records.");
  document.querySelectorAll("[data-mental-id]").forEach(btn => btn.addEventListener("click", () => showMentalDetails(btn.dataset.mentalId)));
  if (!selectedCrashId && page[0]) showMentalDetails(page[0].crash_id);
}

async function cardsForRecords(records) {
  const pages = Array.from(new Set(records.map(r => Number(r.page))));
  const map = new Map();
  await Promise.all(pages.map(loadCardPage));
  pages.forEach(page => {
    (cardPageCache[`${CURRENT_DATASET}:${page}`]?.records || []).forEach(card => map.set(card.crash_id, card));
  });
  return map;
}

function recordButton(record, kind = "crash") {
  const attr = kind === "mental" ? "data-mental-id" : kind === "review" ? "data-review-id" : "data-case-id";
  return `
    <button class="record-card ${selectedCrashId === record.crash_id ? "active" : ""}" ${attr}="${escapeHtml(record.crash_id)}">
      <span class="record-id">${escapeHtml(record.crash_id)}</span>
      <span class="record-story">${escapeHtml(record.story_label || record.story?.label || "")}</span>
      <span class="record-text">${escapeHtml((record.snippet || record.safety_summary || record.public_safe_text || "").slice(0, 190))}</span>
    </button>`;
}

async function showMentalDetails(crashId) {
  selectedCrashId = crashId;
  const record = await loadRecord(crashId);
  if (!record) return;
  byId("mentalDetails").innerHTML = renderCrashMentalModel(record);
  document.querySelectorAll("[data-mental-id]").forEach(btn => btn.classList.toggle("active", btn.dataset.mentalId === crashId));
}

function renderCrashMentalModel(record) {
  return `
    <div class="detail-heading">
      <div><div class="eyebrow">${escapeHtml(record.crash_id)}</div><h2>${escapeHtml(record.story?.label || "Crash record")}</h2></div>
      <div class="confidence">${Math.round((record.story?.confidence || record.causal_clarity?.score || 0) * 100)}%</div>
    </div>
    <div class="context-grid">${renderContext(record.cris_context || {})}</div>
    <div class="actor-grid">${(record.actors || []).map(actor => renderActorMentalCard(record, actor)).join("")}</div>
    <div class="section-kicker">Accepted evidence</div>
    ${renderClaims((record.claims || []).filter(c => !c.suppressed_from_graph).slice(0, 12))}
  `;
}

function actorIdentity(actor) {
  return actor.actor_id || actor.id || `unit_${actor.unit_number || "unknown"}`;
}

function renderActorMentalCard(record, actor) {
  const id = actorIdentity(actor);
  const model = record.mental_models?.[id] || {};
  const timeline = record.timeline?.[id] || { pre_crash: [], during_crash: [], post_crash: [] };
  return `
    <article class="actor-card">
      <div class="actor-head">
        <div><h3>Unit ${safeValue(actor.unit_number)}</h3><div class="muted">${escapeHtml(titleCase(actor.road_user_role || actor.role))} / ${escapeHtml(actor.mode || actor.type || "unknown")}</div></div>
        ${badge(titleCase(model.causal_role || actor.causal_role || "uncertain"), `role-${model.causal_role || actor.causal_role || "uncertain"}`)}
      </div>
      <div class="model-grid">
        <div><span>Attention</span><strong>${safeValue(model.attention_state)}</strong></div>
        <div><span>Rule compliance</span><strong>${safeValue(model.rule_compliance)}</strong></div>
        <div><span>Perception gap</span><strong>${safeValue(model.perception_gap)}</strong></div>
        <div><span>Post-crash</span><strong>${safeValue(model.post_crash_behavior)}</strong></div>
      </div>
      <div class="badge-row">${(model.failure_modes || []).map(f => badge(titleCase(f), "badge-human_behavior")).join("") || badge("no explicit failure mode", "status-unknown")}</div>
      <div class="timeline-grid">
        ${renderTimelineColumn("Before", timeline.pre_crash || [])}
        ${renderTimelineColumn("During", timeline.during_crash || [])}
        ${renderTimelineColumn("After", timeline.post_crash || [])}
      </div>
    </article>`;
}

function renderTimelineColumn(label, items) {
  return `<div class="timeline-col"><div class="timeline-title">${escapeHtml(label)}</div>${
    items.length
      ? items
          .slice(0, 4)
          .map(item => `<div class="timeline-item"><strong>${escapeHtml(item.action)}</strong><span>${escapeHtml(item.evidence)}</span></div>`)
          .join("")
      : '<div class="timeline-empty">not described</div>'
  }</div>`;
}

function renderContext(context) {
  const fields = [
    ["Year", context.year],
    ["Severity", context.severity],
    ["Weather", context.weather],
    ["Lighting", context.lighting],
    ["Intersection", context.intersection_relation],
    ["Traffic control", context.traffic_control],
    ["Surface", context.surface],
    ["Collision", context.first_harmful_event_collision],
  ];
  return fields.map(([label, value]) => `<div class="context-cell"><span>${escapeHtml(label)}</span><strong>${safeValue(value)}</strong></div>`).join("");
}

function renderStoriesTab(host) {
  host.innerHTML = `
    <section class="stories-layout">
      <section class="wide-pane">
        <div class="section-header"><h2>Story Archetypes</h2><p>Supervisor-facing crash stories with CRIS condition prevalence.</p></div>
        <div class="story-grid" id="storyGrid"></div>
      </section>
      <aside class="side-pane" id="storyDetails"></aside>
    </section>`;
  buildStories();
}

function buildStories() {
  byId("storyGrid").innerHTML = DATA.story_archetypes
    .map(
      story => `
        <article class="story-card ${activeStory === story.id ? "active" : ""}" data-story-card="${story.id}">
          <div class="story-topline"><span class="story-count">${fmt(story.frequency)}</span><span class="story-pct">${story.percentage}%</span></div>
          <h3>${escapeHtml(story.label)}</h3>
          <div class="story-id">${escapeHtml(story.id)}</div>
          <div class="condition-list">${story.top_conditions.slice(0, 4).map(c => `<span>${escapeHtml(c.condition)} (${c.percentage}%)</span>`).join("")}</div>
        </article>`
    )
    .join("");
  document.querySelectorAll("[data-story-card]").forEach(card => card.addEventListener("click", () => showStoryDetail(card.dataset.storyCard)));
  showStoryDetail((DATA.story_archetypes[0] || {}).id);
}

function showStoryDetail(storyId) {
  const story = DATA.story_archetypes.find(s => s.id === storyId);
  if (!story) return;
  byId("storyDetails").innerHTML = `
    <div class="detail-title">${escapeHtml(story.label)}</div>
    <div class="muted">${fmt(story.frequency)} crashes / ${story.percentage}% of sample</div>
    <button class="primary-btn" id="storyFilterBtn">Filter crash browser</button>
    <div class="section-kicker">Top CRIS conditions</div>
    ${story.top_conditions.map(c => `<div class="metric-row"><span>${escapeHtml(c.condition)}</span><strong>${fmt(c.count)} / ${c.percentage}%</strong></div>`).join("")}
    <div class="section-kicker">Representative cases</div>
    ${story.representative_crashes.map(item => `<button class="record-card" data-open-id="${item.crash_id}"><span class="record-id">${escapeHtml(item.crash_id)}</span><span class="record-text">${escapeHtml(item.safety_summary || item.public_safe_text)}</span></button>`).join("")}
  `;
  byId("storyFilterBtn").addEventListener("click", () => {
    activeStory = story.id;
    switchTab("crashes");
  });
  document.querySelectorAll("[data-open-id]").forEach(btn => btn.addEventListener("click", () => openRecordById(btn.dataset.openId)));
}

function renderValidationTab(host) {
  host.innerHTML = `
    <section class="validation-layout">
      <section class="wide-pane">
        <div class="section-header"><h2>CRIS Validation</h2><p>Confirmed, narrative-only, contradictory, and suppressed claims.</p></div>
        <div class="dashboard-grid" id="validationDashboard"></div>
        <div class="section-header compact"><h2 id="validationListTitle">Validation Review Examples</h2></div>
        <div class="record-list" id="validationExampleList"></div>
      </section>
      <aside class="side-pane" id="suppressedList"></aside>
    </section>`;
  buildValidation();
}

function buildValidation() {
  const counts = DATA.validation_overview.status_counts || {};
  byId("validationDashboard").innerHTML = Object.entries(STATUS_LABELS)
    .filter(([key]) => counts[key])
    .map(([status, label]) => `<div class="dashboard-card"><div class="dashboard-value">${fmt(counts[status])}</div><div class="dashboard-label">${escapeHtml(label)}</div><div class="badge-row">${(DATA.validation_overview.top_factors_by_status[status] || []).slice(0, 3).map(f => badge(`${titleCase(f.factor)}: ${fmt(f.count)}`, `status-${status}`)).join("")}</div></div>`)
    .join("") || emptyState("No claim validation summary was generated for this dataset.");
  const examples = (DATA.validation_overview.contradictions || []).length
    ? DATA.validation_overview.contradictions
    : DATA.validation_overview.review_examples || [];
  byId("validationListTitle").textContent = (DATA.validation_overview.contradictions || []).length ? "Contradictions" : "Validation Review Examples";
  byId("validationExampleList").innerHTML =
    examples
      .slice(0, 80)
      .map(item => `<button class="record-card" data-open-id="${item.crash_id}"><span class="record-id">${escapeHtml(item.crash_id)} / ${escapeHtml(titleCase(item.factor))}</span><span class="record-story">${escapeHtml(item.reason)}</span><span class="record-text">${escapeHtml(item.evidence)}</span></button>`)
      .join("") || emptyState("No contradictions or validation-review examples detected.");
  byId("suppressedList").innerHTML = `
    <div class="detail-title">Validation Review Signals</div>
    <div class="muted">Pedestrian records are checked for CRIS-supported factors, narrative-only factors, and high-priority manual review flags.</div>
    <div class="section-kicker">Review flag mix</div>
    ${Object.entries(DATA.validation_overview.review_flag_counts || {}).map(([code, count]) => `<div class="metric-row"><span>${escapeHtml(titleCase(code))}</span><strong>${fmt(count)}</strong></div>`).join("") || emptyState("No manual review flags.")}
    <div class="section-kicker">Suppressed duplicate claims</div>
    <div class="muted">${fmt(DATA.validation_overview.suppressed_count || 0)} duplicate claims suppressed.</div>
  `;
  document.querySelectorAll("[data-open-id]").forEach(btn => btn.addEventListener("click", () => openRecordById(btn.dataset.openId)));
}

function renderReviewTab(host) {
  host.innerHTML = `
    <section class="mental-layout">
      <aside class="list-pane">
        <div class="section-header"><h2>Review Queue</h2><p>Expert review candidates ranked by severity, uncertainty, and narrative dependence.</p></div>
        <input type="text" class="search-input" id="reviewSearch" placeholder="Search review flags or crash id">
        <div class="mini-count" id="reviewCount"></div>
        <div class="record-list" id="reviewList"></div>
      </aside>
      <section class="detail-pane" id="reviewDetails"></section>
    </section>`;
  byId("reviewSearch").addEventListener("input", buildReviewQueue);
  buildReviewQueue();
}

function buildReviewQueue() {
  const query = (byId("reviewSearch")?.value || "").trim().toLowerCase();
  const items = DATA.review_queue.filter(item => {
    if (!query) return true;
    return [item.crash_id, item.story_label, item.safety_summary, item.public_safe_text, ...(item.flags || []).map(f => `${f.code} ${f.label}`)].join(" ").toLowerCase().includes(query);
  });
  byId("reviewCount").textContent = `${fmt(items.length)} review candidates`;
  byId("reviewList").innerHTML =
    items
      .slice(0, 180)
      .map(item => `<button class="record-card" data-review-id="${item.crash_id}"><span class="record-id">${escapeHtml(item.crash_id)} / score ${safeValue(item.review_score)}</span><span class="record-story">${escapeHtml(item.story_label)}</span><span class="badge-row">${(item.flags || []).map(f => badge(titleCase(f.code), f.priority === "critical" ? "status-contradicts_cris" : "status-narrative_only")).join("")}</span><span class="record-text">${escapeHtml(item.safety_summary || item.public_safe_text)}</span></button>`)
      .join("") || emptyState("No matching review candidates.");
  document.querySelectorAll("[data-review-id]").forEach(btn => btn.addEventListener("click", () => showReviewDetail(btn.dataset.reviewId)));
  if (items[0]) showReviewDetail(items[0].crash_id);
}

async function showReviewDetail(crashId) {
  const record = await loadRecord(crashId);
  if (!record) return;
  byId("reviewDetails").innerHTML = `
    <div class="detail-heading"><div><div class="eyebrow">${escapeHtml(crashId)}</div><h2>${escapeHtml(record.story.label)}</h2></div></div>
    <div class="badge-row">${(record.review_flags || []).map(f => badge(f.label, `flag-${f.code}`)).join("")}</div>
    <div class="section-kicker">Why this needs review</div>
    ${renderReviewFlags(record.review_flags || [])}
    <div class="section-kicker">Causal clarity</div>
    ${renderCausalClarity(record)}
    <div class="section-kicker">Validation summary</div>
    <div class="dashboard-grid mini">${Object.entries(record.validation_summary || {}).map(([k, v]) => `<div class="dashboard-card"><div class="dashboard-value">${fmt(v)}</div><div class="dashboard-label">${escapeHtml(statusLabel(k))}</div></div>`).join("")}</div>
    <div class="section-kicker">Mental model</div>
    ${renderCrashMentalModel(record)}
  `;
}

function renderReviewFlags(flags) {
  return (
    flags
      .map(flag => `<div class="claim-card"><div class="claim-head"><strong>${escapeHtml(flag.label || titleCase(flag.code))}</strong>${badge(titleCase(flag.priority || "review"), flag.priority === "critical" ? "status-contradicts_cris" : "status-narrative_only")}</div><div class="claim-meta">${escapeHtml(titleCase(flag.code))}</div><div class="claim-reason">${escapeHtml(flag.reason || "")}</div>${flag.trigger_factors ? `<div class="badge-row">${flag.trigger_factors.map(f => badge(titleCase(f), "status-unknown")).join("")}</div>` : ""}</div>`)
      .join("") || emptyState("No review flags.")
  );
}

function renderCausalClarity(record) {
  const clarity = record.causal_clarity || {};
  return `<div class="dashboard-grid mini"><div class="dashboard-card"><div class="dashboard-value">${Math.round((clarity.score || 0) * 100)}</div><div class="dashboard-label">clarity score</div></div><div class="dashboard-card"><div class="dashboard-value">${clarity.is_explicit ? "yes" : "no"}</div><div class="dashboard-label">explicit sequence</div></div><div class="dashboard-card"><div class="dashboard-value">${(clarity.responsible_units || []).join(", ") || "none"}</div><div class="dashboard-label">responsible unit</div></div><div class="dashboard-card"><div class="dashboard-value">${(clarity.impact_actor_units || []).join(", ") || "none"}</div><div class="dashboard-label">impact actor</div></div></div><div class="claim-card"><div class="claim-head"><strong>${escapeHtml(clarity.reason || "No clarity rationale available")}</strong></div><div class="claim-evidence">${escapeHtml(clarity.evidence || "No single causal evidence span selected.")}</div></div>`;
}

function renderHeatmapTab(host) {
  host.innerHTML = `
    <section class="heatmap-layout">
      <section class="cooc-main scroll">
        <div class="section-header"><h2>Validated Factor Co-occurrence</h2><p>Pairs computed from accepted mental-model and narrative-added factors.</p></div>
        <div class="cooc-controls">
          <input class="search-input" id="coocSearch" type="text" placeholder="Search factors in the matrix">
          <select class="search-input" id="coocCategory"><option value="all">All categories</option></select>
          <select class="search-input" id="coocMetric">
            <option value="count">Count</option>
            <option value="support">Support %</option>
            <option value="lift">Lift</option>
            <option value="jaccard">Jaccard</option>
          </select>
          <select class="search-input" id="coocSort">
            <option value="cooccurrence">Sort: Strength</option>
            <option value="prevalence">Sort: Prevalence</option>
            <option value="category">Sort: Category</option>
            <option value="alphabetical">Sort: Alphabetical</option>
          </select>
          <select class="search-input" id="coocView">
            <option value="triangle">View: Triangle</option>
            <option value="full">View: Full Matrix</option>
          </select>
          <label class="cooc-slider">Factors <strong id="coocLimitValue"></strong><input id="coocLimit" type="range" min="8" max="36" step="1"></label>
          <label class="cooc-slider">Min count <strong id="coocMinValue"></strong><input id="coocMin" type="range" min="1" max="50000" step="1"></label>
        </div>
        <div class="cooc-summary" id="coocSummary"></div>
        <div class="hm-wrap" id="heatmapContainer"></div>
      </section>
      <aside class="cooc-side"><div id="heatmapDetails"></div><div class="section-kicker">Strongest pairs</div><div class="cooc-pair-list" id="coocTopPairs"></div></aside>
    </section>`;
  setupCoocControls();
  buildHeatmap();
}

function setupCoocControls() {
  const categories = Object.entries(DATA.aggregate_graph.stats.category_distribution || {})
    .filter(([, count]) => count)
    .map(([key]) => key);
  byId("coocCategory").innerHTML =
    `<option value="all">All categories</option>` +
    categories.map(key => `<option value="${escapeHtml(key)}">${escapeHtml(CAT_LABELS[key] || titleCase(key))}</option>`).join("");
  byId("coocSearch").value = coocState.query;
  byId("coocCategory").value = coocState.category;
  byId("coocMetric").value = coocState.metric;
  byId("coocSort").value = coocState.sortMode;
  byId("coocView").value = coocState.viewMode;
  byId("coocLimit").value = coocState.factorLimit;
  byId("coocMin").value = coocState.minCount;
  byId("coocSearch").addEventListener("input", e => {
    coocState.query = e.target.value;
    buildHeatmap();
  });
  byId("coocCategory").addEventListener("change", e => {
    coocState.category = e.target.value;
    buildHeatmap();
  });
  byId("coocMetric").addEventListener("change", e => {
    coocState.metric = e.target.value;
    buildHeatmap();
  });
  byId("coocSort").addEventListener("change", e => {
    coocState.sortMode = e.target.value;
    buildHeatmap();
  });
  byId("coocView").addEventListener("change", e => {
    coocState.viewMode = e.target.value;
    buildHeatmap();
  });
  byId("coocLimit").addEventListener("input", e => {
    coocState.factorLimit = Number(e.target.value);
    buildHeatmap();
  });
  byId("coocMin").addEventListener("input", e => {
    coocState.minCount = Number(e.target.value);
    buildHeatmap();
  });
}

function buildHeatmap() {
  const container = byId("heatmapContainer");
  container.innerHTML = "";
  const tip = document.createElement("div");
  tip.id = "coocTip";
  tip.className = "cooc-tip";
  tip.hidden = true;
  container.appendChild(tip);
  const cooc = DATA.cooccurrence_matrix || [];
  if (!cooc.length) {
    byId("heatmapDetails").innerHTML = emptyState("No co-occurring factor pairs were generated.");
    return;
  }
  const totalCrashes = DATA.meta.total_unique_crashes || 1;
  const nodeMeta = new Map(DATA.aggregate_graph.nodes.map(node => [node.id, node]));
  const maxCount = d3.max(cooc, d => d.count) || 1;
  const minSlider = byId("coocMin");
  if (minSlider) {
    minSlider.max = String(maxCount);
    minSlider.value = Math.min(coocState.minCount, maxCount);
    coocState.minCount = Number(minSlider.value);
  }
  byId("coocLimitValue").textContent = fmt(coocState.factorLimit);
  byId("coocMinValue").textContent = fmt(coocState.minCount);
  const enriched = cooc
    .map(pair => enrichCoocPair(pair, nodeMeta, totalCrashes))
    .filter(pair => {
      const query = coocState.query.trim().toLowerCase();
      if (pair.count < coocState.minCount) return false;
      if (coocState.category !== "all" && pair.category_a !== coocState.category && pair.category_b !== coocState.category) return false;
      if (query && ![pair.factor_a, pair.factor_b, pair.label_a, pair.label_b].join(" ").toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => metricValue(b) - metricValue(a));
  const factorLimit = CURRENT_DATASET === "pedestrian" ? 24 : 29;
  const pairFactorCounts = new Map();
  enriched.forEach(pair => {
    const value = Math.max(metricValue(pair), 0);
    pairFactorCounts.set(pair.factor_a, (pairFactorCounts.get(pair.factor_a) || 0) + value);
    pairFactorCounts.set(pair.factor_b, (pairFactorCounts.get(pair.factor_b) || 0) + value);
  });
  
  let topFactors = [...pairFactorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(coocState.factorLimit, Math.max(factorLimit, coocState.factorLimit)))
    .map(([factor]) => factor);

  if (coocState.sortMode === "prevalence") {
    topFactors.sort((a, b) => {
      const freqA = nodeMeta.get(a)?.frequency || 0;
      const freqB = nodeMeta.get(b)?.frequency || 0;
      return freqB - freqA;
    });
  } else if (coocState.sortMode === "category") {
    topFactors.sort((a, b) => {
      const catA = nodeMeta.get(a)?.category || "unknown";
      const catB = nodeMeta.get(b)?.category || "unknown";
      if (catA !== catB) return catA.localeCompare(catB);
      const labelA = nodeMeta.get(a)?.label || a;
      const labelB = nodeMeta.get(b)?.label || b;
      return labelA.localeCompare(labelB);
    });
  } else if (coocState.sortMode === "alphabetical") {
    topFactors.sort((a, b) => {
      const labelA = nodeMeta.get(a)?.label || a;
      const labelB = nodeMeta.get(b)?.label || b;
      return labelA.localeCompare(labelB);
    });
  }

  const factorSet = new Set(topFactors);
  const visiblePairs = enriched.filter(pair => factorSet.has(pair.factor_a) && factorSet.has(pair.factor_b));
  const topPairs = enriched.slice(0, 14);
  if (!visiblePairs.length || !topFactors.length) {
    byId("heatmapDetails").innerHTML = emptyState("No co-occurring pairs are available for the current factor set.");
    byId("coocTopPairs").innerHTML = "";
    byId("coocSummary").innerHTML = "";
    return;
  }
  const max = d3.max(visiblePairs, metricValue) || 1;
  const cell = topFactors.length > 28 ? 24 : topFactors.length > 22 ? 28 : 34;
  const margin = { top: 190, left: 290, right: 190, bottom: 60 };
  const W = margin.left + topFactors.length * cell + margin.right;
  const H = margin.top + topFactors.length * cell + margin.bottom;
  const key = (a, b) => [a, b].sort().join("|");
  const lookup = new Map(visiblePairs.map(pair => [key(pair.factor_a, pair.factor_b), pair]));
  const color = d3.scaleSequential(d3.interpolateYlGnBu).domain([0, max]);
  byId("coocSummary").innerHTML = [
    { value: enriched.length, label: "matching pairs" },
    { value: topFactors.length, label: "factors shown" },
    { value: metricDisplay(topPairs[0] || {}, coocState.metric), label: `top ${metricLabel(coocState.metric)}` },
    { value: `${topPairs[0]?.support_pct || 0}%`, label: "top support" },
  ]
    .map(item => `<div class="cooc-stat"><strong>${fmt(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`)
    .join("");
  byId("coocTopPairs").innerHTML = topPairs.map(pair => `<button class="cooc-pair ${selectedCoocKey === key(pair.factor_a, pair.factor_b) ? "active" : ""}" data-pair="${pair.factor_a}|${pair.factor_b}"><span>${escapeHtml(pair.label_a)} + ${escapeHtml(pair.label_b)}</span><strong>${escapeHtml(metricDisplay(pair, coocState.metric))}</strong></button>`).join("");
  document.querySelectorAll("[data-pair]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [a, b] = btn.dataset.pair.split("|");
      showCoocPair(a, b, visiblePairs);
    });
  });
  const svg = d3.select(container).append("svg").attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`).attr("class", "cooc-svg");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  g.append("rect")
    .attr("x", -margin.left + 4)
    .attr("y", -margin.top + 4)
    .attr("width", W - 8)
    .attr("height", H - 8)
    .attr("rx", 12)
    .attr("fill", "rgba(255,255,255,0.012)")
    .attr("stroke", "rgba(255,255,255,0.04)");
  topFactors.forEach((left, i) => {
    topFactors.forEach((right, j) => {
      const isDiagonal = i === j;
      const isUpper = i < j;
      if (coocState.viewMode === "triangle" && (isDiagonal || isUpper)) return;

      if (isDiagonal) {
        const meta = nodeMeta.get(left) || {};
        const count = meta.frequency || 0;
        const support = Math.round((count / Math.max(totalCrashes, 1)) * 1000) / 10;
        const dummyPair = {
          label: meta.label || titleCase(left),
          count: count,
          support_pct: support
        };
        const diagColor = d3.interpolateGreys(0.18 + 0.36 * (count / maxCount));

        g.append("rect")
          .attr("x", j * cell + 1)
          .attr("y", i * cell + 1)
          .attr("width", cell - 2)
          .attr("height", cell - 2)
          .attr("rx", 6)
          .attr("fill", diagColor)
          .attr("opacity", 0.72)
          .attr("stroke", "rgba(255,255,255,0.22)")
          .attr("stroke-dasharray", "2,2")
          .attr("data-pair-cell", `${left}|${left}`)
          .on("mouseenter", event => {
            showCoocTip(event, dummyPair, true);
            d3.selectAll(`.cooc-row-label[data-factor-row="${left}"]`).classed("highlighted", true);
            d3.selectAll(`.cooc-col-label[data-factor-col="${left}"]`).classed("highlighted", true);
            document.querySelectorAll("[data-pair-cell]").forEach(c => {
              const parts = c.getAttribute("data-pair-cell").split("|");
              c.classList.toggle("related", parts.includes(left));
            });
          })
          .on("mousemove", event => moveCoocTip(event))
          .on("mouseleave", () => {
            hideCoocTip();
            if (selectedCoocKey) {
              const [selectedA, selectedB] = selectedCoocKey.split("|");
              showCoocPair(selectedA, selectedB, visiblePairs, { soft: true });
            } else {
              document.querySelectorAll("[data-pair-cell]").forEach(c => c.classList.remove("related"));
            }
            d3.selectAll(".cooc-axis-label").classed("highlighted", false);
          });
      } else {
        const pair = lookup.get(key(left, right));
        if (!pair) return;
        const value = metricValue(pair);

        g.append("rect")
          .attr("x", j * cell + 1)
          .attr("y", i * cell + 1)
          .attr("width", cell - 2)
          .attr("height", cell - 2)
          .attr("rx", 6)
          .attr("fill", color(value))
          .attr("opacity", 0.56 + 0.42 * (value / max))
          .attr("stroke", isUpper ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)")
          .attr("data-pair-cell", `${left}|${right}`)
          .on("mouseenter", event => {
            showCoocPair(left, right, visiblePairs, { soft: true });
            showCoocTip(event, pair);
            d3.selectAll(`.cooc-row-label[data-factor-row="${left}"]`).classed("highlighted", true);
            d3.selectAll(`.cooc-col-label[data-factor-col="${right}"]`).classed("highlighted", true);
          })
          .on("mousemove", event => moveCoocTip(event))
          .on("mouseleave", () => {
            hideCoocTip();
            if (selectedCoocKey) {
              const [selectedA, selectedB] = selectedCoocKey.split("|");
              showCoocPair(selectedA, selectedB, visiblePairs, { soft: true });
            }
            d3.selectAll(".cooc-axis-label").classed("highlighted", false);
          })
          .on("click", () => showCoocPair(left, right, visiblePairs));
      }
    });
  });

  topFactors.forEach((factor, index) => {
    const label = nodeMeta.get(factor)?.label || titleCase(factor);
    const category = nodeMeta.get(factor)?.category || "unknown";

    g.append("text")
      .attr("x", -10)
      .attr("y", index * cell + cell / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("class", "cooc-axis-label cooc-row-label")
      .attr("fill", CAT_COLORS[category] || "#c9c5b8")
      .attr("data-factor-row", factor)
      .style("cursor", "pointer")
      .text(shortLabel(label, 30))
      .on("click", () => {
        byId("coocSearch").value = label;
        coocState.query = label;
        buildHeatmap();
      });

    g.append("text")
      .attr("x", index * cell + cell / 2)
      .attr("y", -12)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .attr("transform", `rotate(-48,${index * cell + cell / 2},-12)`)
      .attr("class", "cooc-axis-label cooc-col-label")
      .attr("fill", CAT_COLORS[category] || "#c9c5b8")
      .attr("data-factor-col", factor)
      .style("cursor", "pointer")
      .text(shortLabel(label, 30))
      .on("click", () => {
        byId("coocSearch").value = label;
        coocState.query = label;
        buildHeatmap();
      });
  });

  const selected = selectedCoocKey ? visiblePairs.find(pair => key(pair.factor_a, pair.factor_b) === selectedCoocKey) : null;
  const first = selected || visiblePairs[0];
  if (first) showCoocPair(first.factor_a, first.factor_b, visiblePairs);
}

function enrichCoocPair(pair, nodeMeta, totalCrashes) {
  const a = nodeMeta.get(pair.factor_a) || {};
  const b = nodeMeta.get(pair.factor_b) || {};
  const expected = ((a.frequency || 0) * (b.frequency || 0)) / Math.max(totalCrashes, 1);
  const union = (a.frequency || 0) + (b.frequency || 0) - pair.count;
  return {
    ...pair,
    label_a: a.label || titleCase(pair.factor_a),
    label_b: b.label || titleCase(pair.factor_b),
    category_a: a.category || "unknown",
    category_b: b.category || "unknown",
    frequency_a: a.frequency || 0,
    frequency_b: b.frequency || 0,
    support_pct: Math.round((pair.count / Math.max(totalCrashes, 1)) * 1000) / 10,
    lift: expected ? Math.round((pair.count / expected) * 100) / 100 : 0,
    jaccard: union ? Math.round((pair.count / union) * 1000) / 1000 : 0,
  };
}

function metricValue(pair) {
  if (coocState.metric === "support") return pair.support_pct || 0;
  if (coocState.metric === "lift") return pair.lift || 0;
  if (coocState.metric === "jaccard") return pair.jaccard || 0;
  return pair.count || 0;
}

function metricLabel(metric) {
  return { count: "count", support: "support", lift: "lift", jaccard: "Jaccard" }[metric] || "count";
}

function metricDisplay(pair, metric) {
  if (!pair) return "0";
  if (metric === "support") return `${pair.support_pct || 0}%`;
  if (metric === "lift") return `${pair.lift || 0}x`;
  if (metric === "jaccard") return String(pair.jaccard || 0);
  return fmt(pair.count || 0);
}

function showCoocTip(event, pair, isDiagonal = false) {
  const tip = byId("coocTip");
  if (!tip) return;
  tip.hidden = false;
  if (isDiagonal) {
    tip.innerHTML = `
      <strong>${escapeHtml(pair.label)}</strong>
      <span>Prevalence: ${fmt(pair.count)} crashes | ${pair.support_pct}% support</span>
    `;
  } else {
    tip.innerHTML = `
      <strong>${escapeHtml(pair.label_a)} + ${escapeHtml(pair.label_b)}</strong>
      <span>${fmt(pair.count)} crashes | ${pair.support_pct}% support | ${pair.lift}x lift</span>
    `;
  }
  moveCoocTip(event);
}

function moveCoocTip(event) {
  const tip = byId("coocTip");
  const container = byId("heatmapContainer");
  if (!tip || !container) return;
  const rect = container.getBoundingClientRect();
  tip.style.left = `${event.clientX - rect.left + container.scrollLeft + 14}px`;
  tip.style.top = `${event.clientY - rect.top + container.scrollTop + 14}px`;
}

function hideCoocTip() {
  const tip = byId("coocTip");
  if (tip) tip.hidden = true;
}

function showCoocPair(factorA, factorB, pairs = null, options = {}) {
  const pair = (pairs || (DATA.cooccurrence_matrix || []).map(p => enrichCoocPair(p, new Map(DATA.aggregate_graph.nodes.map(node => [node.id, node])), DATA.meta.total_unique_crashes || 1))).find(item => [item.factor_a, item.factor_b].sort().join("|") === [factorA, factorB].sort().join("|"));
  if (!pair) return;
  const key = [factorA, factorB].sort().join("|");
  if (!options.soft) selectedCoocKey = key;
  document.querySelectorAll("[data-pair-cell]").forEach(cell => {
    const parts = cell.getAttribute("data-pair-cell").split("|");
    const cellKey = parts.slice().sort().join("|");
    cell.classList.toggle("selected", cellKey === key);
    cell.classList.toggle("related", parts.includes(pair.factor_a) || parts.includes(pair.factor_b));
  });
  document.querySelectorAll("[data-pair]").forEach(btn => {
    const btnKey = btn.dataset.pair.split("|").sort().join("|");
    btn.classList.toggle("active", btnKey === key);
  });
  byId("heatmapDetails").innerHTML = `
    <div class="detail-title">Selected Pair</div>
    <div class="chain cooc-chain">
      <span class="chain-node" style="border-color:${CAT_COLORS[pair.category_a] || "var(--line)"}">${escapeHtml(pair.label_a)}</span>
      <span class="chain-arrow">+</span>
      <span class="chain-node" style="border-color:${CAT_COLORS[pair.category_b] || "var(--line)"}">${escapeHtml(pair.label_b)}</span>
    </div>
    <div class="cooc-metrics">
      <div><strong>${fmt(pair.count)}</strong><span>co-occurring crashes</span></div>
      <div><strong>${pair.support_pct}%</strong><span>support</span></div>
      <div><strong>${pair.lift}x</strong><span>lift over expected</span></div>
      <div><strong>${pair.jaccard}</strong><span>Jaccard</span></div>
    </div>
    <div class="section-kicker">Individual prevalence</div>
    <div class="metric-row"><span>${escapeHtml(pair.label_a)}</span><strong>${fmt(pair.frequency_a)}</strong></div>
    <div class="metric-row"><span>${escapeHtml(pair.label_b)}</span><strong>${fmt(pair.frequency_b)}</strong></div>
    <div class="section-kicker">Sample crashes</div>
    <div class="badge-row cooc-samples">${(pair.sample_crash_ids || []).slice(0, 8).map(id => `<button class="chip" data-cooc-record="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join("") || badge("no samples exported", "status-unknown")}</div>
  `;
  byId("heatmapDetails").querySelectorAll("[data-cooc-record]").forEach(btn => {
    btn.addEventListener("click", () => openRecordById(btn.dataset.coocRecord));
  });
}

async function renderCrashTab(host) {
  host.innerHTML = `
    <section class="crash-layout">
      <aside class="crash-list-col">
        <div class="section-header"><h2>Crash Browser</h2><p>CRIS-backed records with causal safety summaries and deidentified narratives.</p></div>
        <div class="filter-strip" id="activeStoryFilter"></div>
        <div class="case-toolbar mental-case-toolbar">
          <input type="text" class="search-input" id="caseQuery" placeholder="Search narratives, IDs, story labels, factors">
          <select class="search-input" id="caseYear"><option value="">All years</option></select>
          <select class="search-input" id="caseSeverity"><option value="">All severities</option></select>
          <select class="search-input" id="caseCity"><option value="">All cities</option></select>
        </div>
        <div class="mini-count" id="crashCount"></div>
        <div class="crash-grid" id="crashList"></div>
        <div class="pagination" id="casePagination"></div>
      </aside>
      <section class="crash-detail-col" id="crashDetails"></section>
    </section>`;
  populateCaseFilterOptions();
  byId("caseQuery").value = caseFilters.query;
  byId("caseQuery").addEventListener("input", e => {
    caseFilters.query = e.target.value;
    currentCasePage = 0;
    buildCrashList();
  });
  ["caseYear", "caseSeverity", "caseCity"].forEach(id => {
    byId(id).addEventListener("change", e => {
      const key = id.replace("case", "").toLowerCase();
      caseFilters[key] = e.target.value;
      currentCasePage = 0;
      buildCrashList();
    });
  });
  await buildCrashList();
}

function populateCaseFilterOptions() {
  fillSelect("caseYear", Object.keys(DATA.facets?.years || {}).sort(), caseFilters.year);
  fillSelect("caseSeverity", Object.keys(DATA.facets?.severity || {}).sort(), caseFilters.severity);
  fillSelect("caseCity", Object.keys(DATA.facets?.city || {}).sort(), caseFilters.city);
}

function fillSelect(id, values, selected) {
  const select = byId(id);
  const first = select.firstElementChild.outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

async function buildCrashList() {
  const buildSeq = ++crashListBuildSeq;
  const query = caseFilters.query || "";
  let records = await getFilteredIndex(query, activeStory);
  records = records.filter(record => {
    if (caseFilters.year && String(record.year) !== String(caseFilters.year)) return false;
    if (caseFilters.severity && String(record.severity) !== String(caseFilters.severity)) return false;
    if (caseFilters.city && String(record.city) !== String(caseFilters.city)) return false;
    return true;
  });
  currentCaseResults = records;
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  currentCasePage = Math.min(currentCasePage, totalPages - 1);
  const pageItems = records.slice(currentCasePage * PAGE_SIZE, currentCasePage * PAGE_SIZE + PAGE_SIZE);
  const cardMap = await cardsForRecords(pageItems);
  if (buildSeq !== crashListBuildSeq) return;
  byId("activeStoryFilter").innerHTML = activeStory ? `<span class="active-filter">Story: ${escapeHtml(DATA.story_archetypes.find(s => s.id === activeStory)?.label || activeStory)} <button id="clearStoryBtn">clear</button></span>` : "";
  byId("clearStoryBtn")?.addEventListener("click", () => {
    activeStory = null;
    buildCrashList();
  });
  const selectedInResults = selectedCrashId && records.some(record => record.crash_id === selectedCrashId);
  if (!records.length) {
    selectedCrashId = null;
    byId("crashDetails").innerHTML = emptyState("No crash record matches the current filters.");
  } else if (!selectedInResults) {
    selectedCrashId = pageItems[0]?.crash_id || records[0].crash_id;
  }
  byId("crashCount").textContent = `${fmt(records.length)} crashes`;
  byId("crashList").innerHTML = pageItems.map(item => crashCard(cardMap.get(item.crash_id) || item)).join("") || emptyState("No matching crash records.");
  byId("casePagination").innerHTML = `<button class="secondary-btn" id="prevPage" ${currentCasePage === 0 ? "disabled" : ""}>Previous</button><span class="bar-value">Page ${fmt(currentCasePage + 1)} of ${fmt(totalPages)}</span><button class="secondary-btn" id="nextPage" ${currentCasePage >= totalPages - 1 ? "disabled" : ""}>Next</button>`;
  byId("prevPage").addEventListener("click", () => {
    currentCasePage -= 1;
    buildCrashList();
  });
  byId("nextPage").addEventListener("click", () => {
    currentCasePage += 1;
    buildCrashList();
  });
  document.querySelectorAll("[data-case-id]").forEach(btn => btn.addEventListener("click", () => showCrashDetail(btn.dataset.caseId)));
  if (selectedCrashId && !byId("crashDetails").innerHTML.trim()) {
    const record = await loadRecord(selectedCrashId);
    if (buildSeq !== crashListBuildSeq) return;
    if (record) showCrashDetailRecord(record);
  } else if (selectedCrashId && pageItems.some(item => item.crash_id === selectedCrashId)) {
    const record = await loadRecord(selectedCrashId);
    if (buildSeq !== crashListBuildSeq) return;
    if (record) showCrashDetailRecord(record);
  }
}

function crashCard(record) {
  return `<button class="crash-card ${selectedCrashId === record.crash_id ? "active" : ""}" data-case-id="${escapeHtml(record.crash_id)}"><span class="record-id">${escapeHtml(record.crash_id)}</span><span class="record-story">${escapeHtml(record.story_label || record.story?.label || "")}</span><span class="record-text">${escapeHtml((record.snippet || record.safety_summary || "").slice(0, 190))}</span><span class="badge-row">${(record.factor_labels || record.factors || []).slice(0, 4).map(f => badge(titleCase(f), "status-unknown")).join("")}</span></button>`;
}

async function showCrashDetail(crashId) {
  selectedCrashId = crashId;
  const record = await loadRecord(crashId);
  if (!record) return;
  showCrashDetailRecord(record);
}

function showCrashDetailRecord(record) {
  selectedCrashId = record.crash_id;
  byId("crashDetails").innerHTML = renderCrashDetail(record);
  document.querySelectorAll("[data-case-id]").forEach(btn => btn.classList.toggle("active", btn.dataset.caseId === record.crash_id));
}

function renderCrashDetail(record) {
  return `
    <div class="detail-heading"><div><div class="eyebrow">Crash ${escapeHtml(record.crash_id)}</div><h2>${escapeHtml(record.story?.label || "Crash record")}</h2></div><div class="confidence">${Math.round((record.story?.confidence || record.causal_clarity?.score || 0) * 100)}%</div></div>
    <div class="badge-row">${badge("deidentified narrative", "status-unknown")}${(record.review_flags || []).map(f => badge(f.label, `flag-${f.code}`)).join("")}</div>
    <div class="section-kicker">Causal safety summary</div>${renderSafetySummary(record)}
    <div class="section-kicker">CRIS context</div><div class="context-grid">${renderContext(record.cris_context || {})}</div>
    <div class="section-kicker">Actors</div><div class="actor-strip">${(record.actors || []).map(actor => `<div class="actor-mini"><strong>Unit ${safeValue(actor.unit_number)}</strong><span>${escapeHtml(titleCase(actor.road_user_role || actor.role))}</span><span>${escapeHtml(actor.mode || actor.type || "unknown")}</span><span>${escapeHtml(actor.causal_role || "uncertain")}</span></div>`).join("")}</div>
    <div class="section-kicker">Validated factors</div><div class="badge-row">${(record.factors || []).map(factorBadge).join("") || badge("no accepted narrative factors", "status-unknown")}</div>
    <div class="section-kicker">Claims and evidence</div>${renderClaims((record.claims || []).slice(0, 18))}
    <div class="section-kicker">Deidentified narrative</div><div class="narr-text">${escapeHtml(redactedNarrative(record))}</div>
  `;
}

function renderSafetySummary(record) {
  const summary = record.safety_summary || {};
  const chain = summary.chain || [];
  return `<div class="safety-summary"><div class="summary-head"><strong>${escapeHtml(summary.headline || record.story?.label || "Safety summary")}</strong>${badge(`clarity ${Math.round((summary.clarity_score || record.causal_clarity?.score || 0) * 100)}`, summary.is_explicit ? "status-confirmed_by_cris" : "status-narrative_only")}</div><div class="summary-text">${escapeHtml(summary.text || safetyText(record))}</div><div class="summary-chain">${chain.map(step => `<div class="summary-step"><span>${escapeHtml(titleCase(step.stage))}</span><strong>${escapeHtml(step.text)}</strong></div>`).join("")}</div>${summary.evidence_span ? `<div class="claim-evidence">${escapeHtml(summary.evidence_span)}</div>` : ""}</div>`;
}

function renderClaims(claims) {
  return (
    claims
      .map(claim => `<div class="claim-card ${claim.suppressed_from_graph ? "suppressed" : ""}"><div class="claim-head"><strong>${escapeHtml(claim.label || titleCase(claim.factor))}</strong>${statusBadge(claim.validation_status)}</div><div class="claim-meta">Unit ${safeValue(claim.actor_unit)} / ${escapeHtml(claim.source_agent || "agent")} / confidence ${Math.round((claim.confidence || 0) * 100)}%</div><div class="claim-evidence">${escapeHtml(claim.evidence?.text_span || "")}</div><div class="claim-reason">${escapeHtml(claim.validation_reason || "")}</div></div>`)
      .join("") || emptyState("No extracted claims.")
  );
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function toast(text) {
  const el = byId("toast");
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 2400);
}

let entropyAnimationId = null;

function startEntropySimulation() {
  const container = document.querySelector(".intro-visual");
  if (!container) return;

  let canvas = byId("introEntropyCanvas");
  if (!canvas) return;

  if (entropyAnimationId) {
    cancelAnimationFrame(entropyAnimationId);
  }

  const size = 520;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const particleColor = "#ffffff";

  class Particle {
    constructor(x, y, order) {
      this.x = x;
      this.y = y;
      this.originalX = x;
      this.originalY = y;
      this.size = 2;
      this.order = order;
      this.velocity = {
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2
      };
      this.influence = 0;
      this.neighbors = [];
    }

    update() {
      if (this.order) {
        const dx = this.originalX - this.x;
        const dy = this.originalY - this.y;

        const chaosInfluence = { x: 0, y: 0 };
        this.neighbors.forEach(neighbor => {
          if (!neighbor.order) {
            const distance = Math.hypot(this.x - neighbor.x, this.y - neighbor.y);
            const strength = Math.max(0, 1 - distance / 100);
            chaosInfluence.x += neighbor.velocity.x * strength;
            chaosInfluence.y += neighbor.velocity.y * strength;
            this.influence = Math.max(this.influence, strength);
          }
        });

        this.x += dx * 0.05 * (1 - this.influence) + chaosInfluence.x * this.influence;
        this.y += dy * 0.05 * (1 - this.influence) + chaosInfluence.y * this.influence;
        this.influence *= 0.99;
      } else {
        this.velocity.x += (Math.random() - 0.5) * 0.5;
        this.velocity.y += (Math.random() - 0.5) * 0.5;
        this.velocity.x *= 0.95;
        this.velocity.y *= 0.95;
        this.x += this.velocity.x;
        this.y += this.velocity.y;

        if (this.x < size / 2 || this.x > size) this.velocity.x *= -1;
        if (this.y < 0 || this.y > size) this.velocity.y *= -1;
        this.x = Math.max(size / 2, Math.min(size, this.x));
        this.y = Math.max(0, Math.min(size, this.y));
      }
    }

    draw(c) {
      const alpha = this.order ? 0.8 - this.influence * 0.5 : 0.8;
      c.fillStyle = `${particleColor}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
      c.beginPath();
      c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      c.fill();
    }
  }

  const particles = [];
  const gridSize = 25;
  const spacing = size / gridSize;

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = spacing * i + spacing / 2;
      const y = spacing * j + spacing / 2;
      const order = x < size / 2;
      particles.push(new Particle(x, y, order));
    }
  }

  function updateNeighbors() {
    particles.forEach(p => {
      p.neighbors = particles.filter(other => {
        if (other === p) return false;
        const distance = Math.hypot(p.x - other.x, p.y - other.y);
        return distance < 100;
      });
    });
  }

  let time = 0;

  function animate() {
    ctx.clearRect(0, 0, size, size);

    if (time % 30 === 0) {
      updateNeighbors();
    }

    particles.forEach(p => {
      p.update();
      p.draw(ctx);

      p.neighbors.forEach(neighbor => {
        const distance = Math.hypot(p.x - neighbor.x, p.y - neighbor.y);
        if (distance < 50) {
          const alpha = 0.2 * (1 - distance / 50);
          ctx.strokeStyle = `${particleColor}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(neighbor.x, neighbor.y);
          ctx.stroke();
        }
      });
    });

    ctx.strokeStyle = `${particleColor}4D`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();

    time++;
    entropyAnimationId = requestAnimationFrame(animate);
  }

  animate();
}

function stopEntropySimulation() {
  if (entropyAnimationId) {
    cancelAnimationFrame(entropyAnimationId);
    entropyAnimationId = null;
  }
}
