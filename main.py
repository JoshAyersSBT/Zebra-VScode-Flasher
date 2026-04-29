import uasyncio as asyncio


async def main(zbot):
    zbot.display("Zebra", "Hello")
    while True:
        await asyncio.sleep_ms(100)
