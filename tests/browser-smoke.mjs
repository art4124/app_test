import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json'};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + '/') || !/\.(html|js|css|svg|webmanifest)$/.test(file)) { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, {'Content-Type': types[file.slice(file.lastIndexOf('.'))], 'Cache-Control':'no-store'}).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#newPasscode').fill('FictionalPasscode-123');
  await page.locator('#confirmPasscode').fill('FictionalPasscode-123');
  await page.locator('#setupForm button[type=submit]').click();
  await page.locator('#termsAgreeCheck').check();
  await page.locator('#acceptTermsBtn').click();
  await page.locator('#termsGate').waitFor({state:'hidden'});

  await page.locator('#moodSelect').selectOption('calm');
  await page.locator('#checkinForm button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#saveCheckinStatus')?.textContent.includes('successfully'));
  await page.locator('#moodSelect').selectOption('anxious');
  await page.locator('#checkinForm button[type=submit]').click();
  await page.locator('#viewPastCheckinsBtn').click();
  assert.equal(await page.locator('#view-past-checkins [data-past-checkin-id]').count(), 2);

  await page.locator('.side-nav [data-view="settings"]').click();
  await page.locator('[data-plan="supporter"]').click();
  await page.locator('#currentPlanCard').getByText('Supporter', {exact:false}).first().waitFor();
  await page.locator('#companionLauncher').click({force:true});
  await page.locator('#generateReportBtn').click();
  await page.locator('#reportDialog[open]').waitFor();
  assert.equal(await page.locator('#reportContent .report-metric strong').first().innerText(), '2');
  await page.locator('#closeReportBtn').click();
  await page.locator('#closeCompanionBtn').click();

  await page.locator('.side-nav [data-view="journal"]').click();
  await page.locator('#journalText').fill('A fictional note for the browser test.');
  await page.locator('#journalForm button[type=submit]').click();
  await page.locator('#view-journal .journal-view-all').click();
  const savedNote = page.locator('#view-journal-entries .journal-history-text').first();
  await savedNote.waitFor();
  assert.equal(await savedNote.innerText(), 'A fictional note for the browser test.');

  await page.locator('#lockNowBtn').click();
  await page.locator('#unlockPasscode').fill('FictionalPasscode-123');
  await page.locator('#unlockForm button[type=submit]').click();
  await page.locator('#appShell').waitFor({state:'visible'});

  await page.locator('.side-nav [data-view="settings"]').click();
  await page.locator('[data-settings-tab="backup"]').click();
  await page.locator('#showRecoveryKeyBtn').click();
  await page.locator('.vune-secure-dialog input[type=password]').first().fill('FictionalPasscode-123');
  await page.locator('.vune-secure-dialog button[type=submit]').click();
  await page.locator('#recoveryKeyDisplay').waitFor({state:'visible'});
  const recoveryKey = await page.locator('#recoveryKeyDisplay').innerText();
  assert.ok(recoveryKey.length > 30);

  await page.locator('[data-settings-tab="security"]').click();
  await page.locator('#changePasscodeBtn').click();
  await page.locator('#vuneSecurePrimary').fill('ReplacementPasscode-456');
  await page.locator('#vuneSecureConfirm').fill('ReplacementPasscode-456');
  await page.locator('.vune-secure-dialog button[type=submit]').click();
  await page.locator('.vune-secure-dialog').waitFor({state:'detached'});
  await page.locator('#lockNowBtn').click();
  await page.locator('#unlockPasscode').fill('ReplacementPasscode-456');
  await page.locator('#unlockForm button[type=submit]').click();
  await page.locator('#appShell').waitFor({state:'visible'});

  await page.locator('.side-nav [data-view="settings"]').click();
  await page.locator('[data-settings-tab="data"]').click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#deleteAllBtn').click();
  await page.locator('#setupPanel').waitFor({state:'visible'});
  await page.locator('#restoreFromSetupBtn').click();
  await page.locator('#recoveryInput').fill(recoveryKey);
  await page.locator('#confirmRecoveryBtn').click();
  await page.locator('#vuneSecurePrimary').fill('RestoredPasscode-789');
  await page.locator('#vuneSecureConfirm').fill('RestoredPasscode-789');
  await page.locator('.vune-secure-dialog button[type=submit]').click();
  await page.locator('.vune-secure-dialog').waitFor({state:'detached'});
  await page.locator('.side-nav [data-view="today"]').click();
  await page.locator('#viewPastCheckinsBtn').click();
  assert.equal(await page.locator('#view-past-checkins [data-past-checkin-id]').count(), 2);

  assert.deepEqual(errors, []);
  await context.close();
  console.log('Browser smoke passed: vault, terms, repeated check-ins, report, journal, passcode rotation, lock, and Recovery Key restore.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
