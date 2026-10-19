/* Brain Graph — phone PWA. Graph + file text live only in the PRIVATE repo
   braydendueck/brain-graph-data and are fetched with a fine-grained PAT kept
   in this browser's localStorage. This public app repo never contains brain content. */
const API = 'https://api.github.com';
const DEFAULT_REPO = 'braydendueck/brain-graph-data';
const FILE = 'graph.json';
const LS = { token: 'bg.token', repo: 'bg.repo', cache: 'bg.cache' };
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Brain+Graph+phone&description=Brain+Graph+app%3A+read-only+graph.json+in+brain-graph-data+only&target_name=braydendueck&expires_in=90&contents=read';

const GROUPS = [
  { id: 'core', label: 'Core', color: '#a78bfa' },
  { id: 'raw', label: 'raw/', color: '#38bdf8' },
  { id: 'people', label: 'people/', color: '#f472b6' },
  { id: 'projects', label: 'projects/', color: '#fbbf24' },
  { id: 'out', label: 'out/', color: '#34d399' },
  { id: 'sb-raw', label: '2nd raw/', color: '#60a5fa' },
  { id: 'wiki', label: 'wiki', color: '#67e8f9' },
  { id: 'wiki-topics', label: 'wiki/topics', color: '#22d3ee' },
  { id: 'wiki-people', label: 'wiki/people', color: '#e879f9' },
  { id: 'wiki-answers', label: 'wiki/answers', color: '#4ade80' },
  { id: 'contradictions', label: 'contradictions', color: '#fb7185' },
  { id: 'other', label: 'other', color: '#94a3b8' },
];
const GMAP = Object.fromEntries(GROUPS.map(g => [g.id, g]));
const EDGE_STYLE = {
  link: { color: 'rgba(148,163,184,.45)', width: 1 },
  source: { color: 'rgba(167,139,250,.7)', width: 1.6 },
  mention: { color: 'rgba(244,114,182,.55)', width: 1.2 },
  contact: { color: 'rgba(56,189,248,.35)', width: 0.8 },
  mirror: { color: 'rgba(148,163,184,.25)', width: 0.6, dash: true },
  contradiction: { color: 'rgba(251,113,133,.95)', width: 2.4 },
};

const S = {
  token: localStorage.getItem(LS.token) || '',
  repo: localStorage.getItem(LS.repo) || DEFAULT_REPO,
  graph: null, view: 'graph', // graph | waiting | setup | settings
  q: '', filters: new Set(GROUPS.map(g => g.id)),
  sel: null, err: '', loading: false, fg: null,
};

const $ = (s, el = document) => el.querySelector(s);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function color(g) { return (GMAP[g] || GMAP.other).color; }

class ApiError extends Error {
  constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; }
}
async function gh(path, opts = {}, token = S.token) {
  let r;
  try {
    r = await fetch(API + path, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw new ApiError('net', 'Network error talking to GitHub.'); }
  if (r.status === 401) throw new ApiError('auth', 'GitHub rejected the token (wrong, revoked or expired).', 401);
  if (r.status === 404) throw new ApiError('notfound', 'File or repo not found for this token.', 404);
  if (r.status === 403) throw new ApiError('forbidden', 'This token needs Contents: Read on ' + S.repo + '.', 403);
  if (!r.ok) throw new ApiError('http', 'GitHub error ' + r.status, r.status);
  return r.json();
}
function b64decode(s) {
  const bin = atob(s.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
async function fetchGraph(token = S.token, repo = S.repo) {
  try {
    const j = await gh(`/repos/${repo}/contents/${FILE}`, {}, token);
    if (!j.content) throw new ApiError('http', 'graph.json has no content');
    return JSON.parse(b64decode(j.content));
  } catch (e) {
    if (e.kind === 'notfound') {
      try { await gh(`/repos/${repo}`, {}, token); }
      catch (e2) {
        if (e2.kind === 'notfound') throw new ApiError('norepo', `This token can't see ${repo}. Give it access to that repository.`);
      }
      throw new ApiError('notfound', `${FILE} is missing from ${repo}.`);
    }
    throw e;
  }
}

function filteredNodes() {
  if (!S.graph) return [];
  const q = S.q.trim().toLowerCase();
  return S.graph.nodes.filter(n => {
    if (!S.filters.has(n.group)) return false;
    if (!q) return true;
    const hay = (n.title + ' ' + n.id + ' ' + n.summary + ' ' + (n.content || '')).toLowerCase();
    return hay.includes(q);
  });
}
function filteredEdges(nodes) {
  const ids = new Set(nodes.map(n => n.id));
  return (S.graph?.edges || []).filter(e => ids.has(e.source) && ids.has(e.target));
}
function outItems() {
  return (S.graph?.nodes || []).filter(n => n.group === 'out').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function render() {
  const root = $('#app');
  if (!S.token || S.view === 'setup') { root.innerHTML = setupHTML(); bindSetup(); return; }
  if (S.view === 'waiting') { root.innerHTML = waitingHTML(); bindChrome(); return; }
  if (S.view === 'settings') { root.innerHTML = settingsHTML(); bindChrome(); return; }
  if (S.fg) { try { S.fg._destructor && S.fg._destructor(); } catch {} S.fg = null; S._fitted = false; S._fitDone = false; }
  root.innerHTML = graphHTML();
  bindChrome();
  paintGraph();
  if (S.sel) openSheet(S.sel);
}

function setupHTML() {
  return `<div class="setup">
    <h1>Connect Brain Graph</h1>
    <p class="lead">Your second brain lives in the private GitHub repo <b>${esc(S.repo)}</b>. Paste a read-only token once so this phone can draw the graph.</p>
    <a class="linkbtn" href="${TOKEN_URL}" target="_blank" rel="noopener noreferrer">Create the token on GitHub</a>
    <ol>
      <li>Sign in as <b>braydendueck</b>. Name, 90-day expiry and Contents: Read are pre-filled.</li>
      <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> → <b>brain-graph-data</b>.</li>
      <li>Leave Contents on <b>Read-only</b>. Generate, copy the <code>github_pat_…</code> token and paste it below.</li>
    </ol>
    <form id="setupform">
      <label class="field"><span>Paste the token here</span><input id="tok" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Private data repo</span><input id="repo" value="${esc(S.repo)}" autocomplete="off" spellcheck="false"></label>
      <p class="err" id="setuperr" hidden></p>
      <button class="btn primary" type="submit" style="width:100%;padding:12px">Connect</button>
    </form>
    <p class="lead" style="margin-top:18px;font-size:12px">The token stays only on this device. It can only read the brain graph, nothing else on your GitHub. No brain content is in this public app.</p>
  </div>`;
}
function bindSetup() {
  $('#setupform').onsubmit = async ev => {
    ev.preventDefault();
    const tok = $('#tok').value.trim(), repo = $('#repo').value.trim() || DEFAULT_REPO;
    const err = $('#setuperr'); err.hidden = true;
    try {
      const g = await fetchGraph(tok, repo);
      S.token = tok; S.repo = repo; S.graph = g; S.view = 'graph';
      localStorage.setItem(LS.token, tok); localStorage.setItem(LS.repo, repo);
      try { localStorage.setItem(LS.cache, JSON.stringify(g)); } catch {}
      render();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.kind === 'auth' ? 'GitHub rejected this token. Check you copied all of it.' : ex.message;
    }
  };
}

function chrome(title) {
  return `<header>
    <div class="row">
      <h1>${esc(title)}<div class="meta" id="meta"></div></h1>
      <button class="iconbtn" data-act="rebuild" title="Refresh from GitHub">↻</button>
      <button class="iconbtn" data-act="settings" title="Settings">⚙</button>
    </div>
    <div class="tabs">
      <button class="tab ${S.view === 'graph' ? 'on' : ''}" data-act="tab-graph">Graph</button>
      <button class="tab ${S.view === 'waiting' ? 'on' : ''}" data-act="tab-waiting">Waiting for your yes <span id="outcount"></span></button>
    </div>
    ${S.view === 'graph' ? `<div class="row"><div class="search"><span>⌕</span><input id="q" placeholder="Search title or content" value="${esc(S.q)}"></div></div>
    <div class="filters" id="filters"></div>` : ''}
  </header>`;
}
function settingsHTML() {
  return chrome('Settings') + `<div class="setup">
    <p class="lead">Connected to <b>${esc(S.repo)}</b>. Token stays on this phone only.</p>
    <button class="btn" data-act="newtoken" style="width:100%;margin:6px 0">Enter a new token</button>
    <button class="btn" data-act="signout" style="width:100%;margin:6px 0;color:var(--danger)">Sign out / forget token</button>
    <p class="lead" style="font-size:12px;margin-top:16px">${S.graph ? `${S.graph.nodes.length} nodes · ${S.graph.edges.length} edges` : ''}</p>
  </div>`;
}
function waitingHTML() {
  const items = outItems();
  return chrome('Waiting for your yes') + `<div class="waiting">
    <p class="lead">Drafts, plans and to-dos in <b>out/</b> that need your OK. Tap one to focus it on the graph.</p>
    ${items.length ? items.map(n => `<button class="witem" data-focus="${esc(n.id)}"><div class="t">${esc(n.title)}</div><div class="s">${esc(n.summary || n.date || n.id)}</div></button>`).join('') : `<div class="empty">Nothing in out/ right now.</div>`}
  </div>`;
}
function graphHTML() {
  return chrome('Brain Graph') + `<div id="graphwrap"><div id="graph"></div>
    <div class="hud"><div class="pill" id="stats"></div><div class="pill legend" id="legend"></div></div>
  </div>
  <div class="sheet" id="sheet" aria-hidden="true">
    <div class="handle"></div>
    <div class="top"><h2 id="shtitle"></h2><button class="iconbtn" data-act="close">✕</button></div>
    <div class="body" id="shbody"></div>
  </div>`;
}

function bindChrome() {
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => onAct(b.dataset.act));
  const q = $('#q'); if (q) q.oninput = () => { S.q = q.value; paintGraph(); };
  const f = $('#filters');
  if (f) {
    const present = new Set((S.graph?.nodes || []).map(n => n.group));
    f.innerHTML = GROUPS.filter(g => present.has(g.id)).map(g =>
      `<button class="chip ${S.filters.has(g.id) ? 'on' : ''}" data-g="${g.id}" style="${S.filters.has(g.id) ? `background:${g.color};` : ''}"><span class="dot" style="background:${g.color}"></span>${esc(g.label)}</button>`
    ).join('');
    f.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const id = c.dataset.g;
      if (S.filters.has(id)) S.filters.delete(id); else S.filters.add(id);
      // if all off, turn all on
      if (![...S.filters].some(x => present.has(x))) GROUPS.forEach(g => S.filters.add(g.id));
      paintGraph(); bindChrome();
    });
  }
  const oc = $('#outcount'); if (oc) { const n = outItems().length; oc.textContent = n ? `(${n})` : ''; }
  document.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => {
    S.view = 'graph'; S.sel = b.dataset.focus; render();
    setTimeout(() => focusNode(b.dataset.focus), 900);
  });
  const meta = $('#meta');
  if (meta && S.graph) meta.textContent = `${S.graph.nodes.length} nodes · ${S.graph.edges.length} edges`;
}

async function onAct(act) {
  if (act === 'tab-graph') { S.view = 'graph'; render(); }
  if (act === 'tab-waiting') { S.view = 'waiting'; render(); }
  if (act === 'settings') { S.view = 'settings'; render(); }
  if (act === 'close') { S.sel = null; closeSheet(); if (S.fg) highlight(null); }
  if (act === 'newtoken') { S.view = 'setup'; render(); }
  if (act === 'signout') {
    if (!confirm('Forget the token and cached graph on this device?')) return;
    localStorage.removeItem(LS.token); localStorage.removeItem(LS.repo); localStorage.removeItem(LS.cache);
    S.token = ''; S.graph = null; S.view = 'setup'; render();
  }
  if (act === 'rebuild') {
    if (!S.token) return;
    S.loading = true; const btn = document.querySelector('[data-act=rebuild]'); if (btn) btn.disabled = true;
    try {
      S.graph = await fetchGraph();
      try { localStorage.setItem(LS.cache, JSON.stringify(S.graph)); } catch {}
      S.err = ''; paintGraph(); bindChrome();
    } catch (ex) { S.err = ex.message; alert(ex.message); }
    finally { S.loading = false; if (btn) btn.disabled = false; }
  }
}

function paintGraph() {
  const el = $('#graph'); if (!el || !S.graph) return;
  const nodes = filteredNodes().map(n => ({
    id: n.id, name: n.title, group: n.group, degree: n.degree || 0,
    flagged: !!(n.contradictions && n.contradictions.length),
    soft: !!(n.citesContradicted && n.citesContradicted.length),
    val: 1 + Math.min(6, Math.sqrt(n.degree || 1)),
  }));
  const edges = filteredEdges(nodes).map(e => ({
    source: e.source, target: e.target, type: e.type, why: e.why,
  }));
  const st = $('#stats'); if (st) st.textContent = `${nodes.length} shown · ${edges.length} links`;
  const leg = $('#legend');
  if (leg) {
    const used = new Set(nodes.map(n => n.group));
    leg.innerHTML = GROUPS.filter(g => used.has(g.id)).map(g =>
      `<span><span class="dot" style="background:${g.color};width:8px;height:8px;border-radius:50%;display:inline-block"></span>${esc(g.label)}</span>`).join('');
  }
  if (!window.ForceGraph) { el.innerHTML = '<div class="empty">Graph library failed to load.</div>'; return; }
  if (!S.fg) {
    S.fg = ForceGraph()(el)
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeLabel(n => n.name)
      .nodeColor(n => color(n.group))
      .nodeVal('val')
      .nodeCanvasObjectMode(() => 'after')
      .nodeCanvasObject((n, ctx, scale) => {
        const r = Math.sqrt(Math.max(0.5, n.val || 1)) * 4;
        if (n.flagged || n.soft) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5, 0, 2 * Math.PI);
          ctx.strokeStyle = n.flagged ? '#fb7185' : 'rgba(251,113,133,.55)';
          ctx.setLineDash(n.flagged ? [] : [2, 2]); ctx.lineWidth = n.flagged ? 1.6 : 1; ctx.stroke(); ctx.setLineDash([]);
        }
        if (scale > 2.2 && !n.__dim) {
          const label = n.name.length > 28 ? n.name.slice(0, 27) + '…' : n.name;
          ctx.font = `${11 / scale}px -apple-system,system-ui,sans-serif`;
          ctx.fillStyle = 'rgba(232,236,245,.85)'; ctx.textAlign = 'center';
          ctx.fillText(label, n.x, n.y + r + 9 / scale);
        }
      })
      .linkColor(l => (EDGE_STYLE[l.type] || EDGE_STYLE.link).color)
      .linkWidth(l => (EDGE_STYLE[l.type] || EDGE_STYLE.link).width)
      .linkDirectionalParticles(l => l.type === 'contradiction' ? 2 : 0)
      .linkDirectionalParticleWidth(2)
      .linkDirectionalParticleColor(() => '#fb7185')
      .onNodeClick(n => { S.sel = n.id; openSheet(n.id); highlight(n.id); centerVisible(n, null); })
      .onBackgroundClick(() => { S.sel = null; closeSheet(); highlight(null); })
      .enableNodeDrag(true)
      .enableZoomInteraction(true)
      .enablePanInteraction(true);
    new ResizeObserver(() => { if (S.fg && el.isConnected) S.fg.width(el.clientWidth).height(el.clientHeight); }).observe(el);
    // Fit once after first data
    S._fitted = false;
  }
  S.fg.graphData({ nodes, links: edges });
  if (!S._fitted && nodes.length) {
    S._fitted = true;
    S.fg.cooldownTime(4000).onEngineStop(() => { if (!S._fitDone && !S.sel) { S._fitDone = true; S.fg.zoomToFit(500, 30); } });
    setTimeout(() => { if (!S.sel) S.fg.zoomToFit(400, 30); }, 1200);
  }
  if (S.sel) highlight(S.sel);
}

function highlight(id) {
  if (!S.fg) return;
  const { nodes, links } = S.fg.graphData();
  if (!id) {
    nodes.forEach(n => { n.__dim = false; });
    links.forEach(l => { l.__dim = false; });
  } else {
    const nbr = new Set([id]);
    links.forEach(l => {
      const s = l.source.id || l.source, t = l.target.id || l.target;
      if (s === id || t === id) { nbr.add(s); nbr.add(t); }
    });
    nodes.forEach(n => { n.__dim = !nbr.has(n.id); });
    links.forEach(l => {
      const s = l.source.id || l.source, t = l.target.id || l.target;
      l.__dim = !(s === id || t === id);
    });
  }
  S.fg
    .nodeColor(n => n.__dim ? '#2a3145' : color(n.group))
    .linkColor(l => {
      const base = (EDGE_STYLE[l.type] || EDGE_STYLE.link).color;
      return l.__dim ? 'rgba(42,49,69,.25)' : base;
    });
}

function openSheet(id) {
  const n = (S.graph?.nodes || []).find(x => x.id === id); if (!n) return;
  const sheet = $('#sheet'); if (!sheet) return;
  $('#shtitle').textContent = n.title || n.id;
  const g = GMAP[n.group] || GMAP.other;
  let html = `<span class="badge" style="background:${g.color}">${esc(g.label)}</span>`;
  if (n.contradictions?.length) html += `<span class="badge" style="background:#fb7185">contradiction</span>`;
  html += `<dl class="kv">
    <dt>Path</dt><dd><code>${esc(n.id)}</code></dd>
    <dt>Date</dt><dd>${esc(n.date || '—')}</dd>
    <dt>Source</dt><dd>${sourceHTML(n)}</dd>
    <dt>Summary</dt><dd>${esc(n.summary || '—')}</dd>
  </dl>`;
  if (n.contradictions?.length) {
    html += `<div class="warn"><b>Flagged in contradictions log</b><ul style="margin:6px 0 0;padding-left:18px">${n.contradictions.map(c => typeof c === 'string' ? `<li>${esc(c)}</li>` : `<li><b>${esc(c.heading)}</b>${c.conflict ? `<div>${esc(c.conflict)}</div>` : ''}${c.deciding ? `<div style="margin-top:4px"><i>Needs deciding:</i> ${esc(c.deciding)}</div>` : ''}</li>`).join('')}</ul></div>`;
  }
  if (n.citesContradicted?.length) {
    html += `<div class="warn" style="background:#2a1720;border-color:#5b2333"><b>Cites a source with an open contradiction</b><ul style="margin:6px 0 0;padding-left:18px">${n.citesContradicted.map(id => `<li><a href="#" data-goto="${esc(id)}">${esc(nodeById(id)?.title || id)}</a></li>`).join('')}</ul></div>`;
  }
  const nb = neighbours(n.id);
  if (nb.length) html += `<details class="nb"><summary>${nb.length} connections</summary><ul>${nb.map(([id, t]) => `<li><a href="#" data-goto="${esc(id)}">${esc(nodeById(id)?.title || id)}</a> <span class="et">${esc(t)}</span></li>`).join('')}</ul></details>`;
  let text = n.content || '';
  const h = text.match(/^#\s+(.+)\n/); if (h && h[1].trim() === (n.title || '').trim()) text = text.slice(h[0].length);
  const md = (typeof marked !== 'undefined' ? marked.parse(text) : `<pre>${esc(n.content || '')}</pre>`);
  html += `<div class="md">${md}</div>`;
  const body = $('#shbody'); body.innerHTML = html; body.scrollTop = 0;
  body.querySelectorAll('.md a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^[a-z]+:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
    const t = resolveHref(n.id, href);
    if (t) a.dataset.goto = t; else a.removeAttribute('href');
  });
  body.querySelectorAll('[data-goto]').forEach(a => a.onclick = ev => { ev.preventDefault(); focusNode(a.dataset.goto); });
  sheet.classList.add('open'); sheet.classList.remove('full'); sheet.setAttribute('aria-hidden', 'false');
  sheet.querySelector('.handle').onclick = () => sheet.classList.toggle('full');
  highlight(id);
}
function sourceHTML(n) {
  const s = n.source || '';
  const m = s.match(/https:\/\/mail\.google\.com\/[^\s)]+/);
  if (m) return `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer" style="color:var(--acc)">Open in Gmail</a>`;
  if (!s && n.group.startsWith('wiki')) { const k = neighbours(n.id).filter(([, t]) => t === 'source').length; return k ? `cites ${k} raw file${k > 1 ? 's' : ''}` : '—'; }
  return s ? esc(s) : '—';
}
function nodeById(id) { return (S.graph?.nodes || []).find(x => x.id === id); }
function neighbours(id) {
  const out = new Map();
  for (const e of S.graph?.edges || []) {
    if (e.source === id && !out.has(e.target)) out.set(e.target, e.type);
    else if (e.target === id && !out.has(e.source)) out.set(e.source, e.type);
  }
  return [...out.entries()];
}
function resolveHref(fromId, href) {
  href = decodeURIComponent(href.split('#')[0]); if (!href) return null;
  const parts = fromId.split('/'); parts.pop();
  for (const p of href.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
  let id = parts.join('/');
  const sb = fromId.startsWith('sb/');
  if (sb && !id.startsWith('sb/')) id = 'sb/' + id;
  const ok = x => S.graph.nodes.some(n => n.id === x);
  if (ok(id)) return id; if (ok(id + '.md')) return id + '.md';
  return null;
}
function focusNode(id) {
  if (!nodeById(id)) return;
  const n = nodeById(id);
  S.filters.add(n.group); S.sel = id;
  if (S.view !== 'graph') { S.view = 'graph'; render(); return; }
  paintGraph(); bindChrome(); openSheet(id);
  const gn = S.fg?.graphData().nodes.find(x => x.id === id);
  if (gn && gn.x != null) centerVisible(gn, 2.5);
}
function centerVisible(n, zoom) {
  // keep the node in the part of the graph the bottom sheet doesn't cover
  const z = zoom || S.fg.zoom();
  const sheet = $('#sheet');
  const phone = window.innerWidth < 900;
  const cover = phone && sheet ? sheet.getBoundingClientRect().height : 0;
  if (zoom) S.fg.zoom(z, 500);
  S.fg.centerAt(n.x, n.y + (cover / 2) / z, 500);
}
function closeSheet() {
  const sheet = $('#sheet'); if (!sheet) return;
  sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true');
}

(async function boot() {
  if (S.token) {
    try {
      const cached = localStorage.getItem(LS.cache);
      if (cached) S.graph = JSON.parse(cached);
    } catch {}
    render();
    try {
      S.graph = await fetchGraph();
      try { localStorage.setItem(LS.cache, JSON.stringify(S.graph)); } catch {}
      if (S.view === 'graph') paintGraph();
      bindChrome();
    } catch (ex) {
      if (!S.graph) { S.err = ex.message; if (ex.kind === 'auth' || ex.kind === 'norepo') S.view = 'setup'; render(); }
    }
  } else render();
})();
