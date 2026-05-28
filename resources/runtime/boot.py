# This file is executed on every boot before main.py.

try:
    import bluetooth
    import builtins
    import gc
    import time

    _ble = bluetooth.BLE()
    for _attempt in range(1, 4):
        try:
            try:
                _ble.active(False)
            except Exception:
                pass
            gc.collect()
            time.sleep_ms(250 * _attempt)
            _ble.active(True)
            builtins._zbot_preactive_ble = _ble
            print("[INFO] BOOT: BLE controller preactivated in boot.py")
            break
        except Exception as _err:
            print("[ERR] BLE_BOOT_PREACTIVE_{} {}".format(_attempt, repr(_err)))
            time.sleep_ms(400 * _attempt)
except Exception as _err:
    print("[ERR] BLE_BOOT_PREIMPORT {}".format(repr(_err)))
