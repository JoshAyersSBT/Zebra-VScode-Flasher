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
   - This now also runs the Zebra toolchain setup.
   - It creates/checks the extension venv and installs `pyserial`, `mpremote`, and `esptool`.
3. Connect the ESP32.
4. Run `Zebra: Detect ESP32 Serial Port`.
5. Run `Zebra: Deploy Project to ESP32`.
6. Open the serial monitor.

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


## Initialize Project includes Toolchain Setup

`Zebra: Initialize Project` now behaves like a PlatformIO-style first-run setup:

1. Creates or checks the extension-managed Python virtual environment.
2. Installs or updates `pyserial`, `mpremote`, and `esptool`.
3. Creates `zebra.json`.
4. Creates a starter `main.py` when needed.
5. Creates `.vscode/settings.json` with Zebra defaults.

You can still run `Zebra: Setup Toolchain` separately later if you need to repair or update the Python tooling.

## Robot driver initialization

`Zebra: Initialize Project` now also initializes the `robot/` driver directory.

Driver source priority:

1. Existing project `robot/` folder, if it already contains `.py` or `.mpy` drivers.
2. `zebra.driverCachePath`, if configured and it contains a usable `robot/` folder.
3. Extension global cache at VS Code global storage under `zbot-driver-cache/robot`.
4. `zebra.driverRepoUrl`, cloned with `git` into the global cache.
5. Bundled fallback `resources/runtime/robot`.

Useful commands:

- `Zebra: Refresh Robot Driver Cache`
- `Zebra: Install Robot Drivers into Project`

Default driver repo:

```txt
https://github.com/JoshAyersSBT/Zebra_SOL_Flasher.git
```
