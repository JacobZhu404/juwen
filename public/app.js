let models = [];
let ws;
const cols = {}; // id -> { col, body }

// Per-model enable state. Disabled models are skipped on send and their column
// is hidden. Persisted so the selection survives a refresh.
let enabled = new Set();
function loadEnabled(ids) {
  try {
    const saved = JSON.parse(localStorage.getItem('enabledModels') || 'null');
    enabled = new Set(Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : ids);
  } catch { enabled = new Set(ids); }
  if (!enabled.size) enabled = new Set(ids);
}
function saveEnabled() { localStorage.setItem('enabledModels', JSON.stringify([...enabled])); }

// Conversation history: each round is one question broadcast to the enabled
// models, plus each model's answer. Persisted so the multi-turn transcript
// survives a refresh (mirrors the live conversations the browser keeps open).
// Shape: [{ id, q, ts, answers: { modelId: { text, status, ms } } }]
let history = [];
const roundEls = {}; // roundId -> { modelId -> { turnEl, aEl, metaEl, retryBtn } }
// Which round each model is currently awaiting a response for. Keyed by model so
// a single-model retry routes to the right turn even if it's an older round and
// even while other models are mid-answer.
const pendingRound = {}; // modelId -> roundId

const MAX_HISTORY = 50;
function loadHistory() {
  try { history = JSON.parse(localStorage.getItem('history') || '[]'); }
  catch { history = []; }
  if (!Array.isArray(history)) history = [];
}
function saveHistory() {
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  try { localStorage.setItem('history', JSON.stringify(history)); } catch { /* quota */ }
}

async function init() {
  models = await fetch('/api/models').then((r) => r.json());
  loadEnabled(models.map((m) => m.id));
  loadHistory();
  renderColumns();
  renderHistory();
  applyEnabled();
  await refreshStatus();
  connectWs();
  setInterval(refreshStatus, 8000);
}

function renderColumns() {
  const wrap = document.getElementById('columns');
  wrap.innerHTML = '';
  for (const m of models) {
    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `
      <div class="col-head"><span>${m.name}</span><span class="spinner"></span><button class="copy-btn" title="复制本模型最新回答">复制</button></div>
      <div class="col-body" data-id="${m.id}"></div>`;
    wrap.appendChild(col);
    cols[m.id] = { col, body: col.querySelector('.col-body') };
    const btn = col.querySelector('.copy-btn');
    btn.onclick = () => copyText(latestAnswer(m.id), btn);
  }
}

// Build a single turn (question + answer + meta) inside a model's column and
// register its elements for live updates.
function appendTurn(round, id) {
  const c = cols[id];
  if (!c) return;
  const a = round.answers[id] || { text: '', status: 'pending' };
  const turn = document.createElement('div');
  turn.className = 'turn';
  turn.innerHTML = `
    <div class="turn-q"></div>
    <div class="turn-a ${a.status === 'error' ? 'error' : ''}"></div>
    <div class="turn-meta"><span class="meta-text"></span><button class="refresh-btn" title="重新抓取该模型当前页面上的答案（不重新提问）">刷新</button><button class="retry-btn" title="在该模型上重新发送本问题">重试</button></div>`;
  turn.querySelector('.turn-q').textContent = round.q;
  const aEl = turn.querySelector('.turn-a');
  const metaEl = turn.querySelector('.meta-text');
  const retryBtn = turn.querySelector('.retry-btn');
  const refreshBtn = turn.querySelector('.refresh-btn');
  aEl.textContent = a.text || '';
  metaEl.textContent = metaFor(a);
  retryBtn.onclick = () => retry(round.id, id);
  refreshBtn.onclick = () => refresh(round.id, id);
  c.body.appendChild(turn);
  c.body.scrollTop = c.body.scrollHeight;
  (roundEls[round.id] ||= {})[id] = { turnEl: turn, aEl, metaEl, retryBtn, refreshBtn };
}

// Re-scrape a model's current on-page answer (no re-submit) and update this turn.
function refresh(roundId, id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const round = history.find((r) => r.id === roundId);
  if (!round) return;
  const a = (round.answers[id] ||= { text: '', status: 'running' });
  a.status = 'running'; a._startedAt = Date.now();
  if (!roundEls[round.id]?.[id]) appendTurn(round, id);
  const els = roundEls[round.id][id];
  els.aEl.classList.remove('error');
  els.metaEl.textContent = '刷新中…';
  cols[id]?.col.classList.add('running');
  pendingRound[id] = round.id;
  saveHistory();
  ws.send(JSON.stringify({ type: 'refresh', model: id }));
}

// Re-send a single round's question to one model and update that turn in place.
function retry(roundId, id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const round = history.find((r) => r.id === roundId);
  if (!round) return;
  const a = (round.answers[id] ||= { text: '', status: 'running' });
  a.status = 'running'; a.text = ''; delete a.ms; a._startedAt = Date.now();
  if (!roundEls[round.id]?.[id]) appendTurn(round, id);
  const els = roundEls[round.id][id];
  els.aEl.classList.remove('error');
  els.aEl.textContent = '';
  els.metaEl.textContent = '重试中…';
  cols[id]?.col.classList.add('running');
  pendingRound[id] = round.id;
  saveHistory();
  ws.send(JSON.stringify({ type: 'ask', prompt: round.q, models: [id] }));
}

// Re-scrape the latest round's on-page answer for every enabled model that
// participated in it (no re-submit).
function refreshAll() {
  const round = history[history.length - 1];
  if (!round) return;
  for (const m of models) {
    if (enabled.has(m.id) && round.answers[m.id]) refresh(round.id, m.id);
  }
}

// Re-send the latest round's question to every enabled model.
function retryAll() {
  const round = history[history.length - 1];
  if (!round) return;
  for (const m of models) {
    if (enabled.has(m.id)) retry(round.id, m.id);
  }
}

function metaFor(a) {
  if (a.status === 'running') return '生成中…';
  if (a.status === 'error') return '出错';
  if (a.status === 'done') return `完成 · ${a.text ? a.text.length : 0} 字${a.ms ? ' · ' + (a.ms / 1000).toFixed(1) + 's' : ''}`;
  return '';
}

// Re-render the full transcript from stored history (on load / after reset).
function renderHistory() {
  for (const id in cols) cols[id].body.innerHTML = '';
  for (const k in roundEls) delete roundEls[k];
  for (const round of history) {
    for (const id of Object.keys(round.answers)) appendTurn(round, id);
  }
}

function latestAnswer(id) {
  for (let i = history.length - 1; i >= 0; i--) {
    const a = history[i].answers[id];
    if (a && a.text) return a.text;
  }
  return '';
}

async function copyText(text, btn) {
  text = (text || '').trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
  } catch { /* clipboard blocked */ }
}

function copyAll(btn) {
  const parts = [];
  for (const m of models) {
    if (!enabled.has(m.id)) continue;
    const t = latestAnswer(m.id).trim();
    if (t) parts.push(`【${m.name}】\n${t}`);
  }
  copyText(parts.join('\n\n'), btn);
}

function applyEnabled() {
  for (const m of models) {
    if (cols[m.id]) cols[m.id].col.style.display = enabled.has(m.id) ? '' : 'none';
  }
}

function toggleModel(id) {
  if (enabled.has(id)) enabled.delete(id); else enabled.add(id);
  saveEnabled();
  applyEnabled();
  refreshStatus();
}

async function refreshStatus() {
  let status = [];
  try { status = await fetch('/api/status').then((r) => r.json()); } catch { return; }
  const byId = Object.fromEntries(status.map((s) => [s.id, s.loggedIn]));
  const bar = document.getElementById('status-bar');
  bar.innerHTML = '';
  // Active models first (so the front row stays useful even when many are disabled);
  // inactive models render after a divider so they wrap to a second line if needed.
  const sorted = [...models].sort((a, b) => (enabled.has(b.id) - enabled.has(a.id)));
  let inactiveStarted = false;
  for (const m of sorted) {
    const on = byId[m.id];
    const active = enabled.has(m.id);
    if (!active && !inactiveStarted) {
      const sep = document.createElement('span');
      sep.className = 'chip-sep';
      bar.appendChild(sep);
      inactiveStarted = true;
    }
    const chip = document.createElement('span');
    chip.className = 'status-chip' + (on ? ' on' : '') + (active ? '' : ' off');
    chip.innerHTML = `<input type="checkbox" ${active ? 'checked' : ''} title="启用/停用">
      <span class="dot"></span>${m.name}
      <button data-id="${m.id}">${on ? '已登录' : '登录'}</button>`;
    chip.querySelector('input').onchange = () => toggleModel(m.id);
    chip.querySelector('button').onclick = (e) => { e.stopPropagation(); login(m.id); };
    bar.appendChild(chip);
  }
}

async function login(id) {
  await fetch('/api/login/' + id, { method: 'POST' });
  setTimeout(refreshStatus, 1500);
}

async function newChat(btn) {
  if (history.length && !confirm('清空所有历史记录，并为已启用的模型开启全新对话？')) return;
  history = [];
  saveHistory();
  renderHistory();
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '新建中…';
  try { await fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [...enabled] }) }); }
  catch { /* ignore */ }
  btn.disabled = false;
  btn.textContent = old;
  refreshStatus();
}

function connectWs() {
  ws = new WebSocket('ws://' + location.host);
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => setTimeout(connectWs, 1500);
}

function handle(msg) {
  if (msg.type === 'all-done') { setSending(false); saveHistory(); return; }
  const round = history.find((r) => r.id === pendingRound[msg.model]);
  if (!round) return;
  const a = round.answers[msg.model];
  const els = roundEls[round.id]?.[msg.model];
  if (!a || !els) return;
  const c = cols[msg.model];
  switch (msg.type) {
    case 'start':
      a.status = 'running'; a.text = ''; a._startedAt = Date.now();
      els.aEl.classList.remove('error');
      els.aEl.textContent = '';
      els.metaEl.textContent = '生成中…';
      if (c) c.col.classList.add('running');
      break;
    case 'delta':
      if (msg.replace) a.text = msg.delta; else a.text = (a.text || '') + msg.delta;
      els.aEl.textContent = a.text;
      c.body.scrollTop = c.body.scrollHeight;
      break;
    case 'done':
      a.status = 'done';
      if (a._startedAt) { a.ms = Date.now() - a._startedAt; delete a._startedAt; }
      els.metaEl.textContent = metaFor(a);
      if (c) c.col.classList.remove('running');
      delete pendingRound[msg.model];
      saveHistory();
      break;
    case 'error':
      a.status = 'error'; a.text = msg.error;
      els.aEl.classList.add('error');
      els.aEl.textContent = msg.error;
      els.metaEl.textContent = '出错';
      if (c) c.col.classList.remove('running');
      delete pendingRound[msg.model];
      saveHistory();
      break;
  }
}

function setSending(on) {
  document.getElementById('send').disabled = on;
}

function send() {
  const promptEl = document.getElementById('prompt');
  const prompt = promptEl.value.trim();
  if (!prompt || !ws || ws.readyState !== WebSocket.OPEN) return;
  const targets = [...enabled];
  if (!targets.length) return;
  setSending(true);

  const round = { id: Date.now(), q: prompt, ts: Date.now(), answers: {} };
  for (const id of targets) { round.answers[id] = { text: '', status: 'running' }; pendingRound[id] = round.id; }
  history.push(round);
  for (const id of targets) appendTurn(round, id);
  saveHistory();

  ws.send(JSON.stringify({ type: 'ask', prompt, models: targets }));
  promptEl.value = '';
}

document.getElementById('send').onclick = send;
document.getElementById('copy-all').onclick = (e) => copyAll(e.currentTarget);
document.getElementById('new-chat').onclick = (e) => newChat(e.currentTarget);
document.getElementById('refresh-all').onclick = () => refreshAll();
document.getElementById('retry-all').onclick = () => retryAll();
// Enter = newline (default textarea behavior); Shift+Enter = send.
document.getElementById('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send(); }
});

init();
