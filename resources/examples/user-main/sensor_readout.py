# Zebra Example: Sensor Readout
# Shows time-of-flight readings from sensor port 1.

import uasyncio as asyncio


async def main(zbot):
    zbot.display("Sensor", "Port 1")

    while True:
        distance = zbot.tof(1)
        if distance is None:
            zbot.display("Sensor", "No reading")
        else:
            zbot.display("Sensor", "Port 1", "{} mm".format(distance))

        await asyncio.sleep_ms(250)
