# Sensor Usage

ZebraBot exposes sensors through the global `zbot` object. Plug a sensor into one
of the six sensor ports, then read it by port number from student code.

```python
distance = zbot.tof(1)
color = zbot.color(2)
```

## Sensor Ports

Sensor ports are numbered `1` through `6`. The sensor hub scans enabled ports and
auto-detects supported I2C sensors.

The current supported sensor types are:

- VL53L0X / VL53L1X time-of-flight distance sensors
- TCS3472 color sensors

## Distance Sensors

Use `zbot.tof(port)` for a quick distance reading in millimeters.

```python
distance_mm = zbot.tof(1)

if distance_mm is not None and distance_mm < 200:
    zbot.stop()
```

You can also use the sensor wrapper directly:

```python
front = zbot.sensor(1)
distance_mm = front.read()
```

`tof()` and `sensor(port).read()` return:

- an integer distance in millimeters when a distance sensor is available
- `None` when no distance reading is available yet

## Color Sensors

Use `zbot.color(port)` to read the nearest color name from the 32-color range
palette. This avoids needing to match an exact raw RGB value.

```python
color = zbot.color(2)

if color == "red":
    zbot.stop()
```

The direct wrapper has the same helper:

```python
floor = zbot.sensor(2)

if floor.is_color("blue"):
    zbot.notify("Blue marker")
```

Color matching is case-insensitive when using `is_color()`.

## Raw RGB Readings

If you need the raw color sensor values, use `zbot.rgb(port)` or
`zbot.sensor(port).rgb()`.

```python
rgb = zbot.rgb(2)

if rgb is not None:
    red = rgb["r"]
    green = rgb["g"]
    blue = rgb["b"]
    clear = rgb["clear"]
```

Raw RGB readings are useful for calibration, debugging, or checking how lighting
affects the sensor.

## Color Match Details

Use `color_match()` when you want the matched color plus debugging details.

```python
match = zbot.sensor(2).color_match()

if match is not None:
    zbot.notify("{} {}".format(match["color"], match["confidence"]))
```

`color_match()` returns a dictionary like:

```python
{
    "color": "red",
    "confidence": 92,
    "rgb": {"r": 210, "g": 35, "b": 28, "clear": 310},
    "normalized": {"r": 196, "g": 32, "b": 26},
    "range": {
        "center": (255, 0, 0),
        "min": (165, 0, 0),
        "max": (255, 90, 90),
        "tolerance": 90,
    },
}
```

`confidence` is a rough score from `0` to `100`. It is meant for quick robot
logic and debugging, not precise color science.

## 32-Color Palette

The built-in palette currently includes:

```text
black, white, silver, gray,
red, maroon, orange, coral, salmon, brown, tan,
yellow, gold, olive, lime, chartreuse, green, spring_green,
cyan, turquoise, teal, azure, sky_blue, blue, navy,
indigo, purple, violet, lavender, magenta, pink, rose
```

Use these exact names with `zbot.color(port)` comparisons or
`zbot.sensor(port).is_color(name)`.

## Full Sensor Snapshot

For advanced code, use `zbot.sensors()` to get the full sensor snapshot.

```python
sensors = zbot.sensors()
color_item = sensors.get("color_port_2")
tof_item = sensors.get("tof_port_1")
```

Color snapshots keep backward-compatible raw RGB values and add matched color
metadata:

```python
{
    "value": {
        "r": 210,
        "g": 35,
        "b": 28,
        "clear": 310,
        "color": "red",
        "confidence": 92,
        "normalized": {"r": 196, "g": 32, "b": 26},
    },
    "meta": {
        "kind": "TCS3472",
        "port": 2,
        "palette": "COLOR_PALETTE_32",
        "range": {"center": (255, 0, 0), "min": (165, 0, 0), "max": (255, 90, 90), "tolerance": 90},
    },
}
```

Distance snapshots look like:

```python
{
    "value": 245,
    "meta": {"kind": "VL53L0X", "port": 1, "unit": "mm"},
}
```

## Notes

- Sensor readings may be `None` briefly at startup while the hub scans ports.
- Color readings depend on lighting, distance from the surface, and the material
  being measured.
- For best color results, keep the sensor close to the target and avoid shadows
  or bright reflections.
