// Records the ack race on the deployed board, in a fresh temporary Chrome profile.
// A person looks at a row, decides, and clicks a moment later. This script does the same, on purpose:
// it aims at a row, waits until a new incident arrives at the top (rows shift down), and then clicks the
// position it aimed at. It logs the row it meant, the row that got acked, and the ack receipt.
// Usage: npm run record-race        (BOARD_URL overrides the address)
import { chromium } from 'playwright';
import { mkdirSync, renameSync } from 'node:fs';

const BOARD_URL = process.env.BOARD_URL || 'https://sched-prod-board.talii.workers.dev/';
const AIM_INDEX = 1; // the second row
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
await rows.nth(AIM_INDEX).waitFor();
await page.waitForTimeout(2000);

// Look: pick the row to ack and where its Ack button is on screen.
const meant = await rows.nth(AIM_INDEX).getAttribute('data-id');
const topBefore = await rows.first().getAttribute('data-id');
const box = await rows.nth(AIM_INDEX).getByTestId('ack').boundingBox();
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
await page.mouse.move(x, y, { steps: 20 });
log(`aimed at row ${AIM_INDEX + 1} (${meant}), top row is ${topBefore}, pointer at ${Math.round(x)},${Math.round(y)}`);

// Decide: wait for the next arrival (the top row changes), at most 40 s.
await page.waitForFunction(
  (top) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== top,
  topBefore,
  { timeout: 40000, polling: 'raf' },
);
const topAfter = await rows.first().getAttribute('data-id');
log(`new incident ${topAfter} arrived at the top; rows moved down`);

// Click where the pointer is, as a person would a moment later.
await page.waitForTimeout(400);
await page.mouse.click(x, y);
log('clicked the aimed position');
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
const out = `${DIR}/board-race-${sha.slice(0, 7)}.webm`;
renameSync(await video.path(), out);
console.log(JSON.stringify({ video: out, meant, newIncident: topAfter, acked: ackedId, wrongRow: ackedId !== meant, receipt, sha }, null, 2));
