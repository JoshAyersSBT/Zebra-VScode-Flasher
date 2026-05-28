# Zebra Example: Button Motor
# Hold button 1 to run motor port 1; release it to stop.

import uasyncio as asyncio


async def main(zbot):
    motor = zbot.motor(1)
    button = zbot.button(1)

    zbot.display("Button", "Hold B1")

    while True:
        if button.pressed():
            motor.on(45)
            zbot.display("Motor", "Port 1 on")
        else:
            motor.stop()
            zbot.display("Motor", "Stopped")

        await asyncio.sleep_ms(50)
