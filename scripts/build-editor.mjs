// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-10-27: retain DOMPurify MPL license in generated distributions.
// Modified in the personal fork on 2026-10-28: optionally report the exact bundled inputs for source/notice audits.
// Modified in the personal fork on 2026-10-28: retain the unchanged Codicons font's separate attribution and license.
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {mkdir, copyFile, rm, writeFile} from 'node:fs/promises';
const outdir = 'frontend/vendor';
await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});
// Monaco also vendors DOMPurify; overriding npm alone does not replace that copy.
const sanitizerPlugin = {name:'patched-dompurify', setup(builder) {
  builder.onResolve({filter:/dompurify\/dompurify\.js$/}, () => ({path:resolve('node_modules/dompurify/dist/purify.es.mjs')}));
}};
const result = await build({
  plugins:[sanitizerPlugin],
  entryPoints: {'editor': 'frontend/editor/editor.js', 'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js'},
  outdir, bundle: true, format: 'esm', target: 'es2022', minify: true, metafile: true,
  loader: {'.ttf': 'file'}, assetNames: '[name]-[hash]', legalComments: 'linked',
});
if (process.env.ASE_FRONTEND_REPORT) {
  await writeFile(process.env.ASE_FRONTEND_REPORT, JSON.stringify(result.metafile, null, 2) + '\n');
  await writeFile(process.env.ASE_FRONTEND_REPORT + '.license', 'SPDX-License-Identifier: GPL-2.0-only\n');
}
await copyFile('node_modules/monaco-editor/LICENSE', `${outdir}/MONACO-LICENSE.txt`);
await copyFile('node_modules/monaco-editor/ThirdPartyNotices.txt', `${outdir}/MONACO-ThirdPartyNotices.txt`);
await copyFile('scripts/codicons-font-license.txt', `${outdir}/CODICONS-LICENSE.txt`);
await copyFile('scripts/codicons-font-notice.txt', `${outdir}/CODICONS-NOTICE.txt`);

await copyFile('node_modules/dompurify/LICENSE', `${outdir}/DOMPURIFY-LICENSE.txt`);

await copyFile('node_modules/dompurify/LICENSE-MPL', `${outdir}/DOMPURIFY-LICENSE-MPL.txt`);
