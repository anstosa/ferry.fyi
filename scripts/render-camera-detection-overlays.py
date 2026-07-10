#!/usr/bin/env python3
import io
import json
import textwrap
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = REPO_ROOT / "shared" / "data" / "camera-detection-areas.json"
OUTPUT_DIR = REPO_ROOT / "docs" / "camera-line-detection-overlays"
INCLUDE_COLOR = (34, 197, 94, 190)
EXCLUDE_COLOR = (239, 68, 68, 180)
TEXT_COLOR = (255, 255, 255, 255)
TEXT_OUTLINE = (2, 6, 23, 255)


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


# fetch one camera frame
def fetch_image(url: str) -> Image.Image:
    # request guard
    with urllib.request.urlopen(url, timeout=20) as response:
        body = response.read()
    return Image.open(io.BytesIO(body)).convert("RGB")


# denormalize polygon coordinates
def denormalize(
    points: list[list[float]], width: int, height: int
) -> list[tuple[int, int]]:
    # point conversion
    return [(round(x * width), round(y * height)) for x, y in points]


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
) -> None:
    x, y = position
    # outline pass
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        draw.text((x + dx, y + dy), text, font=font, fill=TEXT_OUTLINE)
    draw.text((x, y), text, font=font, fill=TEXT_COLOR)


# draw one polygon set
def draw_area(
    draw: ImageDraw.ImageDraw,
    area: dict,
    width: int,
    height: int,
    color: tuple[int, int, int, int],
) -> None:
    points = denormalize(area["polygon"], width, height)
    draw.polygon(points, fill=color, outline=color[:3], width=2)
    anchor = label_anchor(points)
    label = textwrap.shorten(area.get("label") or area["id"], width=32)
    draw_text(draw, anchor, label, LABEL_FONT)


# draw one camera overlay
def render_camera(camera_id: str, camera: dict) -> Image.Image:
    image = fetch_image(camera["imageUrl"])
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = image.size
    # include pass
    for area in camera.get("allowedAreas", []):
        draw_area(draw, area, width, height, INCLUDE_COLOR)
    # exclusion pass
    for area in camera.get("excludedAreas", []):
        draw_area(draw, area, width, height, EXCLUDE_COLOR)
    combined = Image.alpha_composite(image.convert("RGBA"), overlay)
    title_height = 52
    canvas = Image.new(
        "RGBA",
        (combined.width, combined.height + title_height),
        (15, 23, 42, 255),
    )
    canvas.alpha_composite(combined, (0, title_height))
    title_draw = ImageDraw.Draw(canvas)
    draw_text(
        title_draw, (10, 6), f"{camera_id} — {camera['terminal']}", TITLE_FONT
    )
    draw_text(title_draw, (10, 28), camera["displayName"], SMALL_FONT)
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
        thumb.thumbnail((thumb_width, 360))
        thumbs.append((camera_id, thumb))
    rows = (len(thumbs) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_width + (columns + 1) * padding, rows * 390 + padding),
        (15, 23, 42),
    )
    # paste pass
    for index, (_, thumb) in enumerate(thumbs):
        column = index % columns
        row = index // columns
        x = padding + column * (thumb_width + padding)
        y = padding + row * 390
        sheet.paste(thumb, (x, y))
    return sheet


# script entry point
def main() -> None:
    data = json.loads(DATA_PATH.read_text())
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[str, Image.Image]] = []
    # reviewed camera pass
    for camera_id in data.get("reviewedCameraIds", []):
        camera = data["cameras"][camera_id]
        # empty camera guard
        if not camera.get("allowedAreas") and not camera.get("excludedAreas"):
            continue
        image = render_camera(camera_id, camera)
        output_path = OUTPUT_DIR / f"camera-{camera_id}-overlay.png"
        image.save(output_path)
        rendered.append((camera_id, image))
        print(output_path)
    # contact sheet guard
    if rendered:
        contact_sheet = build_contact_sheet(rendered)
        contact_path = OUTPUT_DIR / "contact-sheet.png"
        contact_sheet.save(contact_path)
        print(contact_path)


# cli guard
if __name__ == "__main__":
    main()
