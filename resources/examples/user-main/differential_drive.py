# Zebra Example: Differential Drive
# Drives forward, turns, then stops using motor ports 1 and 2.

import uasyncio as asyncio
from robot.differential import DifferentialDrive


async def main(zbot):
    drive = DifferentialDrive(zbot, left_port=1, right_port=2)

    zbot.display("Drive", "Forward")
    drive.forward(45)
    await asyncio.sleep_ms(1500)

    zbot.display("Drive", "Turn")
    drive.drive(35, 35)
    await asyncio.sleep_ms(900)

    drive.stop()
    zbot.display("Drive", "Stopped")

    while True:
        await asyncio.sleep_ms(1000)
