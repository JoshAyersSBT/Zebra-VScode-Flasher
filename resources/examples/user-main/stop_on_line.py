async def main(zbot):
    import uasyncio as asyncio
    from robot.ackermann import AckermannDrive

    color_sensor_port = 1
    stop_color = "black"
    floor_color = "floor"
    drive_power = 35

    async def calibrate_surface(name, prompt):
        zbot.display("Calibrate", prompt)
        print("Put color sensor on", name)
        await asyncio.sleep_ms(2000)

        zbot.display("Calibrating", name)
        result = zbot.calibrate_color(color_sensor_port, name)
        print("Calibrated", name, result)

        if result is None:
            zbot.display("Calibration", "No color sensor")
            await asyncio.sleep_ms(1500)
            return False

        await asyncio.sleep_ms(700)
        return True

    car = AckermannDrive(
        zbot,
        drive_motor_port=1,
        steering_port=4,
        center_angle=90,
    )

    if not await calibrate_surface(floor_color, "Put on floor"):
        return

    if not await calibrate_surface(stop_color, "Put on black"):
        return

    zbot.display("Color stop", "Find {}".format(stop_color))
    car.steer_center()
    car.forward(drive_power)

    try:
        while True:
            color = zbot.color(color_sensor_port)
            print("I see:", color)

            if color == stop_color:
                car.stop()
                zbot.display("Stopped", "Saw {}".format(stop_color))
                break

            await asyncio.sleep_ms(100)

    finally:
        car.stop()