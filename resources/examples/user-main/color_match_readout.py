# Zebra Example: Color Match Readout
# Shows live RGB readings and the closest calibrated dictionary color.

import uasyncio as asyncio


COLOR_SENSOR_PORT = 1


async def main(zbot):
    zbot.display("Color sensor", "Port {}".format(COLOR_SENSOR_PORT))

    while True:
        rgb = zbot.rgb(COLOR_SENSOR_PORT)

        if rgb is None:
            zbot.display(
                "Color P{}".format(COLOR_SENSOR_PORT),
                "No RGB reading",
                "Check sensor",
            )
            print("No RGB reading on color sensor port", COLOR_SENSOR_PORT)
            await asyncio.sleep_ms(100)
            continue

        match = zbot.color_match(COLOR_SENSOR_PORT)
        color = "No match"
        confidence = None

        if match is not None and match.get("color") is not None:
            color = str(match.get("color"))
            confidence = int(match.get("confidence", 0))

        rgb_line = "R{} G{} B{}".format(rgb["r"], rgb["g"], rgb["b"])
        if confidence is None:
            match_line = color
        else:
            match_line = "{} {}%".format(color, confidence)

        zbot.display(
            "Color P{}".format(COLOR_SENSOR_PORT),
            rgb_line,
            "Closest:",
            match_line,
        )
        print(
            "RGB r={} g={} b={} clear={} closest={} confidence={}".format(
                rgb["r"],
                rgb["g"],
                rgb["b"],
                rgb.get("clear", 0),
                color,
                confidence,
            )
        )

        await asyncio.sleep_ms(100)
