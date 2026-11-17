"""Switch the Windows capture default while One4All voice routing is active."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, sys.argv[1])
import comtypes
from pycaw.pycaw import AudioUtilities
from pycaw.api.mmdeviceapi import IMMEndpoint
from pycaw.constants import DEVICE_STATE, ERole

ROLES = (ERole.eConsole, ERole.eMultimedia, ERole.eCommunications)
state_file = Path(sys.argv[2]) / 'voice-default-input.json'
command = sys.argv[3]

def current(enumerator, role):
    try:
        return enumerator.GetDefaultAudioEndpoint(1, role.value).GetId()
    except (OSError, comtypes.COMError):
        return None

def main():
    enumerator = AudioUtilities.GetDeviceEnumerator()
    if command == 'activate':
        matches = [d for d in AudioUtilities.GetAllDevices(device_state=DEVICE_STATE.ACTIVE.value)
                   if 'cable output' in (d.FriendlyName or '').lower()
                   and 'vb-audio' in (d.FriendlyName or '').lower()
                   and enumerator.GetDevice(d.id).QueryInterface(IMMEndpoint).GetDataFlow() == 1]
        if len(matches) != 1:
            raise RuntimeError('未找到唯一的 VB-CABLE 虚拟麦克风')
        cable = matches[0].id
        actual = {role.name: current(enumerator, role) for role in ROLES}
        previous = dict(actual)
        if state_file.exists():
            try:
                saved = json.loads(state_file.read_text(encoding='utf-8'))
                for role in ROLES:
                    if previous[role.name] == cable and saved.get('previous', {}).get(role.name):
                        previous[role.name] = saved['previous'][role.name]
            except (ValueError, OSError):
                pass
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({'cable': cable, 'previous': previous}), encoding='utf-8')
        try:
            missing = [role for role in ROLES if actual[role.name] != cable]
            if missing:
                AudioUtilities.SetDefaultDevice(cable, missing)
        except Exception:
            restore(enumerator)
            raise
        return {'active': True, 'name': matches[0].FriendlyName}
    if command == 'restore':
        return restore(enumerator)
    raise ValueError('未知音频操作')

def restore(enumerator):
    if not state_file.exists():
        return {'restored': False}
    saved = json.loads(state_file.read_text(encoding='utf-8'))
    failed = []
    for role in ROLES:
        old = saved.get('previous', {}).get(role.name)
        if old and old != saved['cable'] and current(enumerator, role) == saved['cable']:
            try:
                AudioUtilities.SetDefaultDevice(old, [role])
            except (OSError, comtypes.COMError):
                failed.append(role.name)
    if failed:
        raise RuntimeError('未能恢复默认麦克风：' + ', '.join(failed))
    state_file.unlink(missing_ok=True)
    return {'restored': True}

try:
    print(json.dumps({'ok': True, **main()}, ensure_ascii=True))
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=True))
