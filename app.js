/* Brain Graph — phone PWA (2D + 3D). Graph + file text live only in the PRIVATE repo
   braydendueck/brain-graph-data and are fetched with a fine-grained PAT kept in this
   browser's localStorage. This public app repo never contains brain content. */
const API = 'https://api.github.com';
const DEFAULT_REPO = 'braydendueck/brain-graph-data';
const FILE = 'graph.json';
const LS = { token: 'bg.token', repo: 'bg.repo', cache: 'bg.cache', mode: 'bg.mode', sources: 'bg.sources', hinted: 'bg.hinted', hidden: 'bg.hidden' };
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Brain+Graph+phone&description=Brain+Graph+app%3A+read-only+graph.json+in+brain-graph-data+only&target_name=braydendueck&expires_in=90&contents=read';

// Display groups. raw/ (brain) and raw/inbox (second brain) copies are merged into "sources".
const GROUPS = [
  { id: 'core', label: 'Core files', color: '#a78bfa' },
  { id: 'out', label: 'Waiting (out/)', color: '#34d399' },
  { id: 'projects', label: 'Projects', color: '#fbbf24' },
  { id: 'people', label: 'People', color: '#f472b6' },
  { id: 'wiki-topics', label: 'Wiki topics', color: '#22d3ee' },
  { id: 'wiki-people', label: 'Wiki people', color: '#e879f9' },
  { id: 'wiki-answers', label: 'Wiki answers', color: '#4ade80' },
  { id: 'wiki', label: 'Wiki index', color: '#67e8f9' },
  { id: 'contradictions', label: 'Contradictions log', color: '#fb7185' },
  { id: 'sources', label: 'Sources (emails)', color: '#60a5fa' },
  { id: 'other', label: 'Other', color: '#94a3b8' },
];
const GMAP = Object.fromEntries(GROUPS.map(g => [g.id, g]));
const EDGE = {
  link: { label: 'links to', color: '148,163,184' },
  source: { label: 'cites source', color: '167,139,250' },
  mention: { label: 'mentions', color: '244,114,182' },
  contact: { label: 'same contact', color: '56,189,248' },
  contradiction: { label: 'contradiction', color: '251,113,133' },
};
const ATTN_RED = '#fb7185', ATTN_GREEN = '#34d399';

const S = {
  token: localStorage.getItem(LS.token) || '',
  repo: localStorage.getItem(LS.repo) || DEFAULT_REPO,
  graph: null, G: null, view: 'graph', // graph | waiting | setup | settings
  mode: localStorage.getItem(LS.mode) || '', // '2d' | '3d' ('' = auto)
  showSources: localStorage.getItem(LS.sources) === '1',
  hidden: new Set(JSON.parse(localStorage.getItem(LS.hidden) || '[]')),
  q: '', sel: null, fg: null, fgMode: null, vis: null,
};

const $ = (s, el = document) => el.querySelector(s);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function color(g) { return (GMAP[g] || GMAP.other).color; }
const rgba = (rgb, a) => `rgba(${rgb},${a})`;

/* ---------- GitHub ---------- */
class ApiError extends Error { constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; } }
async function gh(path, opts = {}, token = S.token) {
  let r;
  try {
    r = await fetch(API + path, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch { throw new ApiError('net', 'Network error talking to GitHub.'); }
  if (r.status === 401) throw new ApiError('auth', 'GitHub rejected the token (wrong, revoked or expired).', 401);
  if (r.status === 404) throw new ApiError('notfound', 'File or repo not found for this token.', 404);
  if (r.status === 403) throw new ApiError('forbidden', 'This token needs Contents: Read on ' + S.repo + '.', 403);
  if (!r.ok) throw new ApiError('http', 'GitHub error ' + r.status, r.status);
  return r.json();
}
function b64decode(s) {
  const bin = atob(s.replace(/\n/g, ''));
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
async function fetchGraph(token = S.token, repo = S.repo) {
  try {
    const j = await gh(`/repos/${repo}/contents/${FILE}`, {}, token);
    if (j.content) return JSON.parse(b64decode(j.content));
    if (j.download_url || j.git_url) { // >1 MB files come back without inline content
      const b = await gh(`/repos/${repo}/git/blobs/${j.sha}`, {}, token);
      return JSON.parse(b64decode(b.content));
    }
    throw new ApiError('http', 'graph.json has no content');
  } catch (e) {
    if (e.kind === 'notfound') {
      try { await gh(`/repos/${repo}`, {}, token); }
      catch (e2) { if (e2.kind === 'notfound') throw new ApiError('norepo', `This token can't see ${repo}. Give it access to that repository.`); }
      throw new ApiError('notfound', `${FILE} is missing from ${repo}.`);
    }
    throw e;
  }
}
function setGraph(g) { S.graph = g; S.G = prepare(g); try { localStorage.setItem(LS.cache, JSON.stringify(g)); } catch {} }

/* ---------- Data prep: merge duplicate sources, display groups ---------- */
function prepare(g) {
  const alias = {};
  // the same email saved in both brains -> one node (prefer the brain/ copy)
  for (const e of g.edges) if (e.type === 'mirror') {
    const [keep, drop] = e.source.startsWith('sb/') ? [e.target, e.source] : [e.source, e.target];
    alias[drop] = alias[keep] || keep;
  }
  const canon = id => alias[id] || id;
  const byId = {}, nodes = [];
  for (const n of g.nodes) {
    const c = canon(n.id);
    if (c !== n.id) continue;
    const m = { ...n, dgroup: (n.group === 'raw' || n.group === 'sb-raw') ? 'sources' : (GMAP[n.group] ? n.group : 'other'), also: [], contradictions: [...(n.contradictions || [])], citesContradicted: [...(n.citesContradicted || [])] };
    byId[c] = m; nodes.push(m);
  }
  for (const n of g.nodes) {
    const c = canon(n.id);
    if (c === n.id) continue;
    const m = byId[c]; if (!m) continue;
    m.also.push(n.id);
    for (const x of n.contradictions || []) if (!m.contradictions.some(y => JSON.stringify(y) === JSON.stringify(x))) m.contradictions.push(x);
  }
  for (const m of nodes) m.citesContradicted = [...new Set(m.citesContradicted.map(canon))];
  const ek = {}, edges = [];
  for (const e of g.edges) {
    if (e.type === 'mirror') continue;
    const s = canon(e.source), t = canon(e.target);
    if (s === t || !byId[s] || !byId[t]) continue;
    const k = [s, t].sort().join('|') + '|' + e.type;
    if (ek[k]) continue;
    ek[k] = 1; edges.push({ source: s, target: t, type: e.type, why: e.why });
  }
  for (const m of nodes) {
    m.attn = m.dgroup === 'out' ? 'waiting' : (m.contradictions.length ? 'contradiction' : (m.citesContradicted.length ? 'soft' : ''));
  }
  return { nodes, edges, byId, alias, canon };
}
function nodeById(id) { return S.G && (S.G.byId[id] || S.G.byId[S.G.canon(id)]); }
function neighbours(id) {
  const out = new Map();
  for (const e of S.G?.edges || []) {
    if (e.source === id && !out.has(e.target)) out.set(e.target, e.type);
    else if (e.target === id && !out.has(e.source)) out.set(e.source, e.type);
  }
  return [...out.entries()];
}
function outItems() { return (S.G?.nodes || []).filter(n => n.dgroup === 'out').sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function contradictionItems() {
  const m = new Map();
  for (const n of S.G?.nodes || []) for (const c of n.contradictions) {
    const h = typeof c === 'string' ? c : c.heading;
    if (!m.has(h)) m.set(h, n.id);
  }
  return [...m.entries()].map(([heading, id]) => ({ heading, id }));
}

/* ---------- Visible subset ---------- */
function groupOn(g) { return g === 'sources' ? S.showSources : !S.hidden.has(g); }
function computeVisible() {
  const q = S.q.trim().toLowerCase();
  let nodes = S.G.nodes.filter(n => {
    if (q) return (n.title + ' ' + n.id + ' ' + n.summary + ' ' + (n.content || '')).toLowerCase().includes(q) && (n.dgroup === 'sources' || groupOn(n.dgroup));
    return groupOn(n.dgroup) || (n.dgroup === 'sources' && n.attn === 'contradiction'); // contradicted emails always show
  });
  if (S.sel && !nodes.some(n => n.id === S.sel) && nodeById(S.sel)) nodes.push(nodeById(S.sel));
  const ids = new Set(nodes.map(n => n.id));
  const edges = S.G.edges.filter(e => ids.has(e.source) && ids.has(e.target) && (e.type !== 'contact' || S.showSources));
  const deg = {};
  for (const e of edges) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; }
  const hubs = new Set(nodes.slice().sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0)).slice(0, 6).map(n => n.id));
  const out = nodes.map(n => {
    const d = deg[n.id] || 0;
    const imp = (n.dgroup === 'core' ? 3 : 0) + (n.attn === 'waiting' || n.attn === 'contradiction' ? 3 : 0) + (['projects', 'people', 'wiki-people', 'wiki-topics', 'contradictions'].includes(n.dgroup) ? 1.5 : 0) + (hubs.has(n.id) ? 1 : 0);
    return {
      id: n.id, name: n.title, group: n.dgroup, attn: n.attn, degree: d,
      size: 1.2 + Math.min(7, Math.sqrt(d) * 1.2) + imp * 0.6,
      prio: imp * 10 + d,
      label: imp >= 1.5 || hubs.has(n.id),
    };
  });
  // 3D can't de-overlap labels, so only the top dozen get one there
  const top3d = new Set(out.filter(n => n.label).sort((a, b) => b.prio - a.prio).slice(0, 12).map(n => n.id));
  out.forEach(n => { n.label3d = top3d.has(n.id); });
  return { nodes: out, links: edges.map(e => ({ ...e })) };
}

/* ---------- Views ---------- */
function render() {
  const root = $('#app');
  destroyGraph();
  if (!S.token || S.view === 'setup') { root.innerHTML = setupHTML(); bindSetup(); return; }
  if (S.view === 'waiting') { root.innerHTML = waitingHTML(); bindCommon(); return; }
  if (S.view === 'settings') { root.innerHTML = settingsHTML(); bindCommon(); return; }
  root.innerHTML = graphHTML();
  bindCommon(); bindGraphChrome();
  paintGraph();
  if (S.sel) openSheet(S.sel);
}
function setupHTML() {
  return `<div class="page">
    <h1>Connect Brain Graph</h1>
    <p class="lead">Your second brain lives in the private GitHub repo <b>${esc(S.repo)}</b>. Paste a read-only token once so this phone can draw the graph.</p>
    <a class="linkbtn" href="${TOKEN_URL}" target="_blank" rel="noopener noreferrer">Create the token on GitHub</a>
    <ol class="steps">
      <li>Sign in as <b>braydendueck</b>. Name, 90-day expiry and Contents: Read are pre-filled.</li>
      <li>Under <b>Repository access</b>, choose <b>Only select repositories</b> → <b>brain-graph-data</b>.</li>
      <li>Leave Contents on <b>Read-only</b>. Generate, copy the <code>github_pat_…</code> token and paste it below.</li>
    </ol>
    <form id="setupform">
      <label class="field"><span>Paste the token here</span><input id="tok" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Private data repo</span><input id="repo" value="${esc(S.repo)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="err" id="setuperr" hidden></p>
      <button class="btn primary wide" type="submit">Connect</button>
    </form>
    <p class="fine">The token stays only on this device. It can only read the brain graph, nothing else on your GitHub. No brain content is in this public app.</p>
  </div>`;
}
function bindSetup() {
  $('#setupform').onsubmit = async ev => {
    ev.preventDefault();
    const tok = $('#tok').value.trim(), repo = $('#repo').value.trim() || DEFAULT_REPO;
    const err = $('#setuperr'); err.hidden = true;
    try {
      const g = await fetchGraph(tok, repo);
      S.token = tok; S.repo = repo; localStorage.setItem(LS.token, tok); localStorage.setItem(LS.repo, repo);
      setGraph(g); S.view = 'graph'; render();
    } catch (ex) { err.hidden = false; err.textContent = ex.kind === 'auth' ? 'GitHub rejected this token. Check you copied all of it.' : ex.message; }
  };
}
function topbar(title, back) {
  return `<header class="top">
    <div class="bar">
      ${back ? `<button class="iconbtn" data-act="tab-graph" aria-label="Back">‹</button>` : ''}
      <div class="ttl"><h1>${esc(title)}</h1><div class="meta" id="meta"></div></div>
      ${back ? '' : `<button class="iconbtn mode" data-act="mode" id="modebtn" aria-label="Switch 2D/3D">${curMode() === '3d' ? '3D' : '2D'}</button>`}
      <button class="iconbtn" data-act="rebuild" aria-label="Refresh from GitHub">↻</button>
      <button class="iconbtn" data-act="settings" aria-label="Settings">⚙︎</button>
    </div>`;
}
function settingsHTML() {
  return topbar('Settings', true) + `</header><div class="page">
    <p class="lead">Connected to <b>${esc(S.repo)}</b>. The token stays on this phone only.</p>
    <button class="btn wide" data-act="newtoken">Enter a new token</button>
    <button class="btn wide danger" data-act="signout">Sign out / forget token</button>
    <button class="btn wide" data-act="rehint">Show the tips again</button>
    <p class="fine">${S.G ? `${S.G.nodes.length} files · ${S.G.edges.length} connections (duplicates merged)` : ''}</p>
  </div>`;
}
function waitingHTML() {
  const items = outItems(), cons = contradictionItems();
  return topbar('Needs your attention', true) + `</header><div class="page waiting">
    <h2>Waiting for your yes</h2>
    <p class="lead">Drafts, plans and to-dos in out/. Tap one to open it on the graph.</p>
    ${items.length ? items.map(n => `<button class="witem" data-focus="${esc(n.id)}"><span class="wdot" style="background:${ATTN_GREEN}"></span><span><span class="t">${esc(n.title)}</span><span class="s">${esc(n.summary || n.date || '')}</span></span></button>`).join('') : `<div class="empty">Nothing waiting right now.</div>`}
    <h2>Contradictions to settle</h2>
    ${cons.length ? cons.map(c => `<button class="witem" data-focus="${esc(c.id)}"><span class="wdot" style="background:${ATTN_RED}"></span><span><span class="t">${esc(c.heading)}</span><span class="s">${esc(nodeById(c.id)?.title || '')}</span></span></button>`).join('') : `<div class="empty">No open contradictions.</div>`}
  </div>`;
}
function graphHTML() {
  const items = outItems(), cons = contradictionItems();
  const strip = (items.length || cons.length) ? `<div class="attn" id="attn">
      <button class="pill all" data-act="tab-waiting">Needs you <b>${items.length + cons.length}</b></button>
      ${items.map(n => `<button class="pill" data-focus="${esc(n.id)}"><span class="wdot" style="background:${ATTN_GREEN}"></span>${esc(short(n.title, 26))}</button>`).join('')}
      ${cons.map(c => `<button class="pill" data-focus="${esc(c.id)}"><span class="wdot" style="background:${ATTN_RED}"></span>${esc(short(c.heading.replace(/^\d{4}-\d\d-\d\d\s*/, ''), 26))}</button>`).join('')}
    </div>` : '';
  return topbar('Brain') + `
    <div class="tools">
      <label class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Search everything" value="${esc(S.q)}" autocomplete="off"></label>
      <button class="btn filt" data-act="filters" id="filtbtn">Filters</button>
    </div>
    ${strip}
  </header>
  <main id="graphwrap"><div id="graph"></div>
    <div class="hint" id="hint" hidden><span id="hinttext"></span><button data-act="hintok" aria-label="Dismiss">✕</button></div>
    <button class="fab" data-act="fit" aria-label="Fit graph to screen">⤢</button>
  </main>
  <div class="scrim" id="scrim" hidden></div>
  <section class="sheet" id="sheet" aria-hidden="true">
    <button class="handle" aria-label="Expand"></button>
    <div class="shead"><h2 id="shtitle"></h2><button class="iconbtn" data-act="close" aria-label="Close">✕</button></div>
    <div class="sbody" id="shbody"></div>
  </section>
  <section class="sheet" id="fsheet" aria-hidden="true">
    <button class="handle" aria-label="Expand"></button>
    <div class="shead"><h2>Filters &amp; legend</h2><button class="iconbtn" data-act="fclose" aria-label="Close">✕</button></div>
    <div class="sbody" id="fbody"></div>
  </section>`;
}
const short = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || '');

function bindCommon() {
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); onAct(b.dataset.act); });
  document.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => focusNode(b.dataset.focus));
  updateMeta();
}
function bindGraphChrome() {
  const q = $('#q');
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.q = q.value; paintGraph(); updateFilterBtn(); }, 120); };
  q.onkeydown = e => { if (e.key === 'Enter') q.blur(); };
  updateFilterBtn();
  if (!localStorage.getItem(LS.hinted)) showHint();
  $('#scrim').onclick = () => { closeFilters(); };
}
function updateMeta() {
  const m = $('#meta'); if (!m || !S.G) return;
  const v = S.vis;
  m.textContent = v && S.view === 'graph' ? `${v.nodes.length} of ${S.G.nodes.length} files${S.showSources ? '' : ' · sources hidden'}` : `${S.G.nodes.length} files`;
}
function updateFilterBtn() {
  const b = $('#filtbtn'); if (!b) return;
  const off = GROUPS.filter(g => g.id !== 'sources' && S.hidden.has(g.id)).length + (S.showSources ? 0 : 1);
  b.textContent = off > 1 ? `Filters · ${off}` : 'Filters';
}
function showHint() {
  const h = $('#hint'); if (!h) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  $('#hinttext').innerHTML = curMode() === '3d'
    ? `<b>Tap a dot to open it.</b> ${touch ? 'Two fingers rotate · pinch zooms · one finger moves.' : 'Drag rotates · scroll zooms · right-drag moves.'}`
    : `<b>Tap a dot to open it.</b> ${touch ? 'Pinch to zoom · drag to move.' : 'Scroll to zoom · drag to move.'}`;
  h.hidden = false;
}
function dismissHint() { const h = $('#hint'); if (h) h.hidden = true; localStorage.setItem(LS.hinted, '1'); }

function filtersHTML() {
  const counts = {};
  for (const n of S.G.nodes) counts[n.dgroup] = (counts[n.dgroup] || 0) + 1;
  const rows = GROUPS.filter(g => counts[g.id]).map(g => `
    <label class="frow"><span class="fdot" style="background:${g.color}"></span><span class="fl">${esc(g.label)}</span><span class="fc">${counts[g.id]}</span>
      <input type="checkbox" class="sw" data-g="${g.id}" ${groupOn(g.id) ? 'checked' : ''}></label>`).join('');
  return `<p class="fine" style="margin-top:0">Sources are the raw emails behind the wiki and core files. They're hidden by default to keep the graph readable; search always looks through them.</p>
    <div class="flist">${rows}</div>
    <h3>Rings</h3>
    <div class="legend"><span><i class="ring" style="border-color:${ATTN_GREEN}"></i>Waiting for your yes</span><span><i class="ring" style="border-color:${ATTN_RED}"></i>Open contradiction</span><span><i class="ring dash" style="border-color:${ATTN_RED}"></i>Cites a contradicted source</span></div>
    <h3>Lines</h3>
    <div class="legend">${['source', 'link', 'mention', 'contradiction', 'contact'].map(t => `<span><i class="ln" style="background:${rgba(EDGE[t].color, .9)}"></i>${EDGE[t].label}${t === 'contact' ? ' (sources only)' : ''}</span>`).join('')}</div>
    <h3>Size</h3><p class="fine">Bigger dots have more connections. Core files, people, projects and anything needing you are labelled.</p>
    <button class="btn wide" data-act="freset">Reset filters</button>`;
}
function openFilters() {
  const s = $('#fsheet'); $('#fbody').innerHTML = filtersHTML();
  $('#fbody').querySelectorAll('.sw').forEach(c => c.onchange = () => {
    const g = c.dataset.g;
    if (g === 'sources') { S.showSources = c.checked; localStorage.setItem(LS.sources, c.checked ? '1' : '0'); }
    else { c.checked ? S.hidden.delete(g) : S.hidden.add(g); localStorage.setItem(LS.hidden, JSON.stringify([...S.hidden])); }
    paintGraph(true); updateFilterBtn();
  });
  $('#fbody').querySelector('[data-act=freset]').onclick = () => { S.hidden.clear(); S.showSources = false; localStorage.removeItem(LS.hidden); localStorage.setItem(LS.sources, '0'); openFilters(); paintGraph(true); updateFilterBtn(); };
  closeSheet(); s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;
  s.querySelector('.handle').onclick = () => s.classList.toggle('full');
}
function closeFilters() { const s = $('#fsheet'); if (!s) return; s.classList.remove('open', 'full'); s.setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }

async function onAct(act) {
  if (act === 'tab-graph') { S.view = 'graph'; render(); }
  if (act === 'tab-waiting') { S.view = 'waiting'; render(); }
  if (act === 'settings') { S.view = 'settings'; render(); }
  if (act === 'filters') openFilters();
  if (act === 'fclose') closeFilters();
  if (act === 'hintok') dismissHint();
  if (act === 'rehint') { localStorage.removeItem(LS.hinted); S.view = 'graph'; render(); }
  if (act === 'fit') fitView(400);
  if (act === 'close') { S.sel = null; closeSheet(); highlight(null); }
  if (act === 'mode') { S.mode = curMode() === '3d' ? '2d' : '3d'; localStorage.setItem(LS.mode, S.mode); render(); }
  if (act === 'newtoken') { S.view = 'setup'; render(); }
  if (act === 'signout') {
    if (!confirm('Forget the token and cached graph on this device?')) return;
    [LS.token, LS.repo, LS.cache].forEach(k => localStorage.removeItem(k));
    S.token = ''; S.graph = S.G = null; S.view = 'setup'; render();
  }
  if (act === 'rebuild') {
    const btn = document.querySelector('[data-act=rebuild]'); if (btn) btn.classList.add('spin');
    try { setGraph(await fetchGraph()); if (S.view === 'graph') render(); else { render(); } toast('Up to date'); }
    catch (ex) { toast(ex.message); }
    finally { const b2 = document.querySelector('[data-act=rebuild]'); if (b2) b2.classList.remove('spin'); }
  }
}
function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show'; clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 1800);
}

/* ---------- Graph engines ---------- */
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
function curMode() {
  if (S.mode === '2d' || S.mode === '3d') return S.mode;
  const cores = navigator.hardwareConcurrency || 4;
  return webglOK() && cores >= 4 && (S.G?.nodes.length || 0) < 600 ? '3d' : '2d';
}
let lib3d;
function load3d() {
  if (window.ForceGraph3D) return Promise.resolve();
  return lib3d ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'graph3d.min.js?v=1'; s.onload = res; s.onerror = () => { lib3d = null; rej(new Error('3D library failed to load')); }; document.head.appendChild(s); });
}
function destroyGraph() {
  if (!S.fg) return;
  try { S.fg.pauseAnimation && S.fg.pauseAnimation(); } catch {}
  try { if (S.fgMode === '3d') { S.fg.renderer().dispose(); S.fg.renderer().forceContextLoss?.(); } } catch {}
  try { S.fg._destructor && S.fg._destructor(); } catch {}
  cancelAnimationFrame(S._raf);
  S.fg = null; S.fgMode = null; S._ro?.disconnect();
}
function nodeColorOf(n) { return n.__dim ? '#343b52' : color(n.group); }
function linkColorOf(l) {
  const e = EDGE[l.type] || EDGE.link;
  if (S.sel) return l.__on ? rgba(e.color, .95) : 'rgba(60,68,92,.10)';
  return rgba(e.color, l.type === 'contradiction' ? .9 : l.type === 'contact' ? .12 : .28);
}
function linkWidthOf(l) {
  if (S.sel && l.__on) return l.type === 'contradiction' ? 2.6 : 1.8;
  return l.type === 'contradiction' ? 1.8 : l.type === 'source' ? 0.9 : 0.6;
}

async function paintGraph(refit) {
  const el = $('#graph'); if (!el || !S.G) return;
  S.vis = computeVisible(); updateMeta();
  const mode = curMode();
  if (S.fg && S.fgMode !== mode) destroyGraph();
  if (!S.fg) {
    if (mode === '3d') {
      try { await load3d(); } catch { S.mode = '2d'; return paintGraph(refit); }
      if (!$('#graph') || S.fg) return; // view changed while loading
      init3d(el);
    } else init2d(el);
    S._ro = new ResizeObserver(() => { if (S.fg && el.isConnected) { S.fg.width(el.clientWidth).height(el.clientHeight); applyViewOffset(); } });
    S._ro.observe(el);
    refit = true;
  }
  S._needFit = !!refit && !S.sel;
  S.fg.graphData(S.vis);
  if (S.sel) highlight(S.sel); else refreshStyles();
  if (S._needFit) setTimeout(() => { if (S._needFit) fitView(0); }, 60);
}
function fitView(ms) {
  if (!S.fg) return;
  const pad = S.fgMode === '3d' ? 4 : 56;
  S.fg.zoomToFit(ms ?? 400, pad);
}

function init2d(el) {
  const fg = ForceGraph()(el)
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .nodeId('id').nodeVal(n => n.size * n.size * 0.5).nodeRelSize(3.2)
    .nodeLabel(() => '')
    .nodeColor(nodeColorOf)
    .nodeCanvasObjectMode(() => 'after')
    .nodeCanvasObject((n, ctx) => {
      if (!n.attn || n.__dim) return;
      const r = Math.sqrt(n.size * n.size * 0.5) * 3.2;
      const t = performance.now() / 1000;
      const pulse = n.attn === 'soft' ? 0 : (Math.sin(t * 3 + n.x) + 1) * 1.6;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5 + pulse, 0, 2 * Math.PI);
      ctx.strokeStyle = n.attn === 'waiting' ? ATTN_GREEN : ATTN_RED;
      ctx.globalAlpha = n.attn === 'soft' ? .5 : 1 - pulse / 5;
      if (n.attn === 'soft') ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((n, c, ctx, scale) => { // generous tap target: at least ~22px on screen
      const r = Math.max(Math.sqrt(n.size * n.size * 0.5) * 3.2 + 3, 11 / scale);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fill();
    })
    .linkColor(linkColorOf).linkWidth(linkWidthOf)
    .linkDirectionalParticles(l => l.type === 'contradiction' ? 2 : 0)
    .linkDirectionalParticleWidth(2.2).linkDirectionalParticleColor(() => ATTN_RED)
    .onRenderFramePost(drawLabels2d)
    .onNodeClick(n => selectNode(n.id))
    .onBackgroundClick(() => { if (S.sel) { S.sel = null; closeSheet(); highlight(null); } })
    .warmupTicks(60).cooldownTime(3500)
    .onEngineStop(() => { if (S._needFit) { S._needFit = false; fitView(500); } })
    .autoPauseRedraw(false)
    .minZoom(0.3).maxZoom(12);
  fg.d3Force('charge').strength(-90);
  fg.d3Force('shape', shapeForce(el));
  fg.d3Force('link').distance(l => l.type === 'contact' ? 60 : 38);
  S.fg = fg; S.fgMode = '2d';
}
// Pull the layout into the screen's shape (tall on a phone) so zoom-to-fit fills it.
function shapeForce(el) {
  let nodes = [];
  const f = alpha => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    const kx = w < h ? 0.06 : 0.02, ky = w < h ? 0.015 : 0.03;
    for (const n of nodes) { n.vx -= (n.x || 0) * kx * alpha; n.vy -= (n.y || 0) * ky * alpha; if (n.z != null) n.vz -= n.z * kx * alpha; }
  };
  f.initialize = ns => { nodes = ns; };
  return f;
}
function drawLabels2d(ctx, scale) {
  if (!S.fg) return;
  const nodes = S.fg.graphData().nodes;
  const fs = 12 / scale, boxes = [];
  const want = nodes.filter(n => n.x != null && !n.__dim && (S.sel ? n.__nbr : (n.label || scale > 3)))
    .sort((a, b) => (b.id === S.sel) - (a.id === S.sel) || b.prio - a.prio);
  ctx.font = `600 ${fs}px -apple-system,BlinkMacSystemFont,system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const n of want) {
    const txt = short(n.name, 24);
    const w = ctx.measureText(txt).width, h = fs * 1.25;
    const r = Math.sqrt(n.size * n.size * 0.5) * 3.2;
    const x = n.x - w / 2, y = n.y + r + 3 / scale;
    if (boxes.some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1])) continue;
    boxes.push([x - 2 / scale, y, w + 4 / scale, h]);
    ctx.fillStyle = 'rgba(11,13,18,.72)';
    ctx.fillRect(x - 3 / scale, y - 1 / scale, w + 6 / scale, h);
    ctx.fillStyle = n.id === S.sel ? '#fff' : 'rgba(232,236,245,.92)';
    ctx.fillText(txt, n.x, y);
  }
}

let ringTex;
function ringTexture() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.strokeStyle = '#fff'; x.lineWidth = 10; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
  ringTex = new THREE.CanvasTexture(c); return ringTex;
}
function init3d(el) {
  const fg = ForceGraph3D({ controlType: 'orbit' })(el)
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor('#0b0d12').showNavInfo(false)
    .nodeId('id').nodeRelSize(2.6).nodeVal(n => n.size * n.size * 0.5).nodeResolution(12).nodeOpacity(.95)
    .nodeLabel(() => '')
    .nodeColor(nodeColorOf)
    .nodeThreeObjectExtend(true).nodeThreeObject(nodeObj3d)
    .linkColor(linkColorOf).linkOpacity(.9)
    .linkWidth(l => (S.sel && l.__on) || l.type === 'contradiction' ? linkWidthOf(l) * .22 : 0)
    .linkDirectionalParticles(l => l.type === 'contradiction' ? 2 : 0)
    .linkDirectionalParticleWidth(1.6).linkDirectionalParticleColor(() => ATTN_RED)
    .onNodeClick(n => selectNode(n.id))
    .onBackgroundClick(() => { if (S.sel) { S.sel = null; closeSheet(); highlight(null); } })
    .enableNodeDrag(false) // single finger on a node = tap, never an accidental drag
    .warmupTicks(60).cooldownTime(3500)
    .onEngineStop(() => { if (S._needFit) { S._needFit = false; fitView(600); } });
  fg.d3Force('charge').strength(-70);
  fg.d3Force('shape', shapeForce(el));
  const c = fg.controls();
  // Touch: two fingers rotate (and pinch zooms), one finger moves the graph. Mouse: drag rotates, right-drag pans.
  c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  c.screenSpacePanning = true; c.enableDamping = true; c.dampingFactor = 0.12; c.rotateSpeed = 0.8;
  S.fg = fg; S.fgMode = '3d';
  const tick = () => { // gentle pulse on attention rings
    const t = performance.now() / 1000;
    for (const n of fg.graphData().nodes) if (n.__ring && n.attn !== 'soft') { const k = 1 + (Math.sin(t * 3 + (n.x || 0)) + 1) * .12; n.__ring.scale.set(n.__rs * k, n.__rs * k, 1); n.__ring.material.opacity = 1.15 - k * .5; }
    S._raf = requestAnimationFrame(tick);
  };
  S._raf = requestAnimationFrame(tick);
}
function nodeObj3d(n) {
  const g = new THREE.Group();
  const r = Math.cbrt(n.size * n.size * 0.5) * 2.6;
  if (n.attn && !n.__dim) {
    const m = new THREE.SpriteMaterial({ map: ringTexture(), color: n.attn === 'waiting' ? ATTN_GREEN : ATTN_RED, transparent: true, opacity: n.attn === 'soft' ? .45 : .95, depthWrite: false });
    const s = new THREE.Sprite(m); n.__rs = r * 3; s.scale.set(n.__rs, n.__rs, 1); n.__ring = s; g.add(s);
  } else n.__ring = null;
  const show = S.sel ? n.__lbl : n.label3d;
  if (show && !n.__dim && window.SpriteText) {
    const t = new SpriteText(short(n.name, 22));
    t.textHeight = n.id === S.sel ? 6 : 4.6; t.color = n.id === S.sel ? '#ffffff' : 'rgba(232,236,245,.92)';
    t.backgroundColor = 'rgba(11,13,18,.65)'; t.padding = 1.2; t.borderRadius = 2;
    t.fontWeight = '600'; t.fontFace = '-apple-system,BlinkMacSystemFont,system-ui,sans-serif';
    t.position.y = -(r + 4.5); t.material.depthWrite = false; g.add(t);
  }
  return g;
}

function refreshStyles() {
  if (!S.fg) return;
  S.fg.nodeColor(nodeColorOf).linkColor(linkColorOf);
  if (S.fgMode === '3d') S.fg.nodeThreeObject(nodeObj3d).linkWidth(l => (S.sel && l.__on) || l.type === 'contradiction' ? linkWidthOf(l) * .22 : 0);
  else S.fg.linkWidth(linkWidthOf);
}
function highlight(id) {
  if (!S.fg) return;
  const { nodes, links } = S.fg.graphData();
  const nbr = new Set(id ? [id] : []);
  links.forEach(l => {
    const s = l.source.id || l.source, t = l.target.id || l.target;
    l.__on = !!id && (s === id || t === id);
    if (l.__on) { nbr.add(s); nbr.add(t); }
  });
  nodes.forEach(n => { n.__nbr = nbr.has(n.id); n.__dim = !!id && !nbr.has(n.id); n.__lbl = false; });
  // 3D labels on selection: the node itself + its 8 most important neighbours
  nodes.filter(n => n.__nbr && n.id !== id).sort((a, b) => b.prio - a.prio).slice(0, 8).forEach(n => { n.__lbl = true; });
  const me = nodes.find(n => n.id === id); if (me) me.__lbl = true;
  refreshStyles();
}
function selectNode(id) {
  dismissHint(); closeFilters();
  S.sel = id; openSheet(id);
  const gn = S.fg?.graphData().nodes.find(x => x.id === id);
  if (gn) centerOn(gn, false);
}
function focusNode(id) {
  const n = nodeById(id); if (!n) return;
  id = n.id;
  if (n.dgroup === 'sources' ? false : S.hidden.has(n.dgroup)) { S.hidden.delete(n.dgroup); localStorage.setItem(LS.hidden, JSON.stringify([...S.hidden])); }
  S.sel = id;
  if (S.view !== 'graph') { S.view = 'graph'; render(); }
  else { paintGraph(); openSheet(id); }
  const go = (tries) => {
    const gn = S.fg?.graphData().nodes.find(x => x.id === id);
    if (gn && gn.x != null) centerOn(gn, true); else if (tries > 0) setTimeout(() => go(tries - 1), 150);
  };
  setTimeout(() => go(20), 80);
}
function centerOn(n, zoomIn) {
  if (!S.fg) return;
  if (S.fgMode === '3d') {
    applyViewOffset();
    const cam = S.fg.camera().position, t = S.fg.controls().target;
    const cur = Math.hypot(cam.x - t.x, cam.y - t.y, cam.z - t.z);
    const d = zoomIn ? Math.max(140, cur * 0.6) : Math.max(160, cur * 0.8);
    const h = Math.hypot(n.x, n.y, n.z) || 1, k = 1 + d / h;
    S.fg.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, { x: n.x, y: n.y, z: n.z }, 700);
    return;
  }
  const z = zoomIn ? Math.max(S.fg.zoom(), 2.6) : S.fg.zoom();
  const cover = sheetCover();
  if (zoomIn) S.fg.zoom(z, 500);
  S.fg.centerAt(n.x, n.y + (cover / 2) / z, 500);
}
function sheetCover() {
  const sheet = $('#sheet'), wrap = $('#graphwrap');
  if (!sheet || !wrap || window.innerWidth >= 900 || !sheet.classList.contains('open')) return 0;
  // use the sheet's resting height (not its animated position) so this works mid-transition
  const w = wrap.getBoundingClientRect(), top = window.innerHeight - sheet.offsetHeight;
  return Math.max(0, w.bottom - Math.max(top, w.top));
}
function applyViewOffset() { // 3D: shift the camera's view so its centre sits above the bottom sheet
  if (!S.fg || S.fgMode !== '3d') return;
  const cam = S.fg.camera(), el = $('#graph'); if (!el) return;
  const cover = sheetCover(), w = el.clientWidth, h = el.clientHeight;
  if (cover > 0) cam.setViewOffset(w, h, 0, cover / 2, w, h); else cam.clearViewOffset();
  cam.updateProjectionMatrix();
}

/* ---------- Node sheet ---------- */
function openSheet(id) {
  const n = nodeById(id); if (!n) return;
  const sheet = $('#sheet'); if (!sheet) return;
  $('#shtitle').textContent = n.title || n.id;
  const g = GMAP[n.dgroup] || GMAP.other;
  let html = `<div class="badges"><span class="badge" style="background:${g.color}">${esc(g.label)}</span>`;
  if (n.attn === 'waiting') html += `<span class="badge" style="background:${ATTN_GREEN}">waiting for your yes</span>`;
  if (n.contradictions.length) html += `<span class="badge" style="background:${ATTN_RED}">contradiction</span>`;
  html += `</div>`;
  if (n.summary) html += `<p class="sum">${esc(n.summary)}</p>`;
  html += `<dl class="kv"><dt>Date</dt><dd>${esc(fmtDate(n.date))}</dd><dt>Source</dt><dd>${sourceHTML(n)}</dd><dt>File</dt><dd><code>${esc(n.id)}</code>${n.also.length ? `<div class="fine">Also saved as <code>${n.also.map(esc).join(', ')}</code></div>` : ''}</dd></dl>`;
  if (n.contradictions.length) html += `<div class="warn"><b>Flagged in the contradictions log</b><ul>${n.contradictions.map(c => typeof c === 'string' ? `<li>${esc(c)}</li>` : `<li><b>${esc(c.heading)}</b>${c.conflict ? `<div>${esc(c.conflict)}</div>` : ''}${c.deciding ? `<div class="dec"><i>Needs deciding:</i> ${esc(c.deciding)}</div>` : ''}</li>`).join('')}</ul></div>`;
  if (n.citesContradicted.length) html += `<div class="warn soft"><b>Cites a source with an open contradiction</b><ul>${n.citesContradicted.map(id => `<li><a href="#" data-goto="${esc(id)}">${esc(nodeById(id)?.title || id)}</a></li>`).join('')}</ul></div>`;
  const nb = neighbours(n.id);
  if (nb.length) html += `<details class="nb"><summary>${nb.length} connection${nb.length > 1 ? 's' : ''}</summary><ul>${nb.map(([id, t]) => `<li><a href="#" data-goto="${esc(id)}"><span class="fdot" style="background:${color(nodeById(id)?.dgroup)}"></span>${esc(nodeById(id)?.title || id)}</a> <span class="et">${esc(EDGE[t]?.label || t)}</span></li>`).join('')}</ul></details>`;
  let text = n.content || '';
  const h = text.match(/^#\s+(.+)\n/); if (h && h[1].trim() === (n.title || '').trim()) text = text.slice(h[0].length);
  html += `<div class="md">${typeof marked !== 'undefined' ? marked.parse(text) : `<pre>${esc(text)}</pre>`}</div>`;
  const body = $('#shbody'); body.innerHTML = html; body.scrollTop = 0;
  body.querySelectorAll('.md a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^[a-z]+:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
    const t = resolveHref(n.id, href); if (t) a.dataset.goto = t; else a.removeAttribute('href');
  });
  body.querySelectorAll('[data-goto]').forEach(a => a.onclick = ev => { ev.preventDefault(); focusNode(a.dataset.goto); });
  closeFilters();
  sheet.classList.add('open'); sheet.classList.remove('full'); sheet.setAttribute('aria-hidden', 'false');
  sheet.querySelector('.handle').onclick = () => { sheet.classList.toggle('full'); setTimeout(applyViewOffset, 300); };
  highlight(id);
  setTimeout(applyViewOffset, 300);
}
function fmtDate(d) {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4}-\d\d-\d\d)(?:T(\d\d:\d\d))?/);
  if (!m) return d;
  if (!m[2]) return m[1];
  try { return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return d; }
}
function sourceHTML(n) {
  const s = n.source || '';
  const m = s.match(/https:\/\/mail\.google\.com\/[^\s)]+/);
  if (m) return `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer">Open in Gmail</a>`;
  if (!s && n.dgroup.startsWith('wiki')) { const k = neighbours(n.id).filter(([, t]) => t === 'source').length; return k ? `cites ${k} source email${k > 1 ? 's' : ''}` : '—'; }
  return s ? esc(s) : '—';
}
function resolveHref(fromId, href) {
  href = decodeURIComponent(href.split('#')[0]); if (!href) return null;
  const tryFrom = [fromId, ...(nodeById(fromId)?.also || [])];
  for (const f of tryFrom) {
    const parts = f.split('/'); parts.pop();
    for (const p of href.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
    let id = parts.join('/');
    if (f.startsWith('sb/') && !id.startsWith('sb/')) id = 'sb/' + id;
    for (const c of [id, id + '.md']) { const n = nodeById(c); if (n) return n.id; }
  }
  return null;
}
function closeSheet() {
  const sheet = $('#sheet'); if (!sheet) return;
  sheet.classList.remove('open', 'full'); sheet.setAttribute('aria-hidden', 'true');
  applyViewOffset();
}

/* ---------- Boot ---------- */
(async function boot() {
  if (S.token) {
    try { const c = localStorage.getItem(LS.cache); if (c) { S.graph = JSON.parse(c); S.G = prepare(S.graph); } } catch {}
    render();
    try {
      const g = await fetchGraph();
      const changed = JSON.stringify(g) !== JSON.stringify(S.graph);
      setGraph(g);
      if (changed && S.view === 'graph') render(); else updateMeta();
    } catch (ex) {
      if (!S.graph) { if (ex.kind === 'auth' || ex.kind === 'norepo') S.view = 'setup'; render(); toast(ex.message); }
    }
  } else render();
})();
