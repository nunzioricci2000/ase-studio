<!-- SPDX-License-Identifier: GPL-2.0-only -->
<!-- Created in the personal fork on 2026-10-30: retain fork-specific editor, checkout and regression workflows without copying the upstream guide. -->
# Developing Abate

Use the [upstream documentation](https://github.com/cad-polito-it/ase-studio#readme)
for unchanged Studio behavior. For this fork's source installation and engine
changes, see the [simulator fork guide](https://github.com/nunzioricci2000/ase_riscv_gem5_sim/blob/main/FORK.md).
Clone the personal fork, or initialize its `ase_studio` submodule, to work on
Abate. Studio has its own Git history; the simulator pins a Studio commit.

End users do not need Node.js. Maintainers rebuild the checked-in assets with:

```bash
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` to test with an
installed Chromium. Keep `frontend/vendor/` and the lockfile with source changes.
The fork's `Studio CI` workflow rebuilds and tests the frontend and backend on
Linux and both macOS architectures, with a separate WebKitGTK check. Per-phase
timestamps and logs are retained as artifacts; see [RELEASES.md](RELEASES.md).
These checks do not compile gem5 or produce a desktop distribution by themselves.
Monaco is pinned; upgrades must pass the edit-protection browser tests because
the adapter guards the model's edit entry points before its undo stack changes.
The build uses the pinned DOMPurify override in place of Monaco's bundled copy,
and includes Monaco, DOMPurify, and third-party license notices alongside assets.

To preview a separate Studio worktree against an existing simulator checkout:

```bash
ASE_STUDIO_HOST_ROOT=/path/to/ase_riscv_gem5_sim ./launch.sh --development
```

All launches validate the simulator runtime without fetching Git remotes or
switching branches. `--development` remains accepted for compatibility. The
backend always comes from this Studio checkout. `ASE_STUDIO_HOST_ROOT` selects
the simulator projects and toolchain; `ASE_STUDIO_PORT` selects another port.

This personal fork installs as **ASE Studio di Nunzio** with its own desktop ID,
`org.asestudio.Personal`, so the original installation can coexist.

The updater only fast-forwards the current branch from `origin`. Local changes,
divergent branches, detached HEADs and branches tracking another remote are never
reset or switched automatically. Commit or stash tracked setup and program edits
before updating. In a submodule installation, the simulator pins the Studio
commit; an external Studio worktree updates independently and leaves its host
repository alone. Keep `upstream` for manually reviewing original-project changes.

For in-order runs, the parent repository's `utils/gem5-runtime.patch` records the
entry register state and drains older instructions before a syscall can exit.
Build the updated engine with `./utils/installation.sh gem5` from the parent,
then rerun existing projects. Old traces cannot recover values never recorded;
unknown initial values display as `—`. This teaching gem5 deliberately initializes
`sp` to zero. O3 initial-state recording is not added by this MinorCPU patch.

Regression coverage for these changes:

- `python3 -m unittest discover -s tests -p 'test_*.py'`
- `ASE_TEST_HOST_ROOT=/path/to/simulator python3 tests/studio-server.py --simulate`
  checks delayed final writebacks and loop results using the installed engine.
- Start `ASE_TEST_HOST_ROOT=/path/to/simulator python3 tests/studio-server.py`,
  then run `node tests/autosave-browser.mjs URL SCRATCH_ROOT` with its printed
  values to check automatic writes, navigation, slow responses and write errors.

Run the fork update regression checks with `python3 -m unittest discover -s tests -p 'test_fork.py'`.

Additional native and integration checks:

- Start `ASE_TEST_SERVE_ONLY=1 npm run test:browser`, then run
  `python3 tests/webkit.py URL` with the printed harness URL to verify WebKitGTK.
- Set `ASE_TEST_HOST_ROOT` to a simulator checkout and run
  `python3 tests/studio-server.py`. It prints a URL and disposable project root.
  Pass both to `node tests/studio-browser.mjs URL SCRATCH_ROOT` to verify the
  application, saving, external reload, preferences, and pipeline navigation.
  Run `node tests/upstream-browser.mjs URL` against the same disposable server
  to verify draft recovery, label protection, diagnostics and superscalar controls.
- `ASE_TEST_HOST_ROOT=/path/to/ase_riscv_gem5_sim python3 tests/studio-server.py --simulate`
  builds and simulates temporary arithmetic and branch-loop programs. Add
  `--superscalar` to include O3 simulation checks. Older optimized gem5 22.1.0.0
  builds can abort in `InstructionQueue::getInstToExecute`; the parent fork's
  `utils/gem5-timebuffer.patch` fixes the uninitialized buffer responsible for
  this startup failure. Rebuild/update the engine before running this check.
  The arithmetic and loop checks pass with both CPU modes using the fixed engine.


The named release identity is shared by `versioning.py`, `VERSION` and
`FORK.json`; see [VERSIONING.md](VERSIONING.md). The backend keeps the numeric
`version` API field for compatibility and exposes `displayVersion`, `releaseTag`
and the fork name/revision separately. The About view displays `1.6.0 · Abate`.

Packaging tests run external scripts against the installed final archive; those
tools are not included in the runtime. Release-installer tests cover version
identity, integrity, rollback, concurrent operations and preservation of data.
A source archive must include the version module and fork metadata as well as
all packaging/build recipes. [RELEASES.md](RELEASES.md) describes the CI gates.
