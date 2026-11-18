// Records the deployed board in use, in a fresh temporary Chrome profile (nothing from your own profile).
// Usage: npm run record            (BOARD_URL overrides the address)
// Prints when each step happens in the video, the ack receipt and the build sha, for the report.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';

const BOARD_URL = process.env.BOARD_URL || 'https://sched-prod-board.talii.workers.dev/';
const DIR = 'recordings';
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: DIR, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const t0 = Date.now();
const at = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let receipt = null;
let incidentCalls = 0;
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('ack ')) receipt = t.split(' ').pop();
});
page.on('request', (r) => {
  if (new URL(r.url()).pathname.endsWith('/incidents')) incidentCalls++;
});

const log = (flow, what) => console.log(`${at()}  ${flow}  ${what}`);

await page.goto(BOARD_URL, { waitUntil: 'commit' });
log('open-board', 'page opened, loader should be on screen');
await page.waitForTimeout(1500);
await page.getByTestId('loader').waitFor({ state: 'hidden' });
await page.getByTestId('incident-row').first().waitFor();
log('open-board', `incidents on screen: ${await page.getByTestId('incident-row').count()}`);
await page.waitForTimeout(3000);

const row = page.getByTestId('incident-row').first();
const id = await row.getAttribute('data-id');
await row.getByTestId('ack').hover();
await page.waitForTimeout(1000);
await row.getByTestId('ack').click();
await row.getByTestId('acked').waitFor();
log('ack-incident', `acked ${id}`);
await page.waitForTimeout(3000);

const before = incidentCalls;
await page.waitForTimeout(8000);
log('watch-board', `${incidentCalls - before} refresh calls in 8 s without a reload`);

const sha = await page.getByTestId('build-sha').textContent();
log('open-board', `footer build sha ${sha}`);
await page.waitForTimeout(2000);

const video = page.video();
await context.close();
await browser.close();
const path = await video.path();
const out = `${DIR}/board-${sha.slice(0, 7)}.webm`;
renameSync(path, out);
console.log(JSON.stringify({ video: out, ackedId: id, receipt, sha }, null, 2));
console.log(`files in ${DIR}: ${readdirSync(DIR).join(', ')}`);
