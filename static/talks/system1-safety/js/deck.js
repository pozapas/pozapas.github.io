/* Sheet chrome, verdict tally, countdowns, the reliability instrument and the live runner client. */
(function () {
  "use strict";

  const FOOT = "Texas State University · AIT Lab · CE 7393 guest lecture · 14 Oct 2026";
  const RUNNER = "http://127.0.0.1:8791";
  const sheets = Array.from(document.querySelectorAll(".reveal .slides > section"));
  const total = sheets.length;

  // Ink texture for rubber stamps: fractal noise turned into speckled alpha.
  const noise =
    "<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7'/>" +
    "<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.3'/></filter>" +
    "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
  document.documentElement.style.setProperty(
    "--ink-mask", 'url("data:image/svg+xml;utf8,' + encodeURIComponent(noise) + '")'
  );

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- checkboxes ---------- */

  const BOX = '<svg class="box" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40"/><path d="M10 23 l8 8 l16 -18"/></svg>';
  document.querySelectorAll("i.cb").forEach((i) => { i.outerHTML = BOX; });

  /* ---------- sheet chrome ---------- */

  sheets.forEach((sec, i) => {
    const body = document.createElement("div");
    body.className = "sheet-body";
    while (sec.firstChild) {
      const n = sec.firstChild;
      if (n.nodeType === 1 && n.tagName === "ASIDE") break;
      body.appendChild(n);
    }
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.innerHTML =
      '<div class="sheet-head">' +
        '<div><span class="lbl">Form</span><div class="v v-form">' + esc(sec.dataset.form || "") + "</div></div>" +
        '<div><span class="lbl">Sheet</span><div class="v v-title">' + esc(sec.dataset.title || "") + "</div></div>" +
        '<div class="tally-cell"><span class="lbl">Verdicts so far</span>' +
          '<div class="tally-group can"><b>Can</b><div class="tally-marks" data-kind="can"></div></div>' +
          '<div class="tally-group cannot"><b>Cannot</b><div class="tally-marks" data-kind="cannot"></div></div>' +
        "</div>" +
      "</div>";
    sheet.appendChild(body);
    const foot = document.createElement("div");
    foot.className = "sheet-foot";
    foot.innerHTML = "<span>" + FOOT + '</span><span class="sheet-no">Sheet ' +
      String(i + 1).padStart(2, "0") + " of " + String(total).padStart(2, "0") + "</span>";
    sheet.appendChild(foot);
    sec.insertBefore(sheet, sec.firstChild);
  });

  /* ---------- verdict tally ---------- */

  function tallySVG(n, cls) {
    let out = "";
    let left = n;
    while (left > 0) {
      const k = Math.min(5, left);
      let p = "";
      for (let j = 0; j < Math.min(4, k); j++) {
        const x = 6 + j * 11;
        p += "M" + x + " 4 L" + (x + 1) + " 38 ";
      }
      if (k === 5) p += "M0 32 L50 8 ";
      out += '<svg class="' + cls + '" viewBox="0 0 52 42"><path d="' + p +
        '" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>';
      left -= k;
    }
    return out;
  }

  let last = { can: -1, cannot: -1 };

  function countVerdicts() {
    const cur = Reveal.getIndices().h;
    const c = { can: 0, cannot: 0 };
    document.querySelectorAll(".stamp[data-verdict]").forEach((s) => {
      const h = sheets.indexOf(s.closest(".reveal .slides > section"));
      const shown = h < cur || (h === cur && (!s.classList.contains("fragment") || s.classList.contains("visible")));
      if (shown) c[s.dataset.verdict] += 1;
    });
    return c;
  }

  function renderTally() {
    const c = countVerdicts();
    ["can", "cannot"].forEach((k) => {
      const grew = last[k] >= 0 && c[k] > last[k];
      document.querySelectorAll('.tally-marks[data-kind="' + k + '"]').forEach((el) => {
        el.style.color = k === "can" ? "var(--can)" : "var(--cannot)";
        el.innerHTML = c[k] ? tallySVG(c[k], grew ? "new" : "") : '<span class="tally-zero">0</span>';
      });
    });
    last = c;
    const sum = c.can + c.cannot;
    ["can", "cannot"].forEach((k) => {
      const share = sum ? c[k] / sum : 0;
      document.querySelectorAll('[data-share="' + k + '"]').forEach((b) => b.style.setProperty("--p", share));
      document.querySelectorAll('[data-share-v="' + k + '"]').forEach((v) => (v.textContent = share.toFixed(2)));
    });
  }

  /* ---------- countdown (press T) ---------- */

  let timer = null;
  const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

  function toggleCountdown() {
    const slide = Reveal.getCurrentSlide();
    const box = slide && slide.querySelector(".countdown");
    if (!box) return;
    const t = box.querySelector(".t");
    const drain = box.querySelector(".drain i");
    const secs = parseInt(box.dataset.seconds || "30", 10);
    if (timer) { clearInterval(timer); timer = null; return; }
    const start = performance.now();
    box.classList.remove("done");
    timer = setInterval(() => {
      const left = Math.max(0, secs - (performance.now() - start) / 1000);
      t.textContent = fmt(Math.ceil(left));
      drain.style.transform = "scaleX(" + (left / secs) + ")";
      if (left <= 0) { clearInterval(timer); timer = null; box.classList.add("done"); }
    }, 100);
  }

  function resetCountdowns() {
    if (timer) { clearInterval(timer); timer = null; }
    document.querySelectorAll(".countdown").forEach((box) => {
      const secs = parseInt(box.dataset.seconds || "30", 10);
      box.classList.remove("done");
      box.querySelector(".t").textContent = fmt(secs);
      box.querySelector(".drain i").style.transform = "scaleX(1)";
    });
  }

  /* ---------- reliability instrument (real data from the studies) ---------- */

  const DS = {
    p1: {
      src: "Paper 1 · Jev 1.13 · crash narratives",
      head: "Points sit on the line. The tails can be trusted.",
      body: "2,416 blinded human judgments in five bins. When it says 0.98 it is right 99 percent of the time.",
      conf: [0.019, 0.097, 0.477, 0.847, 0.978], acc: [0.001, 0.005, 0.354, 0.855, 0.991]
    },
    p3: {
      src: "Paper 3 · Jev 1.13 · pedestrian direction",
      head: "It says 0.98 and is right less than half the time.",
      body: "Jülich one-way corridor, direction 1 s ahead, about 3,000 decisions in ten bins. Confidence rises, accuracy does not.",
      conf: [0.44, 0.502, 0.562, 0.689, 0.837, 0.907, 0.939, 0.957, 0.971, 0.982],
      acc: [0.226, 0.263, 0.276, 0.66, 0.625, 0.625, 0.58, 0.605, 0.52, 0.465]
    },
    p4laya: {
      src: "Paper 4A · Laya English as shipped · typed decisions",
      head: "A flat curve. Higher confidence does not mean right more often.",
      body: "2,000 benchmark decisions in ten bins. Rescaling cannot fix a model whose confidence does not rank its answers.",
      conf: [0.275, 0.337, 0.385, 0.442, 0.498, 0.532, 0.572, 0.619, 0.699, 0.82],
      acc: [0.285, 0.35, 0.305, 0.29, 0.325, 0.42, 0.475, 0.485, 0.34, 0.39]
    },
    p4raw: {
      src: "Paper 4A · Jev 1.13 as shipped · emotion labels",
      head: "Far below the line. Overconfident on emotion labels.",
      body: "About 50 decisions per bin. Expected calibration error 0.314.",
      conf: [0.46, 0.579, 0.679, 0.765, 0.833, 0.917, 0.962, 0.986, 0.999, 1.0],
      acc: [0.24, 0.40, 0.224, 0.38, 0.34, 0.56, 0.68, 0.531, 0.84, 0.84]
    },
    p4cal: {
      src: "Paper 4A · Jev 1.13 rescaled · emotion labels",
      head: "Temperature scaling pulls it back to the line.",
      body: "Same answers after out-of-fold temperature scaling. Error falls from 0.314 to 0.073. The ranking does not change, only the numbers.",
      conf: [0.244, 0.307, 0.36, 0.405, 0.449, 0.485, 0.534, 0.576, 0.716, 0.739],
      acc: [0.24, 0.44, 0.286, 0.40, 0.48, 0.34, 0.64, 0.551, 0.80, 0.86]
    }
  };
  let ds = "p1";

  function drawCalib() {
    const svg = document.getElementById("calib");
    if (!svg) return;
    const W = 760, H = 660, L = 96, B = 570, T = 20, R = 740;
    const x = (p) => L + p * (R - L);
    const y = (p) => B - p * (B - T);
    const d = DS[ds];
    const good = ds === "p1" || ds === "p4cal";
    const col = good ? "var(--can)" : "var(--cannot)";
    let s = "";
    for (let g = 0; g <= 1.0001; g += 0.2) {
      s += '<line x1="' + x(g) + '" y1="' + T + '" x2="' + x(g) + '" y2="' + B + '" stroke="var(--maroon-faint)" stroke-width="1.5"/>';
      s += '<line x1="' + L + '" y1="' + y(g) + '" x2="' + R + '" y2="' + y(g) + '" stroke="var(--maroon-faint)" stroke-width="1.5"/>';
      s += '<text x="' + x(g) + '" y="' + (B + 38) + '" text-anchor="middle" font-size="26" fill="var(--ink-soft)">' + g.toFixed(1) + "</text>";
      s += '<text x="' + (L - 14) + '" y="' + (y(g) + 9) + '" text-anchor="end" font-size="26" fill="var(--ink-soft)">' + g.toFixed(1) + "</text>";
    }
    s += '<line x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(1) + '" y2="' + y(1) + '" stroke="var(--ink)" stroke-width="2.5" stroke-dasharray="8 8"/>';
    s += '<text x="' + x(0.3) + '" y="' + y(0.37) + '" font-size="24" fill="var(--ink)" transform="rotate(-37 ' + x(0.3) + " " + y(0.37) + ')">stated = observed</text>';
    let path = "";
    d.conf.forEach((c, i) => { path += (i ? " L" : "M") + x(c).toFixed(1) + " " + y(d.acc[i]).toFixed(1); });
    s += '<path d="' + path + '" fill="none" stroke="' + col + '" stroke-width="5" stroke-linejoin="round"/>';
    d.conf.forEach((c, i) => {
      s += '<circle cx="' + x(c).toFixed(1) + '" cy="' + y(d.acc[i]).toFixed(1) + '" r="12" fill="' + col + '" stroke="var(--paper)" stroke-width="3"/>';
    });
    s += '<rect x="' + L + '" y="' + T + '" width="' + (R - L) + '" height="' + (B - T) + '" fill="none" stroke="var(--maroon)" stroke-width="2.5"/>';
    s += '<text x="' + ((L + R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="24" font-weight="700" fill="var(--maroon)" letter-spacing="2">STATED CONFIDENCE</text>';
    s += '<text transform="translate(26 ' + ((T + B) / 2) + ') rotate(-90)" text-anchor="middle" font-size="24" font-weight="700" fill="var(--maroon)" letter-spacing="2">OBSERVED ACCURACY</text>';
    svg.innerHTML = s;
    document.getElementById("ds-src").textContent = d.src;
    document.getElementById("ds-head").textContent = d.head;
    document.getElementById("ds-body").textContent = d.body;
    const n = d.conf.length - 1;
    document.getElementById("ro-stated").textContent = d.conf[n].toFixed(2);
    const ob = document.getElementById("ro-observed");
    ob.textContent = d.acc[n].toFixed(2);
    ob.style.color = Math.abs(d.conf[n] - d.acc[n]) > 0.1 ? "var(--cannot)" : "var(--can)";
  }

  function initInstrument() {
    document.querySelectorAll(".seg button[data-ds]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ds = btn.dataset.ds;
        document.querySelectorAll(".seg button[data-ds]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        drawCalib();
      });
    });
    drawCalib();
  }

  /* ---------- live runner ---------- */

  const PRESETS = window.PRESETS || {};
  const RECORDED = (window.RECORDED && window.RECORDED.runs) || {};
  let runnerUp = false;

  async function pingRunner() {
    try {
      const r = await fetch(RUNNER + "/health", { cache: "no-store" });
      runnerUp = r.ok;
    } catch (e) { runnerUp = false; }
    document.querySelectorAll(".live .runner-flag").forEach((el) => {
      el.textContent = runnerUp ? "Runner live on this laptop" : "Runner off · recorded runs";
      el.parentElement.classList.toggle("on", runnerUp);
    });
  }

  function resultRows(questions, answers, emptyText) {
    return questions.map((q) => {
      const a = answers && answers[q.id];
      let p = null, label = "";
      if (a && typeof a.p_yes === "number") { p = a.p_yes; label = "P(yes)"; }
      else if (a && a.probs) {
        const best = Object.entries(a.probs).sort((u, v) => v[1] - u[1])[0];
        p = best[1]; label = "top option · " + best[0].replace(/_/g, " ");
      }
      const txt = esc(q.instructions.length > 64 ? q.instructions.slice(0, 62) + "…" : q.instructions);
      if (p === null) {
        return '<div class="r"><div class="rq">' + txt + "<small>" + esc(emptyText || "needs the live runner") + '</small></div><div class="bar" style="--p:0"><div class="fill"></div></div><div class="pv">–</div></div>';
      }
      return '<div class="r"><div class="rq">' + txt + "<small>" + esc(label) + '</small></div><div class="bar" style="--p:' + p.toFixed(3) + '"><div class="fill"></div></div><div class="pv">' + p.toFixed(2) + "</div></div>";
    }).join("");
  }

  function buildLive(el) {
    const presetKeys = (el.dataset.presets || el.dataset.preset).split(",");
    const extra = parseInt(el.dataset.extra || "0", 10);
    let key = el.dataset.preset;

    el.innerHTML =
      '<div class="stack" style="gap: 16px; align-content: start;">' +
        (presetKeys.length > 1 ? '<div class="presets">' + presetKeys.map((k) =>
          '<button type="button" class="btn ghost" data-k="' + k + '">' + esc(PRESETS[k].label) + "</button>").join("") + "</div>" : "") +
        '<div class="field"><span class="lbl">State <span class="synthetic-tag">Synthetic</span></span><textarea class="st" rows="3" spellcheck="false"></textarea></div>' +
        '<div class="field"><span class="lbl">Typed questions</span><div class="qs" style="display: grid; gap: 10px;"></div></div>' +
        '<div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">' +
          '<button type="button" class="btn" data-run="both">Run both</button>' +
          '<button type="button" class="btn ghost" data-run="laya">Laya</button>' +
          '<button type="button" class="btn ghost" data-run="jev">Jev</button>' +
          '<span class="run-status"><i></i><span class="runner-flag">Checking runner</span></span>' +
        "</div>" +
      "</div>" +
      '<div class="stack" style="gap: 18px; align-content: start;">' +
        '<div class="field res"><span class="lbl">Laya 0.4.2 · open weights · this laptop</span><div class="rows" data-m="laya"></div><div class="run-meta" data-meta="laya"></div>' +
          (el.dataset.criteriaNote ? '<p class="note fragment" style="margin: 10px 0 0; color: var(--ink);">With plain yes and no descriptions added to each question, Laya moves to 0.37, 0.77 and 0.65. Wording changes the answer.</p>' : "") +
        "</div>" +
        '<div class="field res"><span class="lbl">Jev 1.13 · TypeSafe API</span><div class="rows" data-m="jev"></div><div class="run-meta" data-meta="jev"></div></div>' +
      "</div>";

    const st = el.querySelector(".st");
    const qs = el.querySelector(".qs");

    function currentQuestions() {
      const p = PRESETS[key];
      return Array.from(qs.querySelectorAll("input")).map((inp) => {
        const base = p.questions.find((q) => q.id === inp.dataset.id);
        const text = inp.value.trim();
        if (!text) return null;
        if (base) return Object.assign({}, base, { instructions: text });
        return { id: inp.dataset.id, type: "noul", instructions: text };
      }).filter(Boolean);
    }

    function load(k) {
      key = k;
      const p = PRESETS[k];
      st.value = p.state;
      qs.innerHTML = p.questions.map((q) =>
        '<div class="qedit"><span class="qid">' + (q.type === "choice" ? "pick" : "y/n") + '</span><input type="text" data-id="' + q.id + '" value="' + esc(q.instructions) + '"' + (q.type === "choice" ? " readonly" : "") + "></div>").join("") +
        Array.from({ length: extra }, (_, i) =>
          '<div class="qedit"><span class="qid">y/n</span><input type="text" data-id="class_q' + (i + 1) + '" placeholder="Question from the chat"></div>').join("");
      el.querySelectorAll(".presets .btn").forEach((b) => b.classList.toggle("ghost", b.dataset.k !== k));
      ["laya", "jev"].forEach((m) => {
        el.querySelector('.rows[data-m="' + m + '"]').innerHTML = resultRows(currentQuestions(), null, "not run yet");
        el.querySelector('[data-meta="' + m + '"]').textContent = "";
      });
    }

    async function run(model) {
      const questions = currentQuestions();
      const state = st.value.trim();
      const rowsEl = el.querySelector('.rows[data-m="' + model + '"]');
      const meta = el.querySelector('[data-meta="' + model + '"]');
      meta.textContent = "running";
      let out = null, how = "";
      if (runnerUp) {
        try {
          const r = await fetch(RUNNER + "/run", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, state, questions })
          });
          const j = await r.json();
          if (r.ok) { out = j; how = "live · " + (j.model || model) + " · " + j.latency_ms + " ms"; }
          else { how = "runner error · " + (j.error || r.status); }
        } catch (e) { runnerUp = false; }
      }
      if (!out) {
        const rec = RECORDED[key] && RECORDED[key][model];
        const p = PRESETS[key];
        const answers = {};
        if (rec && state === p.state.trim()) {
          questions.forEach((q) => {
            const orig = p.questions.find((o) => o.id === q.id);
            if (orig && orig.instructions === q.instructions && rec.answers[q.id]) answers[q.id] = rec.answers[q.id];
          });
          how = how || ("recorded run · 10 Oct 2026 · " + (model === "jev" ? "jev-1.13.0" : "laya 0.4.2") + " · " + rec.latency_ms + " ms");
        } else {
          how = how || "runner off · start runner/server.py to run new text";
        }
        out = { answers };
      }
      rowsEl.innerHTML = resultRows(questions, out.answers);
      meta.textContent = how;
    }

    el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.run;
      if (m === "both") { run("laya"); run("jev"); } else run(m);
    }));
    el.querySelectorAll(".presets .btn").forEach((b) => b.addEventListener("click", () => load(b.dataset.k)));
    load(key);
  }

  /* ---------- boot ---------- */

  document.querySelectorAll(".live").forEach(buildLive);

  Reveal.initialize({
    width: 1920,
    height: 1080,
    margin: 0,
    minScale: 0.1,
    maxScale: 2,
    center: false,
    hash: true,
    controls: false,
    progress: false,
    transition: "fade",
    transitionSpeed: "fast",
    backgroundTransition: "none",
    pdfSeparateFragments: false,
    keyboard: { 84: toggleCountdown },
    plugins: [RevealHighlight, RevealNotes]
  }).then(() => {
    initInstrument();
    renderTally();
    pingRunner();
    setInterval(pingRunner, 15000);
    // ?autorun fills every live form on load (used for the PDF backup and checks)
    if (/autorun/.test(location.search)) setTimeout(() => document.querySelectorAll('.live [data-run="both"]').forEach((x) => x.click()), 600);
    Reveal.on("slidechanged", () => { resetCountdowns(); renderTally(); });
    Reveal.on("fragmentshown", renderTally);
    Reveal.on("fragmenthidden", renderTally);
  });
})();
