// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-10-27: exercise autosave ordering and failure recovery through the real API.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const [url, root] = process.argv.slice(2);
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium'});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', {name:'arithmetic', exact:true}).click();
  const path = `${root}/programs/arithmetic/main.s`;
  async function type(text) {
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText(text);
  }
  await type('# saved without Ctrl+S\n');
  await page.waitForFunction(() => !window.aseHasUnsavedChanges());
  assert.ok((await readFile(path, 'utf8')).startsWith('# saved without Ctrl+S\n'));
  console.log('PASS edits automatically reach the source file');

  let release, started;
  const pending = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let saves = 0;
  await page.route('**/api/save', async route => {
    saves++;
    if (saves === 1) { started(); await gate; }
    await route.continue();
  });
  await type('# first pending edit\n');
  await pending;
  await type('# last pending edit\n');
  await page.getByRole('button', {name:'loop', exact:true}).click();
  assert.match(await page.locator('#project-title').innerText(), /^arithmetic(?: • Unsaved)?$/);
  assert.equal(saves, 1);
  release();
  await page.waitForFunction(() => document.querySelector('#project-title').textContent === 'loop');
  assert.ok((await readFile(path, 'utf8')).startsWith('# last pending edit\n# first pending edit\n'));
  assert.equal(await page.locator('#message-dialog[open]').count(), 0);
  console.log('PASS delayed saves retain the latest edit before changing project');
  await page.unroute('**/api/save');

  await page.getByRole('button', {name:'arithmetic', exact:true}).click();
  await page.route('**/api/save', route => route.fulfill({status:500, contentType:'application/json', body:JSON.stringify({error:'Test disk failure'})}));
  await type('# retained after failure\n');
  await page.getByRole('button', {name:'loop', exact:true}).click();
  await page.locator('#message-dialog[open]').waitFor();
  assert.match(await page.locator('#project-title').innerText(), /^arithmetic(?: • Unsaved)?$/);
  assert.equal(await page.evaluate(() => window.aseHasUnsavedChanges()), true);
  assert.ok((await page.evaluate(() => localStorage.getItem('ase-studio-draft:arithmetic'))).includes('retained after failure'));
  assert.ok(!(await readFile(path, 'utf8')).includes('retained after failure'));
  await page.getByRole('button', {name:'OK', exact:true}).click();
  await page.unroute('**/api/save');
  await page.getByRole('button', {name:'loop', exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#project-title').textContent === 'loop');
  assert.ok((await readFile(path, 'utf8')).includes('retained after failure'));
  console.log('PASS failed writes preserve editor/draft and navigation retries safely');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
