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

## Flashing firmware

`Zebra: Flash MicroPython Firmware` can auto-collect the default ESP32 MicroPython firmware:

```txt
https://micropython.org/resources/firmware/ESP32_GENERIC-20260406-v1.28.0.bin
```

The command caches the downloaded `.bin` in the extension's global storage and reuses it on future flashes. You can also choose `Select ESP32 firmware .bin` to flash a local ESP32 MicroPython binary instead.

## Toolchain

The extension creates an isolated Python virtual environment in VS Code global extension storage and installs:

- `pyserial`
- `mpremote`
- `esptool`

If Python 3 is not already available, `Zebra: Setup Toolchain` and `Zebra: Initialize Project` attempt a platform-specific install first:

- Windows: installs Python 3.12 with `winget` when available.
- macOS: installs Python with Homebrew when available.
- Linux: opens a terminal with the appropriate package-manager command for `apt`, `dnf`, or `pacman`.

Set `zebra.pythonPath` only when you want to force a specific Python executable. Leave it empty for auto-detect and auto-install behavior.

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
