<!-- Modified in the personal fork on 2026-10-27: name the personal app and document automatic source saving. -->
<!-- Modified in the personal fork on 2026-10-27: clarify licensing and redistribution requirements. -->
<!-- Modified in the personal fork on 2026-10-27: document measured Studio CI and the corrected O3 engine check. -->
<!-- Modified in the personal fork on 2026-10-28: link verified portable desktop packages and explain their runtime requirements. -->
# ASE Studio di Nunzio

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/ase_dark.png">
    <img src="frontend/ase_light.png" alt="ASE Studio" width="360">
  </picture>
</p>


ASE Studio is a free educational application for learning RISC-V assembly,
processor hazards, memory behavior, and instruction pipelines.

The simulation backend is based on the open-source gem5 architectural
simulator. The five-stage RISC-V pipeline model builds on modifications
developed by contributors to the
[ase_riscv_gem5_sim](https://github.com/cad-polito-it/ase_riscv_gem5_sim)
project.
The modified simulator source is maintained in the CAD group's
[gem5 repository](https://github.com/cad-polito-it/gem5).

This personal fork is maintained at
[nunzioricci2000/ase-studio](https://github.com/nunzioricci2000/ase-studio).
Please report fork-specific problems in its
[issue tracker](https://github.com/nunzioricci2000/ase-studio/issues).

## Installation

Prebuilt application packages are available in the fork's
[GitHub Releases](https://github.com/nunzioricci2000/ase-studio/releases).
Choose `ase-studio-nunzio-TARGET.tar.gz` for the matching Linux distribution and
architecture, or the macOS Apple Silicon `.zip`. These packages include the
simulation engine, Python and the RISC-V toolchain; first launch does not compile
them. The separate `*-sources.tar.gz` archives supply the corresponding editable
sources and are not the application to launch.

On Linux, extract the application archive, enter its folder and install the
prebuilt system runtime packages using
`sudo bash ase_studio/scripts/runtime-dependencies.sh debian` for Ubuntu/Debian,
or replace `debian` with `fedora` or `arch`. Then run `./ase-studio`.
On macOS 15 Apple Silicon, install the listed Homebrew runtime libraries using
`bash "ASE Studio di Nunzio.app/Contents/Resources/ase_studio/scripts/runtime-dependencies.sh" macos`
and open the application. The preview is ad-hoc signed, not notarized.
Windows uses the Ubuntu 24.04 x86-64 package inside WSL2 with WSLg; it is not a
native Windows executable. Release notes state which platforms and runtime
checks passed, including the scope of the virtual-display Windows check.
Projects and settings are stored outside the application and survive replacing
its folder. See [RELEASES.md](RELEASES.md) for build reports and source rebuilds.

### Source checkout and existing simulator installations

ASE Studio is designed to live at `ase_studio/` as a Git submodule of the
simulator repository. Clone the parent repository with its submodules:

```bash
git clone --branch main --recurse-submodules https://github.com/nunzioricci2000/ase_riscv_gem5_sim.git
cd ase_riscv_gem5_sim
```

The unified installer supports Ubuntu, Fedora, and Arch Linux. Run it without
an argument for an interactive menu:
 
```bash
./utils/installation.sh
```

It can also install individual components or a complete frontend explicitly:

```text
./utils/installation.sh toolchain
./utils/installation.sh gem5
./utils/installation.sh ase-studio
./utils/installation.sh labinf
./utils/installation.sh visualizer
./utils/installation.sh all-ase
./utils/installation.sh all-qt
```

`all-ase` installs the RISC-V toolchain, gem5, and ASE Studio. `all-qt`
installs the same simulator dependencies with the Qt visualizer. The
installer updates the portable paths and selected frontend in `setup_default`.

On a LabInf workstation, the required compiler, gem5 build, and GUI runtime
are already installed. Run `./utils/installation.sh labinf` after cloning to
copy the paths from `setup_default.labinf` into `setup_default` and create the
ASE Studio application-menu and desktop launchers without reinstalling tools.

ASE Studio has no third-party pip dependencies; its backend uses the Python
standard library. The native window requires Python 3, PyGObject, GTK 3, and
WebKitGTK 4.1. Running the submodule installer directly installs and verifies
these packages on Ubuntu/Debian, Fedora, or Arch/Manjaro:

```bash
./ase_studio/install.sh
```

The installer adds ASE Studio to the current user's application menu. When a
desktop directory is available, it also creates a trusted `ASE Studio.desktop`
shortcut there.

## Assembly editor

The embedded Monaco editor provides multiple cursors, find/replace, undo/redo,
indentation, bracket matching, folding, RISC-V instruction/register completion,
and instruction hover help. Entry/exit scaffold instructions remain protected;
an edit touching a protected line is rejected as a whole. Instruction help
identifies ISA extensions and pseudoinstructions, but does not guarantee support
by the selected CPU configuration. The instruction reference is the
[RISC-V ISA specification](https://docs.riscv.org/reference/isa/unpriv/rv32.html).

Edits are saved to the project file automatically after 400 ms without typing.
Switching projects waits for pending saves; a failed save keeps the text and a
local recovery draft instead of discarding changes. Ctrl+S still saves immediately.

The editor and its worker are served locally and work offline. No VS Code
extension host, language server, label navigation, or inline assembler diagnostics
are included. Pipeline selection highlights the corresponding source line.

### Developing the editor

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

The fork includes upstream Studio 1.6.0: superscalar predictors, virtualized
pipeline navigation, memory pop-out, project folders, local drafts and compiler
diagnostics. Draft recovery, label protection and diagnostic navigation use Monaco.
Invalid tool paths can be repaired in Settings without blocking first launch.

The interface uses HTML/CSS and plain JavaScript inside WebKitGTK. Monaco
provides the source editor; `backend.py` compiles programs, runs gem5 and parses
its traces. The register, memory and pipeline panels are custom views. The
teaching timeline reschedules trace events, so register writes must stay attached
to their dynamic instruction, rather than only to an old cycle number.

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

## License and educational use

This project is intended for education and research. The repository is
distributed under the
[GNU General Public License version 2 only](LICENSE);
redistribution and modification must follow that license. gem5 components
retain their upstream copyright and license notices. The software is provided
without warranty.

##

<p align="center">
  <a href="https://www.polito.it/"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/polito_dark.png"><img src="frontend/polito_light.png" alt="Politecnico di Torino" height="52"></picture></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://cad.polito.it/"><picture><source media="(prefers-color-scheme: dark)" srcset="frontend/cad-dark.webp"><img src="frontend/cad-light.webp" alt="Electronic CAD and Reliability Group" height="52"></picture></a>
</p>

<p align="center"><small>© Politecnico di Torino 2026</small></p> 

## Redistribution and license compliance

The project code is **GPL-2.0-only**, except for components with their own
license notices. You may redistribute and modify it, including commercially,
subject to the applicable license conditions. Preserve upstream attribution
and identify changes made in this personal fork. No upstream endorsement is implied.

See [distribution requirements](DISTRIBUTION.md), [third-party components](THIRD_PARTY.md)
and [contributor instructions](AGENTS.md). Keep all required license notices
and provide corresponding source when distributing built artifacts.
