# Zebra MicroPython VS Code Extension

A PlatformIO-style workflow for ZebraBot MicroPython projects.

## Commands

Open the Zebra activity bar panel or use the command palette:

- `Zebra: Initialize Project`
- `Zebra: Project Status`
- `Zebra: Check Python Syntax`
- `Zebra: Setup Toolchain`
- `Zebra: Setup Native C Firmware Toolchain`
- `Zebra: Detect ESP32 Serial Port`
- `Zebra: Deploy Project to ESP32`
- `Zebra: Flash MicroPython Firmware`
- `Zebra: Reset Device`
- `Zebra: Open Serial Monitor`
- `Zebra: Open USB UART Driver Help`
- `Zebra: Open Robot Driver Docs`
- `Zebra: Open Robot Simulator`

## Robot simulator

`Zebra: Open Robot Simulator` opens a 2D Ackermann robot simulator. Use it to place a robot, add rectangle or circle obstacles, drag distance/line/IMU sensors onto the robot, assign sensor ports, and run a simulated version of common user-code calls such as `drive.drive(...)`, `drive.stop()`, and `sleep_ms(...)`.

Simulator layouts are saved to `.zebra/simulator.json` in the workspace.

## PlatformIO-like workflow

1. Open a project folder in VS Code.
2. Run `Zebra: Initialize Project`.
   - This now also runs the Zebra toolchain setup.
   - It creates/checks the extension venv and installs `pyserial`, `mpremote`, `esptool`, and `bleak`.
   - For native C driver/user_main builds, also run `Zebra: Setup Native C Firmware Toolchain`.
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

For Zebra native C firmware builds, choose `Select Zebra native firmware folder` and select a folder containing:

- `bootloader.bin`
- `partition-table.bin`
- `micropython.bin`

The extension flashes those at `0x1000`, `0x8000`, and `0x10000` with the ESP32 flash settings used by the native Zebra build.

## Toolchain

The extension creates an isolated Python virtual environment in VS Code global extension storage and installs:

- `pyserial`
- `mpremote`
- `esptool`
- `bleak`

It also verifies Git, which is required for robot driver cache updates.
On Windows, `Zebra: Setup Toolchain` installs Git with `winget` when possible.
On macOS, it uses Homebrew when available. On Linux, it opens a terminal with
the appropriate package-manager install command.

If Python 3 is not already available, `Zebra: Setup Toolchain` and `Zebra: Initialize Project` attempt a platform-specific install first:

- Windows: installs Python 3.12 with `winget` when available.
- macOS: installs Python with Homebrew when available.
- Linux: opens a terminal with the appropriate package-manager command for `apt`, `dnf`, or `pacman`.

Set `zebra.pythonPath` only when you want to force a specific Python executable. Leave it empty for auto-detect and auto-install behavior.

## Native C firmware dependencies

`Zebra: Setup Native C Firmware Toolchain` prepares the dependencies used to build the Zebra C driver modules and native `user_main.c` firmware.

On Windows, it bootstraps WSL Debian when needed and creates a default Linux flasher account automatically. The account defaults to username `flasher` and password `flasher`; override these with `zebra.wslFlasherUsername` and `zebra.wslFlasherPassword` before setup if you need different credentials. If Windows requires a reboot during WSL installation, reboot and run the command again. Once Debian is available, it installs Linux build packages, clones MicroPython `v1.28.0`, clones ESP-IDF `v5.5.1`, installs ESP-IDF tools for `esp32`, builds `mpy-cross`, and prepares ESP32 submodules.

On macOS, it uses Homebrew to install the native build packages, then clones and prepares the same MicroPython and ESP-IDF toolchains. On Linux, it supports `apt`, `dnf`, and `pacman`; other distributions get a clear package list to install manually. The build root defaults to `~/zbot-fw` and can be changed with `zebra.nativeBuildRoot`.

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

## Wi-Fi user program deploy

Open `Zebra: Project Setup`, use the Upload Method card, and choose
`Use Wi-Fi Upload` to set `zebra.deployTransport` to `wifi`. This uploads only
the staged `user_main.py` to the Zebra Wi-Fi code server from the C-modules
driver runtime. Use serial deploy first after flashing so `main.py`, `boot.py`,
and `robot/wifi_code.py` are installed on the board.

By default the extension targets the board access-point URL:

```json
{
  "zebra.deployTransport": "wifi",
  "zebra.wifiUrl": "http://192.168.4.1:8080"
}
```

If your robot joins another network, set `zebra.wifiUrl` to the STA URL shown
by the board, for example `http://192.168.1.44:8080`. If the runtime is
configured with a token, set `zebra.wifiToken` too. Wi-Fi deploy posts
`/user_main.py`, requests a reset, and uses `zebra.wifiTimeout` for the HTTP
timeout.

## BLE user program deploy

Open `Zebra: Project Setup`, use the Upload Method card, and choose
`Use Bluetooth Upload` to set `zebra.deployTransport` to `ble`. This uploads
only the staged `user_main.py` over ZebraBot BLE UART. The board must already be
running a Zebra runtime with BLE teleop support. The BLE deploy path uses the
extension toolchain's `bleak` package, sends the robot into quiet mode, writes
`/user_main.py`, and requests a reset.

Before uploading, the extension scans nearby BLE devices and shows a picker so
you can choose the correct board. Devices advertising `ZebraBot` or the Zebra
UART service are listed as likely Zebra targets, but other nearby devices are
shown too.

Useful settings:

- `zebra.bleName`: defaults to `ZebraBot`
- `zebra.bleChunkSize`: defaults to `12` for conservative BLE writes

Use `serial` deploy when installing or refreshing the full runtime and `robot/`
driver package. Use `wifi` or `ble` for the faster edit/program loop once the
runtime is already on the board.


## Initialize Project includes Toolchain Setup

`Zebra: Initialize Project` now behaves like a PlatformIO-style first-run setup:

1. Creates or checks the extension-managed Python virtual environment.
2. Installs or updates `pyserial`, `mpremote`, `esptool`, and `bleak`.
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
- `Zebra: Open Robot Driver Docs`

Default driver repo:

```txt
https://github.com/JoshAyersSBT/ZbotDriver.git
```

The extension reads driver documentation from the cached driver repo `docs/`
folder. Run `Zebra: Refresh Robot Driver Cache` to pull updated docs from the
configured driver repo. Documentation files are shown in a read-only VS Code tab
and are not included in staged flash or deploy files.
