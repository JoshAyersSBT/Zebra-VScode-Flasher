# Student API

Student programs use the global `zbot` object to control ZebraBot. The helpers
are designed for simple scripts first, with lower-level status snapshots
available when you need more detail.

```python
zbot.forward(40)
zbot.display("Driving")
```

Power values are usually `-100` to `100`:

- positive power moves forward
- negative power moves backward
- `0` stops that motor or movement command

## Robot State

Check whether the robot runtime is ready:

```python
if zbot.ready():
    zbot.notify("Ready")
```

Stop all motors:

```python
zbot.stop()
```

## Simple Driving

The top-level driving helpers use the default runtime drive bridge.

```python
zbot.forward(50)
zbot.backward(30)
zbot.drive(40, 0)
zbot.drive(40, 25)
zbot.tank(50, 20)
zbot.stop()
```

`zbot.drive(throttle, turn)` takes:

- `throttle`: forward/backward power from `-100` to `100`
- `turn`: steering/turn command from `-100` to `100`

`zbot.tank(left_power, right_power)` is a compatibility helper. It converts left
and right motor powers into a throttle/turn command for the runtime bridge.

For custom robot layouts, prefer one of the drive model helpers below.

## Motors

Use `zbot.motor(port)` to control one motor port directly.

```python
left = zbot.motor(1)

left.on(50)
left.on(-50)
left.off()
```

Motor ports are numbered by the configured motor map. The default physical motor
ports are `1` through `4`.

Motor wrapper methods:

- `on(power)`: set motor power from `-100` to `100`
- `speed(power)`: alias for `on(power)`
- `set(power)`: alias for `on(power)`
- `off()`: stop the motor
- `stop()`: alias for `off()`
- `value()`: return the latest status dictionary for that motor

Example:

```python
m1 = zbot.motor(1)
m1.on(75)

status = m1.value()
zbot.notify("M1 {}".format(status.get("power")))
```

You can pass a motor type label when constructing the wrapper. This is recorded
in status metadata for user code and tools.

```python
arm = zbot.motor(3, motor_type="arm")
arm.on(25)
```

## Servos

Use `zbot.servo(port)` to control a servo on an actuator port.

```python
servo = zbot.servo(1)
servo.angle(90)
servo.center()
```

Servo wrapper methods:

- `angle(deg)`: move the servo to an angle in degrees
- `write_angle(deg)`: alias for `angle(deg)`
- `center()`: move to the configured center angle for that port
- `center(center_angle)`: move to a provided center angle

The top-level steering helper controls the configured steering servo:

```python
zbot.steer(90)
```

## Differential Drive

Use `robot.differential.DifferentialDrive` when your robot has separate left and
right drive motors.

```python
from robot.differential import DifferentialDrive

drive = DifferentialDrive(zbot, left_port=1, right_port=2)

drive.forward(50)
drive.drive(40, 20)
drive.tank(60, 30)
drive.stop()
```

Differential drive methods:

- `forward(power)`: drive both motors forward
- `backward(power)`: drive both motors backward
- `drive(throttle, turn)`: mix throttle and turn into left/right power
- `tank(left_power, right_power)`: set left and right motor power directly
- `stop()`: stop both motors
- `status()`: return the last commanded drive state

## Ackermann Drive

Use `robot.ackermann.AckermannDrive` when your robot has a drive motor and a
steering servo.

```python
from robot.ackermann import AckermannDrive

car = AckermannDrive(
    zbot,
    drive_motor_port=1,
    steering_port=2,
    center_angle=90,
    min_angle=45,
    max_angle=135,
)

car.forward(40)
car.steer(110)
car.drive(50, 90)
car.stop()
```

Ackermann drive methods:

- `forward(power)`: drive forward
- `backward(power)`: drive backward
- `drive(throttle, steering_angle)`: set drive power and steering angle
- `steer(angle)`: set the steering angle
- `steer_center()`: move steering to the configured center angle
- `stop()`: stop the drive motor

Ackermann drive also supports optional IMU heading reference:

```python
car = AckermannDrive(zbot, 1, 2, imu_ref=True)
car.forward(40)

while True:
    car.update()
```

Call `update()` regularly when `imu_ref=True` so the drive helper can refresh
the heading estimate.

## Buttons

Use `zbot.button(id)` to read a button. Button IDs start at `1` in student code.

```python
button = zbot.button(1)

if button.pressed():
    zbot.stop()
```

Button wrapper methods:

- `read()`: return `True` when pressed, otherwise `False`
- `value()`: alias for `read()`
- `pressed()`: return `True` while held down
- `released()`: return `True` while not held down
- `was_pressed()`: return `True` once after a press event
- `was_released()`: return `True` once after a release event
- `presses(reset=False)`: return the press count
- `releases(reset=False)`: return the release count
- `snapshot()`: return the full button status dictionary

Example press counter:

```python
button = zbot.button(1)

if button.was_pressed():
    zbot.notify("Pressed {}".format(button.presses()))
```

## Display And Notifications

Show text on the OLED:

```python
zbot.display("Line 1", "Line 2", "Line 3", "Line 4")
```

`zbot.say()` is an alias for `zbot.display()`.

Send a message over the active telemetry link:

```python
zbot.notify("Hello from user code")
```

`display()` returns `True` when the OLED is available. `notify()` returns `True`
when a telemetry connection is available.

## Sensors

The most common sensor helpers are:

```python
distance = zbot.tof(1)
color = zbot.color(2)
rgb = zbot.rgb(2)
```

See [Sensor Usage](sensors.md) for the full sensor guide, including ToF sensors,
raw RGB readings, and the 32-color range palette.

## IMU

Use `zbot.imu()` to read the latest IMU snapshot.

```python
imu = zbot.imu()

if imu:
    value = imu.get("value", {})
    gz = value.get("gz_dps")
```

The exact fields depend on the IMU driver payload. Use the full snapshot while
debugging to see what is available.

## Status Snapshots

The status helpers return dictionaries with the latest runtime state:

```python
all_status = zbot.status()
motors = zbot.motor_status()
feedback = zbot.motor_feedback()
servos = zbot.servo_status()
sensors = zbot.sensors()
buttons = zbot.button_status()
imu = zbot.imu()
```

These are useful for debugging and dashboards. For normal robot behavior, prefer
the direct wrappers like `zbot.motor(1)`, `zbot.button(1)`, and `zbot.tof(1)`.

## Safety Pattern

Always stop motors when your program exits or hits an error condition.

```python
try:
    zbot.forward(40)
    # your loop here
finally:
    zbot.stop()
```

This makes user code much friendlier during testing.
