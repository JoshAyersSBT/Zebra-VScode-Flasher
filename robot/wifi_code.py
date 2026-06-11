# robot/wifi_code.py
import os
import time
import uasyncio as asyncio

try:
    import machine
except Exception:
    machine = None

import network


def _dirname(path):
    i = path.rfind("/")
    if i <= 0:
        return "/" if path.startswith("/") else ""
    return path[:i]


def _mkdirs(path):
    if not path or path == "/":
        return
    cur = "/" if path.startswith("/") else ""
    for part in path.split("/"):
        if not part:
            continue
        if cur in ("", "/"):
            cur = cur + part if cur == "/" else part
        else:
            cur = cur + "/" + part
        try:
            os.mkdir(cur)
        except OSError:
            pass


def _hex_value(ch):
    o = ord(ch)
    if 48 <= o <= 57:
        return o - 48
    if 65 <= o <= 70:
        return o - 55
    if 97 <= o <= 102:
        return o - 87
    return -1


def _url_decode(text):
    text = str(text).replace("+", " ")
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "%" and i + 2 < len(text):
            hi = _hex_value(text[i + 1])
            lo = _hex_value(text[i + 2])
            if hi >= 0 and lo >= 0:
                out.append(chr((hi << 4) | lo))
                i += 3
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def _parse_query(path):
    if "?" not in path:
        return path, {}
    path, query = path.split("?", 1)
    args = {}
    for item in query.split("&"):
        if not item:
            continue
        if "=" in item:
            key, value = item.split("=", 1)
        else:
            key, value = item, ""
        args[_url_decode(key)] = _url_decode(value)
    return path, args


def _sanitize_path(path):
    path = _url_decode(path or "/user_main.py").strip()
    if not path:
        path = "/user_main.py"
    if not path.startswith("/"):
        path = "/" + path
    if ".." in path.split("/"):
        raise ValueError("parent paths are not allowed")
    return path


class WifiCodeServer:
    """
    Tiny HTTP service for uploading MicroPython files over Wi-Fi.

    Routes:
      GET  /status
      GET  /
      POST /upload?path=/user_main.py[&reset=1]   raw request body
      POST /save[?path=/user_main.py&reset=1]     form body with code=...
      POST /reset
    """

    def __init__(
        self,
        port=8080,
        sta_ssid="",
        sta_password="",
        sta_timeout_ms=12000,
        ap_enabled=True,
        ap_ssid="ZebraBot-Code",
        ap_password="zebrabot1",
        token="",
        notify=None,
        oled=None,
    ):
        self.port = int(port)
        self.sta_ssid = sta_ssid or ""
        self.sta_password = sta_password or ""
        self.sta_timeout_ms = int(sta_timeout_ms)
        self.ap_enabled = bool(ap_enabled)
        self.ap_ssid = ap_ssid or "ZebraBot-Code"
        self.ap_password = ap_password or "zebrabot1"
        self.token = token or ""
        self.notify = notify
        self.oled = oled

        self.sta = None
        self.ap = None
        self.task = None
        self.addresses = []

    def _notify(self, text):
        try:
            print(str(text))
        except Exception:
            pass
        try:
            if self.notify is not None:
                self.notify(str(text))
        except Exception:
            pass

    def _ip(self, wlan):
        try:
            cfg = wlan.ifconfig()
            if cfg and cfg[0] != "0.0.0.0":
                return cfg[0]
        except Exception:
            pass
        return ""

    async def start(self):
        self.addresses = []
        await self._start_network()

        if not self.addresses:
            raise RuntimeError("Wi-Fi code server has no active interface")

        server = await asyncio.start_server(self._handle_client, "0.0.0.0", self.port)
        self.task = server
        self._notify("INFO WIFI code server listening on {}".format(self.urls()))
        return self

    async def _start_network(self):
        if self.sta_ssid:
            try:
                self.sta = network.WLAN(network.STA_IF)
                self.sta.active(True)
                if not self.sta.isconnected():
                    self._notify("INFO WIFI joining {}".format(self.sta_ssid))
                    self.sta.connect(self.sta_ssid, self.sta_password)
                    deadline = time.ticks_add(time.ticks_ms(), self.sta_timeout_ms)
                    while not self.sta.isconnected() and time.ticks_diff(deadline, time.ticks_ms()) > 0:
                        await asyncio.sleep_ms(250)
                ip = self._ip(self.sta)
                if ip:
                    self.addresses.append(("STA", ip))
                    self._notify("INFO WIFI STA {}".format(ip))
            except Exception as e:
                self._notify("ERR WIFI_STA {}".format(repr(e)))

        if self.ap_enabled:
            try:
                self.ap = network.WLAN(network.AP_IF)
                self.ap.active(True)
                if len(self.ap_password) >= 8:
                    self.ap.config(essid=self.ap_ssid, password=self.ap_password)
                else:
                    self.ap.config(essid=self.ap_ssid)
                ip = self._ip(self.ap)
                if ip:
                    self.addresses.append(("AP", ip))
                    self._notify("INFO WIFI AP {} {}".format(self.ap_ssid, ip))
            except Exception as e:
                self._notify("ERR WIFI_AP {}".format(repr(e)))

    def urls(self):
        out = []
        for mode, ip in self.addresses:
            out.append("{}=http://{}:{}".format(mode, ip, self.port))
        return " ".join(out)

    async def _readline(self, reader):
        line = await reader.readline()
        if isinstance(line, bytes):
            return line.decode()
        return line

    async def _write(self, writer, data):
        if isinstance(data, str):
            data = data.encode()
        if hasattr(writer, "awrite"):
            await writer.awrite(data)
        else:
            writer.write(data)
            drain = getattr(writer, "drain", None)
            if drain:
                await drain()

    async def _close(self, writer):
        try:
            if hasattr(writer, "aclose"):
                await writer.aclose()
            else:
                writer.close()
                wait_closed = getattr(writer, "wait_closed", None)
                if wait_closed:
                    await wait_closed()
        except Exception:
            pass

    async def _send(self, writer, status, content, content_type="text/plain"):
        if isinstance(content, str):
            content = content.encode()
        header = (
            "HTTP/1.1 {}\r\n"
            "Content-Type: {}\r\n"
            "Content-Length: {}\r\n"
            "Connection: close\r\n\r\n"
        ).format(status, content_type, len(content))
        await self._write(writer, header)
        await self._write(writer, content)

    def _authorized(self, args, headers, fields=None):
        if not self.token:
            return True
        if fields is None:
            fields = {}
        return (
            args.get("token", "") == self.token
            or headers.get("x-zbot-token", "") == self.token
            or fields.get("token", "") == self.token
        )

    async def _handle_client(self, reader, writer):
        try:
            request = (await self._readline(reader)).strip()
            if not request:
                await self._close(writer)
                return

            parts = request.split()
            if len(parts) < 2:
                await self._send(writer, "400 Bad Request", "bad request\n")
                return
            method, raw_path = parts[0], parts[1]
            path, args = _parse_query(raw_path)

            headers = {}
            while True:
                line = await self._readline(reader)
                if not line or line in ("\r\n", "\n"):
                    break
                if ":" in line:
                    key, value = line.split(":", 1)
                    headers[key.strip().lower()] = value.strip()

            if method == "GET" and path == "/status":
                await self._send(writer, "200 OK", "OK {}\n".format(self.urls()))
                return

            if method == "GET" and path == "/":
                await self._send(writer, "200 OK", self._index_html(), "text/html")
                return

            if path != "/save" and not self._authorized(args, headers):
                await self._send(writer, "403 Forbidden", "token required\n")
                return

            if method == "POST" and path == "/upload":
                await self._handle_upload(reader, writer, args, headers)
                return

            if method == "POST" and path == "/save":
                await self._handle_save(reader, writer, args, headers, auth_checked=False)
                return

            if method == "POST" and path == "/reset":
                await self._send(writer, "200 OK", "resetting\n")
                self._schedule_reset()
                return

            await self._send(writer, "404 Not Found", "not found\n")
        except Exception as e:
            try:
                await self._send(writer, "500 Internal Server Error", "ERR {}\n".format(repr(e)))
            except Exception:
                pass
        finally:
            await self._close(writer)

    async def _read_body(self, reader, headers, limit=65536):
        length = int(headers.get("content-length", "0") or "0")
        if length < 0 or length > limit:
            raise ValueError("body too large")
        data = b""
        while len(data) < length:
            chunk = await reader.read(min(1024, length - len(data)))
            if not chunk:
                break
            data += chunk
        if len(data) != length:
            raise ValueError("short body")
        return data

    async def _handle_upload(self, reader, writer, args, headers):
        path = _sanitize_path(args.get("path", "/user_main.py"))
        tmp = path + ".part"
        length = int(headers.get("content-length", "0") or "0")
        if length < 0:
            raise ValueError("bad content length")

        _mkdirs(_dirname(path))
        try:
            os.remove(tmp)
        except OSError:
            pass

        written = 0
        fp = open(tmp, "wb")
        try:
            while written < length:
                chunk = await reader.read(min(1024, length - written))
                if not chunk:
                    raise ValueError("short upload")
                fp.write(chunk)
                written += len(chunk)
        finally:
            fp.close()

        self._commit(tmp, path)
        self._notify("INFO WIFI uploaded {} bytes to {}".format(written, path))
        await self._send(writer, "200 OK", "OK uploaded {} bytes to {}\n".format(written, path))
        if args.get("reset", "") in ("1", "true", "yes"):
            self._schedule_reset()

    async def _handle_save(self, reader, writer, args, headers, auth_checked=True):
        body = await self._read_body(reader, headers)
        text = body.decode()
        fields = {}
        for item in text.split("&"):
            if not item:
                continue
            if "=" in item:
                key, value = item.split("=", 1)
            else:
                key, value = item, ""
            fields[_url_decode(key)] = _url_decode(value)

        if not auth_checked and not self._authorized(args, headers, fields):
            await self._send(writer, "403 Forbidden", "token required\n")
            return

        path = _sanitize_path(args.get("path", fields.get("path", "/user_main.py")))
        data = fields.get("code", "").encode()
        tmp = path + ".part"
        _mkdirs(_dirname(path))
        try:
            os.remove(tmp)
        except OSError:
            pass
        fp = open(tmp, "wb")
        try:
            fp.write(data)
        finally:
            fp.close()
        self._commit(tmp, path)
        self._notify("INFO WIFI saved {} bytes to {}".format(len(data), path))
        await self._send(writer, "200 OK", "OK saved {} bytes to {}\n".format(len(data), path))
        if args.get("reset", fields.get("reset", "")) in ("1", "true", "yes", "on"):
            self._schedule_reset()

    def _commit(self, tmp, path):
        try:
            os.remove(path)
        except OSError:
            pass
        os.rename(tmp, path)

    def _schedule_reset(self):
        if machine is None:
            return

        async def reset_later():
            await asyncio.sleep_ms(400)
            machine.reset()

        try:
            asyncio.create_task(reset_later())
        except Exception:
            machine.reset()

    def _index_html(self):
        token_input = ""
        if self.token:
            token_input = '<input name="token" placeholder="token">'
        return """<!doctype html>
<html>
<head><title>ZebraBot Code</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
<h1>ZebraBot Code</h1>
<p>{urls}</p>
<form method="post" action="/save?path=/user_main.py">
<p><input name="path" value="/user_main.py"> {token_input}</p>
<p><textarea name="code" rows="20" cols="70">import uasyncio as asyncio

async def main(zbot):
    zbot.display("WiFi Upload", "user_main.py", "running")
    while True:
        await asyncio.sleep_ms(1000)
</textarea></p>
<p><label><input type="checkbox" name="reset" value="1" checked> reset after save</label></p>
<p><button type="submit">Save Code</button></p>
</form>
</body>
</html>
""".format(urls=self.urls(), token_input=token_input)


async def start_wifi_code_from_config(api, oled, notify_fn, config, state_fn, error_fn):
    port = getattr(config, "WIFI_CODE_PORT", 8080)
    try:
        server = WifiCodeServer(
            port=port,
            sta_ssid=getattr(config, "WIFI_STA_SSID", ""),
            sta_password=getattr(config, "WIFI_STA_PASSWORD", ""),
            sta_timeout_ms=getattr(config, "WIFI_STA_TIMEOUT_MS", 12000),
            ap_enabled=getattr(config, "WIFI_AP_ENABLED", True),
            ap_ssid=getattr(config, "WIFI_AP_SSID", "ZebraBot-Code"),
            ap_password=getattr(config, "WIFI_AP_PASSWORD", "zebrabot1"),
            token=getattr(config, "WIFI_CODE_TOKEN", ""),
            notify=notify_fn,
            oled=oled,
        )
        await server.start()
        api.register_handle("wifi_code", server)
        state_fn("BOOT", "wifi_code_ok")
        if oled is not None and getattr(oled, "available", False):
            try:
                first = server.addresses[0][1] if server.addresses else ""
                oled.show_lines("ZebraBot WiFi", first, "port {}".format(port))
                await asyncio.sleep_ms(1200)
            except Exception as e:
                error_fn("WIFI_CODE_OLED", e)
    except Exception as e:
        error_fn("WIFI_CODE_START", e)
        state_fn("BOOT", "wifi_code_failed")
