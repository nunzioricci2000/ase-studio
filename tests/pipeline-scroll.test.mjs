// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-10-30: run upstream scrolling regression checks on Linux and macOS without requiring GJS.
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('upstream pipeline scroll behavior in the Monaco fork', () => {
  const filename = fileURLToPath(new URL('./test_pipeline_scroll.js', import.meta.url));
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    TextDecoder, ARGV: [filename], print: () => {},
    imports: {gi: {GLib: {build_filenamev: parts => path.join(...parts),
      path_get_dirname: path.dirname, file_get_contents: file => [true, fs.readFileSync(file)]}},
      system: {programPath: filename}}
  }, {filename});
});
