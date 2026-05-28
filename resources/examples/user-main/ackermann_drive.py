# Zebra Example: Ackermann Drive
# Runs one drive motor and one steering servo, then centers and stops.

import uasyncio as asyncio
from robot.ackermann import AckermannDrive


async def main(zbot):
    drive = AckermannDrive(
        zbot,
        drive_motor_port=1,
        steering_port=1,
        center_angle=90,
        min_angle=45,
        max_angle=135,
    )

    zbot.display("Ackermann", "Forward")
    drive.drive(40, 90)
    await asyncio.sleep_ms(1200)

    zbot.display("Ackermann", "Steer")
    drive.drive(35, 120)
    await asyncio.sleep_ms(900)

    drive.stop()
    drive.steer_center()
    zbot.display("Ackermann", "Stopped")

    while True:
        await asyncio.sleep_ms(1000)
