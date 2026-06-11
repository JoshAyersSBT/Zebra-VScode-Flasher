# robot/config.py

# ============================================================
# MOTOR PORT DEFINITIONS (PHYSICAL PINOUT)
# ============================================================

# M1
M1_ENC = 17
M1_DIR = 16
M1_PWM = 23

# M2
M2_ENC = 34
M2_DIR = 14
M2_PWM = 13

# M3
M3_ENC = 27
M3_DIR = 26
M3_PWM = 25

# M4
M4_ENC = 35
M4_DIR = 32
M4_PWM = 33


# ============================================================
# PORT / ACTUATOR MAP
# ============================================================

PORT_MAP = {
    1: {
        "name": "M1",
        "pins": {"pwm": M1_PWM, "dir": M1_DIR, "enc": M1_ENC},
        "supports": ["dc_motor", "servo"],
        "default_mode": "dc_motor",
    },
    2: {
        "name": "M2",
        "pins": {"pwm": M2_PWM, "dir": M2_DIR, "enc": M2_ENC},
        "supports": ["dc_motor", "servo"],
        "default_mode": "dc_motor",
    },
    3: {
        "name": "M3",
        "pins": {"pwm": M3_PWM, "dir": M3_DIR, "enc": M3_ENC},
        "supports": ["dc_motor", "servo"],
        "default_mode": "dc_motor",
    },
    4: {
        "name": "M4",
        "pins": {"pwm": M4_PWM, "dir": M4_DIR, "enc": M4_ENC},
        "supports": ["dc_motor", "servo"],
        "default_mode": "dc_motor",
    },
}


# ============================================================
# LEGACY MOTOR PORT MAP COMPATIBILITY
# ============================================================

# Keep this for older code paths that still expect flat pwm/dir/enc keys.
MOTOR_PORT_MAP = {
    port: {
        "name": cfg["name"],
        "pwm": cfg["pins"]["pwm"],
        "dir": cfg["pins"]["dir"],
        "enc": cfg["pins"]["enc"],
    }
    for port, cfg in PORT_MAP.items()
}


# ============================================================
# DRIVE TRAIN CONFIG
# ============================================================

# Which actuator ports are used for drive motion.
DRIVE_MOTOR_PORTS = (1, 2)
ACTIVE_MOTOR_PORTS = (1, 2, 3, 4)

LEFT_PORT = 1
RIGHT_PORT = 2

# Legacy aliases still used by current code.
LEFT_PWM = MOTOR_PORT_MAP[LEFT_PORT]["pwm"]
LEFT_DIR = MOTOR_PORT_MAP[LEFT_PORT]["dir"]
LEFT_ENC = MOTOR_PORT_MAP[LEFT_PORT]["enc"]

RIGHT_PWM = MOTOR_PORT_MAP[RIGHT_PORT]["pwm"]
RIGHT_DIR = MOTOR_PORT_MAP[RIGHT_PORT]["dir"]
RIGHT_ENC = MOTOR_PORT_MAP[RIGHT_PORT]["enc"]


# ============================================================
# SERVO CONFIG
# ============================================================

SERVO_FREQ_HZ = 50
SERVO_MIN_US = 500
SERVO_MAX_US = 2500
SERVO_CENTER_DEG = 90

# Motor and servo ports are the same four physical actuator ports.
# Runtime code switches a port into motor mode or servo mode when it is used.
SERVO_PORT_MAP = {
    port: {
        "name": "{}_SERVO".format(cfg["name"]),
        "gpio": cfg["pwm"],
        "freq_hz": SERVO_FREQ_HZ,
        "min_us": SERVO_MIN_US,
        "max_us": SERVO_MAX_US,
        "center_deg": SERVO_CENTER_DEG,
        "role": "",
    }
    for port, cfg in MOTOR_PORT_MAP.items()
}

# Default Ackermann steering port.
STEER_SERVO_PORT = 4
SERVO_PORT_MAP[STEER_SERVO_PORT]["role"] = "steering"
STEER_SERVO_GPIO = SERVO_PORT_MAP[STEER_SERVO_PORT]["gpio"]

# ============================================================
# BLE
# ============================================================

BLE_NAME = "ZebraBot"
BLE_ENABLED = False


# ============================================================
# I2C / TCA9548A MUX
# ============================================================

TCA_I2C_ID = 0
TCA_SDA_GPIO = 21
TCA_SCL_GPIO = 22
TCA_I2C_FREQ = 400000
TCA_ADDR = 0x70


# ============================================================
# OLED (MUX CHANNEL 0)
# ============================================================

OLED_ADDR = 0x3C
OLED_CHANNEL = 0
OLED_WIDTH = 128
OLED_HEIGHT = 64
OLED_STATUS_ENABLED = False


# ============================================================
# IMU (MUX CHANNEL 7)
# ============================================================

MPU_ADDR = 0x68
MPU_CHANNEL = 7
MPU_PERIOD_MS = 10


# ============================================================
# SENSOR PORT DATA PINS
# ============================================================

SENSOR_DATA_PINS = {
    1: 18,
    2: 19,
    3: 5,
    4: 36,
    5: 39,
    6: 4,
}

SENSOR_PORT_CHANNELS = {
    1: 6,
    2: 5,
    3: 4,
    4: 3,
    5: 2,
    6: 1,
}


# ============================================================
# SENSOR HUB CONFIG
# ============================================================

SENSOR_SCAN_PERIOD_MS = 500

SENSOR_PORT_MODES = {
    1: "auto",
    2: "auto",
    3: "auto",
    4: "auto",
    5: "auto",
    6: "auto",
}


# ============================================================
# MOTOR / TELEMETRY SETTINGS
# ============================================================

MOTOR_PWM_FREQ_HZ = 20000
MOTOR_MAX_DUTY_U16 = 40000
# Electrical PWM polarity for this board's active-low motor PWM input.
# With inversion enabled, logical duty 0 maps to physical full-high/off.
MOTOR_INVERT_PWM = True

MOTOR_SCAN_POWER = 25
MOTOR_SCAN_PULSE_MS = 250
MOTOR_SCAN_PERIOD_MS = 1500
MOTOR_FEEDBACK_PERIOD_MS = 200
MOTOR_FEEDBACK_ENABLED = False

# ============================================================
# BUTTON IO Settings
# ============================================================

BUTTON1_IO = 15
BUTTON2_IO = 12

BUTTON_DEFAULT_PULL = "down"
BUTTON_DEFAULT_ACTIVE_LOW = False
BUTTON_DEBOUNCE_MS = 45
BUTTON_SCAN_PERIOD_MS = 10

BUTTON_MAP = {
    1: {
        "name": "B1",
        "gpio": BUTTON1_IO,
        "pull": BUTTON_DEFAULT_PULL,
        "active_low": BUTTON_DEFAULT_ACTIVE_LOW,
    },
    2: {
        "name": "B2",
        "gpio": BUTTON2_IO,
        "pull": BUTTON_DEFAULT_PULL,
        "active_low": BUTTON_DEFAULT_ACTIVE_LOW,
    },
}
