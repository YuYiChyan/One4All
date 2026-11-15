import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('maono_backend', Path(__file__).resolve().parents[1] / 'core' / 'maono_backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class Protocol:
    REPORT_LENGTH = 64
    FIELD_DEFINITIONS = {'gain': {'address': 0x2023, 'writable': True, 'type': 'number', 'min': 0, 'max': 100, 'step': 1}, 'lightingColor': {'address': 0x2038, 'writable': True, 'type': 'select'}, 'unknown': {'address': 0x2039, 'writable': False}}

    @staticmethod
    def frame(kind, address, value=0):
        packet = bytearray(64)
        packet[0], packet[5] = 75, kind
        packet[6:8], packet[8:10] = address.to_bytes(2, 'little'), value.to_bytes(2, 'little')
        return bytes(packet)

    @staticmethod
    def read_packet(address):
        return Protocol.frame(4, address)

    @staticmethod
    def write_packet(address, value):
        return Protocol.frame(3, address, value)

    @staticmethod
    def parse_report(raw):
        if len(raw) < 12 or raw[0] != 75:
            raise ValueError('Malformed report')
        return {'kind': raw[5], 'address': int.from_bytes(raw[6:8], 'little'), 'value': int.from_bytes(raw[8:10], 'little')}

    @staticmethod
    def decode_field(key, raw):
        return raw & 15 if key == 'lightingColor' else raw

    @staticmethod
    def encode_field(key, value, current):
        if type(value) is not int or not 0 <= value <= (8 if key == 'lightingColor' else 100):
            raise ValueError('Out of range')
        return (current & 0xf0) | value if key == 'lightingColor' else value


class FakeHid:
    def __init__(self):
        self.info = {'vendor_id': 0x352f, 'product_id': 0x010c, 'interface_number': 3, 'usage_page': 12, 'usage': 1, 'path': b'fixture&mi_03'}
        self.records = [self.info]
        self.values = {0x2023: 96, 0x2038: 0x12, 0x2039: 17}
        self.sent, self.incoming = [], []
        self.opens, self.closes = 0, 0
        self.ignore_write = False

    def enumerate(self, vendor, product):
        return self.records

    def device(self):
        return self

    def open_path(self, path):
        assert path in [info['path'] for info in self.records]
        self.opens += 1

    def close(self):
        self.closes += 1

    def write(self, packet):
        self.sent.append(packet)
        reply = Protocol.parse_report(packet)
        if reply['kind'] == 4:
            self.incoming.extend([b'bad', Protocol.frame(3, 0x2034, 999), Protocol.frame(4, 0x1234, 999), Protocol.frame(4, reply['address'], self.values[reply['address']])])
        elif not self.ignore_write:
            self.values[reply['address']] = reply['value']
        return len(packet)

    def read(self, length, timeout):
        return self.incoming.pop(0) if self.incoming else []


class BackendTests(unittest.TestCase):
    def fixture(self):
        hid = FakeHid()
        return hid, backend.Backend(hid, Protocol, timeout_ms=5)

    def test_scan_is_identity_only_and_exact_model_interface(self):
        hid, service = self.fixture()
        hid.records += [{**hid.info, 'product_id': 0x0108}, {**hid.info, 'path': b'wrong&mi_02', 'interface_number': 2}, {**hid.info, 'usage_page': 1}]
        self.assertEqual(len(service.run({'action': 'scan'})['devices']), 1)
        self.assertEqual(hid.opens, 0)
        self.assertFalse(hid.sent)

    def test_status_filters_live_level_and_wrong_register_without_writes(self):
        hid, service = self.fixture()
        state = service.run({'action': 'status', 'deviceId': 'maono-pd100x'})
        self.assertEqual(state['values']['gain'], 96)
        self.assertEqual(state['values']['lightingColor'], 2)
        self.assertTrue(all(packet[5] == 4 for packet in hid.sent))
        self.assertEqual(hid.closes, 1)

    def test_setting_uses_live_register_preserves_other_fields_and_reads_back(self):
        hid, service = self.fixture()
        state = service.run({'action': 'execute', 'deviceId': backend.device_id(hid.info), 'command': 'lightingColor.set', 'value': 6})
        self.assertEqual(hid.values[0x2038], 0x16)
        self.assertEqual(state['values']['lightingColor'], 6)
        self.assertEqual(sum(packet[5] == 3 for packet in hid.sent), 1)
        self.assertEqual(hid.closes, 1)

    def test_failed_readback_never_reports_success(self):
        hid, service = self.fixture()
        hid.ignore_write = True
        with self.assertRaisesRegex(OSError, '读回'):
            service.run({'action': 'execute', 'deviceId': backend.device_id(hid.info), 'command': 'gain.set', 'value': 30})
        self.assertEqual(hid.closes, 1)

    def test_invalid_value_unknown_field_and_model_selector_do_not_write(self):
        hid, service = self.fixture()
        for request in [{'command': 'gain.set', 'value': 101}, {'command': 'unknown.set', 'value': 1}, {'command': 'gain.set', 'value': 10, 'deviceId': 'maono-pd100x'}]:
            with self.assertRaises(ValueError):
                service.run({'action': 'execute', 'deviceId': backend.device_id(hid.info), **request})
        self.assertFalse(any(packet[5] == 3 for packet in hid.sent))

    def test_offline_and_multiple_devices_leave_selection_available(self):
        hid, service = self.fixture()
        hid.records = []
        self.assertFalse(service.run({'action': 'status', 'deviceId': 'maono-pd100x'})['connected'])
        hid.records = [hid.info, {**hid.info, 'path': b'other&mi_03'}]
        state = service.run({'action': 'status', 'deviceId': 'maono-pd100x'})
        self.assertTrue(state['ambiguous'])
        self.assertEqual(len(state['devices']), 2)
        self.assertEqual(hid.opens, 0)


class NativeCodecIntegrationTests(unittest.TestCase):
    def fixture(self):
        import maono_protocol

        class NativeFakeHid(FakeHid):
            def __init__(self):
                super().__init__()
                self.values = {0x2023: 96, 0x2022: 0, 0x203a: 1, 0x203b: 1350, 0x2036: 1, 0x2037: 40, 0x2038: 0x12}

            def reply(self, kind, address, value):
                packet = bytearray(maono_protocol.write_packet(address, value))
                packet[5] = kind
                packet[10:12] = (-sum(packet[1:10]) & 0xffff).to_bytes(2, 'little')
                return bytes(packet)

            def write(self, packet):
                self.sent.append(packet)
                address = int.from_bytes(packet[6:8], 'little')
                if packet[5] == 4:
                    assert packet == maono_protocol.read_packet(address)
                    self.incoming.extend([self.reply(3, 0x2034, 999), self.reply(4, address, self.values[address])])
                else:
                    parsed = maono_protocol.parse_report(packet)
                    assert parsed and parsed['kind'] == 3
                    self.values[address] = parsed['value']
                return len(packet)

        hid = NativeFakeHid()
        return hid, backend.Backend(hid, maono_protocol, timeout_ms=5)

    def test_actual_codec_exposes_eight_confirmed_fields_from_capture_values(self):
        hid, service = self.fixture()
        result = service.run({'action': 'status', 'deviceId': 'maono-pd100x'})
        self.assertEqual(len(result['capabilities']), 8)
        self.assertEqual(result['values']['noiseLevel'], 15)
        self.assertEqual(result['values']['lightingMode'], 16)
        self.assertIs(result['values']['mute'], False)
        self.assertFalse(result['errors'])
        self.assertTrue(all(packet[5] == 4 for packet in hid.sent))

    def test_actual_codec_scales_strength_and_preserves_shared_lighting_bits(self):
        hid, service = self.fixture()
        target = backend.device_id(hid.info)
        service.run({'action': 'execute', 'deviceId': target, 'command': 'noiseLevel.set', 'value': 20})
        self.assertEqual(hid.values[0x203b], 1400)
        result = service.run({'action': 'execute', 'deviceId': target, 'command': 'lightingColor.set', 'value': 6})
        self.assertEqual(hid.values[0x2038], 0x16)
        self.assertEqual(result['values']['lightingMode'], 16)
        self.assertEqual(result['values']['lightingColor'], 6)
        self.assertEqual(hid.closes, 2)


if __name__ == '__main__':
    unittest.main()
