#!/usr/bin/env python3
import argparse
import io
import json
import textwrap
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "docs" / "camera-line-detection-results"
INCLUDE_COLOR = (34, 197, 94, 105)
EXCLUDE_COLOR = (239, 68, 68, 95)
INCLUDED_DETECTION_COLOR = (22, 163, 74, 255)
TEXT_COLOR = (255, 255, 255, 255)
TEXT_OUTLINE = (2, 6, 23, 255)
PANEL_BG = (15, 23, 42, 255)


# load default font
def get_font(size: int) -> ImageFont.ImageFont:
    # truetype guard
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


TITLE_FONT = get_font(16)
LABEL_FONT = get_font(10)
SMALL_FONT = get_font(11)
TINY_FONT = get_font(9)


# parse cli arguments
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render QA overlays for camera line detection results."
    )
    parser.add_argument(
        "--api-url",
        help="Line detection API URL, for example http://localhost:4040/api/cameras/line-detection",
    )
    parser.add_argument(
        "--results-json",
        type=Path,
        help="Existing line detection JSON response with includeDetections=true",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for QA overlays",
    )
    parser.add_argument(
        "--camera-id",
        action="append",
        dest="camera_ids",
        help="Camera id to render; repeat to render several",
    )
    return parser.parse_args()


# fetch one camera frame
def fetch_image(url: str) -> Image.Image:
    request = urllib.request.Request(url, headers={"User-Agent": "ferry.fyi-qa"})
    # request guard
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
    return Image.open(io.BytesIO(body)).convert("RGB")


# unwrap API test wrappers
def unwrap_results_response(response: dict[str, Any]) -> dict[str, Any]:
    body = response.get("body")
    # body guard
    if isinstance(body, dict):
        return body
    return response


# fetch line detection results
def fetch_results(api_url: str, camera_ids: list[str]) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"ids": ",".join(camera_ids), "includeDetections": "true"}
    )
    separator = "&" if "?" in api_url else "?"
    request_url = f"{api_url}{separator}{query}"
    request = urllib.request.Request(request_url, headers={"Accept": "application/json"})
    # request guard
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


# build no-detector result stubs
def build_unavailable_results(camera_ids: list[str], data: dict[str, Any]) -> dict[str, Any]:
    results: dict[str, Any] = {}
    # camera result pass
    for camera_id in camera_ids:
        camera = data["cameras"][camera_id]
        results[camera_id] = {
            "areaCounts": [
                {
                    "areaId": area["id"],
                    "label": area["label"],
                    "type": area["type"],
                    "vehicleCount": 0,
                }
                for area in camera.get("allowedAreas", [])
            ],
            "cameraId": camera_id,
            "checkedAt": 0,
            "detectionCount": 0,
            "detections": [],
            "error": "No line detection result source configured",
            "excludedDetectionCount": 0,
            "imageUrl": camera["imageUrl"],
            "includedDetectionCount": 0,
            "reviewed": camera.get("reviewed", False),
        }
    return results


# denormalize one point
def denormalize_point(point: list[float], width: int, height: int) -> tuple[int, int]:
    return round(point[0] * width), round(point[1] * height)


# denormalize polygon coordinates
def denormalize_polygon(
    points: list[list[float]], width: int, height: int
) -> list[tuple[int, int]]:
    # point conversion
    return [denormalize_point(point, width, height) for point in points]


# build polygon bounds
def polygon_bounds(points: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


# calculate candidate label point
def label_anchor(points: list[tuple[int, int]]) -> tuple[int, int]:
    min_x, min_y, max_x, max_y = polygon_bounds(points)
    return round((min_x + max_x) / 2), round((min_y + max_y) / 2)


# draw outlined text
def draw_text(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int] = TEXT_COLOR,
) -> None:
    x, y = position
    # outline pass
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        draw.text((x + dx, y + dy), text, font=font, fill=TEXT_OUTLINE)
    draw.text((x, y), text, font=font, fill=fill)


# draw one polygon area
def draw_area(
    draw: ImageDraw.ImageDraw,
    area: dict[str, Any],
    width: int,
    height: int,
    color: tuple[int, int, int, int],
    count_lookup: dict[str, int],
) -> None:
    points = denormalize_polygon(area["polygon"], width, height)
    draw.polygon(points, fill=color, outline=color[:3], width=2)
    anchor = label_anchor(points)
    count = count_lookup.get(area["id"])
    suffix = f" ({count})" if count is not None else ""
    label = textwrap.shorten(f"{area.get('label') or area['id']}{suffix}", width=34)
    draw_text(draw, anchor, label, LABEL_FONT)


# draw one detection box
def draw_detection(
    draw: ImageDraw.ImageDraw,
    detection: dict[str, Any],
    width: int,
    height: int,
) -> None:
    box = detection["box"]
    x1 = round(box["x"] * width)
    y1 = round(box["y"] * height)
    x2 = round((box["x"] + box["width"]) * width)
    y2 = round((box["y"] + box["height"]) * height)
    color = INCLUDED_DETECTION_COLOR
    draw.rectangle((x1, y1, x2, y2), outline=color, width=2)
    center = detection.get("center")
    # center guard
    if center:
        cx, cy = denormalize_point(center, width, height)
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=color)
    label = textwrap.shorten(
        f"{detection.get('label', 'vehicle')} {detection.get('confidence', 0):.2f}",
        width=38,
    )
    draw_text(draw, (x1 + 2, max(0, y1 - 12)), label, TINY_FONT, color)


# draw legend panel
def draw_legend(draw: ImageDraw.ImageDraw, y: int) -> None:
    items = [
        (INCLUDED_DETECTION_COLOR, "included vehicle"),
    ]
    x = 10
    # legend item pass
    for color, label in items:
        draw.rectangle((x, y, x + 10, y + 10), fill=color)
        draw.text((x + 14, y - 1), label, font=SMALL_FONT, fill=TEXT_COLOR)
        x += 150


# draw one camera result overlay
def render_camera_result(
    camera_id: str,
    camera: dict[str, Any],
    result: dict[str, Any],
) -> Image.Image:
    image = fetch_image(camera["imageUrl"])
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = image.size
    count_lookup = {
        area["areaId"]: area.get("vehicleCount", 0)
        for area in result.get("areaCounts", [])
    }
    # include area pass
    for area in camera.get("allowedAreas", []):
        draw_area(draw, area, width, height, INCLUDE_COLOR, count_lookup)
    # exclusion area pass
    for area in camera.get("excludedAreas", []):
        draw_area(draw, area, width, height, EXCLUDE_COLOR, {})
    # countable detection pass
    for detection in result.get("detections", []):
        # inclusion guard
        if detection.get("disposition") != "included":
            continue
        draw_detection(draw, detection, width, height)
    combined = Image.alpha_composite(image.convert("RGBA"), overlay)
    title_height = 76
    canvas = Image.new(
        "RGBA",
        (combined.width, combined.height + title_height),
        PANEL_BG,
    )
    canvas.alpha_composite(combined, (0, title_height))
    title_draw = ImageDraw.Draw(canvas)
    draw_text(title_draw, (10, 6), f"{camera_id} — {camera['terminal']}", TITLE_FONT)
    summary = (
        f"detected {result.get('detectionCount', 0)} | "
        f"included {result.get('includedDetectionCount', 0)} | "
        f"excluded {result.get('excludedDetectionCount', 0)}"
    )
    draw_text(title_draw, (10, 28), summary, SMALL_FONT)
    error = result.get("error")
    # error guard
    if error:
        draw_text(title_draw, (10, 48), textwrap.shorten(error, width=86), SMALL_FONT)
    else:
        draw_legend(title_draw, 51)
    return canvas.convert("RGB")


# compose contact sheet
def build_contact_sheet(images: list[tuple[str, Image.Image]]) -> Image.Image:
    thumb_width = 420
    padding = 16
    columns = 2
    thumbs: list[tuple[str, Image.Image]] = []
    # thumbnail pass
    for camera_id, image in images:
        thumb = image.copy()
        thumb.thumbnail((thumb_width, 380))
        thumbs.append((camera_id, thumb))
    rows = (len(thumbs) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_width + (columns + 1) * padding, rows * 410 + padding),
        PANEL_BG[:3],
    )
    # paste pass
    for index, (_, thumb) in enumerate(thumbs):
        column = index % columns
        row = index // columns
        x = padding + column * (thumb_width + padding)
        y = padding + row * 410
        sheet.paste(thumb, (x, y))
    return sheet


# script entry point
def main() -> None:
    args = parse_args()
    data = json.loads(DATA_PATH.read_text())
    reviewed_with_areas = [
        camera_id
        for camera_id in data.get("reviewedCameraIds", [])
        if data["cameras"][camera_id].get("allowedAreas")
    ]
    camera_ids = args.camera_ids or reviewed_with_areas
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # results source selection
    if args.results_json:
        results = unwrap_results_response(json.loads(args.results_json.read_text()))
    elif args.api_url:
        results = unwrap_results_response(fetch_results(args.api_url, camera_ids))
    else:
        results = build_unavailable_results(camera_ids, data)
    results_path = args.output_dir / "latest-line-detection-results.json"
    results_path.write_text(json.dumps(results, indent=2, sort_keys=True))
    print(results_path)
    rendered: list[tuple[str, Image.Image]] = []
    # camera render pass
    for camera_id in camera_ids:
        camera = data["cameras"][camera_id]
        result = results.get(camera_id) or build_unavailable_results([camera_id], data)[
            camera_id
        ]
        image = render_camera_result(camera_id, camera, result)
        output_path = args.output_dir / f"camera-{camera_id}-line-detection.png"
        image.save(output_path)
        rendered.append((camera_id, image))
        print(output_path)
    # contact sheet guard
    if rendered:
        contact_sheet = build_contact_sheet(rendered)
        contact_path = args.output_dir / "contact-sheet.png"
        contact_sheet.save(contact_path)
        print(contact_path)


# cli guard
if __name__ == "__main__":
    main()
