// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: coordinate the Lumino frontend startup.
import {CommandRegistry} from '@lumino/commands';
import {StudioSession} from './workbench/session.js';
import {createShell} from './workbench/shell.js';
import {createApplication} from './application.js';

const commands = new CommandRegistry();
const session = new StudioSession();
const shell = createShell(commands);
const application = createApplication({session, shell, commands});
// The same harness runs inside Chromium, WebKitGTK and the native macOS WebView.
// Expose it only when explicitly requested by the test runner.
if (new URLSearchParams(location.search).has('workbench-test')) {
  window.studioWorkbench = {session,shell,commands,editor:application.sourceEditor};
}
