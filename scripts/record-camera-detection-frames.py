#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
CAMERA_CONFIG_PATH = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
CAPTURE_ROOT = REPO_ROOT / "benchmarks" / "camera-detection" / "captures"
DEFAULT_INTERVAL_SECONDS = 600
DEFAULT_MINIMUM_FREE_GIB = 2.0


# parse a positive integer
def positive_integer(value: str) -> int:
    parsed = int(value)
    # positive value guard
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be greater than zero")
    return parsed


# parse a positive float
def positive_float(value: str) -> float:
    parsed = float(value)
    # positive value guard
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be greater than zero")
    return parsed


# parse an aware timestamp
def aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    # timezone guard
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include a timezone")
    return parsed


# parse command arguments
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Record enabled camera frames for occupancy benchmarking."
    )
    parser.add_argument(
        "--camera-config",
        type=Path,
        default=CAMERA_CONFIG_PATH,
        help="Camera detection configuration path.",
    )
    parser.add_argument(
        "--camera-id",
        action="append",
        dest="camera_ids",
        help="Capture only this eligible camera id. Repeat for multiple cameras.",
    )
    parser.add_argument(
        "--image-limit",
        type=positive_integer,
        help="Maximum capture rounds per selected camera.",
    )
    parser.add_argument(
        "--interval-seconds",
        type=positive_integer,
        default=DEFAULT_INTERVAL_SECONDS,
        help="Seconds between capture rounds.",
    )
    parser.add_argument(
        "--minimum-free-gib",
        type=positive_float,
        default=DEFAULT_MINIMUM_FREE_GIB,
        help="Stop before available disk space falls below this value.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Capture one round and exit.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Session output directory.",
    )
    parser.add_argument(
        "--request-timeout",
        type=positive_integer,
        default=30,
        help="Per-camera HTTP timeout in seconds.",
    )
    parser.add_argument(
        "--session-id",
        default=f"capture-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        help="Stable capture session identifier.",
    )
    parser.add_argument(
        "--stop-at",
        type=aware_datetime,
        help="Timezone-aware timestamp when recording must stop.",
    )
    args = parser.parse_args()
    # bounded-run guard
    if not args.once and args.stop_at is None and args.image_limit is None:
        parser.error("--stop-at or --image-limit is required unless --once is used")
    # output default
    if args.output_dir is None:
        args.output_dir = CAPTURE_ROOT / args.session_id
    return args


# add a source cache buster
def fresh_image_url(image_url: str, captured_at: str) -> str:
    split = urlsplit(image_url)
    query = dict(parse_qsl(split.query, keep_blank_values=True))
    query["capture"] = captured_at
    return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), ""))


# validate image bytes
def validate_image(body: bytes, content_type: str) -> None:
    # jpeg response guard
    if content_type == "image/jpeg" and body.startswith(b"\xff\xd8\xff"):
        return
    # png response guard
    if content_type == "image/png" and body.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    raise RuntimeError(f"Unexpected or invalid image response: {content_type}")


# download one camera frame
def fetch_frame(image_url: str, captured_at: str, timeout: int) -> tuple[bytes, str]:
    request = Request(
        fresh_image_url(image_url, captured_at),
        headers={"User-Agent": "FerryFYI-CameraDataset/1.0"},
    )
    # source response scope
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get_content_type()
        body = response.read()
    validate_image(body, content_type)
    return body, content_type


# map image content type to suffix
def image_suffix(content_type: str) -> str:
    # png response guard
    if content_type == "image/png":
        return ".png"
    return ".jpg"


# select enabled reviewed cameras
def enabled_cameras(
    camera_config: dict, requested_camera_ids: list[str] | None = None
) -> list[tuple[str, dict]]:
    selected = []
    requested = set(requested_camera_ids or [])
    # configured camera pass
    for camera_id in camera_config.get("cameraIds", []):
        camera = camera_config.get("cameras", {}).get(camera_id)
        # requested camera guard
        if requested and camera_id not in requested:
            continue
        # active camera guard
        if (
            camera
            and camera.get("reviewed") is True
            and camera.get("detectionEnabled") is not False
            and len(camera.get("allowedAreas", [])) > 0
        ):
            selected.append((camera_id, camera))
    selected_ids = {camera_id for camera_id, _camera in selected}
    missing_ids = requested - selected_ids
    # eligible selection guard
    if missing_ids:
        raise RuntimeError(
            f"Requested cameras are not enabled and reviewed: {', '.join(sorted(missing_ids))}"
        )
    # selection guard
    if not selected:
        raise RuntimeError("No enabled reviewed cameras with allowed areas were found")
    return selected


# append one durable manifest row
def append_manifest_record(manifest_path: Path, record: dict) -> None:
    with manifest_path.open("a", encoding="utf-8") as manifest_file:
        manifest_file.write(json.dumps(record, separators=(",", ":")) + "\n")
        manifest_file.flush()
        os.fsync(manifest_file.fileno())


# write one atomic JSON document
def write_json(path: Path, value: dict) -> None:
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(path)


# rebuild stored-frame deduplication state
def load_seen_frames(manifest_path: Path) -> dict[tuple[str, str], str]:
    seen = {}
    # missing manifest guard
    if not manifest_path.exists():
        return seen
    # manifest recovery pass
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        # blank row guard
        if not line.strip():
            continue
        record = json.loads(line)
        # stored frame guard
        if record.get("status") == "stored":
            seen[(record["cameraId"], record["sha256"])] = record["file"]
    return seen


# enforce the disk floor
def require_disk_space(output_dir: Path, minimum_free_gib: float) -> None:
    free_bytes = shutil.disk_usage(output_dir).free
    minimum_free_bytes = int(minimum_free_gib * 1024**3)
    # disk floor guard
    if free_bytes < minimum_free_bytes:
        raise RuntimeError(
            f"Available disk space fell below {minimum_free_gib:.2f} GiB"
        )


# capture one camera round
def capture_round(
    cameras: list[tuple[str, dict]],
    frames_dir: Path,
    manifest_path: Path,
    seen_frames: dict[tuple[str, str], str],
    request_timeout: int,
) -> dict[str, int | str]:
    captured_at = datetime.now(timezone.utc).replace(microsecond=0)
    captured_at_text = captured_at.isoformat()
    file_timestamp = captured_at.strftime("%Y%m%dT%H%M%SZ")
    stored = 0
    duplicates = 0
    failures = 0
    # camera capture pass
    for camera_id, camera in cameras:
        base_record = {
            "cameraId": camera_id,
            "cameraName": camera.get("displayName") or camera.get("title") or camera_id,
            "capturedAt": captured_at_text,
            "frameSize": camera.get("frameSize"),
            "sourceImageUrl": camera["imageUrl"],
        }
        try:
            body, content_type = fetch_frame(
                camera["imageUrl"], captured_at_text, request_timeout
            )
            digest = hashlib.sha256(body).hexdigest()
            previous_file = seen_frames.get((camera_id, digest))
            # duplicate frame guard
            if previous_file:
                append_manifest_record(
                    manifest_path,
                    {
                        **base_record,
                        "contentType": content_type,
                        "duplicateOf": previous_file,
                        "sha256": digest,
                        "status": "duplicate",
                    },
                )
                duplicates += 1
                continue
            file_name = f"{file_timestamp}-camera-{camera_id}{image_suffix(content_type)}"
            frame_path = frames_dir / file_name
            frame_path.write_bytes(body)
            relative_file = f"frames/{file_name}"
            seen_frames[(camera_id, digest)] = relative_file
            append_manifest_record(
                manifest_path,
                {
                    **base_record,
                    "contentType": content_type,
                    "file": relative_file,
                    "sha256": digest,
                    "status": "stored",
                },
            )
            stored += 1
            print(f"stored {camera_id} {frame_path}", flush=True)
        except Exception as error:
            append_manifest_record(
                manifest_path,
                {
                    **base_record,
                    "error": str(error),
                    "status": "error",
                },
            )
            failures += 1
            print(f"error {camera_id} {error}", flush=True)
    return {
        "capturedAt": captured_at_text,
        "duplicates": duplicates,
        "failures": failures,
        "stored": stored,
    }


# initialize or resume session state
def load_session(
    session_path: Path,
    session_id: str,
    cameras: list[tuple[str, dict]],
    interval_seconds: int,
    image_limit: int | None,
    stop_at: datetime | None,
) -> dict:
    # resume guard
    if session_path.exists():
        session = json.loads(session_path.read_text(encoding="utf-8"))
        # session identity guard
        if session.get("sessionId") != session_id:
            raise RuntimeError("Existing session identifier does not match")
        return session
    return {
        "cameraIds": [camera_id for camera_id, _camera in cameras],
        "captureAttempts": 0,
        "duplicateFrames": 0,
        "failedFrames": 0,
        "intervalSeconds": interval_seconds,
        "imageLimit": image_limit,
        "lastCapturedAt": None,
        "roundsCompleted": 0,
        "schemaVersion": 1,
        "sessionId": session_id,
        "processId": os.getpid(),
        "startedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": "running",
        "stopAt": stop_at.isoformat() if stop_at else None,
        "storedFrames": 0,
    }


# record bounded camera rounds
def record_frames(args: argparse.Namespace) -> None:
    output_dir = args.output_dir.resolve()
    frames_dir = output_dir / "frames"
    manifest_path = output_dir / "manifest.jsonl"
    session_path = output_dir / "session.json"
    lock_path = output_dir / ".capture.lock"
    frames_dir.mkdir(parents=True, exist_ok=True)
    camera_config = json.loads(args.camera_config.read_text(encoding="utf-8"))
    cameras = enabled_cameras(camera_config, args.camera_ids)
    seen_frames = load_seen_frames(manifest_path)
    session = load_session(
        session_path,
        args.session_id,
        cameras,
        args.interval_seconds,
        args.image_limit,
        args.stop_at,
    )
    # exclusive session scope
    with lock_path.open("w", encoding="utf-8") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError(f"Capture session is already running: {output_dir}") from error
        try:
            session["status"] = "running"
            write_json(session_path, session)
            next_round_at = time.monotonic()
            stop_path = output_dir / ".stop-requested"
            # bounded capture loop
            while True:
                now = datetime.now(timezone.utc)
                # manual stop guard
                if stop_path.exists():
                    break
                # stop timestamp guard
                if args.stop_at and now >= args.stop_at.astimezone(timezone.utc):
                    break
                # image limit guard
                if args.image_limit and session["roundsCompleted"] >= args.image_limit:
                    break
                require_disk_space(output_dir, args.minimum_free_gib)
                result = capture_round(
                    cameras,
                    frames_dir,
                    manifest_path,
                    seen_frames,
                    args.request_timeout,
                )
                session["captureAttempts"] += len(cameras)
                session["duplicateFrames"] += result["duplicates"]
                session["failedFrames"] += result["failures"]
                session["lastCapturedAt"] = result["capturedAt"]
                session["roundsCompleted"] += 1
                session["storedFrames"] += result["stored"]
                write_json(session_path, session)
                # one-shot guard
                if args.once:
                    break
                next_round_at += args.interval_seconds
                sleep_seconds = max(0.0, next_round_at - time.monotonic())
                # final stop clamp
                if args.stop_at:
                    remaining_seconds = (
                        args.stop_at.astimezone(timezone.utc) - datetime.now(timezone.utc)
                    ).total_seconds()
                    # completed window guard
                    if remaining_seconds <= 0:
                        break
                    sleep_seconds = min(sleep_seconds, remaining_seconds)
                # responsive sleep loop
                while sleep_seconds > 0 and not stop_path.exists():
                    sleep_step = min(1.0, sleep_seconds)
                    time.sleep(sleep_step)
                    sleep_seconds -= sleep_step
            session["status"] = "stopped" if stop_path.exists() else "completed"
        except Exception as error:
            session["error"] = str(error)
            session["status"] = "failed"
            raise
        finally:
            session["completedAt"] = (
                datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            )
            write_json(session_path, session)
    print(session_path, flush=True)


# script entry point
def main() -> None:
    args = parse_args()
    record_frames(args)


# cli guard
if __name__ == "__main__":
    main()
