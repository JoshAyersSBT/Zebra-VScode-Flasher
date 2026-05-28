import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path

UART_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
UART_RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
UART_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"


class AckWaiter:
    def __init__(self, verbose=False):
        self.lines = []
        self._waiters = []
        self.verbose = verbose

    def feed(self, _sender, data):
        for raw in data.decode(errors="replace").splitlines():
            line = raw.strip()
            if not line:
                continue
            if self.verbose or line.startswith(("PUT_", "PONG", "OK ", "ERR")):
                print("<", line)
            self.lines.append(line)
            for waiter in list(self._waiters):
                waiter(line)

    async def wait_for(self, predicate, timeout=8):
        for line in self.lines:
            if predicate(line):
                return line

        loop = asyncio.get_running_loop()
        fut = loop.create_future()

        def check(line):
            if not fut.done() and predicate(line):
                fut.set_result(line)

        self._waiters.append(check)
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            try:
                self._waiters.remove(check)
            except ValueError:
                pass

    async def wait_optional(self, predicate, timeout=1.5):
        try:
            return await self.wait_for(predicate, timeout)
        except asyncio.TimeoutError:
            return None


def b64(data):
    return base64.b64encode(data).decode("ascii")


async def send_line(client, line, delay_s):
    await client.write_gatt_char(UART_RX_UUID, (line + "\n").encode("ascii"), response=True)
    if delay_s:
        await asyncio.sleep(delay_s)


async def find_device(name, address, timeout):
    from bleak import BleakScanner

    if address:
        print("Scanning for BLE address {}...".format(address))
    else:
        print("Scanning for {}...".format(name))
    seen = {}

    def remember(device, adv):
        label = device.name or adv.local_name or ""
        uuids = [uuid.lower() for uuid in (adv.service_uuids or [])]
        if label or uuids:
            seen[device.address] = (label, uuids)
        if address and device.address.lower() == address.lower():
            return True
        return (
            label == name
            or name in label
            or UART_SERVICE_UUID.lower() in uuids
        )

    device = await BleakScanner.find_device_by_filter(
        remember,
        timeout=timeout,
    )
    if device is None:
        if seen:
            print("Nearby BLE devices:")
            for seen_address, (label, uuids) in sorted(seen.items()):
                services = ", ".join(uuids[:3])
                print("  - {} {} {}".format(seen_address, label or "(unnamed)", services))
        target = address or name
        raise RuntimeError("BLE device {!r} not found. Make sure the board is powered, advertising as ZebraBot, and not already connected.".format(target))
    return device


async def scan_devices(name, timeout):
    from bleak import BleakScanner

    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    devices = []

    if isinstance(found, dict):
        values = found.values()
    else:
        values = [(device, None) for device in found]

    for entry in values:
        if isinstance(entry, tuple):
            device, adv = entry
        else:
            device, adv = entry, None

        local_name = getattr(adv, "local_name", "") if adv is not None else ""
        label = device.name or local_name or ""
        service_uuids = getattr(adv, "service_uuids", None) if adv is not None else None
        uuids = [uuid.lower() for uuid in (service_uuids or [])]
        is_zebra = label == name or name in label or UART_SERVICE_UUID.lower() in uuids
        devices.append(
            {
                "address": device.address,
                "name": device.name or "",
                "localName": local_name or "",
                "services": uuids,
                "isZebraCandidate": is_zebra,
            }
        )

    devices.sort(key=lambda item: (not item["isZebraCandidate"], (item["name"] or item["localName"] or "").lower(), item["address"]))
    return devices


async def upload(args):
    from bleak import BleakClient

    local_path = Path(args.local).resolve()
    data = local_path.read_bytes()

    device = await find_device(args.name, args.address, args.scan_timeout)
    print("Connecting to {} ({})...".format(device.name or args.name, device.address))

    ack = AckWaiter(verbose=args.verbose)
    async with BleakClient(device) as client:
        if not client.is_connected:
            raise RuntimeError("BLE connect failed")

        await client.start_notify(UART_TX_UUID, ack.feed)

        await send_line(client, "QUIET", args.delay)
        quiet_ack = await ack.wait_optional(lambda line: line == "OK QUIET", timeout=args.quiet_timeout)
        if quiet_ack is None:
            print("Quiet mode was not acknowledged; continuing with upload.")

        await send_line(client, "PING", args.delay)
        await ack.wait_for(lambda line: line == "PONG", timeout=args.timeout)

        await send_line(client, "PU", args.delay)
        await ack.wait_for(lambda line: line == "PUT_OK BEGIN", timeout=args.timeout)

        total = len(data)
        sent = 0
        for offset in range(0, total, args.chunk_size):
            chunk = data[offset:offset + args.chunk_size]
            await send_line(client, "PC " + b64(chunk), args.delay)
            sent += len(chunk)
            await ack.wait_for(
                lambda line, size=len(chunk): line == "PUT_OK CHUNK {}".format(size),
                timeout=args.timeout,
            )
            print("> uploaded {}/{} bytes".format(sent, total))

        await send_line(client, "PE", args.delay)
        await ack.wait_for(lambda line: line == "PUT_OK END", timeout=args.timeout)
        print("Uploaded {} to /user_main.py".format(local_path))

        if args.reset:
            try:
                await send_line(client, "RESET", args.delay)
                print("Reset requested")
            except Exception as exc:
                print("Upload succeeded, but reset request was not confirmed: {}".format(exc))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Upload user_main.py to ZebraBot over BLE UART.")
    parser.add_argument("local", nargs="?", help="Local user_main.py file to upload")
    parser.add_argument("--name", default="ZebraBot", help="BLE advertised name")
    parser.add_argument("--address", default="", help="Specific BLE address selected from a scan")
    parser.add_argument("--list", action="store_true", help="List nearby BLE devices instead of uploading")
    parser.add_argument("--json", action="store_true", help="Print BLE device list as JSON with --list")
    parser.add_argument("--chunk-size", type=int, default=12, help="Raw bytes per BLE chunk")
    parser.add_argument("--delay", type=float, default=0.02, help="Delay after each write")
    parser.add_argument("--timeout", type=float, default=8.0, help="Ack timeout in seconds")
    parser.add_argument("--quiet-timeout", type=float, default=1.5, help="Optional quiet-mode ack timeout in seconds")
    parser.add_argument("--scan-timeout", type=float, default=12.0, help="Scan timeout in seconds")
    parser.add_argument("--reset", action="store_true", help="Reset the board after upload")
    parser.add_argument("--verbose", action="store_true", help="Print all BLE notifications")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.list:
        devices = asyncio.run(scan_devices(args.name, args.scan_timeout))
        if args.json:
            print(json.dumps(devices))
        else:
            for device in devices:
                label = device["name"] or device["localName"] or "(unnamed)"
                services = ", ".join(device["services"][:3])
                marker = "*" if device["isZebraCandidate"] else " "
                print("{} {} {} {}".format(marker, device["address"], label, services))
        return

    if not args.local:
        raise SystemExit("local file is required unless --list is used")

    if args.chunk_size < 1:
        raise SystemExit("--chunk-size must be positive")
    asyncio.run(upload(args))


if __name__ == "__main__":
    main()
