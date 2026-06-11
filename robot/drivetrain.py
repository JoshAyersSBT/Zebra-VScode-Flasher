# robot/drivetrain.py
from .motors import Motor

try:
    import zbot_drive
except ImportError:
    zbot_drive = None


def _clamp(x, lo, hi):
    if zbot_drive is not None and lo == -100 and hi == 100:
        return zbot_drive.clamp(int(x))
    return lo if x < lo else hi if x > hi else x

class DifferentialDrive:
    """
    throttle: -100..100  (forward/back)
    turn:     -100..100  (left/right)
    """
    def __init__(self, left: Motor, right: Motor, max_duty_u16: int = 40000):
        self.left = left
        self.right = right
        self.max_duty = int(max_duty_u16)

    def drive(self, throttle: int, turn: int):
        t = _clamp(int(throttle), -100, 100)
        r = _clamp(int(turn), -100, 100)

        if zbot_drive is not None:
            left_cmd, right_cmd = zbot_drive.mix(t, r)
        else:
            # Simple mix
            left_cmd = _clamp(t + r, -100, 100)
            right_cmd = _clamp(t - r, -100, 100)

        self._apply(self.left, left_cmd)
        self._apply(self.right, right_cmd)

    def _apply(self, motor: Motor, cmd: int):
        forward = (cmd >= 0)
        mag = abs(cmd)
        if zbot_drive is not None:
            duty = zbot_drive.duty(cmd, self.max_duty)
        else:
            duty = (mag * self.max_duty) // 100
        motor.set(forward, duty)

    def stop(self):
        self.left.stop()
        self.right.stop()
