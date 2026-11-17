import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from enum import Enum
from pathlib import Path

class Role(Enum):
    eConsole = 0
    eMultimedia = 1
    eCommunications = 2

class Endpoint:
    def __init__(self, ident): self.ident = ident
    def GetId(self): return self.ident
    def QueryInterface(self, unused): return self
    def GetDataFlow(self): return 1

class Enumerator:
    def __init__(self): self.defaults = {role.value: 'physical' for role in Role}
    def GetDefaultAudioEndpoint(self, flow, role): return Endpoint(self.defaults[role])
    def GetDevice(self, ident): return Endpoint(ident)

class VoiceDefaultTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.enumerator = Enumerator()
        enum = self.enumerator
        self.calls = []
        calls = self.calls
        class Utils:
            @staticmethod
            def GetDeviceEnumerator(): return enum
            @staticmethod
            def GetAllDevices(device_state): return [types.SimpleNamespace(id='cable', FriendlyName='CABLE Output (VB-Audio Virtual Cable)')]
            @staticmethod
            def SetDefaultDevice(ident, roles):
                calls.append((ident, [r.value for r in roles]))
                for role in roles: enum.defaults[role.value] = ident
        modules = {
            'comtypes': types.SimpleNamespace(COMError=type('COMError',(Exception,),{})),
            'pycaw': types.ModuleType('pycaw'),
            'pycaw.pycaw': types.SimpleNamespace(AudioUtilities=Utils),
            'pycaw.api': types.ModuleType('pycaw.api'),
            'pycaw.api.mmdeviceapi': types.SimpleNamespace(IMMEndpoint=object),
            'pycaw.constants': types.SimpleNamespace(DEVICE_STATE=types.SimpleNamespace(ACTIVE=types.SimpleNamespace(value=1)), ERole=Role),
        }
        self.saved_modules = {k:sys.modules.get(k) for k in modules}
        sys.modules.update(modules)
        self.addCleanup(self.restore_modules)
        oldargv = sys.argv
        sys.argv = ['test', self.temp.name, self.temp.name, 'activate']
        self.addCleanup(setattr, sys, 'argv', oldargv)
        spec = importlib.util.spec_from_file_location('voice_default_test_module',Path(__file__).resolve().parents[1]/'core'/'voice-default-input.py')
        self.module = importlib.util.module_from_spec(spec)
        with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(self.module)
    def restore_modules(self):
        for key, value in self.saved_modules.items():
            if value is None: sys.modules.pop(key, None)
            else: sys.modules[key] = value
    def test_activate_reconnect_and_restore_user_changes(self):
        self.assertTrue(all(v == 'cable' for v in self.enumerator.defaults.values()))
        self.module.main()  # reconnect does not forget original defaults
        self.assertEqual(len(self.calls), 1)
        self.enumerator.defaults[2] = 'user-choice'
        self.module.restore(self.enumerator)
        self.assertEqual(self.enumerator.defaults, {0:'physical', 1:'physical', 2:'user-choice'})
        self.assertFalse(self.module.state_file.exists())
    def test_already_default_preserves_existing_choice(self):
        self.module.restore(self.enumerator)
        self.enumerator.defaults = {r.value:'cable' for r in Role}
        self.calls.clear()
        self.module.main()
        self.assertFalse(self.calls)
        self.module.restore(self.enumerator)
        self.assertEqual(self.enumerator.defaults, {0:'cable',1:'cable',2:'cable'})

if __name__ == '__main__': unittest.main()
