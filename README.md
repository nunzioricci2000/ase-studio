# ASE Studio

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

Contributions are welcome. Feel free to
[open an issue](https://github.com/cad-polito-it/ase-studio/issues), submit a
pull request, or [contact us](mailto:behnam.farnaghinejad@polito.it).

## Installation

ASE Studio is designed to live at `ase_studio/` as a Git submodule of the
simulator repository. Clone the parent repository with its submodules:

```bash
git clone --branch main --recurse-submodules https://github.com/cad-polito-it/ase_riscv_gem5_sim.git
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
./utils/installation.sh visualizer
./utils/installation.sh all-ase
./utils/installation.sh all-qt
```

`all-ase` installs the RISC-V toolchain, gem5, and ASE Studio. `all-qt`
installs the same simulator dependencies with the Qt visualizer. The
installer updates the portable paths and selected frontend in `setup_default`.

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

This personal fork installs as **ASE Studio (fork)** with its own desktop ID,
`org.asestudio.Personal`, so the original installation can coexist.

The updater only fast-forwards the current branch from `origin`. Local changes,
divergent branches, detached HEADs and branches tracking another remote are never
reset or switched automatically. Commit or stash tracked setup and program edits
before updating. In a submodule installation, the simulator pins the Studio
commit; an external Studio worktree updates independently and leaves its host
repository alone. Keep `upstream` for manually reviewing original-project changes.

Run the fork update regression checks with `python3 -m unittest discover -s tests -p 'test_fork.py'`.

Additional native and integration checks:

- Start `ASE_TEST_SERVE_ONLY=1 npm run test:browser`, then run
  `python3 tests/webkit.py URL` with the printed harness URL to verify WebKitGTK.
- Set `ASE_TEST_HOST_ROOT` to a simulator checkout and run
  `python3 tests/studio-server.py`. It prints a URL and disposable project root.
  Pass both to `node tests/studio-browser.mjs URL SCRATCH_ROOT` to verify the
  application, saving, external reload, preferences, and pipeline navigation.
- `ASE_TEST_HOST_ROOT=/path/to/ase_riscv_gem5_sim python3 tests/studio-server.py --simulate`
  builds and simulates temporary arithmetic and branch-loop programs.

## License and educational use

This project is intended for education and research. The repository is
distributed under the
[GNU General Public License version 2](https://github.com/cad-polito-it/ase-studio/blob/main/LICENSE);
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
