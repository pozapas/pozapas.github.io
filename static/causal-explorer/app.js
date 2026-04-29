/* ── E-Scooter Causal Explorer v2 — App Logic ── */

const CAT_COLORS = {
  rider_behavior: '#f472b6',
  infrastructure: '#fbbf24',
  environment: '#22d3ee',
  vehicle_factors: '#a78bfa',
  outcome: '#f87171'
};
const CAT_LABELS = {
  rider_behavior: 'Rider Behavior',
  infrastructure: 'Infrastructure',
  environment: 'Environment',
  vehicle_factors: 'Vehicle / Equipment',
  outcome: 'Outcome / Severity'
};
const BADGE_CLS = {
  rider_behavior: 'badge-rider',
  infrastructure: 'badge-infra',
  environment: 'badge-env',
  vehicle_factors: 'badge-vehicle',
  outcome: 'badge-outcome'
};

let DATA = null, simulation = null, svgG = null, zoomBehavior = null;
let activeFilters = new Set();
let _nodes, _links, _nodeG, _linkG;

// ── Data Load ──
const jsonPath = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? '../causal_graph_data.json'
  : 'causal_graph_data.json';

fetch(jsonPath)
  .then(r => { if (!r.ok) return fetch('causal_graph_data.json').then(r2 => r2.json()); return r.json(); })
  .then(d => { DATA = d; init(); })
  .catch(e => document.body.innerHTML = '<p style="color:#f87171;padding:40px;font-size:16px;">Error loading data: ' + e.message + '</p>');

function init() {
  renderStats();
  setupTabs();
  buildGraph();
  buildLegend();
  buildFilters();
  buildPathways();
  buildHeatmap();
  buildCrashList();
  document.getElementById('crashSearch').addEventListener('input', e => buildCrashList(e.target.value));
}

// ── Stats ──
function renderStats() {
  const s = DATA.aggregate_graph.stats;
  document.getElementById('headerStats').innerHTML =
    `<div class="stat-pill"><span class="sv">${DATA.meta.total_unique_narratives}</span>Crashes</div>` +
    `<div class="stat-pill"><span class="sv">${s.total_unique_factors}</span>Factors</div>` +
    `<div class="stat-pill"><span class="sv">${s.total_causal_edges}</span>Edges</div>` +
    `<div class="stat-pill"><span class="sv">${DATA.causal_pathways.length}</span>Pathways</div>`;
}

// ── Tab Switching ──
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add('active');
      if (btn.dataset.tab === 'graph' && simulation) simulation.alpha(0.1).restart();
    });
  });
}

// ── Panels ──
function openPanel(id) { document.getElementById(id).classList.add('open'); }
function closePanel(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════════════
// CAUSAL NETWORK — FULL SCREEN
// ═══════════════════════════════════════════════
function buildGraph() {
  const canvas = document.getElementById('graphCanvas');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const svg = d3.select('#graphSvg').attr('width', W).attr('height', H);

  _nodes = DATA.aggregate_graph.nodes.map(d => ({ ...d }));
  _links = DATA.aggregate_graph.edges
    .filter(e => e.type === 'contributes_to' && e.weight >= 2)
    .map(e => ({ source: e.source, target: e.target, weight: e.weight }));

  const nodeIds = new Set(_nodes.map(n => n.id));
  _links = _links.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  const rScale = d3.scaleSqrt().domain([1, d3.max(_nodes, d => d.frequency)]).range([8, 42]);
  const wScale = d3.scaleLinear().domain([1, d3.max(_links, d => d.weight) || 1]).range([0.8, 5]);

  // Defs
  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'blur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  svgG = svg.append('g');
  zoomBehavior = d3.zoom().scaleExtent([0.2, 6]).on('zoom', e => svgG.attr('transform', e.transform));
  svg.call(zoomBehavior);

  // Links
  _linkG = svgG.append('g').selectAll('line').data(_links).enter().append('line')
    .attr('stroke', d => {
      const src = _nodes.find(n => n.id === d.source);
      return src ? CAT_COLORS[src.category] || '#1a2340' : '#1a2340';
    })
    .attr('stroke-opacity', 0.18)
    .attr('stroke-width', d => wScale(d.weight));

  // Node groups
  _nodeG = svgG.append('g').selectAll('g').data(_nodes).enter().append('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Glow ring
  _nodeG.append('circle')
    .attr('r', d => rScale(d.frequency) + 6)
    .attr('fill', d => CAT_COLORS[d.category] || '#555')
    .attr('opacity', 0.08)
    .attr('filter', 'url(#glow)');

  // Main circle
  _nodeG.append('circle')
    .attr('r', d => rScale(d.frequency))
    .attr('fill', d => {
      const c = CAT_COLORS[d.category] || '#555';
      return `url(#grad-${d.id})` || c;
    })
    .each(function(d) {
      const c = d3.color(CAT_COLORS[d.category] || '#555');
      const grad = defs.append('radialGradient').attr('id', `grad-${d.id}`);
      grad.append('stop').attr('offset', '0%').attr('stop-color', c.brighter(0.8));
      grad.append('stop').attr('offset', '100%').attr('stop-color', c.darker(0.4));
    })
    .attr('stroke', d => d3.color(CAT_COLORS[d.category] || '#555').brighter(1))
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.4);

  // Labels
  _nodeG.filter(d => d.frequency >= 15).append('text')
    .text(d => d.label)
    .attr('text-anchor', 'middle')
    .attr('dy', d => rScale(d.frequency) + 16)
    .attr('fill', '#8892a8')
    .attr('font-size', '11px')
    .attr('font-weight', '600')
    .style('text-shadow', '0 0 8px rgba(0,0,0,0.8)');

  // Tooltip
  const tt = document.getElementById('tooltip');
  _nodeG.on('mouseover', (e, d) => {
    tt.innerHTML = `<div class="tt-title">${d.label}</div><div class="tt-cat">${d.category_label}</div>
      <div class="tt-stat">Appears in <strong>${d.frequency}</strong> crashes (${d.percentage}%)</div>`;
    tt.classList.add('visible');
  }).on('mousemove', e => {
    tt.style.left = (e.pageX + 18) + 'px';
    tt.style.top = (e.pageY - 12) + 'px';
  }).on('mouseout', () => tt.classList.remove('visible'));

  // Click
  _nodeG.on('click', (e, d) => { showNodeDetails(d); openPanel('graphDetailPanel'); });

  // Simulation
  simulation = d3.forceSimulation(_nodes)
    .force('link', d3.forceLink(_links).id(d => d.id).distance(100).strength(0.25))
    .force('charge', d3.forceManyBody().strength(d => -rScale(d.frequency) * 14))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(d => rScale(d.frequency) + 10))
    .force('x', d3.forceX(W / 2).strength(0.03))
    .force('y', d3.forceY(H / 2).strength(0.03))
    .on('tick', () => {
      _linkG.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      _nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

function showNodeDetails(d) {
  const panel = document.getElementById('nodeDetails');
  const connected = _links.filter(e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    return s === d.id || t === d.id;
  });
  const related = DATA.crash_records.filter(c => c.factors.some(f => f.factor === d.id)).slice(0, 8);

  let h = `<div style="margin-bottom:20px;">
    <div style="font-size:20px;font-weight:800;color:${CAT_COLORS[d.category]}">${d.label}</div>
    <div style="font-size:11px;color:var(--text-4);margin-top:2px;">${d.category_label}</div>
    <div class="stat-row">
      <div class="stat-box"><div class="sb-val" style="color:var(--cyan)">${d.frequency}</div><div class="sb-label">Crashes</div></div>
      <div class="stat-box"><div class="sb-val" style="color:var(--purple)">${d.percentage}%</div><div class="sb-label">of Total</div></div>
      <div class="stat-box"><div class="sb-val" style="color:var(--amber)">${connected.length}</div><div class="sb-label">Links</div></div>
    </div></div>`;

  h += '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Connected Factors</div>';
  connected.sort((a, b) => b.weight - a.weight).slice(0, 10).forEach(e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    const oid = s === d.id ? t : s;
    const on = _nodes.find(n => n.id === oid);
    if (!on) return;
    h += `<div class="card"><div class="card-title">${s === d.id ? '&rarr;' : '&larr;'} ${on.label}</div>
      <div class="card-sub">Weight: ${e.weight} &middot; ${on.category_label}</div></div>`;
  });

  h += '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 8px;">Example Crashes</div>';
  related.forEach(c => {
    h += `<div class="card" onclick="showModal('${c.crash_id}')">
      <div class="card-title">${c.crash_id}</div>
      <div class="card-sub">${c.narrative.substring(0, 130)}...</div>
      <div style="margin-top:4px;">${c.factors.slice(0, 4).map(f => `<span class="badge ${BADGE_CLS[f.category]}">${f.factor.replace(/_/g, ' ')}</span>`).join('')}</div>
    </div>`;
  });
  panel.innerHTML = h;
}

// ── Legend ──
function buildLegend() {
  let h = '<div class="leg-title">Factor Categories</div>';
  Object.entries(CAT_LABELS).forEach(([k, v]) => {
    h += `<div class="leg-item"><div class="leg-dot" style="background:${CAT_COLORS[k]};color:${CAT_COLORS[k]}"></div>${v}</div>`;
  });
  document.getElementById('legend').innerHTML = h;
}

// ── Filters ──
function buildFilters() {
  let h = '';
  Object.entries(CAT_LABELS).forEach(([k, v]) => {
    h += `<div class="chip" data-cat="${k}" onclick="toggleFilter('${k}',this)">${v}</div>`;
  });
  document.getElementById('filterBar').innerHTML = h;
}
function toggleFilter(cat, el) {
  if (activeFilters.has(cat)) { activeFilters.delete(cat); el.classList.remove('active'); }
  else { activeFilters.add(cat); el.classList.add('active'); }
  if (activeFilters.size === 0) {
    _nodeG.attr('opacity', 1); _linkG.attr('opacity', 0.18);
  } else {
    _nodeG.attr('opacity', d => activeFilters.has(d.category) ? 1 : 0.06);
    _linkG.attr('opacity', d => {
      const s = typeof d.source === 'object' ? d.source : _nodes.find(n => n.id === d.source);
      const t = typeof d.target === 'object' ? d.target : _nodes.find(n => n.id === d.target);
      return (s && activeFilters.has(s.category)) || (t && activeFilters.has(t.category)) ? 0.35 : 0.02;
    });
  }
}
function zoomIn() { d3.select('#graphSvg').transition().duration(300).call(zoomBehavior.scaleBy, 1.5); }
function zoomOut() { d3.select('#graphSvg').transition().duration(300).call(zoomBehavior.scaleBy, 0.67); }
function resetZoom() { d3.select('#graphSvg').transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity); }

// ═══════════════════════════════════════════════
// PATHWAYS
// ═══════════════════════════════════════════════
function buildPathways() {
  const c = document.getElementById('pathwaysList');
  const mx = DATA.causal_pathways[0]?.frequency || 1;
  let h = '';
  DATA.causal_pathways.forEach((pw, i) => {
    const cs = pw.causes.map(x => x.replace(/_/g, ' ')).join(' + ');
    const os = pw.outcomes.map(x => x.replace(/_/g, ' ')).join(' + ');
    const pct = (pw.frequency / mx * 100).toFixed(0);
    h += `<div class="pw-row" onclick="showPathwayDetail(${i})">
      <span class="pw-count">${pw.frequency}</span>
      <span class="pw-label"><span class="pw-cause">${cs}</span><span class="pw-arrow">&rarr;</span><span class="pw-effect">${os}</span></span>
      <span class="pw-bar-track"><span class="pw-bar-fill" style="width:${pct}%"></span></span>
      <span class="pw-pct">${pw.percentage}%</span>
    </div>`;
  });
  c.innerHTML = h;
}
function showPathwayDetail(i) {
  const pw = DATA.causal_pathways[i];
  const p = document.getElementById('pathwayDetails');
  const matching = DATA.crash_records.filter(c => {
    const cf = new Set(c.contributing_factors), co = new Set(c.outcomes);
    return pw.causes.every(x => cf.has(x)) && pw.outcomes.every(x => co.has(x));
  }).slice(0, 8);

  let h = `<div style="margin-bottom:16px;">
    <div style="font-size:15px;font-weight:800;color:var(--cyan);margin-bottom:10px;">Pathway #${i + 1}</div>
    <div class="chain">
      ${pw.causes.map(c => `<span class="chain-node" style="border-color:var(--pink);color:var(--pink)">${c.replace(/_/g,' ')}</span>`).join('<span class="chain-arrow">+</span>')}
      <span class="chain-arrow">&rarr;</span>
      ${pw.outcomes.map(o => `<span class="chain-node" style="border-color:var(--red);color:var(--red)">${o.replace(/_/g,' ')}</span>`).join('<span class="chain-arrow">+</span>')}
    </div>
    <div style="font-size:12px;color:var(--text-4);margin-top:8px;">${pw.frequency} crashes (${pw.percentage}%)</div>
  </div>
  <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Example Crashes</div>`;
  matching.forEach(c => {
    h += `<div class="card" onclick="showModal('${c.crash_id}')">
      <div class="card-title">${c.crash_id}</div><div class="card-sub">${c.narrative.substring(0, 140)}...</div></div>`;
  });
  p.innerHTML = h;
}

// ═══════════════════════════════════════════════
// HEATMAP
// ═══════════════════════════════════════════════
function buildHeatmap() {
  const container = document.getElementById('heatmapContainer');
  const cooc = DATA.cooccurrence_matrix;
  if (!cooc.length) return;

  const fs = new Set();
  cooc.forEach(d => { fs.add(d.factor_a); fs.add(d.factor_b); });
  const factors = Array.from(fs).sort();
  const cs = 36, mg = { top: 150, left: 150 };
  const W = mg.left + factors.length * cs + 40, H = mg.top + factors.length * cs + 40;

  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

  const lk = {};
  cooc.forEach(d => { lk[d.factor_a + '|' + d.factor_b] = d.count; lk[d.factor_b + '|' + d.factor_a] = d.count; });
  const mx = d3.max(cooc, d => d.count);
  const clr = d3.scaleSequential(d3.interpolateViridis).domain([0, mx]);

  factors.forEach((fa, i) => {
    factors.forEach((fb, j) => {
      const v = lk[fa + '|' + fb] || 0;
      if (i === j || !v) return;
      g.append('rect').attr('x', j * cs).attr('y', i * cs)
        .attr('width', cs - 2).attr('height', cs - 2).attr('rx', 4)
        .attr('fill', clr(v)).attr('opacity', 0.85).style('cursor', 'pointer')
        .on('mouseover', function () {
          d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
          document.getElementById('heatmapDetails').innerHTML = `
            <div style="font-size:15px;font-weight:800;color:var(--cyan);margin-bottom:10px;">Co-occurrence</div>
            <div class="card"><div class="card-title">${fa.replace(/_/g,' ')} + ${fb.replace(/_/g,' ')}</div>
            <div class="card-sub">Appears together in <strong style="color:var(--cyan)">${v}</strong> crashes</div></div>`;
        })
        .on('mouseout', function () { d3.select(this).attr('stroke', 'none'); });
      if (v >= 5) {
        g.append('text').attr('x', j * cs + cs / 2 - 1).attr('y', i * cs + cs / 2 + 1)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .attr('fill', v > mx * 0.6 ? '#000' : '#fff').attr('font-size', '10px').attr('font-weight', '600')
          .text(v).style('pointer-events', 'none');
      }
    });
  });
  factors.forEach((f, i) => {
    g.append('text').attr('x', -8).attr('y', i * cs + cs / 2)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
      .attr('fill', '#8892a8').attr('font-size', '10px').text(f.replace(/_/g, ' '));
    g.append('text').attr('x', i * cs + cs / 2).attr('y', -8)
      .attr('text-anchor', 'start').attr('dominant-baseline', 'middle')
      .attr('transform', `rotate(-50,${i * cs + cs / 2},-8)`)
      .attr('fill', '#8892a8').attr('font-size', '10px').text(f.replace(/_/g, ' '));
  });
}

// ═══════════════════════════════════════════════
// CRASH BROWSER
// ═══════════════════════════════════════════════
function buildCrashList(filter = '') {
  const recs = DATA.crash_records.filter(c => !filter || c.narrative.toLowerCase().includes(filter.toLowerCase()));
  document.getElementById('crashCount').textContent = `${recs.length} crashes`;
  let h = '';
  recs.slice(0, 80).forEach(c => {
    const actorLabel = c.actors.map(a => a.type ? `${a.id} (${a.type})` : a.id).join(' vs ');
    h += `<div class="card" onclick="showCrashDetail('${c.crash_id}')">
      <div class="card-title">${c.crash_id} <span style="font-weight:400;color:var(--text-4);font-size:11px;">${actorLabel}</span></div>
      <div class="card-sub">${c.narrative.substring(0, 160)}...</div>
      <div style="margin-top:5px;">${c.factors.slice(0, 5).map(f => `<span class="badge ${BADGE_CLS[f.category]}">${f.factor.replace(/_/g, ' ')}</span>`).join('')}</div>
    </div>`;
  });
  if (recs.length > 80) h += `<div style="text-align:center;color:var(--text-4);font-size:12px;padding:16px;">Showing 80 of ${recs.length}. Refine your search.</div>`;
  document.getElementById('crashList').innerHTML = h;
}
function showCrashDetail(id) {
  const c = DATA.crash_records.find(r => r.crash_id === id);
  if (!c) return;
  let h = `<div style="font-size:18px;font-weight:800;color:var(--cyan);margin-bottom:14px;">${c.crash_id}</div>
    <div class="narr-text">${c.narrative}</div>
    <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin:18px 0 8px;">Actors</div>`;
  c.actors.forEach(a => { h += `<div class="card"><div class="card-title">${a.id}${a.type ? ' &mdash; ' + a.type : ''}</div>${a.direction ? `<div class="card-sub">Direction: ${a.direction}</div>` : ''}</div>`; });
  h += '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin:18px 0 8px;">Extracted Factors</div><div style="margin-bottom:12px;">';
  c.factors.forEach(f => { h += `<span class="badge ${BADGE_CLS[f.category]}">${f.factor.replace(/_/g, ' ')}</span>`; });
  h += '</div>';
  if (c.causal_chains.length) {
    h += '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 8px;">Causal Evidence</div>';
    c.causal_chains.forEach(ch => {
      h += `<div class="card"><div class="card-title" style="color:var(--purple)">${ch.marker}</div><div class="card-sub">${ch.text_span}</div></div>`;
    });
  }
  if (c.edges.length) {
    h += '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin:18px 0 8px;">Causal Edges</div>';
    c.edges.slice(0, 10).forEach(e => {
      h += `<div class="chain"><span class="chain-node">${e.source.replace(/_/g,' ')}</span><span class="chain-arrow">&rarr;</span><span class="chain-node">${e.target.replace(/_/g,' ')}</span></div>`;
    });
  }
  document.getElementById('crashDetails').innerHTML = h;
}

// ── Modal ──
function showModal(id) {
  const c = DATA.crash_records.find(r => r.crash_id === id);
  if (!c) return;
  document.getElementById('modalBox').innerHTML = `
    <button class="modal-close" onclick="document.getElementById('modalBackdrop').classList.remove('visible')">&times;</button>
    <h3>${c.crash_id}</h3>
    <div class="narr-text">${c.narrative}</div>
    <div style="margin-top:16px;">${c.factors.map(f => `<span class="badge ${BADGE_CLS[f.category]}">${f.factor.replace(/_/g,' ')}</span>`).join('')}</div>
    ${c.causal_chains.length ? '<div style="margin-top:20px;font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;">Causal Evidence</div>' + c.causal_chains.map(ch => `<div style="margin-top:8px;font-size:13px;color:var(--text-2);border-left:2px solid var(--purple);padding-left:12px;">${ch.text_span}</div>`).join('') : ''}`;
  document.getElementById('modalBackdrop').classList.add('visible');
}
document.getElementById('modalBackdrop').addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('visible');
});
