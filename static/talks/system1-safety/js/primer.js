/* Primer sheets: typewriter answer, census growth chart, leaderboard scatter and slope chart. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = { maroon: "#501214", gold: "#c9a25a", goldDeep: "#7a5b22", ink: "#1f1a17", soft: "#4a3f38", faint: "rgba(80,18,20,0.22)", paper: "#f5efe2", can: "#1f6b4a", cannot: "#a8221b" };

  function el(svg, tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    svg.appendChild(e);
    return e;
  }

  /* ---------- typewriter ---------- */
  let typing = null;
  function startTyping(slide) {
    const p = slide && slide.querySelector(".typewriter");
    if (!p) return;
    const full = p.dataset.text || "";
    const counter = slide.querySelector("[data-wordcount]");
    if (typing) clearInterval(typing);
    if (/autorun/.test(location.search)) { p.textContent = full; p.classList.add("done"); if (counter) counter.textContent = full.split(/\s+/).length + " words"; return; }
    let i = 0;
    p.textContent = ""; p.classList.remove("done");
    typing = setInterval(() => {
      i += 2;
      p.textContent = full.slice(0, i);
      if (counter) counter.textContent = p.textContent.split(/\s+/).filter(Boolean).length + " words";
      if (i >= full.length) { clearInterval(typing); typing = null; p.classList.add("done"); }
    }, 45);
  }

  /* ---------- census growth (Paper 4B, census_screened.csv, tiers T1 and T2) ---------- */
  function drawGrowth() {
    const svg = document.getElementById("growth");
    if (!svg) return;
    const days = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
    const orig = [0, 5, 6, 12, 27, 38, 53, 73, 89, 101];   // 3 undated originals counted on the last day
    const deriv = [0, 1, 3, 8, 20, 57, 103, 166, 239, 259];
    const W = 1000, H = 560, L = 70, R = 790, T = 30, B = 480, max = 380;
    const x = (i) => L + i * (R - L) / (days.length - 1);
    const y = (v) => B - v / max * (B - T);
    for (let g = 0; g <= 350; g += 100) {
      el(svg, "line", { x1: L, x2: R, y1: y(g), y2: y(g), stroke: C.faint, "stroke-width": 1.5 });
      el(svg, "text", { x: L - 12, y: y(g) + 8, "text-anchor": "end", "font-size": 24, fill: C.soft, "font-family": "Public Sans" }, g);
    }
    days.forEach((d, i) => el(svg, "text", { x: x(i), y: B + 36, "text-anchor": "middle", "font-size": 24, fill: C.soft, "font-family": "JetBrains Mono" }, d));
    el(svg, "text", { x: (L + R) / 2, y: B + 74, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.maroon, "letter-spacing": 2, "font-family": "Public Sans" }, "SEPTEMBER 2026");
    const tot = orig.map((v, i) => v + deriv[i]);
    let a = "M" + x(0) + " " + y(0);
    tot.forEach((v, i) => { a += " L" + x(i) + " " + y(v); });
    for (let i = days.length - 1; i >= 0; i--) a += " L" + x(i) + " " + y(orig[i]);
    el(svg, "path", { d: a + " Z", fill: C.gold, opacity: 0.9 });
    let o = "M" + x(0) + " " + y(0);
    orig.forEach((v, i) => { o += " L" + x(i) + " " + y(v); });
    o += " L" + x(days.length - 1) + " " + y(0) + " Z";
    el(svg, "path", { d: o, fill: C.maroon });
    el(svg, "line", { x1: L, x2: R, y1: B, y2: B, stroke: C.maroon, "stroke-width": 2.5 });
    el(svg, "text", { x: R + 14, y: y(tot[9]) + 10, "font-size": 32, "font-weight": 800, fill: C.goldDeep, "font-family": "Source Serif 4" }, "259 copies");
    el(svg, "text", { x: R + 14, y: y(orig[9] / 2) + 10, "font-size": 30, "font-weight": 800, fill: C.maroon, "font-family": "Source Serif 4" }, "101 new");
    [[0, "Jev 1.13"], [3, "Laya"]].forEach(([i, t]) => {
      el(svg, "line", { x1: x(i), x2: x(i), y1: y(0), y2: T + 40, stroke: C.ink, "stroke-width": 2, "stroke-dasharray": "6 6" });
      el(svg, "text", { x: x(i) + 8, y: T + 36, "font-size": 26, "font-weight": 700, fill: C.ink, "font-family": "Public Sans" }, t);
    });
  }

  /* ---------- Decision Index scatter ---------- */
  function drawScatter() {
    const svg = document.getElementById("scatter");
    if (!svg || !window.DI_POINTS) return;
    const W = 1100, H = 700, L = 90, R = 1070, T = 30, B = 600;
    const lx = (p) => Math.log10(p);
    const x0 = Math.log10(0.1), x1 = Math.log10(40);
    const x = (p) => L + (lx(Math.max(p, 0.1)) - x0) / (x1 - x0) * (R - L);
    const y = (s) => B - s / 70 * (B - T);
    [0, 10, 20, 30, 40, 50, 60, 70].forEach((g) => {
      el(svg, "line", { x1: L, x2: R, y1: y(g), y2: y(g), stroke: C.faint, "stroke-width": 1.5 });
      el(svg, "text", { x: L - 12, y: y(g) + 8, "text-anchor": "end", "font-size": 24, fill: C.soft, "font-family": "Public Sans" }, g);
    });
    [0.1, 0.3, 1, 3, 10, 30].forEach((p) => {
      el(svg, "line", { x1: x(p), x2: x(p), y1: T, y2: B, stroke: C.faint, "stroke-width": 1.5 });
      el(svg, "text", { x: x(p), y: B + 36, "text-anchor": "middle", "font-size": 24, fill: C.soft, "font-family": "JetBrains Mono" }, p < 1 ? p + "B" : p + "B");
    });
    el(svg, "rect", { x: L, y: T, width: R - L, height: B - T, fill: "none", stroke: C.maroon, "stroke-width": 2.5 });
    el(svg, "text", { x: (L + R) / 2, y: H - 22, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.maroon, "letter-spacing": 2, "font-family": "Public Sans" }, "MODEL SIZE, BILLIONS OF PARAMETERS (LOG SCALE)");
    el(svg, "text", { transform: "translate(26 " + (T + B) / 2 + ") rotate(-90)", "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.maroon, "letter-spacing": 2, "font-family": "Public Sans" }, "DECISION INDEX SCORE");
    el(svg, "line", { x1: L, x2: R, y1: y(60.11), y2: y(60.11), stroke: C.maroon, "stroke-width": 3, "stroke-dasharray": "10 8" });
    el(svg, "text", { x: L + 12, y: y(60.11) - 12, "font-size": 24, "font-weight": 700, fill: C.maroon, "font-family": "Public Sans" }, "Jev 1.13 · 60.1");
    const pts = window.DI_POINTS.slice().sort((a, b) => a.s - b.s);
    pts.forEach((d) => {
      el(svg, "circle", { cx: x(d.p), cy: y(d.s), r: 9, fill: d.o ? C.gold : C.paper, stroke: C.maroon, "stroke-width": d.o ? 1.5 : 3, opacity: 0.92 });
    });
    const LABELS = [
      ["Perplexity Decider v1.1 (27B)", "Perplexity Decider v1.1", -16, -20, "end"],
      ["Fastino GLiDE no-thinking (28B)", "Fastino GLiDE", -16, 34, "end"],
      ["Cloudflare clef", "Cloudflare Clef", -16, 8, "end"],
      ["Cloudflare clef-flash", "Clef-flash", -16, 8, "end"],
      ["LiquidAI d1-3B", "Liquid AI d1-3B", 16, 8, "start"],
      ["Laya", "Laya · 4.4", 16, -8, "start"],
    ];
    LABELS.forEach(([n, t, dx, dy, anc]) => {
      const d = window.DI_POINTS.find((p) => p.n === n);
      if (!d) return;
      el(svg, "circle", { cx: x(d.p), cy: y(d.s), r: 13, fill: n === "Laya" ? C.cannot : C.maroon, stroke: C.paper, "stroke-width": 3 });
      el(svg, "text", { x: x(d.p) + dx, y: y(d.s) + dy, "text-anchor": anc, "font-size": 26, "font-weight": 700, fill: n === "Laya" ? C.cannot : C.ink, "font-family": "Public Sans", "paint-order": "stroke", stroke: C.paper, "stroke-width": 6 }, t);
    });
  }

  /* ---------- two leaderboards, shared models ---------- */
  function drawSlope() {
    const svg = document.getElementById("slope");
    if (!svg) return;
    // [name, Decision Index 0.3.1 score, EdgeEvals System One clinical score], both as published 10 Oct 2026
    const D = [
      ["Perplexity Decider v1.1", 62.75, 96.1], ["Jev 1.13", 60.11, 93.9], ["Cloudflare Clef", 53.08, 92.8],
      ["Nace.AI Drex v1.5", 50.84, 89.2], ["Clef-flash", 47.61, 88.2], ["Clef Omni", 49.32, 85.9],
      ["Intern-Decision 4B", 38.21, 84.9], ["Liquid AI d1-3B", 40.08, 74.1], ["Decider 2B", 25.8, 70.4],
      ["Strands Decider 2B", 21.75, 65.6], ["Intern-Decision 0.8B", 11.78, 56.5], ["Julia-1", 2.56, 23.8],
      ["Laya", 4.43, 21.4], ["GLiNER2.5-Decide", 9.24, 7.3]];
    const H = 720, T = 100, B = 660, XL = 200, XR = 600;
    const yl = (s) => B - s / 70 * (B - T);
    const yr = (s) => B - s / 100 * (B - T);
    el(svg, "text", { x: XL, y: 40, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.maroon, "letter-spacing": 2, "font-family": "Public Sans" }, "GENERAL");
    el(svg, "text", { x: XR, y: 40, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.maroon, "letter-spacing": 2, "font-family": "Public Sans" }, "CLINICAL");
    el(svg, "line", { x1: XL, x2: XL, y1: T - 10, y2: B, stroke: C.maroon, "stroke-width": 3 });
    el(svg, "line", { x1: XR, x2: XR, y1: T - 10, y2: B, stroke: C.maroon, "stroke-width": 3 });
    const hl = { "Jev 1.13": C.maroon, "Perplexity Decider v1.1": C.ink, "Laya": C.cannot };
    D.forEach(([n, a, b]) => {
      const c = hl[n] || "rgba(80,18,20,0.35)";
      el(svg, "line", { x1: XL, y1: yl(a), x2: XR, y2: yr(b), stroke: c, "stroke-width": hl[n] ? 5 : 2.5 });
      el(svg, "circle", { cx: XL, cy: yl(a), r: hl[n] ? 9 : 6, fill: c });
      el(svg, "circle", { cx: XR, cy: yr(b), r: hl[n] ? 9 : 6, fill: c });
    });
    // right labels with simple collision relaxation
    const lab = D.map(([n, a, b]) => ({ n, b, y: yr(b) })).sort((p, q) => p.y - q.y);
    for (let it = 0; it < 60; it++) for (let i = 1; i < lab.length; i++) {
      const gap = lab[i].y - lab[i - 1].y;
      if (gap < 30) { const s = (30 - gap) / 2; lab[i].y += s; lab[i - 1].y -= s; }
    }
    const sh = Math.max(0, (T - 8) - lab[0].y); lab.forEach((p) => { p.y += sh; });
    lab.forEach((p) => el(svg, "text", { x: XR + 20, y: p.y + 8, "font-size": 23, "font-weight": hl[p.n] ? 800 : 500, fill: hl[p.n] || C.ink, "font-family": "Public Sans" }, p.n + "  " + p.b.toFixed(1)));
    const labL = D.map(([n, a]) => ({ n, a, y: yl(a) })).sort((p, q) => p.y - q.y);
    for (let it = 0; it < 60; it++) for (let i = 1; i < labL.length; i++) {
      const gap = labL[i].y - labL[i - 1].y;
      if (gap < 28) { const s = (28 - gap) / 2; labL[i].y += s; labL[i - 1].y -= s; }
    }
    const shL = Math.max(0, (T - 8) - labL[0].y); labL.forEach((p) => { p.y += shL; });
    labL.forEach((p) => el(svg, "text", { x: XL - 16, y: p.y + 8, "text-anchor": "end", "font-size": 23, "font-weight": hl[p.n] ? 800 : 500, fill: hl[p.n] || C.soft, "font-family": "JetBrains Mono" }, p.a.toFixed(1)));
    el(svg, "text", { x: XL - 16, y: H - 14, "text-anchor": "end", "font-size": 20, fill: C.soft, "font-family": "Public Sans" }, "Decision Index 0.3.1");
    el(svg, "text", { x: XR + 20, y: H - 14, "font-size": 20, fill: C.soft, "font-family": "Public Sans" }, "EdgeEvals System One");
  }

  function boot() {
    drawGrowth(); drawScatter(); drawSlope();
    startTyping(Reveal.getCurrentSlide());
    Reveal.on("slidechanged", (e) => startTyping(e.currentSlide));
  }
  if (Reveal.isReady && Reveal.isReady()) boot(); else Reveal.on("ready", boot);
})();
