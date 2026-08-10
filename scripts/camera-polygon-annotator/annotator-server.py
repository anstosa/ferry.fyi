#!/usr/bin/env python3
import json
import os
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
ANNOTATION_FILE = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
ANNOTATION_ROUTE = "/camera-detection-areas.json"
CAMERA_OVERRIDES_FILE = REPO_ROOT / "shared" / "data" / "cameras.json"
CAMERA_OVERRIDES_ROUTE = "/camera-display-overrides.json"
BENCHMARK_ROOT = REPO_ROOT / "benchmarks" / "camera-detection"
BENCHMARK_MANIFEST_FILE = BENCHMARK_ROOT / "manifest.json"
BENCHMARK_MANIFEST_ROUTE = "/camera-benchmark.json"
BENCHMARK_LABELS_FILE = BENCHMARK_ROOT / "labels.json"
BENCHMARK_LABELS_ROUTE = "/camera-benchmark-labels.json"
BENCHMARK_FRAME_ROUTE = "/camera-benchmark-frame/"
ICON_FILE = ROOT / "icons.svg"
ICON_ROUTE = "/dev/camera-detection/icons.svg"
HOST = "127.0.0.1"
PORT = int(os.environ.get("FERRY_ANNOTATOR_PORT", "8787"))
DETECTOR_URL = os.environ.get("FERRY_DETECTOR_URL", "http://127.0.0.1:8001/detect")
CAMERA_IMAGE_HOST = "images.wsdot.wa.gov"
OCCUPANCY_STATES = {"empty", "minority_full", "majority_full", "full"}


# load benchmark manifest
def load_benchmark_manifest():
    return json.loads(BENCHMARK_MANIFEST_FILE.read_text(encoding="utf-8"))


# index benchmark frames
def benchmark_frames_by_id():
    return {
        frame["frameId"]: frame
        for frame in load_benchmark_manifest().get("frames", [])
    }


# validate benchmark labels
def validate_benchmark_labels(payload):
    # payload shape guard
    if not isinstance(payload, dict) or not isinstance(payload.get("frames"), dict):
        raise ValueError("Expected benchmark labels with a frames object")
    benchmark_frames = benchmark_frames_by_id()
    camera_config = json.loads(ANNOTATION_FILE.read_text(encoding="utf-8"))
    # frame label validation pass
    for frame_id, frame_labels in payload["frames"].items():
        # selected frame guard
        if frame_id not in benchmark_frames:
            raise ValueError(f"Unknown benchmark frame: {frame_id}")
        # frame label shape guard
        if not isinstance(frame_labels, dict):
            raise ValueError(f"Expected object labels for frame: {frame_id}")
        expected_camera_id = benchmark_frames[frame_id]["cameraId"]
        # camera identity guard
        if frame_labels.get("cameraId") != expected_camera_id:
            raise ValueError(f"Camera mismatch for benchmark frame: {frame_id}")
        area_states = frame_labels.get("areaStates", {})
        # area state shape guard
        if not isinstance(area_states, dict):
            raise ValueError(f"Expected areaStates object for frame: {frame_id}")
        valid_area_ids = {
            area["id"]
            for area in camera_config["cameras"][expected_camera_id].get(
                "allowedAreas", []
            )
        }
        # polygon label validation pass
        for area_id, state in area_states.items():
            # known polygon guard
            if area_id not in valid_area_ids:
                raise ValueError(f"Unknown polygon {area_id} for frame: {frame_id}")
            # occupancy state guard
            if state not in OCCUPANCY_STATES:
                raise ValueError(f"Invalid occupancy state for polygon: {area_id}")
        notes = frame_labels.get("notes", "")
        # notes shape guard
        if not isinstance(notes, str) or len(notes) > 1000:
            raise ValueError(f"Invalid notes for benchmark frame: {frame_id}")
    return payload


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        # generated Font Awesome subset route
        if self.path.split("?", 1)[0] == ICON_ROUTE:
            self.send_icon_file()
            return
        # app data route
        if self.path.split("?", 1)[0] == ANNOTATION_ROUTE:
            self.send_annotation_file()
            return
        # camera display override route
        if self.path.split("?", 1)[0] == CAMERA_OVERRIDES_ROUTE:
            self.send_json_file(CAMERA_OVERRIDES_FILE)
            return
        # benchmark manifest route
        if self.path.split("?", 1)[0] == BENCHMARK_MANIFEST_ROUTE:
            self.send_json_file(BENCHMARK_MANIFEST_FILE)
            return
        # benchmark labels route
        if self.path.split("?", 1)[0] == BENCHMARK_LABELS_ROUTE:
            self.send_json_file(BENCHMARK_LABELS_FILE)
            return
        # benchmark frame route
        if self.path.split("?", 1)[0].startswith(BENCHMARK_FRAME_ROUTE):
            self.send_benchmark_frame()
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
        if self.path == "/save-benchmark-labels":
            self.save_benchmark_labels()
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
        try:
            frame_id = payload.get("frameId") if isinstance(payload, dict) else None
            # stored benchmark frame path
            if isinstance(frame_id, str):
                benchmark_frame = benchmark_frames_by_id().get(frame_id)
                # benchmark frame guard
                if not benchmark_frame:
                    self.send_json(400, {"error": "Unknown benchmark frameId"})
                    return
                frame_path = BENCHMARK_ROOT / benchmark_frame["file"]
                image_bytes = frame_path.read_bytes()
                content_type = benchmark_frame["contentType"]
            else:
                image_url = payload.get("imageUrl") if isinstance(payload, dict) else None
                parsed_image_url = urlparse(image_url) if isinstance(image_url, str) else None
                # image URL guard
                if (
                    not parsed_image_url
                    or parsed_image_url.scheme != "https"
                    or parsed_image_url.hostname != CAMERA_IMAGE_HOST
                ):
                    self.send_json(400, {"error": "Expected an HTTPS WSDOT camera imageUrl"})
                    return
                trusted_image_url = urlunparse((
                    "https",
                    CAMERA_IMAGE_HOST,
                    parsed_image_url.path,
                    parsed_image_url.params,
                    parsed_image_url.query,
                    "",
                ))
                # fetch image bytes in memory
                with urlopen(Request(trusted_image_url, headers={"User-Agent": "FerryFYI-PolygonAnnotator/1.0"}), timeout=20) as image_response:
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

    # persist benchmark labels
    def save_benchmark_labels(self):
        # request body read
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
            validate_benchmark_labels(payload)
        except (json.JSONDecodeError, ValueError) as error:
            self.send_json(400, {"error": str(error)})
            return
        payload["schemaVersion"] = 1
        payload["updatedAt"] = datetime.now(timezone.utc).replace(
            microsecond=0
        ).isoformat()
        BENCHMARK_LABELS_FILE.write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        self.send_json(200, {"file": str(BENCHMARK_LABELS_FILE), "ok": True})

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

    # send generated icon subset
    def send_icon_file(self):
        try:
            body = ICON_FILE.read_bytes()
        except FileNotFoundError:
            self.send_error(404, f"Missing {ICON_FILE}; run yarn camera:icons")
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # send repository JSON file
    def send_json_file(self, path):
        # direct file read
        try:
            body = path.read_bytes()
        except FileNotFoundError:
            self.send_error(404, f"Missing {path}")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # send selected benchmark frame
    def send_benchmark_frame(self):
        frame_file = self.path.split("?", 1)[0].removeprefix(BENCHMARK_FRAME_ROUTE)
        selected_frame = next(
            (
                frame
                for frame in load_benchmark_manifest().get("frames", [])
                if Path(frame["file"]).name == frame_file
            ),
            None,
        )
        # selected frame guard
        if not selected_frame:
            self.send_error(404, "Unknown benchmark frame")
            return
        frame_path = BENCHMARK_ROOT / selected_frame["file"]
        body = frame_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", selected_frame["contentType"])
        self.send_header("Cache-Control", "no-store")
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
