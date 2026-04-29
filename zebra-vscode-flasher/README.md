# Zebra MicroPython Flasher VS Code Extension

Starter VS Code extension for ZebraBot MicroPython firmware flashing and project deploy.

## Commands

- `Zebra: Setup Toolchain`
- `Zebra: Detect ESP32 Serial Port`
- `Zebra: Deploy Project to ESP32`
- `Zebra: Flash MicroPython Firmware`
- `Zebra: Open USB UART Driver Help`

## Toolchain Installed

The setup command creates an extension-managed Python virtual environment and installs:

- `pyserial`
- `mpremote`
- `esptool`

## USB UART Drivers

The extension opens official driver pages for:

- CP210x / CP2102 USB UART
- CH340 / CH341 USB UART

Driver installation is intentionally not silent because OS-level drivers require user/admin trust.

## Runtime Files

Replace:

```txt
resources/runtime/main.py
resources/runtime/robot/
```

with your real ZebraBot runtime `main.py` and `robot/` driver stack.

The deploy command stages:

```txt
main.py       <- runtime main.py
robot/        <- runtime robot package
user_main.py  <- project main.py or user_main.py
```

Then uploads the staged tree with `mpremote`.

## Develop

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host.
