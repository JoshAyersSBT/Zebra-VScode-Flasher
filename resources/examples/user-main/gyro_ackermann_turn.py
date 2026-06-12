# Zebra Example: Gyro Ackermann Turn
# Uses the IMU gyro and Ackermann drive helper to drive a measured turn.

import time
import uasyncio as asyncio
from robot.ackermann import AckermannDrive


DRIVE_MOTOR_PORT = 1
STEERING_PORT = 1

CENTER_ANGLE = 90
LEFT_TURN_ANGLE = 55
RIGHT_TURN_ANGLE = 125

TURN_POWER = 35
GYRO_DEADBAND_DPS = 0.8
TURN_SETTLE_MS = 150
TURN_TIMEOUT_MS = 4500

# Change this to -1 if the displayed turn angle counts away from the target.
GYRO_SIGN = 1


def _ticks_ms():
    return time.ticks_ms()


def _ticks_diff(now, before):
    return time.ticks_diff(now, before)


def _imu_payload(zbot):
    api = getattr(zbot, "api", None)
    if api is None:
        return None

    snap = None
    if hasattr(api, "refresh_imu_snapshot"):
        snap = api.refresh_imu_snapshot()
    if snap is None and hasattr(api, "get_imu"):
        snap = api.get_imu()

    if isinstance(snap, dict) and isinstance(snap.get("value"), dict):
        return snap["value"]
    if isinstance(snap, dict):
        return snap
    return None


def _gyro_z_dps(zbot):
    payload = _imu_payload(zbot)
    if not isinstance(payload, dict):
        return None

    for key in ("gz_dps", "gyro_z_dps", "gz", "gyro_z"):
        value = payload.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


async def _gyro_bias(zbot, samples=25, sample_ms=10):
    total = 0.0
    count = 0

    for _ in range(samples):
        gz = _gyro_z_dps(zbot)
        if gz is not None:
            total += gz
            count += 1
        await asyncio.sleep_ms(sample_ms)

    if count == 0:
        return 0.0
    return total / count


async def gyro_turn(zbot, drive, degrees):
    """
    Drive an Ackermann turn until the gyro reports the requested yaw change.

    Positive degrees turns right with the constants above; negative degrees
    turns left. Example: await gyro_turn(zbot, drive, 90)
    """
    target = abs(float(degrees))
    if target <= 0.0:
        return 0.0

    direction = 1 if degrees > 0 else -1
    steering = RIGHT_TURN_ANGLE if direction > 0 else LEFT_TURN_ANGLE

    zbot.display("Gyro Turn", "{} deg".format(int(degrees)))
    drive.stop()
    drive.steer_center()
    await asyncio.sleep_ms(TURN_SETTLE_MS)

    bias = await _gyro_bias(zbot)
    turned = 0.0
    last_ms = _ticks_ms()
    start_ms = last_ms

    drive.drive(TURN_POWER, steering)

    while turned < target:
        await asyncio.sleep_ms(10)

        now = _ticks_ms()
        dt_s = _ticks_diff(now, last_ms) / 1000.0
        last_ms = now

        gz = _gyro_z_dps(zbot)
        if gz is None:
            zbot.display("Gyro Turn", "No IMU")
            break

        rate = (gz - bias) * GYRO_SIGN * direction
        if -GYRO_DEADBAND_DPS < rate < GYRO_DEADBAND_DPS:
            rate = 0.0

        turned += rate * dt_s
        if turned < 0.0:
            turned = 0.0

        zbot.display("Turning", "{}/{} deg".format(int(turned), int(target)))

        if _ticks_diff(now, start_ms) > TURN_TIMEOUT_MS:
            zbot.display("Gyro Turn", "Timeout")
            break

    drive.stop()
    drive.steer_center()
    await asyncio.sleep_ms(TURN_SETTLE_MS)
    return turned


async def main(zbot):
    drive = AckermannDrive(
        zbot,
        drive_motor_port=DRIVE_MOTOR_PORT,
        steering_port=STEERING_PORT,
        center_angle=CENTER_ANGLE,
        min_angle=45,
        max_angle=135,
    )

    await gyro_turn(zbot, drive, 90)

    zbot.display("Gyro Turn", "Done")
    while True:
        await asyncio.sleep_ms(1000)
