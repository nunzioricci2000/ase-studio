// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-10-30: exercise the actual update dialog, policy selection and failure feedback in Chromium.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright';
const server = spawn(process.env.PYTHON || 'python3', ['-u','tests/update-ui-server.py'], {stdio:['ignore','pipe','inherit']});
let browser;
try {
  const lines = createInterface({input:server.stdout});
  const url = await Promise.race([new Promise((resolve,reject) => { lines.once('line',resolve); server.once('error',reject); server.once('exit',code=>reject(Error(`UI fixture exited before readiness: ${code}`))); }), new Promise((_,reject)=>setTimeout(()=>reject(Error('UI fixture did not start within 60 seconds')),60000).unref())]);
  assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
  browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let state={managed:true,token:'fixture-token',mode:'automatic',phase:'available',version:'v1.6.2-abate.2',url:'https://github.com/nunzioricci2000/ase-studio/releases/tag/v1.6.2-abate.2'};
  const actions=[];
  await page.route('**/api/release-update',async route=>{
    const request=route.request();
    if(request.method()==='POST') {
      assert.equal(request.headers()['x-ase-update-token'],'fixture-token');
      const body=request.postDataJSON(); actions.push(body.action);
      if(body.action==='mode') state={...state,mode:body.mode};
      if(body.action==='download') state={...state,phase:'ready',message:'Prepared for next launch.'};
      if(body.action==='restart') return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Wait until the simulation finishes'})});
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(state)});
  });
  await page.goto(url);
  await page.locator('#release-updates').click();
  await page.locator('#release-update-dialog[open]').waitFor();
  assert.equal(await page.locator('#update').isVisible(),false);
  await page.locator('#release-update-mode').selectOption('notify');
  await page.waitForFunction(()=>document.querySelector('#release-update-mode').value==='notify');
  await page.locator('#release-update-download').click();
  await page.locator('#release-update-restart').waitFor({state:'visible'});
  await page.locator('#release-update-restart').click();
  await page.getByText('Wait until the simulation finishes',{exact:true}).waitFor();
  await page.locator('#release-update-close').click();
  assert.equal(await page.locator('#release-update-dialog').isVisible(),false);
  assert.ok(actions.includes('ready'));
  assert.ok(actions.includes('mode'));
  assert.ok(actions.includes('download'));
  assert.deepEqual(errors,[]);
  console.log('PASS application update UI: managed mode, preferences, prepare, deferred restart and actionable failures');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
