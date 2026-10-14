#!/usr/bin/env python3
"""Local server for the counter: like `python3 -m http.server`, but tells browsers never to cache.

Without this, Safari on a phone can keep showing an old styles.css / app.js after they change.
Standard library only. Serves this folder on all interfaces, so a phone on the same Wi-Fi can open it.

Usage: python3 serve.py [port]   (default 4422)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4422
    handler = partial(NoCacheHandler, directory=str(Path(__file__).resolve().parent))
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        print(f"Serving on http://localhost:{port} (and on this machine's LAN IP), no caching", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
