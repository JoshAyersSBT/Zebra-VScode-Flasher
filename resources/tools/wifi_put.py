import argparse
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def upload(args):
    local = Path(args.local).resolve()
    data = local.read_bytes()

    base = args.url.rstrip("/")
    query = {"path": args.remote}
    if args.reset:
        query["reset"] = "1"
    if args.token:
        query["token"] = args.token

    url = base + "/upload?" + urlencode(query)
    headers = {"Content-Type": "application/octet-stream"}
    if args.token:
        headers["X-Zbot-Token"] = args.token

    request = Request(url, data=data, headers=headers, method="POST")
    with urlopen(request, timeout=args.timeout) as response:
        body = response.read().decode(errors="replace")
        print(body.strip())

    print("Uploaded {} bytes from {} to {}".format(len(data), local, args.remote))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Upload a file to ZebraBot over Wi-Fi HTTP.")
    parser.add_argument("url", help="Robot URL, for example http://192.168.4.1:8080")
    parser.add_argument("local", help="Local file to upload, for example user_main.py")
    parser.add_argument("remote", nargs="?", default="/user_main.py", help="Remote MicroPython path")
    parser.add_argument("--token", default="", help="Optional Wi-Fi code token")
    parser.add_argument("--reset", action="store_true", help="Reset the board after upload")
    parser.add_argument("--timeout", type=float, default=15.0, help="HTTP timeout in seconds")
    return parser.parse_args(argv)


def main(argv=None):
    upload(parse_args(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    main()
