# Zebra MicroPython VS Code Extension

A PlatformIO-style workflow for ZebraBot MicroPython projects.

## Commands

Open the Zebra activity bar panel or use the command palette:

- `Zebra: Initialize Project`
- `Zebra: Project Status`
- `Zebra: Check Python Syntax`
- `Zebra: Setup Toolchain`
- `Zebra: Detect ESP32 Serial Port`
- `Zebra: Deploy Project to ESP32`
- `Zebra: Flash MicroPython Firmware`
- `Zebra: Reset Device`
- `Zebra: Open Serial Monitor`
- `Zebra: Open USB UART Driver Help`

## PlatformIO-like workflow

1. Open a project folder in VS Code.
2. Run `Zebra: Initialize Project`.
3. Run `Zebra: Setup Toolchain`.
4. Connect the ESP32.
5. Run `Zebra: Detect ESP32 Serial Port`.
6. Run `Zebra: Deploy Project to ESP32`.
7. Open the serial monitor.

## Toolchain

The extension creates an isolated Python virtual environment in VS Code global extension storage and installs:

- `pyserial`
- `mpremote`
- `esptool`

## USB UART drivers

If the ESP32 does not appear as a serial device, install the correct USB UART driver:

- CP210x / CP2102: Silicon Labs VCP driver
- CH340 / CH341: WCH CH341SER driver

Use `Zebra: Open USB UART Driver Help` to open the official driver pages.

## Project file

`Zebra: Initialize Project` creates `zebra.json`:

```json
{
  "name": "my-project",
  "board": "esp32",
  "port": "AUTO",
  "runtimePath": "",
  "uploadProtocol": "mpremote"
}
```

The deploy command stages the runtime `main.py` and `robot/` package, then uploads the workspace `main.py` as `user_main.py`, matching the Zebra teleop flasher workflow.
