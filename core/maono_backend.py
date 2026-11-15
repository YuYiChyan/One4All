# SPDX-License-Identifier: MIT
"""PD100X 352F:010C native HID control; no Maono Link process required.

Discovery reads identity only. Register reads/writes use maono_protocol's exact
PD100X.dll-derived fields; no PD200X commands or default audio endpoint fallback.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))


def load_model():
    catalog = json.loads((Path(__file__).resolve().parent.parent / 'catalog' / 'maono-microphones.json').read_text(encoding='utf-8'))
    return next(model for model in catalog['models'] if model['id'] == 'maono-pd100x')


def device_matches(info):
    path = info.get('path', b'')
    path = path.decode('utf-8', errors='replace') if isinstance(path, bytes) else str(path)
    interface = info.get('interface_number') == 3 or '&mi_03' in path.lower()
    return info.get('vendor_id') == 0x352f and info.get('product_id') == 0x010c and interface and info.get('usage_page') == 12 and info.get('usage') == 1


def device_id(info):
    raw = info['path'] if isinstance(info['path'], bytes) else str(info['path']).encode('utf-8')
    return 'maono-352f-010c-' + hashlib.sha256(raw).hexdigest()[:20]


class Backend:
    def __init__(self, hid, protocol=None, timeout_ms=2000):
        if protocol is None:
            import maono_protocol as protocol
        self.hid, self.protocol, self.timeout_ms = hid, protocol, timeout_ms
        self.model = load_model()

    def metadata(self, info):
        return {'id': device_id(info), 'modelId': self.model['id'], 'name': self.model['name'], 'brand': 'maono', 'kind': 'microphone', 'vendorId': 0x352f, 'productId': 0x010c, 'connected': True, 'verification': 'unverified'}

    def scan(self):
        return [info for info in self.hid.enumerate(0x352f, 0x010c) if device_matches(info)]

    def read(self, handle, address):
        packet = self.protocol.read_packet(address)
        if handle.write(packet) != len(packet):
            raise OSError('PD100X 读取请求未完整发送')
        deadline = time.monotonic() + self.timeout_ms / 1000
        while time.monotonic() < deadline:
            raw = handle.read(self.protocol.REPORT_LENGTH, max(1, int((deadline - time.monotonic()) * 1000)))
            if not raw:
                continue
            try:
                reply = self.protocol.parse_report(bytes(raw))
            except (ValueError, IndexError):
                continue
            if reply and reply['kind'] == 4 and reply['address'] == address:
                return reply['value']
        raise TimeoutError('PD100X 没有返回此设置，请重新检测')

    def snapshot(self, handle, info):
        values, capabilities, errors = {}, {}, {}
        for key, field in self.protocol.FIELD_DEFINITIONS.items():
            try:
                raw = self.read(handle, field['address'])
                values[key] = self.protocol.decode_field(key, raw)
                capabilities[key] = {name: value for name, value in field.items() if name not in ('address', 'source', 'evidence')}
                capabilities[key].update(readable=True, writable=field.get('writable', False))
            except (OSError, ValueError, TimeoutError) as error:
                errors[key] = str(error)
        return {'ok': True, 'connected': True, 'interfaceConfirmed': bool(values), 'device': self.metadata(info), 'capabilities': capabilities, 'values': values, 'errors': errors, 'provider': 'maono-hidapi', 'verification': 'unverified'}

    def run(self, request):
        action = request.get('action')
        if action not in ('scan', 'status', 'execute'):
            raise ValueError('未知麦克风操作')
        records = self.scan()
        if action == 'scan':
            return {'ok': True, 'devices': [self.metadata(info) for info in records]}
        target = request.get('deviceId')
        if target == self.model['id'] and action == 'status':
            selected = records[0] if len(records) == 1 else None
        elif isinstance(target, str) and re.fullmatch(r'maono-352f-010c-[a-f0-9]{20}', target):
            selected = next((info for info in records if device_id(info) == target), None)
        else:
            raise ValueError('请选择实际连接的 PD100X')
        if selected is None:
            if action == 'execute':
                raise OSError('此 PD100X 已断开，请重新检测')
            return {'ok': True, 'connected': False, 'interfaceConfirmed': False, 'ambiguous': len(records) > 1, 'devices': [self.metadata(info) for info in records], 'capabilities': {}, 'values': {}, 'errors': {}}
        handle = self.hid.device()
        try:
            handle.open_path(selected['path'])
            if action == 'execute':
                command = request.get('command', '')
                key = command[:-4] if command.endswith('.set') else None
                field = self.protocol.FIELD_DEFINITIONS.get(key)
                if not field or not field.get('writable'):
                    raise ValueError('PD100X 尚未开放此设置')
                current = self.read(handle, field['address'])
                encoded = self.protocol.encode_field(key, request.get('value'), current)
                packet = self.protocol.write_packet(field['address'], encoded)
                if handle.write(packet) != len(packet):
                    raise OSError('PD100X 设置未完整发送')
                actual = self.read(handle, field['address'])
                if actual != encoded:
                    raise OSError('PD100X 读回设置与所选值不一致，请重新检测')
            return self.snapshot(handle, selected)
        finally:
            handle.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--payload', required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.payload) / 'g309-deps'))
    import hid
    return Backend(hid).run(json.load(sys.stdin))


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=True))
