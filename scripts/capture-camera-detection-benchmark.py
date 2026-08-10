#!/usr/bin/env python3
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
CAMERA_CONFIG_PATH = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
BENCHMARK_ROOT = REPO_ROOT / "benchmarks" / "camera-detection"
FRAME_ROOT = BENCHMARK_ROOT / "frames"
MANIFEST_PATH = BENCHMARK_ROOT / "manifest.json"
LABELS_PATH = BENCHMARK_ROOT / "labels.json"

FRAME_SELECTION = [
    ("test-clover-lane-001", "9161", "Clover Lane", "test"),
    ("test-mukilteo-holding-001", "9164", "Mukilteo Holding", "test"),
    ("test-clinton-holding-001", "9166", "Clinton Holding", "test"),
    ("test-tollbooth-uphill-001", "9172", "Tollbooth / uphill", "test"),
    ("test-food-mart-001", "9174", "Food Mart / east SR 525", "test"),
    ("test-post-office-001", "9175", "Post Office / west SR 525", "test"),
    ("test-fifth-street-north-001", "9394", "5th Street north", "test"),
    ("test-fifth-street-south-001", "9728", "5th Street south", "test"),
    ("control-school-south-001", "9163", "76th Street / school south", "control"),
    ("control-clover-lane-empty-001", "9161", "Clover Lane empty control", "control"),
]


# parse command arguments
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture immutable seed frames for camera occupancy benchmarking."
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace the existing seed manifest and frame files.",
    )
    return parser.parse_args()


# add a source cache buster
def fresh_image_url(image_url: str, captured_at: str) -> str:
    split = urlsplit(image_url)
    query = dict(parse_qsl(split.query, keep_blank_values=True))
    query["benchmark"] = captured_at
    return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), ""))


# download one camera frame
def fetch_frame(image_url: str, captured_at: str) -> tuple[bytes, str]:
    request = Request(
        fresh_image_url(image_url, captured_at),
        headers={"User-Agent": "FerryFYI-CameraBenchmark/1.0"},
    )
    # source response guard
    with urlopen(request, timeout=30) as response:
        content_type = response.headers.get_content_type()
        body = response.read()
    # image response guard
    if content_type not in {"image/jpeg", "image/png"}:
        raise RuntimeError(f"Unexpected frame content type: {content_type}")
    return body, content_type


# map image content type to suffix
def image_suffix(content_type: str) -> str:
    # png response guard
    if content_type == "image/png":
        return ".png"
    return ".jpg"


# capture selected benchmark frames
def capture_frames(replace: bool) -> None:
    # existing benchmark guard
    if MANIFEST_PATH.exists() and not replace:
        raise RuntimeError(
            f"Benchmark manifest already exists at {MANIFEST_PATH}; use --replace intentionally."
        )
    camera_config = json.loads(CAMERA_CONFIG_PATH.read_text(encoding="utf-8"))
    FRAME_ROOT.mkdir(parents=True, exist_ok=True)
    # stale selected-frame cleanup
    if replace and MANIFEST_PATH.exists():
        selected_frame_ids = {selection[0] for selection in FRAME_SELECTION}
        previous_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        # previous frame cleanup pass
        for frame in previous_manifest.get("frames", []):
            # retained frame guard
            if frame.get("frameId") in selected_frame_ids:
                continue
            stale_path = BENCHMARK_ROOT / frame["file"]
            # existing file guard
            if stale_path.is_file():
                stale_path.unlink()
    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    frames = []
    # selected frame capture pass
    for frame_id, camera_id, camera_name, role in FRAME_SELECTION:
        camera = camera_config["cameras"][camera_id]
        body, content_type = fetch_frame(camera["imageUrl"], captured_at)
        file_name = f"{frame_id}{image_suffix(content_type)}"
        frame_path = FRAME_ROOT / file_name
        frame_path.write_bytes(body)
        frames.append(
            {
                "cameraId": camera_id,
                "cameraName": camera_name,
                "capturedAt": captured_at,
                "contentType": content_type,
                "file": f"frames/{file_name}",
                "frameId": frame_id,
                "frameSize": camera["frameSize"],
                "role": role,
                "sha256": hashlib.sha256(body).hexdigest(),
                "sourceImageUrl": camera["imageUrl"],
            }
        )
        print(frame_path)
    manifest = {
        "frames": frames,
        "schemaVersion": 1,
        "stateModel": {
            "fullThreshold": 0.85,
            "majorityThreshold": 0.5,
            "signal": "principal-axis spatial coverage",
            "states": ["empty", "minority_full", "majority_full", "full"],
        },
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    # new-frame label invalidation
    if replace or not LABELS_PATH.exists():
        LABELS_PATH.write_text(
            json.dumps(
                {"frames": {}, "schemaVersion": 1, "updatedAt": None}, indent=2
            )
            + "\n",
            encoding="utf-8",
        )
    print(MANIFEST_PATH)
    print(LABELS_PATH)


# script entry point
def main() -> None:
    args = parse_args()
    capture_frames(args.replace)


# cli guard
if __name__ == "__main__":
    main()
