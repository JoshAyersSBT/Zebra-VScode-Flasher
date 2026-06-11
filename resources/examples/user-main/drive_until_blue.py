# Zebra Example: Drive Until Blue
# Drives forward and stops when the calibrated color sensor sees blue.

import uasyncio as asyncio
from robot.ackermann import AckermannDrive


COLOR_SENSOR_PORT = 1
TARGET_COLORS = ("sky", "sky_blue", "blue", "navy", "aqua", "cyan", "indigo")
DRIVE_POWER = 35
MIN_CONFIDENCE = 45


async def main(zbot):
    car = AckermannDrive(
        zbot,
        drive_motor_port=1,
        steering_port=4,
        center_angle=90,
    )

    zbot.display("Drive until", "blue family", "Port {}".format(COLOR_SENSOR_PORT))
    car.steer_center()
    car.forward(DRIVE_POWER)

    try:
        while True:
            rgb = zbot.rgb(COLOR_SENSOR_PORT)
            match = zbot.color_match(COLOR_SENSOR_PORT)
            color = None
            confidence = 0

            if match is not None:
                color = match.get("color")
                confidence = int(match.get("confidence", 0))

            if color is None:
                match_line = "No dictionary match"
            else:
                match_line = "{} {}%".format(color, confidence)

            if rgb is None:
                print("sees: no RGB reading")
            else:
                print(
                    "sees: r={} g={} b={} clear={} closest_dictionary_match={}".format(
                        rgb["r"],
                        rgb["g"],
                        rgb["b"],
                        rgb.get("clear", 0),
                        match_line,
                    )
                )

            if color in TARGET_COLORS and confidence >= MIN_CONFIDENCE:
                car.stop()
                print("action: stop, saw blue-family color {}".format(color))
                zbot.display("Stopped", "Saw {}".format(color), "{}%".format(confidence))
                break

            zbot.display("Driving", "Closest:", match_line)
            print("action: driving")
            await asyncio.sleep_ms(100)

    finally:
        car.stop()
