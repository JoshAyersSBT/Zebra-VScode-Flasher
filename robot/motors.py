try:
    from zbot_motor import Motor
except ImportError:
    from machine import Pin, PWM

    class Motor:
        """
        Direction + PWM motor.

        Default behavior is active-high PWM:
          duty 0      -> off
          duty 65535  -> full on

        Public power range:
          -100..100
           0 = stop
        """

        def __init__(self, pwm_gpio: int, dir_gpio: int, pwm_freq_hz: int = 20000, invert_pwm: bool = False):
            self._dir = Pin(dir_gpio, Pin.OUT)
            self._pwm = PWM(Pin(pwm_gpio, Pin.OUT), freq=pwm_freq_hz)
            self._invert_pwm = bool(invert_pwm)
            self._power = 0
            self.stop()

        def _clamp_power(self, power):
            power = int(power)
            if power > 100:
                return 100
            if power < -100:
                return -100
            return power

        def _write_duty(self, duty_u16):
            duty_u16 = int(duty_u16)

            if duty_u16 < 0:
                duty_u16 = 0
            if duty_u16 > 65535:
                duty_u16 = 65535

            if self._invert_pwm:
                duty_u16 = 65535 - duty_u16

            self._pwm.duty_u16(duty_u16)

        def set(self, forward: bool, duty_u16: int):
            self._dir.value(1 if forward else 0)
            self._write_duty(duty_u16)

            percent = (int(duty_u16) * 100) // 65535
            self._power = percent if forward else -percent

        def set_power(self, power: int):
            power = self._clamp_power(power)

            if power == 0:
                self.stop()
                return

            forward = power > 0
            mag = abs(power)

            duty_u16 = (mag * 65535) // 100
            self.set(forward, duty_u16)

        def stop(self):
            self._power = 0
            self._write_duty(0)

        def brake(self):
            self.stop()

        def power(self):
            return self._power

        def deinit(self):
            try:
                self.stop()
            except Exception:
                pass

            try:
                self._pwm.deinit()
            except Exception:
                pass
