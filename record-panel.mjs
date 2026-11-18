// Records the panel flow on the deployed board, in a fresh temporary Chrome profile.
// A person picks an incident (a row opens its panel), a new incident arrives and pushes the rows down,
// and the person acks from the panel. The panel keeps naming the incident that was picked, so the ack goes there.
// Usage: npm run record-panel        (BOARD_URL overrides the address)
import { chromium } from 'playwright';
import { mkdirSync, renameSync } from 'node:fs';

const BOARD_URL = process.env.BOARD_URL || 'https://sched-prod-board.talii.workers.dev/';
const PICK_INDEX = 2; // the third row
const DIR = 'recordings';
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: DIR, size: { width: 1280, height: 720 } },
});
// A red dot that follows the pointer, so the video shows where the pointer is. Recording only, not the board.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:rgba(220,0,0,.7);z-index:99999;pointer-events:none;left:-50px;top:-50px';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  });
});
const page = await context.newPage();
const t0 = Date.now();
const at = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const log = (what) => console.log(`${at()}  ${what}`);

let ackLine = null;
page.on('console', (m) => { if (m.text().startsWith('ack ')) ackLine = m.text().split(' '); });

await page.goto(BOARD_URL);
const rows = page.getByTestId('incident-row');
await rows.nth(PICK_INDEX).waitFor();
await page.waitForTimeout(2000);

// Pick: look at a row and click it. It opens the panel.
const meant = await rows.nth(PICK_INDEX).getAttribute('data-id');
const topBefore = await rows.first().getAttribute('data-id');
const rowBox = await rows.nth(PICK_INDEX).boundingBox();
await page.mouse.move(rowBox.x + 200, rowBox.y + rowBox.height / 2, { steps: 20 });
await page.waitForTimeout(500);
await page.mouse.click(rowBox.x + 200, rowBox.y + rowBox.height / 2);
const panel = page.getByTestId('incident-panel');
await panel.waitFor();
log(`picked row ${PICK_INDEX + 1} (${meant}); the panel names ${await panel.getAttribute('data-id')}; top row is ${topBefore}`);

// A new incident arrives and the rows move down.
await page.waitForFunction(
  (top) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== top,
  topBefore,
  { timeout: 40000, polling: 'raf' },
);
const topAfter = await rows.first().getAttribute('data-id');
const meantIndexNow = await page.locator('[data-testid="incident-row"]').evaluateAll((els, id) => els.findIndex((e) => e.dataset.id === id), meant);
await page.waitForTimeout(1500);
const panelNamed = await panel.getAttribute('data-id');
log(`new incident ${topAfter} arrived at the top; ${meant} is now row ${meantIndexNow + 1}; the panel still names ${panelNamed}`);

// Ack from the panel.
const ackBtn = page.getByTestId('panel-ack');
const box = await ackBtn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
await page.waitForTimeout(800);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(2500);

const ackedId = ackLine ? ackLine[1] : null;
const receipt = ackLine ? ackLine[ackLine.length - 1] : null;
const markedRows = await page.locator('[data-testid="incident-row"]:has([data-testid="acked"])').evaluateAll((els) => els.map((e) => e.dataset.id));
const sha = await page.getByTestId('build-sha').textContent();
log(`acked ${ackedId}; rows with the acked mark: ${markedRows.join(', ') || 'none'}; build ${sha}`);
await page.waitForTimeout(2500);

const video = page.video();
await context.close();
await browser.close();
const out = `${DIR}/board-panel-${sha.slice(0, 7)}.webm`;
renameSync(await video.path(), out);
console.log(JSON.stringify({ video: out, meant, newIncident: topAfter, panelNamedAfterArrival: panelNamed, acked: ackedId, wrongRow: ackedId !== meant, receipt, sha }, null, 2));
