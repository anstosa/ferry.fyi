#!/usr/bin/env python3
import json
import os
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
ANNOTATION_FILE = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
ANNOTATION_ROUTE = "/camera-detection-areas.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("FERRY_ANNOTATOR_PORT", "8787"))
DETECTOR_URL = os.environ.get("FERRY_DETECTOR_URL", "http://127.0.0.1:8001/detect")
CAMERA_IMAGE_HOST = "images.wsdot.wa.gov"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        # app data route
        if self.path.split("?", 1)[0] == ANNOTATION_ROUTE:
            self.send_annotation_file()
            return
        super().do_GET()

    def do_POST(self):
        # route dispatch
        if self.path == "/save-annotations":
            self.save_annotations()
            return
        if self.path == "/detect-current-image":
            self.detect_current_image()
            return
        self.send_error(404, "Not found")

    # persist annotations
    def save_annotations(self):
        # request body read
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            self.send_error(400, f"Invalid JSON: {error}")
            return
        # schema guard
        if not isinstance(payload, dict) or "cameras" not in payload:
            self.send_error(400, "Expected annotation JSON with a cameras object")
            return
        payload.setdefault("source", {})["savedBy"] = "ferry-fyi-camera-polygon-annotator"
        ANNOTATION_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        self.send_json(200, {"ok": True, "file": str(ANNOTATION_FILE)})

    # proxy image detection
    def detect_current_image(self):
        # request payload read
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            self.send_json(400, {"error": f"Invalid JSON: {error}"})
            return
        image_url = payload.get("imageUrl") if isinstance(payload, dict) else None
        # image URL guard
        parsed_image_url = urlparse(image_url) if isinstance(image_url, str) else None
        if (
            not parsed_image_url
            or parsed_image_url.scheme != "https"
            or parsed_image_url.hostname != CAMERA_IMAGE_HOST
        ):
            self.send_json(400, {"error": "Expected an HTTPS WSDOT camera imageUrl"})
            return
        try:
            # fetch image bytes in memory
            with urlopen(Request(image_url, headers={"User-Agent": "FerryFYI-PolygonAnnotator/1.0"}), timeout=20) as image_response:
                image_bytes = image_response.read()
                content_type = image_response.headers.get_content_type()
            # forward image bytes to detector
            detection_areas = {
                "allowedAreas": payload.get("allowedAreas", []),
                "excludedAreas": payload.get("excludedAreas", []),
            }
            detector_request = Request(DETECTOR_URL, data=image_bytes, method="POST", headers={
                "Content-Type": content_type,
                "X-Detection-Areas": json.dumps(detection_areas),
            })
            with urlopen(detector_request, timeout=60) as detector_response:
                detector_payload = json.loads(detector_response.read())
        except HTTPError as error:
            self.send_json(502, {"error": f"Detector request failed: {error.code} {error.reason}"})
            return
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            self.send_json(502, {"error": f"Detector unavailable: {error}"})
            return
        self.send_json(200, detector_payload)

    # send JSON response
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_annotation_file(self):
        # direct app data read
        try:
            body = ANNOTATION_FILE.read_bytes()
        except FileNotFoundError:
            self.send_error(404, f"Missing {ANNOTATION_FILE}")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# open local tool
def open_browser():
    webbrowser.open(f"http://{HOST}:{PORT}/")


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Ferry FYI annotator: http://{HOST}:{PORT}/")
    print(f"Reading/writing app data: {ANNOTATION_FILE}")
    # optional browser launch
    if os.environ.get("FERRY_ANNOTATOR_NO_BROWSER") != "1":
        threading.Timer(0.5, open_browser).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping annotator server")
