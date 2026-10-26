import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle = await build({entryPoints:['tests/harness.js'],bundle:true,write:false,outdir:'/tmp/ase-editor-test',format:'esm',target:'es2022',loader:{'.ttf':'dataurl'},plugins:[{name:'sanitizer',setup(b){b.onResolve({filter:/dompurify\/dompurify\.js$/},()=>({path:resolve('node_modules/dompurify/dist/purify.es.mjs')}));}}]});
const script = bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const fixture = '<!doctype html><html><head><link rel="stylesheet" href="/vendor/editor.css"><link rel="stylesheet" href="/studio.css"></head><body style="display:block"><div id="source-editor" style="width:900px;height:650px"></div><div id="editor-status" role="status"></div><script type="module" src="/vendor/harness.js"></script></body></html>';
const server = createServer(async(req,res)=>{
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path === '/harness') {res.setHeader('Content-Type','text/html');res.end(fixture);return;}
    if (path === '/vendor/harness.js') {res.setHeader('Content-Type','text/javascript');res.end(script);return;}
    const file = resolve('frontend', '.'+path);
    if (!file.startsWith(resolve('frontend')+'/')) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type', {'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'}[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}/harness`;
if (process.env.ASE_TEST_SERVE_ONLY) {console.log(url);}
else {
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
    const page = await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`) ? route.continue() : route.abort());
    await page.goto(url);
    await page.waitForFunction(()=>window.harness?.ready);
    const checks=await page.evaluate(()=>window.runEditorTests());
    assert.deepEqual(errors,[]);
    for (const check of checks) console.log(`PASS ${check}`);
    // Check the rendered completion and hover widgets using actual editor commands.
    await page.evaluate(()=>{
      const {monaco}=window.harness;
      const ed=monaco.editor.getEditors()[0];
      ed.setPosition({lineNumber:4,column:8});
      ed.trigger('test','editor.action.triggerSuggest',{});
    });
    await page.waitForSelector('.suggest-widget.visible');
    assert.ok(await page.locator('.suggest-widget').innerText().then(t=>t.includes('addi')));
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      const ed=window.harness.monaco.editor.getEditors()[0];
      ed.setPosition({lineNumber:4,column:7});
      ed.trigger('test','editor.action.showHover',{});
    });
    await page.waitForSelector('.monaco-hover');
    assert.ok((await page.locator('.monaco-hover').innerText()).includes('immediate'));
    console.log('PASS rendered RISC-V completion and hover');
  } finally {await browser?.close();server.close();}
}
