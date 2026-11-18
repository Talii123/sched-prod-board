import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = document.querySelector('.error');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelId = panel.querySelector('.panel-id');
const panelWhat = panel.querySelector('.panel-what');
const panelSev = panel.querySelector('.panel-sev');
const panelTime = panel.querySelector('.panel-time');
const panelState = panel.querySelector('.panel-state');
const panelAck = panel.querySelector('[data-testid="panel-ack"]');
const panelClose = panel.querySelector('.panel-close');

const acked = new Set();
const pending = new Set();
const known = new Map(); // incident id -> latest incident we saw
let selectedId = null; // the panel follows this id, never a row position

const fmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const localTime = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : fmt.format(d); };

function rowHtml(i) {
  return `<li data-testid="incident-row" data-id="${esc(i.id)}" class="row ${esc(i.severity)}${i.id === selectedId ? ' selected' : ''}" tabindex="0" role="button" aria-label="Open incident ${esc(i.id)}">
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    ${acked.has(i.id) ? '<span data-testid="acked" class="acked">✓ acked</span>' : '<span></span>'}
  </li>`;
}

function renderPanel() {
  const i = selectedId && known.get(selectedId);
  panel.hidden = !i;
  if (!i) return;
  panel.dataset.id = i.id;
  panelId.textContent = i.id;
  panelWhat.textContent = `${i.service} · ${i.region} · ${i.summary}`;
  panelSev.textContent = i.severity;
  panelTime.textContent = localTime(i.openedAt);
  panelTime.setAttribute('datetime', i.openedAt);
  const isAcked = acked.has(i.id);
  const isPending = pending.has(i.id);
  panelAck.disabled = isAcked || isPending;
  panelAck.textContent = isAcked ? 'Acked' : isPending ? 'Acking…' : 'Ack';
  panelState.textContent = isAcked ? '✓ You have this one.' : '';
}

let lastIncidents = [];
let lastKey = '';
// Newest first by openedAt; equal times fall back to the incident id, so the order never depends on the API's.
const newestFirst = (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.id.localeCompare(a.id);
function render(unsorted) {
  const incidents = [...unsorted].sort(newestFirst);
  lastIncidents = incidents;
  for (const i of incidents) known.set(i.id, i);
  renderPanel();
  const key = JSON.stringify([incidents.map((i) => [i.id, i.openedAt, i.summary, i.severity]), [...acked], selectedId]);
  empty.hidden = incidents.length > 0;
  if (key === lastKey) return;
  lastKey = key;
  list.innerHTML = incidents.map(rowHtml).join('');
}

// A row opens its incident panel. The panel holds the incident id, so rows moving does not change what it acks.
function open(id) {
  selectedId = id;
  render(lastIncidents);
}
list.addEventListener('click', (e) => {
  const row = e.target.closest('[data-testid="incident-row"]');
  if (row) open(row.dataset.id);
});
list.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-testid="incident-row"]');
  if (!row) return;
  e.preventDefault();
  open(row.dataset.id);
});
panelClose.addEventListener('click', () => {
  selectedId = null;
  render(lastIncidents);
});

panelAck.addEventListener('click', async () => {
  const id = selectedId;
  if (!id || pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderPanel();
  try {
    await ack(id);
    acked.add(id);
    errorBox.hidden = true;
  } catch (err) {
    errorBox.textContent = `Could not ack ${id}: ${err.message}`;
    errorBox.hidden = false;
  } finally {
    pending.delete(id);
    render(lastIncidents);
  }
});

async function refresh() {
  try {
    const page = await fetchIncidents();
    loader.hidden = true;
    errorBox.hidden = true;
    render(page.incidents);
  } catch (err) {
    errorBox.textContent = `Could not load incidents: ${err.message}`;
    errorBox.hidden = false;
  }
}

async function loop() {
  await refresh();
  setTimeout(loop, REFRESH_MS);
}
loop();
