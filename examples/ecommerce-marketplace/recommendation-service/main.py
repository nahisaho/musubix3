"""Minimal executable HTTP entrypoint for the recommendation service."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from recommendations import get_related


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        prefix = "/recommendations/"
        if self.path.startswith(prefix):
            sku = self.path[len(prefix):]
            body = json.dumps({"sku": sku, "related": get_related(sku)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8083), Handler).serve_forever()
