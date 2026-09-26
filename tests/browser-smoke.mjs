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
  const contrastFailures = await page.evaluate(() => {
    const accents = ['lavender','blue','mint','pink','peach','periwinkle','aqua','sage','butter','mauve'];
    const channel = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    const luminance = color => {
      const rgb = color.startsWith('#')
        ? [1,3,5].map(index => parseInt(color.slice(index,index+2),16))
        : color.match(/[\d.]+/g).slice(0,3).map(Number);
      return rgb.map(value => channel(value / 255)).reduce((sum,value,index) => sum + value * [.2126,.7152,.0722][index],0);
    };
    const contrast = (foreground, background) => {
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    };
    const failures = [];
    const headingColors = {light:new Set(),dark:new Set()};
    for(const mode of ['light','dark']) for(const accent of accents){
      vuneApplyDisplayPreferences(mode,accent);
      headingColors[mode].add(getComputedStyle(document.querySelector('#view-journal .journal-page-heading h3')).color);
      const paper = mode === 'dark' ? '#211e26' : '#fffdf8';
      const field = mode === 'dark' ? '#29252f' : '#ffffff';
      for(const [selector,background,pseudo] of [
        ['.journal-page-heading h3',paper],
        ['.journal-page-heading p',paper],
        ['.journal-meta-row label',paper],
        ['.journal-writing-label',paper],
        ['#journalTitle',field,'::placeholder'],
        ['#journalText',field,'::placeholder']
      ]){
        const element = document.querySelector('#view-journal '+selector);
        const color = getComputedStyle(element,pseudo).color;
        if(contrast(color,background) < 4.5) failures.push({mode,accent,selector,color});
      }
    }
    if(headingColors.light.size !== accents.length || headingColors.dark.size !== accents.length){
      failures.push({reason:'Journal heading did not follow every selected accent'});
    }
    vuneApplyDisplayPreferences('light','lavender');
    return failures;
  });
  assert.deepEqual(contrastFailures, [], 'Bloom Notes text should remain readable in every theme');
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
