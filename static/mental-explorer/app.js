const CAT_COLORS = {
  human_behavior: '#5eead4',
  infrastructure: '#fbbf24',
  environment: '#60a5fa',
  vehicle_context: '#c084fc',
  post_crash: '#fb7185',
  outcome: '#f87171',
  evidence_source: '#a3e635'
};

const CAT_LABELS = {
  human_behavior: 'Human Behavior',
  infrastructure: 'Infrastructure',
  environment: 'Environment',
  vehicle_context: 'Vehicle / Device',
  post_crash: 'Post-crash',
  outcome: 'Outcome',
  evidence_source: 'Evidence Source'
};

const STATUS_LABELS = {
  confirmed_by_cris: 'Confirmed by CRIS',
  narrative_only: 'Narrative-only',
  contradicts_cris: 'Contradicts CRIS',
  duplicate_of_cris: 'Duplicate of CRIS',
  unknown: 'Unknown'
};

let DATA = null;
let simulation = null;
let svgG = null;
let zoomBehavior = null;
let activeFilters = new Set();
let activeStory = null;
let selectedCrashId = null;
let _nodes = [];
let _links = [];
let _nodeG = null;
let _linkG = null;
let selectedCoocKey = null;

const params = new URLSearchParams(location.search);
const publicMode = params.get('public') === '1' || params.get('privacy') === 'public';
const dataFile = publicMode ? 'causal_graph_public.json' : 'causal_graph_data.json';
const jsonPath = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? `../${dataFile}`
  : dataFile;

fetch(jsonPath)
  .then(r => {
    if (r.ok) return r.json();
    return fetch(dataFile).then(rr => rr.json());
  })
  .then(d => {
    DATA = d;
    init();
  })
  .catch(error => {
    document.body.innerHTML = `<p class="load-error">Error loading data: ${escapeHtml(error.message)}</p>`;
  });

function init() {
  renderStats();
  setupTabs();
  buildGraph();
  buildLegend();
  buildFilters();
  buildMentalModel();
  buildStories();
  buildValidation();
  buildReviewQueue();
  buildHeatmap();
  buildCrashList();

  byId('crashSearch').addEventListener('input', () => buildCrashList());
  byId('mentalSearch').addEventListener('input', () => buildMentalModel());
  byId('reviewSearch').addEventListener('input', () => buildReviewQueue());

  const first = DATA.crash_records[0];
  if (first) {
    showMentalDetails(first.crash_id);
    showCrashDetail(first.crash_id);
  }
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function titleCase(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\w\S*/g, s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

function safeValue(value) {
  if (value === null || value === undefined || value === '') return '<span class="muted">not available</span>';
  return escapeHtml(value);
}

function statusLabel(status) {
  return STATUS_LABELS[status] || titleCase(status || 'unknown');
}

function badge(text, cls = '') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function factorBadge(factor) {
  const cls = `badge-${factor.category || 'human_behavior'}`;
  const status = factor.validation_status ? ` / ${statusLabel(factor.validation_status)}` : '';
  return `<span class="badge ${cls}" title="${escapeHtml(statusLabel(factor.validation_status))}">${escapeHtml(factor.label || titleCase(factor.factor))}${escapeHtml(status)}</span>`;
}

function statusBadge(status) {
  return badge(statusLabel(status), `status-${status || 'unknown'}`);
}

function renderStats() {
  const s = DATA.aggregate_graph.stats;
  const privacyTier = DATA.meta?.privacy?.export_tier === 'public_safe_demo' ? 'Public-safe' : 'Internal';
  byId('headerStats').innerHTML = [
    `<div class="stat-pill"><span class="sv">${DATA.meta.total_unique_crashes}</span>Crashes</div>`,
    `<div class="stat-pill"><span class="sv">${s.total_unique_factors}</span>Factors</div>`,
    `<div class="stat-pill"><span class="sv">${DATA.story_archetypes.length}</span>Stories</div>`,
    `<div class="stat-pill"><span class="sv">${DATA.validation_overview.contradiction_count}</span>Contradictions</div>`,
    `<div class="stat-pill"><span class="sv">${DATA.review_queue.length}</span>Review</div>`,
    `<div class="stat-pill"><span class="sv">${privacyTier}</span>Privacy</div>`
  ].join('');
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(panel => panel.classList.toggle('active', panel.dataset.tab === tab));
  if (tab === 'graph' && simulation) simulation.alpha(0.1).restart();
}

function openPanel(id) {
  byId(id).classList.add('open');
}

function closePanel(id) {
  byId(id).classList.remove('open');
}

function buildGraph() {
  const canvas = byId('graphCanvas');
  const W = canvas.clientWidth || 1200;
  const H = canvas.clientHeight || 760;
  const svg = d3.select('#graphSvg');
  svg.selectAll('*').remove();
  svg.attr('width', W).attr('height', H);

  _nodes = DATA.aggregate_graph.nodes.map(d => ({ ...d }));
  _links = DATA.aggregate_graph.edges
    .filter(e => e.type === 'validated_sequence' && e.weight >= 2)
    .map(e => ({ source: e.source, target: e.target, weight: e.weight, crash_ids: e.crash_ids }));

  const nodeIds = new Set(_nodes.map(n => n.id));
  _links = _links.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  const rScale = d3.scaleSqrt().domain([1, d3.max(_nodes, d => d.frequency) || 1]).range([9, 44]);
  const wScale = d3.scaleLinear().domain([1, d3.max(_links, d => d.weight) || 1]).range([0.7, 5.5]);

  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  svgG = svg.append('g');
  zoomBehavior = d3.zoom().scaleExtent([0.2, 6]).on('zoom', e => svgG.attr('transform', e.transform));
  svg.call(zoomBehavior);

  _linkG = svgG.append('g').selectAll('line').data(_links).enter().append('line')
    .attr('stroke', d => {
      const src = _nodes.find(n => n.id === d.source);
      return src ? CAT_COLORS[src.category] || '#334155' : '#334155';
    })
    .attr('stroke-opacity', 0.18)
    .attr('stroke-width', d => wScale(d.weight));

  _nodeG = svgG.append('g').selectAll('g').data(_nodes).enter().append('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (e, d) => {
        if (!e.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on('end', (e, d) => {
        if (!e.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
    );

  _nodeG.append('circle')
    .attr('r', d => rScale(d.frequency) + 7)
    .attr('fill', d => CAT_COLORS[d.category] || '#64748b')
    .attr('opacity', 0.08)
    .attr('filter', 'url(#glow)');

  _nodeG.append('circle')
    .attr('r', d => rScale(d.frequency))
    .attr('fill', d => CAT_COLORS[d.category] || '#64748b')
    .attr('stroke', '#f8fafc')
    .attr('stroke-width', 0.7)
    .attr('stroke-opacity', 0.32);

  _nodeG.filter(d => d.frequency >= 20).append('text')
    .text(d => d.label)
    .attr('text-anchor', 'middle')
    .attr('dy', d => rScale(d.frequency) + 16)
    .attr('fill', '#a8b3c7')
    .attr('font-size', '11px')
    .attr('font-weight', '650');

  const tt = byId('tooltip');
  _nodeG.on('mouseover', (e, d) => {
    tt.innerHTML = `<div class="tt-title">${escapeHtml(d.label)}</div>
      <div class="tt-cat">${escapeHtml(d.category_label)}</div>
      <div class="tt-stat">${d.frequency} crashes (${d.percentage}%)</div>`;
    tt.classList.add('visible');
  }).on('mousemove', e => {
    tt.style.left = `${e.pageX + 18}px`;
    tt.style.top = `${e.pageY - 12}px`;
  }).on('mouseout', () => tt.classList.remove('visible'));

  _nodeG.on('click', (e, d) => {
    showNodeDetails(d);
    openPanel('graphDetailPanel');
  });

  simulation = d3.forceSimulation(_nodes)
    .force('link', d3.forceLink(_links).id(d => d.id).distance(110).strength(0.24))
    .force('charge', d3.forceManyBody().strength(d => -rScale(d.frequency) * 16))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(d => rScale(d.frequency) + 14))
    .force('x', d3.forceX(W / 2).strength(0.025))
    .force('y', d3.forceY(H / 2).strength(0.025))
    .on('tick', () => {
      _linkG.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      _nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

function showNodeDetails(node) {
  const connected = _links.filter(edge => {
    const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
    return source === node.id || target === node.id;
  }).sort((a, b) => b.weight - a.weight);
  const related = DATA.crash_records.filter(r => r.factors.some(f => f.factor === node.id)).slice(0, 8);

  byId('nodeDetails').innerHTML = `
    <div class="detail-title" style="color:${CAT_COLORS[node.category] || '#f8fafc'}">${escapeHtml(node.label)}</div>
    <div class="muted">${escapeHtml(node.category_label)}</div>
    <div class="stat-row">
      <div class="stat-box"><div class="sb-val">${node.frequency}</div><div class="sb-label">crashes</div></div>
      <div class="stat-box"><div class="sb-val">${node.percentage}%</div><div class="sb-label">sample</div></div>
      <div class="stat-box"><div class="sb-val">${connected.length}</div><div class="sb-label">links</div></div>
    </div>
    <div class="section-kicker">Validation mix</div>
    <div class="badge-row">${Object.entries(node.validation_status_counts || {}).map(([k, v]) => badge(`${statusLabel(k)}: ${v}`, `status-${k}`)).join('')}</div>
    <div class="section-kicker">Connected factors</div>
    ${connected.slice(0, 10).map(edge => {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;
      const otherId = source === node.id ? target : source;
      const other = _nodes.find(n => n.id === otherId);
      return `<div class="card compact-card">
        <div class="card-title">${source === node.id ? 'to' : 'from'} ${escapeHtml(other ? other.label : titleCase(otherId))}</div>
        <div class="card-sub">weight ${edge.weight}</div>
      </div>`;
    }).join('') || emptyState('No connected validated factors above the display threshold.')}
    <div class="section-kicker">Example crashes</div>
    ${related.map(r => miniCrashCard(r)).join('') || emptyState('No example records.')}
  `;
}

function buildLegend() {
  byId('legend').innerHTML = `<div class="leg-title">Factor categories</div>` +
    Object.entries(CAT_LABELS).map(([key, label]) => `
      <div class="leg-item"><div class="leg-dot" style="background:${CAT_COLORS[key]}"></div>${escapeHtml(label)}</div>
    `).join('');
}

function buildFilters() {
  byId('filterBar').innerHTML = Object.entries(CAT_LABELS).map(([key, label]) =>
    `<button class="chip" data-cat="${key}" onclick="toggleFilter('${key}', this)">${escapeHtml(label)}</button>`
  ).join('');
}

function toggleFilter(cat, element) {
  if (activeFilters.has(cat)) {
    activeFilters.delete(cat);
    element.classList.remove('active');
  } else {
    activeFilters.add(cat);
    element.classList.add('active');
  }

  if (!_nodeG || !_linkG) return;
  if (activeFilters.size === 0) {
    _nodeG.attr('opacity', 1);
    _linkG.attr('opacity', 0.18);
  } else {
    _nodeG.attr('opacity', d => activeFilters.has(d.category) ? 1 : 0.08);
    _linkG.attr('opacity', d => {
      const source = typeof d.source === 'object' ? d.source : _nodes.find(n => n.id === d.source);
      const target = typeof d.target === 'object' ? d.target : _nodes.find(n => n.id === d.target);
      return (source && activeFilters.has(source.category)) || (target && activeFilters.has(target.category)) ? 0.35 : 0.025;
    });
  }
}

function zoomIn() {
  d3.select('#graphSvg').transition().duration(250).call(zoomBehavior.scaleBy, 1.35);
}

function zoomOut() {
  d3.select('#graphSvg').transition().duration(250).call(zoomBehavior.scaleBy, 0.74);
}

function resetZoom() {
  d3.select('#graphSvg').transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
}

function recordSearchText(record) {
  return [
    record.crash_id,
    record.narrative,
    record.public_safe_text,
    record.story?.label,
    record.story?.id,
    ...record.factors.map(f => f.factor),
    ...record.review_flags.map(f => f.code)
  ].join(' ').toLowerCase();
}

function filterRecords(query, storyId = null) {
  const q = (query || '').trim().toLowerCase();
  return DATA.crash_records.filter(record => {
    if (storyId && record.story.id !== storyId) return false;
    if (!q) return true;
    return recordSearchText(record).includes(q);
  });
}

function buildMentalModel() {
  const query = byId('mentalSearch')?.value || '';
  const records = filterRecords(query);
  byId('mentalCount').textContent = `${records.length} crashes`;
  byId('mentalList').innerHTML = records.slice(0, 120).map(record => `
    <button class="record-card ${selectedCrashId === record.crash_id ? 'active' : ''}" onclick="showMentalDetails('${record.crash_id}')">
      <span class="record-id">${escapeHtml(record.crash_id)}</span>
      <span class="record-story">${escapeHtml(record.story.label)}</span>
      <span class="record-text">${escapeHtml(record.public_safe_text.slice(0, 150))}</span>
    </button>
  `).join('') || emptyState('No matching records.');
}

function showMentalDetails(crashId) {
  selectedCrashId = crashId;
  const record = DATA.crash_records.find(r => r.crash_id === crashId);
  if (!record) return;
  byId('mentalDetails').innerHTML = renderCrashMentalModel(record);
  buildMentalModel();
}

function renderCrashMentalModel(record) {
  return `
    <div class="detail-heading">
      <div>
        <div class="eyebrow">${escapeHtml(record.crash_id)}</div>
        <h2>${escapeHtml(record.story.label)}</h2>
      </div>
      <div class="confidence">${Math.round((record.story.confidence || 0) * 100)}%</div>
    </div>
    <div class="context-grid">${renderContext(record.cris_context)}</div>
    <div class="actor-grid">
      ${record.actors.map(actor => renderActorMentalCard(record, actor)).join('')}
    </div>
    <div class="section-kicker">Accepted evidence</div>
    ${renderClaims(record.claims.filter(c => !c.suppressed_from_graph).slice(0, 12))}
  `;
}

function renderActorMentalCard(record, actor) {
  const model = record.mental_models[actor.actor_id] || {};
  const timeline = record.timeline[actor.actor_id] || { pre_crash: [], during_crash: [], post_crash: [] };
  return `
    <article class="actor-card">
      <div class="actor-head">
        <div>
          <h3>Unit ${safeValue(actor.unit_number)}</h3>
          <div class="muted">${escapeHtml(titleCase(actor.road_user_role))} / ${escapeHtml(actor.mode || 'unknown')}</div>
        </div>
        ${badge(titleCase(model.causal_role || actor.causal_role || 'uncertain'), `role-${model.causal_role || actor.causal_role || 'uncertain'}`)}
      </div>
      <div class="model-grid">
        <div><span>Attention</span><strong>${safeValue(model.attention_state)}</strong></div>
        <div><span>Rule compliance</span><strong>${safeValue(model.rule_compliance)}</strong></div>
        <div><span>Perception gap</span><strong>${safeValue(model.perception_gap)}</strong></div>
        <div><span>Post-crash</span><strong>${safeValue(model.post_crash_behavior)}</strong></div>
      </div>
      <div class="badge-row">${(model.failure_modes || []).map(f => badge(titleCase(f), 'badge-human_behavior')).join('') || badge('no explicit failure mode', 'status-unknown')}</div>
      <div class="timeline-grid">
        ${renderTimelineColumn('Before', timeline.pre_crash)}
        ${renderTimelineColumn('During', timeline.during_crash)}
        ${renderTimelineColumn('After', timeline.post_crash)}
      </div>
    </article>
  `;
}

function renderTimelineColumn(label, items) {
  return `<div class="timeline-col">
    <div class="timeline-title">${escapeHtml(label)}</div>
    ${items.length ? items.slice(0, 4).map(item => `
      <div class="timeline-item">
        <strong>${escapeHtml(item.action)}</strong>
        <span>${escapeHtml(item.evidence)}</span>
      </div>
    `).join('') : '<div class="timeline-empty">not described</div>'}
  </div>`;
}

function renderContext(context) {
  const fields = [
    ['Year', context.year],
    ['Severity', context.severity],
    ['Weather', context.weather],
    ['Lighting', context.lighting],
    ['Intersection', context.intersection_relation],
    ['Traffic control', context.traffic_control],
    ['Surface', context.surface],
    ['Collision', context.first_harmful_event_collision]
  ];
  return fields.map(([label, value]) => `<div class="context-cell"><span>${escapeHtml(label)}</span><strong>${safeValue(value)}</strong></div>`).join('');
}

function buildStories() {
  byId('storyGrid').innerHTML = DATA.story_archetypes.map(story => `
    <article class="story-card ${activeStory === story.id ? 'active' : ''}" onclick="showStoryDetail('${story.id}')">
      <div class="story-topline">
        <span class="story-count">${story.frequency}</span>
        <span class="story-pct">${story.percentage}%</span>
      </div>
      <h3>${escapeHtml(story.label)}</h3>
      <div class="story-id">${escapeHtml(story.id)}</div>
      <div class="condition-list">
        ${story.top_conditions.slice(0, 4).map(c => `<span>${escapeHtml(c.condition)} (${c.percentage}%)</span>`).join('')}
      </div>
    </article>
  `).join('');
  const first = DATA.story_archetypes[0];
  if (first && !byId('storyDetails').innerHTML) showStoryDetail(first.id);
}

function showStoryDetail(storyId) {
  const story = DATA.story_archetypes.find(s => s.id === storyId);
  if (!story) return;
  byId('storyDetails').innerHTML = `
    <div class="detail-title">${escapeHtml(story.label)}</div>
    <div class="muted">${story.frequency} crashes / ${story.percentage}% of sample</div>
    <button class="primary-btn" onclick="setStoryFilter('${story.id}')">Filter crash browser</button>
    <div class="section-kicker">Top CRIS conditions</div>
    ${story.top_conditions.map(c => `
      <div class="metric-row">
        <span>${escapeHtml(c.condition)}</span>
        <strong>${c.count} / ${c.percentage}%</strong>
      </div>
    `).join('')}
    <div class="section-kicker">Representative cases</div>
    ${story.representative_crashes.map(item => `
      <button class="record-card" onclick="showCrashDetail('${item.crash_id}'); switchTab('crashes')">
        <span class="record-id">${escapeHtml(item.crash_id)}</span>
        <span class="record-text">${escapeHtml(item.public_safe_text)}</span>
      </button>
    `).join('')}
  `;
}

function setStoryFilter(storyId) {
  activeStory = storyId;
  buildStories();
  buildCrashList();
  switchTab('crashes');
}

function clearStoryFilter() {
  activeStory = null;
  buildStories();
  buildCrashList();
}

function buildValidation() {
  const counts = DATA.validation_overview.status_counts;
  byId('validationDashboard').innerHTML = Object.entries(STATUS_LABELS).filter(([key]) => counts[key]).map(([status, label]) => `
    <div class="dashboard-card">
      <div class="dashboard-value">${counts[status]}</div>
      <div class="dashboard-label">${escapeHtml(label)}</div>
      <div class="badge-row">${(DATA.validation_overview.top_factors_by_status[status] || []).slice(0, 3).map(f => badge(`${titleCase(f.factor)}: ${f.count}`, `status-${status}`)).join('')}</div>
    </div>
  `).join('');

  byId('contradictionList').innerHTML = DATA.validation_overview.contradictions.slice(0, 80).map(item => `
    <button class="record-card" onclick="showCrashDetail('${item.crash_id}'); switchTab('crashes')">
      <span class="record-id">${escapeHtml(item.crash_id)} / ${escapeHtml(titleCase(item.factor))}</span>
      <span class="record-story">${escapeHtml(item.reason)}</span>
      <span class="record-text">${escapeHtml(item.evidence)}</span>
    </button>
  `).join('') || emptyState('No contradictions detected.');

  byId('suppressedList').innerHTML = `
    <div class="detail-title">Suppressed duplicate claims</div>
    <div class="muted">${DATA.validation_overview.suppressed_count} claims removed from the graph because CRIS already carries them.</div>
    <div class="section-kicker">Examples</div>
    ${DATA.validation_overview.suppressed_claims.slice(0, 40).map(item => `
      <div class="card compact-card">
        <div class="card-title">${escapeHtml(item.crash_id)} / ${escapeHtml(titleCase(item.factor))}</div>
        <div class="card-sub">${escapeHtml(item.reason)}</div>
      </div>
    `).join('')}
  `;
}

function buildReviewQueue() {
  const query = (byId('reviewSearch')?.value || '').trim().toLowerCase();
  const items = DATA.review_queue.filter(item => {
    if (!query) return true;
    return [
      item.crash_id,
      item.story_label,
      item.public_safe_text,
      ...item.flags.map(f => `${f.code} ${f.label}`)
    ].join(' ').toLowerCase().includes(query);
  });
  byId('reviewCount').textContent = `${items.length} review candidates`;
  byId('reviewList').innerHTML = items.slice(0, 140).map(item => `
    <button class="record-card" onclick="showReviewDetail('${item.crash_id}')">
      <span class="record-id">${escapeHtml(item.crash_id)} / score ${safeValue(item.review_score)}</span>
      <span class="record-story">${escapeHtml(item.story_label)}</span>
      <span class="badge-row">${item.flags.map(f => badge(titleCase(f.code), f.priority === 'critical' ? 'status-contradicts_cris' : 'status-narrative_only')).join('')}</span>
      <span class="record-text">${escapeHtml(item.public_safe_text)}</span>
    </button>
  `).join('') || emptyState('No matching review candidates.');
  if (items[0] && !byId('reviewDetails').innerHTML) showReviewDetail(items[0].crash_id);
}

function renderReviewFlags(flags) {
  return flags.map(flag => `
    <div class="claim-card">
      <div class="claim-head">
        <strong>${escapeHtml(flag.label || titleCase(flag.code))}</strong>
        ${badge(titleCase(flag.priority || 'review'), flag.priority === 'critical' ? 'status-contradicts_cris' : 'status-narrative_only')}
      </div>
      <div class="claim-meta">${escapeHtml(titleCase(flag.code))}</div>
      <div class="claim-reason">${escapeHtml(flag.reason || '')}</div>
      ${flag.trigger_factors ? `<div class="badge-row">${flag.trigger_factors.map(f => badge(titleCase(f), 'status-unknown')).join('')}</div>` : ''}
    </div>
  `).join('') || emptyState('No review flags.');
}

function renderCausalClarity(record) {
  const clarity = record.causal_clarity || {};
  return `
    <div class="dashboard-grid mini">
      <div class="dashboard-card"><div class="dashboard-value">${Math.round((clarity.score || 0) * 100)}</div><div class="dashboard-label">clarity score</div></div>
      <div class="dashboard-card"><div class="dashboard-value">${clarity.is_explicit ? 'yes' : 'no'}</div><div class="dashboard-label">explicit sequence</div></div>
      <div class="dashboard-card"><div class="dashboard-value">${(clarity.responsible_units || []).join(', ') || 'none'}</div><div class="dashboard-label">responsible unit</div></div>
      <div class="dashboard-card"><div class="dashboard-value">${(clarity.impact_actor_units || []).join(', ') || 'none'}</div><div class="dashboard-label">impact actor</div></div>
    </div>
    <div class="claim-card">
      <div class="claim-head"><strong>${escapeHtml(clarity.reason || 'No clarity rationale available')}</strong></div>
      <div class="claim-evidence">${escapeHtml(clarity.evidence || 'No single causal evidence span selected.')}</div>
    </div>
  `;
}

function showReviewDetail(crashId) {
  const record = DATA.crash_records.find(r => r.crash_id === crashId);
  if (!record) return;
  byId('reviewDetails').innerHTML = `
    <div class="detail-heading">
      <div>
        <div class="eyebrow">${escapeHtml(crashId)}</div>
        <h2>${escapeHtml(record.story.label)}</h2>
      </div>
    </div>
    <div class="badge-row">${record.review_flags.map(f => badge(f.label, `flag-${f.code}`)).join('')}</div>
    <div class="section-kicker">Why this needs review</div>
    ${renderReviewFlags(record.review_flags)}
    <div class="section-kicker">Causal clarity</div>
    ${renderCausalClarity(record)}
    <div class="section-kicker">Validation summary</div>
    <div class="dashboard-grid mini">${Object.entries(record.validation_summary).map(([k, v]) => `
      <div class="dashboard-card"><div class="dashboard-value">${v}</div><div class="dashboard-label">${escapeHtml(statusLabel(k))}</div></div>
    `).join('')}</div>
    <div class="section-kicker">Mental model</div>
    ${renderCrashMentalModel(record)}
  `;
}

function buildHeatmap() {
  const container = byId('heatmapContainer');
  container.innerHTML = '';
  const details = byId('heatmapDetails');
  const pairList = byId('coocTopPairs');
  const orderSelect = byId('coocOrder');
  const limitSelect = byId('coocFactorLimit');
  if (orderSelect) orderSelect.onchange = () => buildHeatmap();
  if (limitSelect) limitSelect.onchange = () => buildHeatmap();

  const cooc = DATA.cooccurrence_matrix || [];
  if (!cooc.length) {
    details.innerHTML = emptyState('No co-occurring factor pairs were generated.');
    return;
  }

  const totalCrashes = DATA.meta.total_unique_crashes || DATA.crash_records.length || 1;
  const nodeMeta = new Map(DATA.aggregate_graph.nodes.map(node => [node.id, node]));
  const pairKey = (a, b) => [a, b].sort().join('|');
  const enriched = cooc.map(pair => {
    const freqA = nodeMeta.get(pair.factor_a)?.frequency || 0;
    const freqB = nodeMeta.get(pair.factor_b)?.frequency || 0;
    const expected = freqA && freqB ? (freqA * freqB) / totalCrashes : 0;
    return {
      ...pair,
      key: pairKey(pair.factor_a, pair.factor_b),
      freq_a: freqA,
      freq_b: freqB,
      lift: expected ? pair.count / expected : 0,
      jaccard: pair.count / Math.max(1, freqA + freqB - pair.count),
      support: pair.count / totalCrashes,
      category_a: nodeMeta.get(pair.factor_a)?.category || 'unknown',
      category_b: nodeMeta.get(pair.factor_b)?.category || 'unknown'
    };
  });

  const scoreByFactor = new Map();
  enriched.forEach(pair => {
    scoreByFactor.set(pair.factor_a, (scoreByFactor.get(pair.factor_a) || 0) + pair.count);
    scoreByFactor.set(pair.factor_b, (scoreByFactor.get(pair.factor_b) || 0) + pair.count);
  });

  const factorLimit = Number(limitSelect?.value || 22);
  const order = orderSelect?.value || 'association';
  const allFactors = Array.from(scoreByFactor.keys());
  const factors = allFactors.sort((a, b) => {
    if (order === 'frequency') return (nodeMeta.get(b)?.frequency || 0) - (nodeMeta.get(a)?.frequency || 0);
    if (order === 'category') {
      const ca = CAT_LABELS[nodeMeta.get(a)?.category] || 'Other';
      const cb = CAT_LABELS[nodeMeta.get(b)?.category] || 'Other';
      return ca.localeCompare(cb) || (scoreByFactor.get(b) || 0) - (scoreByFactor.get(a) || 0);
    }
    return (scoreByFactor.get(b) || 0) - (scoreByFactor.get(a) || 0);
  }).slice(0, factorLimit);

  const factorSet = new Set(factors);
  const visiblePairs = enriched.filter(pair => factorSet.has(pair.factor_a) && factorSet.has(pair.factor_b));
  const topPairs = [...enriched].sort((a, b) => b.count - a.count || b.lift - a.lift);
  if (!selectedCoocKey || !topPairs.some(pair => pair.key === selectedCoocKey)) selectedCoocKey = topPairs[0].key;

  const max = d3.max(visiblePairs, d => d.count) || 1;
  const cell = factors.length > 24 ? 28 : 34;
  const margin = { top: 150, left: 190, right: 28, bottom: 28 };
  const W = margin.left + factors.length * cell + margin.right;
  const H = margin.top + factors.length * cell + margin.bottom;
  const lookup = new Map(visiblePairs.map(pair => [pair.key, pair]));
  const color = d3.scaleSequential(t => d3.interpolateRgbBasis(['#13201d', '#1f5f52', '#a47f2a', '#f87171'])(t)).domain([0, max]);

  byId('coocSummary').innerHTML = [
    { value: cooc.length, label: 'factor pairs' },
    { value: factors.length, label: 'factors shown' },
    { value: topPairs[0]?.count || 0, label: 'max pair count' },
    { value: `${Math.round((topPairs[0]?.support || 0) * 100)}%`, label: 'top-pair support' }
  ].map(item => `<div class="cooc-stat"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('');

  pairList.innerHTML = topPairs.slice(0, 14).map(pair => `
    <button class="cooc-pair ${pair.key === selectedCoocKey ? 'active' : ''}" onclick="showCoocPair('${pair.factor_a}', '${pair.factor_b}')">
      <span>${escapeHtml(titleCase(pair.factor_a))} + ${escapeHtml(titleCase(pair.factor_b))}</span>
      <strong>${pair.count}</strong>
      <i style="--w:${Math.max(8, pair.count / (topPairs[0]?.count || 1) * 100)}%"></i>
    </button>
  `).join('');

  const svg = d3.select(container).append('svg')
    .attr('width', W)
    .attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('class', 'cooc-svg');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', factors.length * cell)
    .attr('height', factors.length * cell)
    .attr('rx', 8)
    .attr('fill', 'rgba(255,255,255,0.015)')
    .attr('stroke', 'rgba(255,255,255,0.06)');

  factors.forEach((left, i) => {
    factors.forEach((right, j) => {
      if (i <= j) return;
      const pair = lookup.get(pairKey(left, right));
      const value = pair?.count || 0;
      if (!value) return;
      const selected = pair.key === selectedCoocKey;
      g.append('rect')
        .attr('x', j * cell + 1)
        .attr('y', i * cell + 1)
        .attr('width', cell - 2)
        .attr('height', cell - 2)
        .attr('rx', 6)
        .attr('fill', color(value))
        .attr('opacity', selected ? 1 : 0.88)
        .attr('stroke', selected ? '#f4f1e8' : 'rgba(255,255,255,0.08)')
        .attr('stroke-width', selected ? 2 : 1)
        .attr('class', 'cooc-cell')
        .on('mouseenter', function () {
          d3.select(this).attr('stroke', '#f4f1e8').attr('stroke-width', 2);
          renderCoocDetails(pair, false);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('stroke', selected ? '#f4f1e8' : 'rgba(255,255,255,0.08)').attr('stroke-width', selected ? 2 : 1);
          const selectedPair = topPairs.find(item => item.key === selectedCoocKey);
          renderCoocDetails(selectedPair, true);
        })
        .on('click', () => showCoocPair(left, right));
      if (cell >= 32 || value >= max * 0.35) {
        g.append('text')
          .attr('x', j * cell + cell / 2)
          .attr('y', i * cell + cell / 2 + 1)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', value > max * 0.62 ? '#090a0a' : '#f8fafc')
          .attr('font-size', '10px')
          .attr('font-weight', '700')
          .text(value)
          .style('pointer-events', 'none');
      }
    });
  });

  factors.forEach((factor, index) => {
    const meta = nodeMeta.get(factor) || {};
    const category = meta.category || 'human_behavior';
    const label = titleCase(factor);
    g.append('rect')
      .attr('x', index * cell + 7)
      .attr('y', index * cell + 7)
      .attr('width', cell - 14)
      .attr('height', cell - 14)
      .attr('rx', 5)
      .attr('fill', CAT_COLORS[category] || '#8e8b80')
      .attr('opacity', 0.32);
    g.append('text')
      .attr('x', -10)
      .attr('y', index * cell + cell / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#c9c5b8')
      .attr('font-size', '11px')
      .text(label);
    g.append('text')
      .attr('x', index * cell + cell / 2)
      .attr('y', -10)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')
      .attr('transform', `rotate(-48,${index * cell + cell / 2},-10)`)
      .attr('fill', '#c9c5b8')
      .attr('font-size', '11px')
      .text(label);
  });

  renderCoocDetails(topPairs.find(pair => pair.key === selectedCoocKey), true);
}

function coocPairStats(factorA, factorB) {
  const key = [factorA, factorB].sort().join('|');
  const nodeMeta = new Map(DATA.aggregate_graph.nodes.map(node => [node.id, node]));
  const pair = DATA.cooccurrence_matrix.find(item => [item.factor_a, item.factor_b].sort().join('|') === key);
  if (!pair) return null;
  const totalCrashes = DATA.meta.total_unique_crashes || DATA.crash_records.length || 1;
  const freqA = nodeMeta.get(pair.factor_a)?.frequency || 0;
  const freqB = nodeMeta.get(pair.factor_b)?.frequency || 0;
  const expected = freqA && freqB ? (freqA * freqB) / totalCrashes : 0;
  return {
    ...pair,
    key,
    freq_a: freqA,
    freq_b: freqB,
    lift: expected ? pair.count / expected : 0,
    jaccard: pair.count / Math.max(1, freqA + freqB - pair.count),
    support: pair.count / totalCrashes
  };
}

function renderCoocDetails(pair, pinned = false) {
  if (!pair) return;
  const records = DATA.crash_records
    .filter(record => {
      const factors = new Set(record.factors.map(factor => factor.factor));
      return factors.has(pair.factor_a) && factors.has(pair.factor_b);
    })
    .slice(0, 6);
  byId('heatmapDetails').innerHTML = `
    <div class="detail-title">${pinned ? 'Selected Pair' : 'Pair Preview'}</div>
    <div class="chain">
      <span class="chain-node">${escapeHtml(titleCase(pair.factor_a))}</span>
      <span class="chain-arrow">+</span>
      <span class="chain-node">${escapeHtml(titleCase(pair.factor_b))}</span>
    </div>
    <div class="cooc-metrics">
      <div><strong>${pair.count}</strong><span>co-occurring crashes</span></div>
      <div><strong>${Math.round(pair.support * 100)}%</strong><span>dataset support</span></div>
      <div><strong>${pair.lift.toFixed(1)}x</strong><span>lift vs chance</span></div>
      <div><strong>${Math.round(pair.jaccard * 100)}%</strong><span>overlap index</span></div>
    </div>
    <div class="metric-row"><span>${escapeHtml(titleCase(pair.factor_a))} frequency</span><strong>${pair.freq_a}</strong></div>
    <div class="metric-row"><span>${escapeHtml(titleCase(pair.factor_b))} frequency</span><strong>${pair.freq_b}</strong></div>
    <div class="section-kicker">Representative crashes</div>
    <div class="cooc-examples">${records.map(miniCrashCard).join('') || emptyState('No representative records found.')}</div>
  `;
}

function showCoocPair(factorA, factorB) {
  const pair = coocPairStats(factorA, factorB);
  if (!pair) return;
  selectedCoocKey = pair.key;
  renderCoocDetails(pair, true);
  buildHeatmap();
}

function buildCrashList() {
  const query = byId('crashSearch')?.value || '';
  const records = filterRecords(query, activeStory);
  byId('activeStoryFilter').innerHTML = activeStory
    ? `<span class="active-filter">Story: ${escapeHtml(DATA.story_archetypes.find(s => s.id === activeStory)?.label || activeStory)} <button onclick="clearStoryFilter()">clear</button></span>`
    : '';
  byId('crashCount').textContent = `${records.length} crashes`;
  byId('crashList').innerHTML = records.slice(0, 120).map(record => `
    <button class="crash-card ${selectedCrashId === record.crash_id ? 'active' : ''}" onclick="showCrashDetail('${record.crash_id}')">
      <span class="record-id">${escapeHtml(record.crash_id)}</span>
      <span class="record-story">${escapeHtml(record.story.label)}</span>
      <span class="record-text">${escapeHtml(record.public_safe_text.slice(0, 170))}</span>
      <span class="badge-row">${record.factors.slice(0, 4).map(factorBadge).join('')}</span>
    </button>
  `).join('') || emptyState('No matching crash records.');
}

function showCrashDetail(crashId) {
  selectedCrashId = crashId;
  const record = DATA.crash_records.find(r => r.crash_id === crashId);
  if (!record) return;
  byId('crashDetails').innerHTML = renderCrashDetail(record);
  buildCrashList();
}

function renderCrashDetail(record) {
  const hasRawNarrative = Boolean(record.narrative);
  const rawNarrativeSection = hasRawNarrative
    ? `<div class="section-kicker">Restricted raw narrative</div><div class="narr-text raw">${escapeHtml(record.narrative)}</div>`
    : `<div class="section-kicker">Raw narrative</div><div class="narr-text raw muted">Removed in the public-safe export.</div>`;
  const privacyLabel = DATA.meta?.privacy?.export_tier === 'public_safe_demo' ? 'public-safe export' : 'internal research export';
  return `
    <div class="detail-heading">
      <div>
        <div class="eyebrow">Crash ${escapeHtml(record.crash_id)}</div>
        <h2>${escapeHtml(record.story.label)}</h2>
      </div>
      <div class="confidence">${Math.round((record.story.confidence || 0) * 100)}%</div>
    </div>
    <div class="badge-row">${badge(privacyLabel, 'status-unknown')}</div>
    <div class="badge-row">${record.review_flags.map(f => badge(f.label, `flag-${f.code}`)).join('')}</div>
    <div class="section-kicker">CRIS context</div>
    <div class="context-grid">${renderContext(record.cris_context)}</div>
    <div class="section-kicker">Actors</div>
    <div class="actor-strip">${record.actors.map(actor => `
      <div class="actor-mini">
        <strong>Unit ${safeValue(actor.unit_number)}</strong>
        <span>${escapeHtml(titleCase(actor.road_user_role))}</span>
        <span>${escapeHtml(actor.mode || 'unknown')}</span>
        <span>${escapeHtml(actor.causal_role || 'uncertain')}</span>
      </div>
    `).join('')}</div>
    <div class="section-kicker">Validated factors</div>
    <div class="badge-row">${record.factors.map(factorBadge).join('') || badge('no accepted narrative factors', 'status-unknown')}</div>
    <div class="section-kicker">Claims and evidence</div>
    ${renderClaims(record.claims.slice(0, 18))}
    <div class="section-kicker">Public-safe summary</div>
    <div class="narr-text">${escapeHtml(record.public_safe_text)}</div>
    ${rawNarrativeSection}
  `;
}

function renderClaims(claims) {
  return claims.map(claim => `
    <div class="claim-card ${claim.suppressed_from_graph ? 'suppressed' : ''}">
      <div class="claim-head">
        <strong>${escapeHtml(claim.label || titleCase(claim.factor))}</strong>
        ${statusBadge(claim.validation_status)}
      </div>
      <div class="claim-meta">
        Unit ${safeValue(claim.actor_unit)} / ${escapeHtml(claim.source_agent || 'agent')} / confidence ${Math.round((claim.confidence || 0) * 100)}%
      </div>
      <div class="claim-evidence">${escapeHtml(claim.evidence?.text_span || '')}</div>
      <div class="claim-reason">${escapeHtml(claim.validation_reason || '')}</div>
    </div>
  `).join('') || emptyState('No extracted claims.');
}

function miniCrashCard(record) {
  return `
    <button class="record-card" onclick="showCrashDetail('${record.crash_id}'); switchTab('crashes')">
      <span class="record-id">${escapeHtml(record.crash_id)}</span>
      <span class="record-story">${escapeHtml(record.story.label)}</span>
      <span class="record-text">${escapeHtml(record.public_safe_text.slice(0, 170))}</span>
    </button>
  `;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function showModal(crashId) {
  const record = DATA.crash_records.find(r => r.crash_id === crashId);
  if (!record) return;
  byId('modalBox').innerHTML = `
    <button class="modal-close" onclick="byId('modalBackdrop').classList.remove('visible')">x</button>
    ${renderCrashDetail(record)}
  `;
  byId('modalBackdrop').classList.add('visible');
}

byId('modalBackdrop')?.addEventListener('click', event => {
  if (event.target === byId('modalBackdrop')) byId('modalBackdrop').classList.remove('visible');
});
