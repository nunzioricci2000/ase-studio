"""Serve the real application against disposable projects; never switch branches."""
import os
from pathlib import Path
import shutil
import sys
import tempfile
from http.server import ThreadingHTTPServer

studio = Path(__file__).resolve().parents[1]
host = Path(os.environ['ASE_TEST_HOST_ROOT']).resolve()
with tempfile.TemporaryDirectory(prefix='ase-monaco-projects-') as scratch:
    root = Path(scratch)
    os.environ['ASE_STUDIO_HOST_ROOT'] = scratch
    sys.path.insert(0, str(studio))
    import backend
    (root / 'programs').mkdir()
    for name in ('setup_default', '.ase-studio-env.json'):
        if (host / name).exists():
            shutil.copy2(host / name, root / name)
    for name in ('tools', 'gem5'):
        (root / name).symlink_to(host / name, target_is_directory=True)
    shutil.copy2(host / 'programs/demo.mk', root / 'programs/demo.mk')
    for name, body in [('arithmetic', '    li t0, 7\n    addi t1, t0, 3\n    mul t2, t0, t1'), ('loop', '    li t0, 3\nLoop:\n    addi t0, t0, -1\n    bnez t0, Loop')]:
        folder = root / 'programs' / name
        folder.mkdir()
        (folder / 'main.s').write_text(backend.TEMPLATE.replace('    # Write your RISC-V assembly here.', body))
        (folder / 'Makefile').write_text(backend.MAKEFILE)
    # Keep an editor regression test independent of remote update availability.
    backend.update_status = lambda **kwargs: {'available': False, 'message': 'Test fixture'}
    if '--simulate' in sys.argv:
        for name in ('arithmetic', 'loop'):
            built = backend.build(name)
            assert built['ok'], built['advancedOutput']
            simulated = backend.simulate(name)
            assert simulated['ok'], simulated['advancedOutput']
            print('PASS build and gem5 simulation:', name, flush=True)
    else:
        server = ThreadingHTTPServer(('127.0.0.1', 0), backend.Handler)
        print(f'http://127.0.0.1:{server.server_address[1]}', flush=True)
        print(scratch, flush=True)
        server.serve_forever()
