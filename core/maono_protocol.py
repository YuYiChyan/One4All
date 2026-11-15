"""MAONO PD100X 352F:010C protocol, independently transcribed from its vendor DLL.

Evidence: Maono Link 4.8.3 PD100X.dll RVAs 1B2B0 (read), 1B360 (write),
15660 (gain/noise), 144A1 (ranges), 18A1D (brightness), 16DB8/19570 (light).
The original Qt byte array is 65 bytes; the actual MI03 HID output report is
64 bytes including ID 4B, confirmed with HidP and eight read-only queries.
These functions only encode/decode bytes. They never access a device.
"""
VID = VENDOR_ID = 0x352F
PID = PRODUCT_ID = 0x010C
INTERFACE = INTERFACE_NUMBER = 3
USAGE_PAGE, USAGE = 0x000C, 0x0001
REPORT_ID, REPORT_LENGTH = 0x4B, 64
PROTOCOL_VERSION = "1.0.0"
DEVICE = {"vendorId": VID, "productId": PID, "interfaceNumber": INTERFACE,
          "usagePage": USAGE_PAGE, "usage": USAGE, "name": "PD100X"}

# No EQ, compressor or the incompletely decoded 2039 linkage flags are exposed.
FIELD_DEFINITIONS = {
    "gain": {"address": 0x2023, "label": "麦克风增益", "type": "number", "min": 0, "max": 100, "step": 1, "unit": "%"},
    "mute": {"address": 0x2022, "label": "麦克风静音", "type": "boolean"},
    "noise": {"address": 0x203A, "label": "降噪", "type": "boolean"},
    "noiseLevel": {"address": 0x203B, "label": "降噪强度", "type": "number", "min": 0, "max": 40, "step": 1, "unit": "", "rawScale": 10, "rawOffset": 1200},
    "lightingEnabled": {"address": 0x2036, "label": "灯光", "type": "boolean"},
    "lightingBrightness": {"address": 0x2037, "label": "灯光亮度", "type": "number", "min": 0, "max": 100, "step": 1, "unit": "%"},
    "lightingMode": {"address": 0x2038, "label": "灯效", "type": "select", "mask": 0xF0,
                     "options": [{"value": 0, "label": "常亮"}, {"value": 16, "label": "呼吸"}]},
    "lightingColor": {"address": 0x2038, "label": "灯光颜色", "type": "select", "mask": 0x0F,
                      "options": [{"value": i, "label": label, "color": color} for i, (label, color) in enumerate([
                          ("彩虹", "linear-gradient(90deg,#f44336,#ffc107,#4caf50,#2196f3,#9c27b0)"),
                          ("红色", "#ff0000"), ("橙色", "#ff8800"), ("黄色", "#ffff00"),
                          ("绿色", "#00ff00"), ("蓝色", "#0000ff"), ("浅蓝", "#00ccff"),
                          ("紫色", "#aa00ff"), ("白色", "#ffffff")])]},
}
for _field in FIELD_DEFINITIONS.values():
    _field.update(writable=True, readVerified=True, writeVerified=False,
                  evidence="Maono Link 4.8.3 PD100X.dll; 352F:010C kind04 capture")


def _word(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 0xFFFF:
        raise ValueError(name + " must be an unsigned 16-bit integer")
    return value


def _packet(kind, address, value=None):
    address = _word(address, "address")
    packet = bytearray(REPORT_LENGTH)
    packet[:6] = bytes((REPORT_ID, 0xC4, 9 if value is None else 11, 0, 0, kind))
    packet[6:8] = address.to_bytes(2, "little")
    checksum_at = 8
    if value is not None:
        packet[8:10] = _word(value, "value").to_bytes(2, "little")
        checksum_at = 10
    packet[checksum_at:checksum_at + 2] = (-sum(packet[1:checksum_at]) & 0xFFFF).to_bytes(2, "little")
    return bytes(packet)


def read_packet(address):
    """Kind04 is a query; it does not change settings or enable a new mode."""
    return _packet(4, address)


def write_packet(address, value):
    """Build kind03 bytes only. Callers must read back the requested register."""
    return _packet(3, address, value)


def parse_report(raw):
    """Return None for consumer keys, truncated frames, or invalid checksums.

    Spontaneous kind03/2034 level reports are valid but are NOT query replies.
    A transaction must match BOTH kind04 and the requested register address.
    """
    data = bytes(raw)
    if len(data) < 12 or data[:2] != bytes((REPORT_ID, 0xC4)):
        return None
    end = int.from_bytes(data[2:4], "little") + 1
    if end < 12 or end > len(data) or data[5] not in (3, 4):
        return None
    checksum_at = end - 2
    if (checksum_at - 6) % 4 or int.from_bytes(data[checksum_at:end], "little") != (-sum(data[1:checksum_at]) & 0xFFFF):
        return None
    pairs = [{"address": int.from_bytes(data[i:i + 2], "little"),
              "value": int.from_bytes(data[i + 2:i + 4], "little")}
             for i in range(6, checksum_at, 4)]
    return {"kind": data[5], "address": pairs[0]["address"], "value": pairs[0]["value"],
            "values": pairs, "reportId": REPORT_ID, "length": len(data), "raw": data.hex()}


def decode_field(key, raw):
    definition = FIELD_DEFINITIONS[key]
    raw = _word(raw, "raw")
    if definition["type"] == "boolean":
        if raw not in (0, 1):
            raise ValueError(key + " returned an unknown boolean value")
        return bool(raw)
    if "mask" in definition:
        return raw & definition["mask"]
    return (raw - definition.get("rawOffset", 0)) / definition.get("rawScale", 1)


def encode_field(key, value, current_raw=None):
    definition = FIELD_DEFINITIONS[key]
    if definition["type"] == "boolean":
        if not isinstance(value, bool) and (not isinstance(value, int) or value not in (0, 1)):
            raise ValueError(key + " requires true or false")
        return int(value)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not float(value).is_integer():
        raise ValueError(key + " requires a whole number")
    value = int(value)
    if definition["type"] == "select":
        if value not in [option["value"] for option in definition["options"]]:
            raise ValueError(key + " option is not supported by PD100X")
        current_raw = _word(current_raw, "current_raw")
        return (current_raw & (0xFFFF ^ definition["mask"])) | value
    if not definition["min"] <= value <= definition["max"]:
        raise ValueError(key + " is outside the native control range")
    return value * definition.get("rawScale", 1) + definition.get("rawOffset", 0)
