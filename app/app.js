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
const rowEls = new Map(); // incident id -> its <li>. Rows are kept and updated in place, never rebuilt.
let selectedId = null; // the panel follows this id, never a row position

const fmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const localTime = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : fmt.format(d); };

function makeRow(id) {
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'incident-row');
  li.dataset.id = id;
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Open incident ${id}`);
  li.innerHTML = '<span class="id"></span><span class="sev"></span><span class="what"></span><time></time><span class="mark"></span>';
  li.querySelector('.id').textContent = id;
  return li;
}

function updateRow(li, i) {
  li.className = `row ${String(i.severity).replace(/[^\w-]/g, '')}${i.id === selectedId ? ' selected' : ''}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const t = li.querySelector('time');
  t.setAttribute('datetime', i.openedAt);
  t.textContent = localTime(i.openedAt);
  const mark = li.querySelector('.mark');
  if (acked.has(i.id) && !mark.firstElementChild) {
    mark.innerHTML = '<span data-testid="acked" class="acked">✓ acked</span>';
  }
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
// Newest first by openedAt; equal times fall back to the incident id, so the order never depends on the API's.
const newestFirst = (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.id.localeCompare(a.id);
function render(unsorted) {
  const incidents = [...unsorted].sort(newestFirst);
  lastIncidents = incidents;
  for (const i of incidents) known.set(i.id, i);
  renderPanel();
  empty.hidden = incidents.length > 0;
  // Rows leave the board only when the feed drops them. A new incident adds one row; the others stay put.
  const keep = new Set(incidents.map((i) => i.id));
  for (const [id, li] of rowEls) {
    if (!keep.has(id)) { li.remove(); rowEls.delete(id); }
  }
  let ref = list.firstElementChild;
  for (const i of incidents) {
    let li = rowEls.get(i.id);
    if (!li) { li = makeRow(i.id); rowEls.set(i.id, li); }
    updateRow(li, i);
    if (li === ref) ref = ref.nextElementSibling;
    else list.insertBefore(li, ref);
  }
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
