"""Small codec regression using read-only capture from the actual 352F:010C."""
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('maono_protocol',pathlib.Path(__file__).resolve().parents[1]/'core'/'maono_protocol.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class ProtocolTests(unittest.TestCase):
    def test_exact_read_query(self):
        self.assertEqual(p.read_packet(0x2023),bytes.fromhex('4bc4090000042320ecfe')+bytes(54))
    def test_real_gain_reply(self):
        r=p.parse_report(bytes.fromhex('4bc40b000004232060008afe')+bytes(52))
        self.assertEqual((r['kind'],r['address'],r['value']),(4,0x2023,96))
    def test_spontaneous_level_is_distinct(self):
        r=p.parse_report(bytes.fromhex('4bc40b0000033420e705eefd')+bytes(52))
        self.assertEqual((r['kind'],r['address']),(3,0x2034))
    def test_invalid_frames_rejected(self):
        good=bytearray.fromhex('4bc40b000004232060008afe');bad=good.copy();bad[8]^=1
        for raw in (good[:9],bad,bytes(64),bytes([1,2,3])):self.assertIsNone(p.parse_report(raw))
    def test_noise_scaling_and_native_range(self):
        self.assertEqual(p.decode_field('noiseLevel',1350),15)
        self.assertEqual(p.encode_field('noiseLevel',40),1600)
        with self.assertRaises(ValueError):p.encode_field('noiseLevel',41)
    def test_color_mode_preserves_other_bits(self):
        self.assertEqual(p.encode_field('lightingColor',3,0x10),0x13)
        self.assertEqual(p.encode_field('lightingMode',16,7),0x17)
        with self.assertRaises(ValueError):p.encode_field('lightingColor',3)
    def test_write_codec_only(self):
        data=p.write_packet(0x2023,50)
        self.assertEqual(len(data),64)
        self.assertEqual(data[:12].hex(),'4bc40b00000323203200b9fe')
        self.assertEqual(p.parse_report(data)['value'],50)
    def test_value_validation(self):
        for key,value in [('gain',101),('gain',float('nan')),('gain',True),('mute','false'),('lightingMode',32)]:
            with self.assertRaises(ValueError):p.encode_field(key,value,0)

if __name__=='__main__':unittest.main()
