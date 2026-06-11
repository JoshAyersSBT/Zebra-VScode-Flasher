# robot/wifi_config.py

# Starts a tiny HTTP upload server on the ESP32 when a caller explicitly starts
# robot.wifi_code. Keep these settings out of robot.config so normal boot stays
# inside the ESP32 MicroPython heap budget.
WIFI_CODE_PORT = 8080

# Set these to join a classroom/home router. Leave SSID empty to skip station
# mode and use only the robot access point.
WIFI_STA_SSID = ""
WIFI_STA_PASSWORD = ""
WIFI_STA_TIMEOUT_MS = 12000

# Access point fallback/default. ESP32 AP passwords must be at least 8 chars.
WIFI_AP_ENABLED = True
WIFI_AP_SSID = "ZebraBot-Code"
WIFI_AP_PASSWORD = "zebrabot1"

# Optional shared secret. When non-empty, uploads require ?token=... or an
# X-Zbot-Token header. Keep empty for beginner-friendly local/AP use.
WIFI_CODE_TOKEN = ""
