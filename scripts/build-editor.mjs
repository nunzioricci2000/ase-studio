import {build} from 'esbuild';
import {resolve} from 'node:path';
import {mkdir, copyFile, rm} from 'node:fs/promises';
const outdir = 'frontend/vendor';
await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});
// Monaco also vendors DOMPurify; overriding npm alone does not replace that copy.
const sanitizerPlugin = {name:'patched-dompurify', setup(builder) {
  builder.onResolve({filter:/dompurify\/dompurify\.js$/}, () => ({path:resolve('node_modules/dompurify/dist/purify.es.mjs')}));
}};
await build({
  plugins:[sanitizerPlugin],
  entryPoints: {'editor': 'frontend/editor/editor.js', 'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js'},
  outdir, bundle: true, format: 'esm', target: 'es2022', minify: true,
  loader: {'.ttf': 'file'}, assetNames: '[name]-[hash]', legalComments: 'linked',
});
await copyFile('node_modules/monaco-editor/LICENSE', `${outdir}/MONACO-LICENSE.txt`);
await copyFile('node_modules/monaco-editor/ThirdPartyNotices.txt', `${outdir}/MONACO-ThirdPartyNotices.txt`);

await copyFile('node_modules/dompurify/LICENSE', `${outdir}/DOMPURIFY-LICENSE.txt`);
