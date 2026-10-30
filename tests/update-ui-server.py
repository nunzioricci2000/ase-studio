# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-30: serve the real UI with disposable empty projects and no engine or Git updates.
import os
from pathlib import Path
import sys
import tempfile
from http.server import ThreadingHTTPServer

with tempfile.TemporaryDirectory(prefix='ase-update-ui-') as directory:
    os.environ['ASE_STUDIO_HOST_ROOT'] = directory
    os.environ['ASE_STUDIO_DISABLE_UPDATES'] = '1'
    (Path(directory)/'programs').mkdir()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import backend
    backend.update_status = lambda **_: {'available':False, 'message':'Fixture'}
    server = ThreadingHTTPServer(('127.0.0.1',0),backend.Handler)
    print(f'http://127.0.0.1:{server.server_port}',flush=True)
    server.serve_forever()
