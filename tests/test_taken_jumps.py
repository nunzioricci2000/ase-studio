# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-11-02: verify upstream Minor branch order with squash and delayed completion.
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('jump_backend', Path(__file__).resolve().parents[1] / 'backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

class TakenJumpsTests(unittest.TestCase):
    def test_decode_order_excludes_squashed_fetch_and_delayed_completion(self):
        rows = [
            {'address':'10010','instruction':'addi x1, x1, 1','cycles':{'5':'D','6':'E'}},
            {'address':'10000','instruction':'bne x1, x0, 16','cycles':{'2':'D','3':'E'}},
            {'address':'10004','instruction':'addi x2, x2, 1','cycles':{'3':'F'},'squashed':True},
        ]
        self.assertEqual(backend.parse_taken_jumps([], [], rows),
                         [{'fromAddress':'10000','toAddress':'10010','cycle':3}])
    def test_fallthrough_and_mismatched_targets_are_not_taken_branches(self):
        for target in ('10004','10020'):
            rows = [{'address':'10000','instruction':'bne x1, x0, 16','cycles':{'2':'D','3':'E'}},
                    {'address':target,'instruction':'addi x1, x1, 1','cycles':{'5':'D'}}]
            self.assertEqual(backend.parse_taken_jumps([], [], rows), [])
