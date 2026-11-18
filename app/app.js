import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = document.querySelector('.error');

const acked = new Set();
const pending = new Set();

const fmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const localTime = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : fmt.format(d); };

function rowHtml(i) {
  const isAcked = acked.has(i.id);
  return `<li data-testid="incident-row" data-id="${esc(i.id)}" class="row ${esc(i.severity)}">
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    ${isAcked
      ? '<span data-testid="acked" class="acked">✓ acked</span>'
      : `<button data-testid="ack" type="button"${pending.has(i.id) ? ' disabled' : ''}>Ack</button>`}
  </li>`;
}

let lastIncidents = [];
let lastKey = '';
// Newest first by openedAt; equal times fall back to the incident id, so the order never depends on the API's.
const newestFirst = (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.id.localeCompare(a.id);
function render(unsorted) {
  const incidents = [...unsorted].sort(newestFirst);
  lastIncidents = incidents;
  const key = JSON.stringify([incidents.map((i) => [i.id, i.openedAt, i.summary, i.severity]), [...acked], [...pending]]);
  empty.hidden = incidents.length > 0;
  if (key === lastKey) return;
  lastKey = key;
  list.innerHTML = incidents.map(rowHtml).join('');
}

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const id = btn.closest('[data-testid="incident-row"]').dataset.id;
  if (pending.has(id)) return;
  pending.add(id);
  render(lastIncidents);
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
