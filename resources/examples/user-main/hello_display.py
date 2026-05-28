# Zebra Example: Hello Display
# A tiny starter program that keeps the robot alive and updates the screen.

import gc
import uasyncio as asyncio


async def main(zbot):
    gc.collect()
    zbot.display("ZebraBot", "Hello!")
    zbot.notify("Hello from user_main.py")

    count = 0
    while True:
        count += 1
        zbot.display("ZebraBot", "Running", "Loop {}".format(count))
        await asyncio.sleep_ms(1000)
