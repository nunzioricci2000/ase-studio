<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-27: separate measured Studio checks from engine builds. -->
<!-- Modified in the personal fork on 2026-10-28: retain frontend provenance without adding runtime assets. -->
<!-- Modified in the personal fork on 2026-10-28: document portable startup and installed-runtime checks. -->
<!-- Modified in the personal fork on 2026-10-28: exercise the native macOS window and preserve webview preferences. -->
# Studio distribution workflow

Studio and its simulation engine are separate repositories and build products.
Studio's pipeline must consume a verified, source-paired engine SDK for each host
platform; changing JavaScript, Python or packaging must not compile gem5 again.
The portable-package workflow is under development. The checks below alone do
not produce an installable desktop package or certify a platform's simulator.

## Continuous checks

`Studio CI` runs on main, develop and feature/release/hotfix branches and on pull
requests. It rebuilds the locked Monaco bundle, rejects uncommitted generated
changes, and runs backend, editor and browser regressions on Ubuntu 24.04 and
macOS 15 Intel/Apple Silicon. A separate Ubuntu job tests the editor in the actual
WebKitGTK 4.1 engine used by the Linux native window, under a disposable display.
These frontend fixtures do not require a simulator installation or user projects.
Both macOS jobs also compile `scripts/native-macos.swift` against the system
AppKit/WebKit frameworks, then test Monaco, popup creation/closure, a real Blob
download, and native file selection inside that application. The temporary
test launcher is not uploaded as a standalone distribution.

Every job retains JSON and Markdown reports, UTC start/end timestamps, monotonic
phase durations, commands and diagnostics for 30 days. Dependency installation,
frontend compilation and runtime checks are measured separately. The npm download
cache is reused; dependencies remain pinned by package-lock.json. Neither Node,
Playwright nor its test browser needs to be installed by an end user.
`frontend-inputs.json` records esbuild's exact input/output graph for each build,
including the selected DOMPurify implementation. It is a provenance aid for
source/notice audits, not a substitute for shipping the corresponding sources.

Run locally from this repository using a new report directory:

```sh
python3 scripts/check.py --browser chromium --output /tmp/studio-checks-new
python3 scripts/check.py --browser webkitgtk --output /tmp/studio-webkit-new
```

For an existing Chromium installation, set `CHROMIUM_PATH`. The WebKitGTK check
requires PyGObject, GTK 3, WebKitGTK 4.1, Xvfb and xauth.

## Packaged runtime

`portable.py` connects Studio to an existing engine SDK without fetching or
compiling anything. It keeps projects, results and settings outside the installed
application: under `$XDG_DATA_HOME/ase-studio-nunzio` (normally
`~/.local/share/ase-studio-nunzio`) on Linux, and
`~/Library/Application Support/ASE Studio di Nunzio` on macOS. Existing settings,
setup files and project sources are preserved. The generated initial setup follows
the current application/SDK paths, so moving an app does not leave stale paths.
The preferred localhost port stays at 8765 (or `ASE_STUDIO_PORT`) to preserve
webview preferences between launches; the server falls back to a free port if
needed. Runtime tests explicitly request an isolated ephemeral port.

Linux's native entry point still uses the system Python and GTK/WebKitGTK packages.
The backend also supports the SDK's Python 3.10. `--server` is the entry point for
the native macOS webview; `--browser` explicitly opens the system browser for
diagnostics. For example, using disposable data:

```sh
python3 portable.py --engine /absolute/path/to/sdk --data /tmp/studio-new-data --check
python3 portable.py --engine /absolute/path/to/sdk --data /tmp/studio-new-data --browser
```

`scripts/smoke-package.py --studio APP/ase_studio --engine APP/engine --output REPORT`
launches the installed runtime and uses its real HTTP API to create, compile and
simulate disposable arithmetic/loop programs. It checks the final registers in
both CPU modes with direct and cached memory, checks Minor's entry snapshots,
loads the editor assets and verifies shutdown. `--python SDK/python/bin/python3.10`
also tests the embedded interpreter. JSON timing reports and simulator diagnostics
are retained. This check requires working engine binaries; it never builds gem5.

Portable-path tests cover spaces in application, compiler and data paths.
The installed-runtime check has also passed locally with a read-only application
copy and an existing Linux engine. Remote desktop packages still require their
own platform/runtime and native-window verification before release.

## Gitflow

Use `main` for stable versions, `develop` for integration, `feature/NAME` or
`fix/NAME` for development, `release/VERSION` for stabilization and
`hotfix/VERSION` for urgent stable fixes. Features merge into develop; releases
and hotfixes merge into main and back into develop. Copies of upstream branches
use `original/`; the original repository remains the `upstream` remote.

`python3 scripts/gitflow.py init` creates develop if absent and configures local
Gitflow prefixes. It does not switch branches, push, or rewrite history. CI checks
pull-request routes; configure GitHub branch protection to require the Studio
checks before merging. No automatic upstream branch switching is performed.

Before distributing desktop packages, follow [DISTRIBUTION.md](DISTRIBUTION.md),
verify the exact engine's runtime tests and include its matching sources, the
frontend's preferred editable dependency sources, and all required notices.
Assets with unresolved redistribution rights must be omitted from packages.
