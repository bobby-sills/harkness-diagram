(() => {
  'use strict';

  // ---------- Constants ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const VB = { w: 1000, h: 720 };
  const CENTER = { x: 500, y: 360 };
  const TABLE = { rx: 300, ry: 170 };
  const ORBIT = { rx: 408, ry: 270 };
  const TAGS = [
    { id: 'q', label: 'Question', key: 'Q' },
    { id: 't', label: 'Cites text', key: 'T' },
    { id: 'b', label: 'Builds on a peer', key: 'B' },
    { id: 'i', label: 'Interrupts', key: 'I' },
  ];
  const STORE_KEY = 'harkness.sessions.v1';
  const CURRENT_KEY = 'harkness.current.v1';
  const FONT_BODY = '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif';

  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  function storage() { try { return window.localStorage; } catch { return null; } }
  function loadAll() {
    try { const s = storage(); return s ? JSON.parse(s.getItem(STORE_KEY) || '{}') || {} : {}; } catch { return {}; }
  }
  function saveAll() {
    try { const s = storage(); if (s) { s.setItem(STORE_KEY, JSON.stringify(all)); s.setItem(CURRENT_KEY, state.id); } } catch { /* storage unavailable */ }
  }
  function loadCurrentId() { try { return storage()?.getItem(CURRENT_KEY) || null; } catch { return null; } }

  // ---------- State ----------
  let all = loadAll();
  let state = null;
  let mode = 'record';
  let replay = null; // null = live, otherwise number of turns shown
  let activeTab = 'summary';
  let drag = null;
  let pulsePid = null;
  let armed = null; // id of a two-step destructive button currently awaiting confirmation

  function defaultTitle() {
    return 'Discussion, ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function makeState(participants = [], title) {
    const now = Date.now();
    return { v: 1, id: uid(), title: title || defaultTitle(), created: now, updated: now, participants, turns: [], timer: { elapsed: 0, since: null } };
  }

  function evenSeats(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pts.push({ x: CENTER.x + ORBIT.rx * Math.cos(a), y: CENTER.y + ORBIT.ry * Math.sin(a) });
    }
    return pts;
  }

  function normalize(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.participants) || !Array.isArray(s.turns)) return null;
    const ids = new Set();
    s.participants = s.participants.filter((p) => p && p.id && typeof p.name === 'string').map((p) => {
      ids.add(p.id);
      return { id: String(p.id), name: p.name.slice(0, 60), x: clamp(+p.x || CENTER.x, 40, VB.w - 40), y: clamp(+p.y || CENTER.y, 40, VB.h - 40) };
    });
    s.turns = s.turns.filter((t) => t && ids.has(t.pid)).map((t) => ({ pid: t.pid, t: Math.max(0, +t.t || 0), tags: Array.isArray(t.tags) ? t.tags.filter((x) => TAGS.some((g) => g.id === x)) : [] }));
    s.timer = s.timer && typeof s.timer === 'object' ? { elapsed: +s.timer.elapsed || 0, since: s.timer.since ? +s.timer.since : null } : { elapsed: 0, since: null };
    s.id = s.id ? String(s.id) : uid();
    s.title = typeof s.title === 'string' && s.title.trim() ? s.title.slice(0, 120) : defaultTitle();
    s.created = +s.created || Date.now();
    s.updated = +s.updated || s.created;
    delete s.sample;
    s.v = 1;
    return s;
  }

  function persist() {
    state.updated = Date.now();
    all[state.id] = state;
    saveAll();
  }

  function switchTo(s) {
    state = s;
    replay = null;
    armed = null;
    all[state.id] = state;
    saveAll();
    renderAll();
  }

  // ---------- Derived data ----------
  const byId = (pid) => state.participants.find((p) => p.id === pid);
  const visibleTurns = () => (replay == null ? state.turns : state.turns.slice(0, replay));

  function elapsedNow() {
    const t = state.timer;
    return t.elapsed + (t.since ? Date.now() - t.since : 0);
  }

  function analyze(turns) {
    const counts = new Map(state.participants.map((p) => [p.id, 0]));
    const tagCounts = new Map(state.participants.map((p) => [p.id, { q: 0, t: 0, b: 0, i: 0 }]));
    const edges = new Map();
    let prev = null;
    for (const t of turns) {
      counts.set(t.pid, (counts.get(t.pid) || 0) + 1);
      const tc = tagCounts.get(t.pid);
      if (tc) for (const g of t.tags) tc[g]++;
      if (prev && prev !== t.pid) {
        const key = [prev, t.pid].sort().join('|');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
      prev = t.pid;
    }
    const n = state.participants.length;
    const vals = [...counts.values()];
    const total = turns.length;
    const heard = vals.filter((v) => v > 0).length;
    let equity = null;
    if (n >= 2 && total > 0) {
      const mean = total / n;
      let sum = 0;
      for (const a of vals) for (const b of vals) sum += Math.abs(a - b);
      const gini = sum / (2 * n * n * mean);
      equity = clamp(1 - gini, 0, 1);
    }
    let topEdge = null;
    for (const [k, w] of edges) if (!topEdge || w > topEdge.w) topEdge = { k, w };
    return { counts, tagCounts, edges, total, heard, n, equity, topEdge };
  }

  function equityLabel(e) {
    if (e == null) return { text: 'Not enough data', cls: '' };
    if (e >= 0.7) return { text: 'Balanced', cls: 'pill-good' };
    if (e >= 0.45) return { text: 'Uneven', cls: 'pill-warn' };
    return { text: 'Dominated', cls: 'pill-danger' };
  }

  // ---------- Board rendering ----------
  const board = $('#board');

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return {
      ink: g('--ink'), muted: g('--muted'), web: g('--web'), onWeb: g('--on-web'), hl: g('--hl'), onHl: g('--on-hl'), latest: g('--latest'),
      table: g('--table'), tableEdge: g('--table-edge'), grain: g('--table-grain'), seat: g('--seat'), silent: g('--silent'),
      line: g('--line'),
    };
  }

  function seatRadius() {
    const n = Math.max(state.participants.length, 1);
    return clamp(1900 / n / 2.3, 26, 44);
  }

  function shorten(a, b, ra, rb) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x1: a.x + (dx / d) * ra, y1: a.y + (dy / d) * ra, x2: b.x - (dx / d) * rb, y2: b.y - (dy / d) * rb };
  }

  function seatLabel(name, r) {
    let label = name.trim();
    const maxChars = Math.round(r / 4.4);
    if (label.length > maxChars && label.includes(' ')) label = label.split(/\s+/)[0];
    if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';
    const size = clamp((r * 1.75) / Math.max(label.length, 3) * 1.6, 11, r * 0.46);
    return { label, size };
  }

  function renderBoard() {
    const c = palette();
    const turns = visibleTurns();
    const a = analyze(turns);
    const R = seatRadius();
    const focusedPid = document.activeElement?.closest?.('#board .seat')?.dataset.pid;

    board.textContent = '';
    board.classList.toggle('arranging', mode === 'arrange');

    const defs = el('defs', {}, board);
    const edgeWidth = (w) => Math.min(1.8 + (w - 1) * 1.6, 11);
    const last = turns[turns.length - 1];
    const prevTurn = turns[turns.length - 2];
    const latestKey = last && prevTurn && prevTurn.pid !== last.pid ? [prevTurn.pid, last.pid].sort().join('|') : null;
    const latestWidth = latestKey ? Math.max(4.5, edgeWidth(a.edges.get(latestKey) || 1)) : 0;
    const arrowSize = 14 + latestWidth * 1.6;
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '1', refY: '5', markerUnits: 'userSpaceOnUse', markerWidth: arrowSize.toFixed(1), markerHeight: arrowSize.toFixed(1), orient: 'auto' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: c.latest }, marker);

    // Table
    el('ellipse', { cx: CENTER.x, cy: CENTER.y + 6, rx: TABLE.rx, ry: TABLE.ry, fill: c.tableEdge, opacity: '0.35' }, board);
    el('ellipse', { cx: CENTER.x, cy: CENTER.y, rx: TABLE.rx, ry: TABLE.ry, fill: c.table, stroke: c.tableEdge, 'stroke-width': '3' }, board);
    for (let i = 1; i <= 3; i++) {
      el('ellipse', { cx: CENTER.x, cy: CENTER.y, rx: TABLE.rx - i * 42, ry: TABLE.ry - i * 30, fill: 'none', stroke: c.grain, 'stroke-width': '1.5' }, board);
    }
    const tableText = el('text', { x: CENTER.x, y: CENTER.y - 4, 'text-anchor': 'middle', fill: c.ink, opacity: '0.55', 'font-family': FONT_BODY, 'font-size': '22', 'font-weight': '700', 'letter-spacing': '3' }, board);
    tableText.textContent = a.total === 1 ? '1 TURN' : `${a.total} TURNS`;
    const tableText2 = el('text', { x: CENTER.x, y: CENTER.y + 24, 'text-anchor': 'middle', fill: c.ink, opacity: '0.55', 'font-family': FONT_BODY, 'font-size': '17' }, board);
    tableText2.textContent = a.n ? `${a.heard} of ${a.n} voices heard` : 'Add participants in the Roster tab';

    if (mode === 'arrange') {
      el('ellipse', { cx: CENTER.x, cy: CENTER.y, rx: ORBIT.rx, ry: ORBIT.ry, fill: 'none', stroke: c.muted, 'stroke-width': '1.5', 'stroke-dasharray': '4 8', opacity: '0.6' }, board);
    }

    // Web lines
    const webG = el('g', { 'stroke-linecap': 'round' }, board);
    for (const [key, w] of a.edges) {
      if (key === latestKey) continue; // drawn in gold below, at the same thickness
      const [p1, p2] = key.split('|').map(byId);
      if (!p1 || !p2) continue;
      const s = shorten(p1, p2, R, R);
      el('line', { ...s, stroke: c.web, 'stroke-width': edgeWidth(w).toFixed(1), opacity: '0.62' }, webG);
    }

    // Latest exchange: one gold line, as thick as that pair's web line, ending in an arrow
    if (latestKey) {
      const p1 = byId(prevTurn.pid), p2 = byId(last.pid);
      if (p1 && p2) {
        // Stop the line where the arrowhead starts so its end cap never shows past the tip
        const s = shorten(p1, p2, R, R + 3 + arrowSize * 0.9);
        el('line', { ...s, stroke: c.latest, 'stroke-width': latestWidth.toFixed(1), 'stroke-linecap': 'round', 'marker-end': 'url(#arrow)' }, board);
      }
    }

    // Seats
    state.participants.forEach((p, idx) => {
      const count = a.counts.get(p.id) || 0;
      const isLast = last && last.pid === p.id;
      const g = el('g', {
        class: 'seat' + (p.id === pulsePid ? ' pulse' : '') + (drag && drag.pid === p.id ? ' dragging' : ''),
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
        'data-pid': p.id, tabindex: '0', role: 'button',
        'aria-label': mode === 'arrange' ? `${p.name}, seat ${idx + 1}. Drag to move.` : `${p.name}, ${count} ${count === 1 ? 'turn' : 'turns'}. Record a turn.`,
      }, board);
      const inner = el('g', { class: 'seat-scale' }, g);
      el('circle', { class: 'seat-hit', r: R + 7, fill: 'transparent' }, inner);
      el('circle', {
        class: 'seat-body', r: R, fill: c.seat,
        stroke: isLast ? c.latest : count ? c.ink : c.silent, 'stroke-width': isLast ? '5' : count ? '2.5' : '2',
        'stroke-dasharray': count ? 'none' : '5 5',
      }, inner);
      const { label, size } = seatLabel(p.name, R);
      const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: '1', fill: count ? c.ink : c.muted, 'font-family': FONT_BODY, 'font-weight': '700', 'font-size': size.toFixed(1) }, inner);
      t.textContent = label;
      const title = el('title', {}, g);
      title.textContent = p.name;
      if (count) {
        const bx = R * 0.72, by = -R * 0.72, br = clamp(R * 0.38, 12, 16);
        el('circle', { cx: bx, cy: by, r: br, fill: c.web }, inner);
        const bt = el('text', { x: bx, y: by + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: c.onWeb, 'font-family': FONT_BODY, 'font-weight': '700', 'font-size': (br * 1.05).toFixed(1) }, inner);
        bt.textContent = count;
      }
    });

    if (focusedPid) board.querySelector(`.seat[data-pid="${CSS.escape(focusedPid)}"]`)?.focus({ preventScroll: true });
    pulsePid = null;
  }

  // ---------- Other renderers ----------
  function renderHeader() {
    const title = $('#title');
    if (document.activeElement !== title) title.value = state.title;
    $('#date').textContent = fmtDate(state.created);
    $('#undo').disabled = !state.turns.length;
    $('#mode-record').setAttribute('aria-pressed', String(mode === 'record'));
    $('#mode-arrange').setAttribute('aria-pressed', String(mode === 'arrange'));
    $('#hint').textContent = mode === 'arrange'
      ? 'Drag each seat to where that person is sitting. Add or rename people in the Roster tab.'
      : state.participants.length
        ? 'Tap whoever speaks. A line joins each speaker to the one before, and repeated exchanges thicken it.'
        : 'Add the people at the table in the Roster tab to get started.';
    renderClock();
  }

  function renderClock() {
    const clock = $('#clock');
    clock.textContent = fmtTime(elapsedNow());
    clock.classList.toggle('running', !!state.timer.since);
    $('#timer-btn').textContent = state.timer.since ? 'Pause' : state.timer.elapsed ? 'Resume' : 'Start timer';
  }

  function renderTagbar() {
    const turns = visibleTurns();
    const last = turns[turns.length - 1];
    const live = replay == null;
    const latest = $('#latest');
    if (!last) {
      latest.textContent = state.turns.length ? 'Start of discussion' : 'No turns yet';
    } else {
      const p = byId(last.pid);
      const prev = turns[turns.length - 2];
      const pp = prev && prev.pid !== last.pid ? byId(prev.pid) : null;
      latest.innerHTML = `${live ? 'Latest' : 'Turn ' + turns.length}: <strong>${esc(p ? p.name : '?')}</strong>` +
        (pp ? ` <span class="from">after ${esc(pp.name)}</span>` : '') +
        ` <span class="mono from">${fmtTime(last.t)}</span>`;
    }
    const wrap = $('#tag-buttons');
    wrap.textContent = '';
    for (const g of TAGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.tag = g.id;
      b.disabled = !last || !live;
      b.setAttribute('aria-pressed', String(!!(last && last.tags.includes(g.id))));
      b.title = `Tag the latest turn as “${g.label}” (key ${g.key})`;
      b.innerHTML = `<span class="k">${g.key}</span>${esc(g.label)}`;
      wrap.appendChild(b);
    }
  }

  function renderReplay() {
    const r = $('#replay');
    const n = state.turns.length;
    r.max = String(n);
    r.value = String(replay == null ? n : replay);
    r.disabled = n === 0;
    $('#replay-label').textContent = replay == null ? (n ? 'Live' : '–') : `${replay} / ${n}`;
    // Keep the button's space reserved so the slider never changes width mid-drag
    const liveBtn = $('#replay-live');
    liveBtn.classList.toggle('is-idle', replay == null);
    liveBtn.disabled = replay == null;
  }

  function renderSummary() {
    const turns = visibleTurns();
    const a = analyze(turns);
    const eq = equityLabel(a.equity);
    const duration = replay == null ? elapsedNow() : (turns.length ? turns[turns.length - 1].t : 0);
    const max = Math.max(1, ...a.counts.values());
    const silent = state.participants.filter((p) => !a.counts.get(p.id));
    let top = '';
    if (a.topEdge) {
      const [x, y] = a.topEdge.k.split('|').map(byId);
      if (x && y) top = `<p class="insight"><b>Most frequent exchange:</b> ${esc(x.name)} ↔ ${esc(y.name)} (${a.topEdge.w}×)</p>`;
    }
    const leaders = [...a.counts.entries()].sort((m, n) => n[1] - m[1]);
    const leadShare = a.total ? leaders[0][1] / a.total : 0;
    const leadNote = a.total >= 6 && a.n >= 3 && leadShare >= 2.2 / a.n
      ? `<p class="insight"><b>${esc(byId(leaders[0][0]).name)}</b> has taken ${Math.round(leadShare * 100)}% of turns; an even share would be about ${Math.round(100 / a.n)}%.</p>`
      : '';

    const rows = state.participants
      .map((p) => ({ p, c: a.counts.get(p.id) || 0, tc: a.tagCounts.get(p.id) }))
      .sort((m, n) => n.c - m.c || m.p.name.localeCompare(n.p.name))
      .map(({ p, c, tc }) => `
        <tr class="${c ? '' : 'silent'}">
          <td class="name" title="${esc(p.name)}">${esc(p.name)}</td>
          <td class="num">${c}</td>
          <td><div class="share"><div class="share-track"><div class="share-fill" style="width:${(c / max) * 100}%"></div></div><span class="share-pct">${a.total ? Math.round((c / a.total) * 100) : 0}%</span></div></td>
          ${TAGS.map((g) => `<td class="num">${tc[g.id] || ''}</td>`).join('')}
        </tr>`).join('');

    $('#tab-summary').innerHTML = `
      <div class="stats">
        <div class="stat"><div class="stat-label">Turns</div><div class="stat-value">${a.total}</div></div>
        <div class="stat"><div class="stat-label">Voices heard</div><div class="stat-value">${a.heard}<small>of ${a.n}</small></div></div>
        <div class="stat"><div class="stat-label">Balance</div><div class="stat-value">${a.equity == null ? '–' : Math.round(a.equity * 100)}${eq.cls ? `<span class="pill ${eq.cls}">${eq.text}</span>` : ''}</div></div>
        <div class="stat"><div class="stat-label">${replay == null ? 'Elapsed' : 'At this turn'}</div><div class="stat-value mono">${fmtTime(duration)}</div></div>
      </div>
      ${top}${leadNote}
      ${silent.length && a.n ? `<div><h3 class="section-title">Not yet heard</h3><ul class="silent-list">${silent.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul></div>` : ''}
      ${a.n ? `<div style="overflow-x:auto">
        <table class="people">
          <thead><tr><th>Name</th><th class="num">Turns</th><th>Share</th>${TAGS.map((g) => `<th class="num" title="${g.label}">${g.key}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : '<p class="empty">No participants yet. Add names in the Roster tab.</p>'}
      <p class="legend">${TAGS.map((g) => `<b>${g.key}</b> ${g.label.toLowerCase()}`).join(' · ')}. Balance runs 0–100: 100 means everyone spoke equally often.</p>`;
  }

  function renderLog() {
    const panel = $('#tab-log');
    if (!state.turns.length) {
      panel.innerHTML = '<p class="empty">Turns appear here as you record them, newest first.</p>';
      return;
    }
    const items = state.turns.map((t, i) => {
      const p = byId(t.pid);
      const prev = state.turns[i - 1];
      const pp = prev && prev.pid !== t.pid ? byId(prev.pid) : null;
      const tags = t.tags.length ? `<span class="ltags">${t.tags.map((id) => { const g = TAGS.find((x) => x.id === id); return `<span class="ltag" title="${g.label}">${g.key}</span>`; }).join('')}</span>` : '';
      return `<li>
        <span class="n">${i + 1}</span><span class="t">${fmtTime(t.t)}</span>
        <span class="who"><b>${esc(p ? p.name : '?')}</b>${tags}${pp ? ` <span class="from">after ${esc(pp.name)}</span>` : ''}</span>
        <button class="x-btn" type="button" data-del-turn="${i}" title="Delete this turn" aria-label="Delete turn ${i + 1}">×</button>
      </li>`;
    }).reverse().join('');
    panel.innerHTML = `<ol class="log">${items}</ol>`;
  }

  function renderRoster() {
    const list = $('#roster-list');
    const a = analyze(state.turns);
    const focused = document.activeElement?.dataset?.rename;
    list.innerHTML = state.participants.map((p, i) => {
      const c = a.counts.get(p.id) || 0;
      return `<li>
        <span class="seatno">${i + 1}</span>
        <label class="sr-only" for="rn-${esc(p.id)}">Name for seat ${i + 1}</label>
        <input id="rn-${esc(p.id)}" type="text" value="${esc(p.name)}" data-rename="${esc(p.id)}" autocomplete="off">
        <span class="cnt" title="Turns">${c}</span>
        <button class="btn btn-sm btn-danger" type="button" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button>
      </li>`;
    }).join('') || '<li class="empty">Nobody at the table yet.</li>';
    if (focused) list.querySelector(`[data-rename="${CSS.escape(focused)}"]`)?.focus();
    $('#spread').disabled = $('#shuffle').disabled = state.participants.length < 2;
  }

  function renderSaved() {
    const items = Object.values(all).filter(Boolean).sort((a, b) => b.updated - a.updated);
    $('#saved-list').innerHTML = items.map((s) => {
      const cur = s.id === state.id;
      const armedHere = armed === 'del:' + s.id;
      return `<li class="${cur ? 'current' : ''}">
        <span class="s-title" title="${esc(s.title)}">${esc(s.title)}</span>
        <span class="s-meta">${fmtDate(s.created)} · ${s.participants.length} people · ${s.turns.length} turns${cur ? ' · open now' : ''}</span>
        <span class="s-actions">
          ${cur ? '' : `<button class="btn btn-sm" type="button" data-open="${esc(s.id)}">Open</button>`}
          <button class="btn btn-sm btn-danger${armedHere ? ' armed' : ''}" type="button" data-delete="${esc(s.id)}">${armedHere ? 'Confirm' : 'Delete'}</button>
        </span>
      </li>`;
    }).join('');
  }

  function renderPanel() {
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
    for (const t of ['summary', 'log', 'roster', 'saved']) $('#tab-' + t).hidden = t !== activeTab;
    if (activeTab === 'summary') renderSummary();
    else if (activeTab === 'log') renderLog();
    else if (activeTab === 'roster') renderRoster();
    else renderSaved();
  }

  function renderAll() {
    renderHeader();
    renderBoard();
    renderTagbar();
    renderReplay();
    renderPanel();
  }

  // ---------- Actions ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function recordTurn(pid) {
    if (!byId(pid)) return;
    replay = null;
    if (!state.timer.since && state.timer.elapsed === 0) state.timer.since = Date.now();
    state.turns.push({ pid, t: elapsedNow(), tags: [] });
    pulsePid = pid;
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    persist();
    renderAll();
  }

  function undo() {
    if (!state.turns.length) return;
    const t = state.turns.pop();
    replay = null;
    persist();
    renderAll();
    toast(`Removed ${byId(t.pid)?.name || 'turn'}'s last turn`);
  }

  function toggleTag(tag) {
    const last = state.turns[state.turns.length - 1];
    if (!last || replay != null) return;
    last.tags = last.tags.includes(tag) ? last.tags.filter((x) => x !== tag) : [...last.tags, tag];
    persist();
    renderTagbar();
    renderPanel();
  }

  function openSpot() {
    const R = seatRadius();
    let best = null;
    for (let i = 0; i < 72; i++) {
      const a = -Math.PI / 2 + (i / 72) * Math.PI * 2;
      const pt = { x: CENTER.x + ORBIT.rx * Math.cos(a), y: CENTER.y + ORBIT.ry * Math.sin(a) };
      const d = Math.min(Infinity, ...state.participants.map((p) => Math.hypot(p.x - pt.x, p.y - pt.y)));
      if (!best || d > best.d) best = { ...pt, d };
      if (d > R * 6) break;
    }
    return best;
  }

  function addPeople(names) {
    const clean = names.map((n) => n.trim()).filter(Boolean).map((n) => n.slice(0, 60));
    if (!clean.length) return 0;
    const wasEven = state.participants.length === 0;
    for (const name of clean) {
      const spot = openSpot();
      state.participants.push({ id: uid(), name, x: spot.x, y: spot.y });
    }
    if (wasEven) spread();
    persist();
    renderAll();
    return clean.length;
  }

  function spread() {
    const pts = evenSeats(state.participants.length);
    state.participants.forEach((p, i) => { p.x = pts[i].x; p.y = pts[i].y; });
  }

  function removePerson(pid) {
    state.participants = state.participants.filter((p) => p.id !== pid);
    state.turns = state.turns.filter((t) => t.pid !== pid);
    replay = null;
    persist();
    renderAll();
  }

  function setMode(m) {
    mode = m;
    renderHeader();
    renderBoard();
  }

  // ---------- Modal ----------
  let modalReturn = null;
  function showModal({ title, body, actions }) {
    modalReturn = document.activeElement;
    $('#modal-title').textContent = title;
    const b = $('#modal-body');
    b.textContent = '';
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    const act = $('#modal-actions');
    act.textContent = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (a.primary ? ' btn-primary' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => { if (a.onClick?.() !== false) closeModal(); });
      act.appendChild(btn);
    }
    $('#modal').hidden = false;
    act.querySelector('.btn-primary, .btn')?.focus();
  }
  function closeModal() {
    $('#modal').hidden = true;
    modalReturn?.focus?.();
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  function newDiscussion() {
    const hasPeople = state.participants.length > 0;
    showModal({
      title: 'Start a new discussion',
      body: `<p>“${esc(state.title)}” is saved in the Saved tab.</p>` +
        (hasPeople ? `<p>Keep the same ${state.participants.length} people in the same seats, or start with an empty table.</p>` : ''),
      actions: [
        { label: 'Cancel' },
        ...(hasPeople ? [{ label: 'Empty table', onClick: () => { switchTo(makeState()); activeTab = 'roster'; renderPanel(); } }] : []),
        {
          label: hasPeople ? 'Same seating' : 'Start', primary: true,
          onClick: () => {
            const people = state.participants.map((p) => ({ ...p }));
            switchTo(makeState(people));
            if (!people.length) { activeTab = 'roster'; renderPanel(); $('#add-name').focus(); }
          },
        },
      ],
    });
  }

  // ---------- Export ----------
  function summaryText() {
    const a = analyze(state.turns);
    const lines = [
      state.title,
      fmtDate(state.created) + ' · ' + fmtTime(elapsedNow()),
      `${a.total} turns · ${a.heard} of ${a.n} voices heard · balance ${a.equity == null ? '–' : Math.round(a.equity * 100)}/100`,
      '',
      ...state.participants
        .map((p) => ({ p, c: a.counts.get(p.id) || 0, tc: a.tagCounts.get(p.id) }))
        .sort((m, n) => n.c - m.c)
        .map(({ p, c, tc }) => {
          const tags = TAGS.filter((g) => tc[g.id]).map((g) => `${tc[g.id]} ${g.label.toLowerCase()}`).join(', ');
          return `${p.name}: ${c} ${c === 1 ? 'turn' : 'turns'}${tags ? ` (${tags})` : ''}`;
        }),
    ];
    if (a.topEdge) {
      const [x, y] = a.topEdge.k.split('|').map(byId);
      if (x && y) lines.push('', `Most frequent exchange: ${x.name} ↔ ${y.name} (${a.topEdge.w}×)`);
    }
    return lines.join('\n');
  }

  function slug() {
    return (state.title || 'harkness').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'harkness';
  }

  function tryDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.rows = 10;
      ta.style.width = '100%';
      ta.readOnly = true;
      showModal({ title: 'Copy this text', body: ta, actions: [{ label: 'Done', primary: true }] });
      ta.focus();
      ta.select();
    }
  }

  async function exportImage() {
    const c = palette();
    const bg = getComputedStyle(document.body).backgroundColor;
    const svg = board.cloneNode(true);
    svg.setAttribute('xmlns', SVGNS);
    svg.setAttribute('width', '2000');
    svg.setAttribute('height', '1440');
    svg.querySelectorAll('.seat-hit').forEach((n) => n.remove());
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    try { await img.decode(); } catch { toast('Could not draw the image. Try again.'); return; }

    const turns = visibleTurns();
    const a = analyze(turns);
    const W = 2000, head = 190, foot = 110;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = head + 1440 + foot;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = c.ink;
    ctx.font = '800 64px "Bricolage Grotesque", Arial, sans-serif';
    ctx.fillText(state.title, 80, 110, W - 160);
    ctx.fillStyle = c.muted;
    ctx.font = '400 34px ' + FONT_BODY;
    const dur = replay == null ? elapsedNow() : (turns.length ? turns[turns.length - 1].t : 0);
    ctx.fillText(`${fmtDate(state.created)}  ·  ${fmtTime(dur)}  ·  ${a.total} turns  ·  ${a.heard} of ${a.n} voices heard  ·  balance ${a.equity == null ? '–' : Math.round(a.equity * 100)}/100`, 80, 165, W - 160);
    ctx.drawImage(img, 0, head, 2000, 1440);
    ctx.fillStyle = c.muted;
    ctx.font = '400 28px ' + FONT_BODY;
    ctx.fillText('Line thickness shows how often two people spoke back to back. Highlight marks the most recent exchange. Dashed seats have not spoken.', 80, head + 1440 + 60, W - 160);

    const url = canvas.toDataURL('image/png');
    const preview = document.createElement('div');
    preview.innerHTML = '<p>If the download doesn’t start, press and hold (or right-click) the image to save or copy it.</p>';
    const im = document.createElement('img');
    im.src = url;
    im.alt = `Spiderweb map for ${state.title}`;
    preview.appendChild(im);
    showModal({
      title: 'Image of the map',
      body: preview,
      actions: [{ label: 'Close' }, { label: 'Download PNG', primary: true, onClick: () => { tryDownload(url, slug() + '.png'); return false; } }],
    });
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    tryDownload(url, slug() + '.harkness.json');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Exported ' + slug() + '.harkness.json');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let s = null;
      try { s = normalize(JSON.parse(String(reader.result))); } catch { s = null; }
      if (!s) { toast('That file isn’t a Harkness discussion export.'); return; }
      if (all[s.id] && all[s.id] !== s) s.id = uid();
      s.timer.since = null;
      switchTo(s);
      toast('Imported “' + s.title + '”');
    };
    reader.readAsText(file);
  }

  // ---------- Events ----------
  function svgPoint(evt) {
    const pt = board.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(board.getScreenCTM().inverse());
  }

  board.addEventListener('pointerdown', (e) => {
    if (mode !== 'arrange') return;
    const seat = e.target.closest('.seat');
    if (!seat) return;
    const p = byId(seat.dataset.pid);
    const pt = svgPoint(e);
    drag = { pid: p.id, dx: p.x - pt.x, dy: p.y - pt.y, id: e.pointerId };
    board.setPointerCapture(e.pointerId);
    seat.classList.add('dragging');
    e.preventDefault();
  });
  board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = byId(drag.pid);
    const pt = svgPoint(e);
    const R = seatRadius();
    p.x = clamp(pt.x + drag.dx, R + 4, VB.w - R - 4);
    p.y = clamp(pt.y + drag.dy, R + 4, VB.h - R - 4);
    renderBoard();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    persist();
    renderBoard();
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  board.addEventListener('click', (e) => {
    const seat = e.target.closest('.seat');
    if (seat && mode === 'record') recordTurn(seat.dataset.pid);
  });
  board.addEventListener('keydown', (e) => {
    const seat = e.target.closest('.seat');
    if (!seat) return;
    if ((e.key === 'Enter' || e.key === ' ') && mode === 'record') {
      e.preventDefault();
      recordTurn(seat.dataset.pid);
    } else if (mode === 'arrange' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const p = byId(seat.dataset.pid);
      const step = e.shiftKey ? 40 : 10;
      if (e.key === 'ArrowLeft') p.x -= step;
      if (e.key === 'ArrowRight') p.x += step;
      if (e.key === 'ArrowUp') p.y -= step;
      if (e.key === 'ArrowDown') p.y += step;
      const R = seatRadius();
      p.x = clamp(p.x, R + 4, VB.w - R - 4);
      p.y = clamp(p.y, R + 4, VB.h - R - 4);
      persist();
      renderBoard();
    }
  });

  $('#title').addEventListener('input', (e) => {
    state.title = e.target.value.slice(0, 120) || defaultTitle();
    persist();
  });
  $('#title').addEventListener('blur', () => { renderHeader(); if (activeTab === 'saved') renderSaved(); });
  $('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $('#timer-btn').addEventListener('click', () => {
    const t = state.timer;
    if (t.since) { t.elapsed += Date.now() - t.since; t.since = null; } else { t.since = Date.now(); }
    persist();
    renderClock();
  });
  $('#timer-reset').addEventListener('click', () => {
    state.timer = { elapsed: 0, since: null };
    persist();
    renderClock();
    toast('Timer reset');
  });
  setInterval(() => { if (state.timer.since) { renderClock(); if (activeTab === 'summary' && replay == null) renderSummary(); } }, 1000);

  $('#mode-record').addEventListener('click', () => setMode('record'));
  $('#mode-arrange').addEventListener('click', () => setMode('arrange'));
  $('#undo').addEventListener('click', undo);
  $('#new-btn').addEventListener('click', newDiscussion);
  $('#export-png').addEventListener('click', exportImage);
  $('#export-json').addEventListener('click', exportJSON);
  $('#copy-summary').addEventListener('click', () => copyText(summaryText(), 'Summary copied'));
  $('#import-json').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; });

  $('#tag-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) toggleTag(b.dataset.tag);
  });

  $('#replay').addEventListener('input', (e) => {
    const v = +e.target.value;
    replay = v >= state.turns.length ? null : v;
    renderBoard();
    renderTagbar();
    renderReplay();
    if (activeTab === 'summary') renderSummary();
  });
  $('#replay-live').addEventListener('click', () => { replay = null; renderAll(); });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    activeTab = b.dataset.tab;
    armed = null;
    renderPanel();
  });
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('.tab')];
    const i = tabs.findIndex((t) => t.dataset.tab === activeTab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    activeTab = next.dataset.tab;
    renderPanel();
    next.focus();
  });

  $('#tab-log').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del-turn]');
    if (!b) return;
    state.turns.splice(+b.dataset.delTurn, 1);
    replay = null;
    persist();
    renderAll();
    toast('Turn deleted');
  });

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#add-name');
    const n = addPeople([input.value]);
    if (n) toast(`Added ${input.value.trim()}`);
    input.value = '';
    input.focus();
  });
  $('#bulk-add').addEventListener('click', () => {
    const ta = $('#bulk-names');
    const names = ta.value.split(/[\n,;]+/);
    const n = addPeople(names);
    ta.value = '';
    toast(n ? `Added ${n} ${n === 1 ? 'person' : 'people'}` : 'Type or paste some names first');
  });
  $('#roster-list').addEventListener('input', (e) => {
    const id = e.target.dataset.rename;
    if (!id) return;
    const p = byId(id);
    if (!p) return;
    p.name = e.target.value.slice(0, 60);
    persist();
    renderBoard();
    renderTagbar();
  });
  $('#roster-list').addEventListener('change', (e) => {
    const id = e.target.dataset.rename;
    const p = id && byId(id);
    if (p && !p.name.trim()) { p.name = 'Seat ' + (state.participants.indexOf(p) + 1); persist(); renderAll(); }
  });
  $('#roster-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const id = b.dataset.remove;
    const name = byId(id)?.name;
    const n = state.turns.filter((t) => t.pid === id).length;
    removePerson(id);
    toast(n ? `Removed ${name} and ${n} ${n === 1 ? 'turn' : 'turns'}` : `Removed ${name}`);
  });
  $('#spread').addEventListener('click', () => { spread(); persist(); renderBoard(); toast('Seats spread evenly'); });
  $('#shuffle').addEventListener('click', () => {
    const ps = state.participants;
    const pos = ps.map((p) => ({ x: p.x, y: p.y }));
    for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
    ps.forEach((p, i) => { p.x = pos[i].x; p.y = pos[i].y; });
    persist();
    renderAll();
    toast('Seating shuffled');
  });

  $('#saved-list').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-delete]');
    if (open) {
      const s = normalize(all[open.dataset.open]);
      if (s) { switchTo(s); toast(`Opened “${s.title}”`); }
    } else if (del) {
      const id = del.dataset.delete;
      if (armed !== 'del:' + id) { armed = 'del:' + id; renderSaved(); return; }
      armed = null;
      const title = all[id]?.title;
      delete all[id];
      if (id === state.id) {
        const next = Object.values(all).sort((a, b) => b.updated - a.updated)[0];
        state = next ? normalize(next) : makeState();
        replay = null;
        all[state.id] = state;
      }
      saveAll();
      renderAll();
      toast(`Deleted “${title}”`);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(); return; }
    if (e.key === 'Escape' && tourStep >= 0) { endTour(); return; }
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !$('#modal').hidden || tourStep >= 0) return;
    const g = TAGS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (g) toggleTag(g.id);
  });

  // Clicking anywhere else disarms two-step buttons
  document.addEventListener('click', (e) => {
    if (armed && !e.target.closest('[data-delete]')) {
      armed = null;
      if (activeTab === 'roster') renderRoster();
      if (activeTab === 'saved') renderSaved();
    }
  }, true);


  // ---------- First-visit tour ----------
  const TOUR_KEY = 'harkness.toured';
  const TOUR = [
    { target: '#add-name', tab: 'roster', title: 'Add your class', text: 'Type each person at the table and press Add. To add a whole class list at once, use “Paste a whole class list” below.' },
    { target: '#mode-arrange', title: 'Match the seating', text: 'Switch to Arrange seats and drag each seat to where that person is actually sitting.' },
    { target: '#board-wrap', title: 'Tap whoever speaks', text: 'In Record mode, tap a seat each time someone talks. A line joins each speaker to the one before, and it thickens when the same two people go back and forth.' },
    { target: '#tag-buttons', title: 'Tag a turn', text: 'Mark the latest turn as a question, a text citation, building on a peer, or an interruption. The Q, T, B and I keys work too.' },
    { target: '#undo', title: 'Fix a mis-tap', text: 'Undo removes the last turn. You can delete any turn from the Log tab.' },
    { target: '#tab-btn-summary', tab: 'summary', title: 'Check the balance', text: 'Summary shows who has spoken, who hasn’t yet, and how evenly the talk is shared.' },
    { target: '#export-png', title: 'Keep a record', text: 'Save an image of the map to share with students. Discussions also save automatically in this browser under the Saved tab.' },
  ];
  let tourStep = -1;
  const tip = $('#tour');

  function startTour() {
    closeModal();
    tourStep = 0;
    showTourStep();
  }
  function endTour() {
    tourStep = -1;
    tip.hidden = true;
    document.querySelector('.tour-target')?.classList.remove('tour-target');
    try { storage()?.setItem(TOUR_KEY, '1'); } catch { /* storage unavailable */ }
  }
  function showTourStep() {
    const step = TOUR[tourStep];
    if (step.tab && activeTab !== step.tab) { activeTab = step.tab; renderPanel(); }
    document.querySelector('.tour-target')?.classList.remove('tour-target');
    const target = $(step.target);
    target.classList.add('tour-target');
    $('#tour-count').textContent = `${tourStep + 1} of ${TOUR.length}`;
    $('#tour-title').textContent = step.title;
    $('#tour-text').textContent = step.text;
    $('#tour-back').hidden = tourStep === 0;
    $('#tour-next').textContent = tourStep === TOUR.length - 1 ? 'Got it' : 'Next';
    tip.hidden = false;
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    placeTip();
    $('#tour-next').focus({ preventScroll: true });
  }
  function placeTip() {
    if (tourStep < 0) return;
    const r = $(TOUR[tourStep].target).getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14, edge = 16;
    let below = r.bottom + gap + th <= vh - edge || r.top - gap - th < edge;
    // A target taller than the screen (the map on a phone): pin the tip inside it
    let top = below ? r.bottom + gap : r.top - gap - th;
    top = clamp(top, edge, vh - th - edge);
    const cx = r.left + r.width / 2;
    const left = clamp(cx - tw / 2, edge, vw - tw - edge);
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    const arrowX = clamp(cx - left, 18, tw - 18);
    tip.style.setProperty('--arrow-x', arrowX + 'px');
    const overlaps = top < r.bottom && top + th > r.top;
    tip.dataset.side = overlaps ? 'none' : below ? 'below' : 'above';
  }
  $('#tour-next').addEventListener('click', () => { if (tourStep >= TOUR.length - 1) endTour(); else { tourStep++; showTourStep(); } });
  $('#tour-back').addEventListener('click', () => { if (tourStep > 0) { tourStep--; showTourStep(); } });
  $('#tour-skip').addEventListener('click', endTour);
  $('#help-btn').addEventListener('click', startTour);
  window.addEventListener('resize', placeTip);
  window.addEventListener('scroll', placeTip, { passive: true });

  // ---------- Theme ----------
  const THEME_KEY = 'harkness.theme';
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function renderThemeBtn() {
    const dark = effectiveTheme() === 'dark';
    const b = $('#theme-btn');
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    b.setAttribute('aria-pressed', String(dark));
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  $('#theme-btn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { storage()?.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  });
  try { const t = storage()?.getItem(THEME_KEY); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch { /* storage unavailable */ }

  // Re-render the board when the colour theme changes
  const rerenderTheme = () => { renderBoard(); renderThemeBtn(); };
  try { darkQuery.addEventListener('change', rerenderTheme); } catch { /* old browser */ }
  new MutationObserver(rerenderTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  if (document.fonts?.ready) document.fonts.ready.then(() => renderBoard());

  // ---------- Boot ----------
  // Older versions stored an example discussion; drop it along with anything unreadable
  for (const k of Object.keys(all)) { const s = all[k]?.sample ? null : normalize(all[k]); if (s) all[k] = s; else delete all[k]; }
  const cur = loadCurrentId();
  state = (cur && all[cur]) || Object.values(all).sort((a, b) => b.updated - a.updated)[0] || null;
  if (!state) { state = makeState(); all[state.id] = state; saveAll(); }
  if (!state.participants.length) activeTab = 'roster';
  renderAll();
  renderThemeBtn();
  let toured = false;
  try { toured = storage()?.getItem(TOUR_KEY) === '1'; } catch { /* storage unavailable */ }
  if (!toured) startTour();
})();
