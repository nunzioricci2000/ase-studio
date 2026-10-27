# SPDX-License-Identifier: GPL-2.0-only
# Created in the personal fork on 2026-10-27: initial state and dynamic writeback regression coverage.
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('register_backend', Path(__file__).resolve().parents[1] / 'backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


def instruction(start, address, value, destination='x5', completed=True):
    asm = f'addi {destination}, x0, {value}'
    events = [f'{start+i}: cpu: Log4GUI: {stage}: {start+i}: 0: {address}: {asm}'
              for i, stage in enumerate(('fetch1', 'decode', 'execute', 'memory', 'writeback') if completed else ('fetch1', 'decode', 'execute'))]
    if completed:
        events += [f'{start+4}: global: x9=0xdeadbeef',
                   f'{start+4}: cpu: T0 : 0x{address} : {asm} : IntAlu : D={value:#x}']
    return events


class RegisterPlaybackTests(unittest.TestCase):
    def parse(self, events):
        with tempfile.TemporaryDirectory() as folder:
            trace = Path(folder) / 'trace.log'
            trace.write_text('\n'.join(events))
            return backend.parse_minor(trace)

    def test_initial_nonzero_state_is_not_first_instruction_write(self):
        data = self.parse(['0: cpu: ASE_INITIAL_REGISTERS_BEGIN thread=0',
                           '0: global: x2=0x12345678',
                           '0: global: f1=0x3ff0000000000000',
                           '0: cpu: ASE_INITIAL_REGISTERS_END thread=0'] + instruction(10, '100', 7))
        self.assertEqual(data['initialRegisters']['x2'], '0x12345678')
        self.assertEqual(data['initialRegisters']['f1'], '0x3ff0000000000000')
        self.assertEqual(data['registerDeltas'], {'5': {'x5': '0x00000007'}})

    def test_legacy_trace_does_not_invent_initial_state(self):
        data = self.parse(instruction(10, '100', 7))
        self.assertEqual(data['initialRegisters'], {'x0': '0x00000000'})

    def test_loop_occurrences_keep_their_own_results(self):
        data = self.parse(instruction(10, '100', 7) + instruction(20, '100', 9))
        self.assertEqual([row['registerWrites'] for row in data['dynamicInstructions']],
                         [{'x5': '0x00000007'}, {'x5': '0x00000009'}])

    def test_incomplete_instruction_and_zero_register_do_not_write(self):
        data = self.parse(instruction(10, '100', 7, destination='x0') + instruction(20, '104', 9, completed=False))
        self.assertEqual(data['registerDeltas'], {})
        self.assertEqual([row['registerWrites'] for row in data['dynamicInstructions']], [{}, {}])


if __name__ == '__main__':
    unittest.main()
