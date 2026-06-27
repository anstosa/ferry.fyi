#!/usr/bin/env python3
from __future__ import annotations

from collections import deque
import json
import re
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from PIL import Image

BASE_URL = "https://wsdot.com/ferries/vesselwatch/"
VESSELS_URL = urljoin(BASE_URL, "Vessels.aspx")
OUT_DIR = Path("client/static/images/vessels")
META_JSON = Path("client/lib/generated/vessel-assets.json")
META_TS = Path("client/lib/generated/vesselAssets.ts")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 ferry.fyi asset generator"})


# slug helper
def slugify(input: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", input.lower()).strip("-")


# page fetch helper
def read_page(url: str) -> BeautifulSoup:
    response = SESSION.get(url, timeout=30)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


# vessel list parser
def parse_vessel_list() -> list[dict[str, str]]:
    soup = read_page(VESSELS_URL)
    vessels: list[dict[str, str]] = []
    current_class = None
    table = soup.find("table")
    # table existence guard
    if not table:
        raise RuntimeError("Could not find WSDOT vessel table")
    # class row loop
    for row in table.find_all("tr"):
        image = row.find("img", alt=True)
        # class header guard
        if image:
            current_class = image["alt"].strip()
        # vessel link loop
        for link in row.find_all("a", href=True):
            match = re.search(r"vessel_id=(\d+)", link["href"])
            # vessel link guard
            if not match or not current_class:
                continue
            vessels.append(
                {
                    "className": current_class,
                    "detailUrl": urljoin(VESSELS_URL, link["href"]),
                    "id": match.group(1),
                    "name": link.get_text(" ", strip=True),
                }
            )
    return vessels


# background pixel classifier
def is_background_pixel(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return alpha == 0 or (red >= 235 and green >= 235 and blue >= 235)


# background remover
def remove_background(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    queue: deque[tuple[int, int]] = deque()
    visited: set[tuple[int, int]] = set()
    # horizontal edge loop
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    # vertical edge loop
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
    # edge-connected flood loop
    while queue:
        x, y = queue.popleft()
        # bounds guard
        if x < 0 or y < 0 or x >= width or y >= height:
            continue
        # repeat guard
        if (x, y) in visited:
            continue
        visited.add((x, y))
        # background connection guard
        if not is_background_pixel(pixels[x, y]):
            continue
        pixels[x, y] = (255, 255, 255, 0)
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    bbox = image.getchannel("A").getbbox()
    # crop guard
    if bbox:
        image = image.crop(bbox)
    image.save(destination)


# image fetch helper
def fetch_image(vessel: dict[str, str]) -> str:
    soup = read_page(vessel["detailUrl"])
    image = soup.find("img", id="cphPageTemplate_imgVesselDrawing")
    # detail image guard
    if not image or not image.get("src"):
        raise RuntimeError(f"Could not find image for {vessel['name']}")
    image_url = urljoin(vessel["detailUrl"], image["src"])
    source_extension = Path(image_url).suffix or ".gif"
    source_path = OUT_DIR / f"{vessel['id']}-{slugify(vessel['name'])}{source_extension}"
    output_path = OUT_DIR / f"{vessel['id']}-{slugify(vessel['name'])}.png"
    response = SESSION.get(image_url, timeout=30)
    response.raise_for_status()
    source_path.write_bytes(response.content)
    remove_background(source_path, output_path)
    source_path.unlink(missing_ok=True)
    return f"/static/images/vessels/{output_path.name}"


# TypeScript string helper
def ts_string(value: str) -> str:
    return json.dumps(value)


# TypeScript metadata renderer
def render_typescript_metadata(entries: dict[str, dict[str, str]]) -> str:
    lines = [
        "export interface VesselAsset {",
        "  className: string;",
        "  image: string;",
        "  name: string;",
        "  sourceUrl: string;",
        "}",
        "",
        "export const vesselAssets: Record<string, VesselAsset> = {",
    ]
    # vessel metadata loop
    for vessel_id, entry in entries.items():
        lines.extend(
            [
                f'  {ts_string(vessel_id)}: {{',
                f'    className: {ts_string(entry["className"])},',
                f'    image: {ts_string(entry["image"])},',
                f'    name: {ts_string(entry["name"])},',
                "    sourceUrl:",
                f'      {ts_string(entry["sourceUrl"])},',
                "  },",
            ]
        )
    lines.extend(["} as const;", ""])
    return "\n".join(lines)


# metadata writer
def write_metadata(vessels: list[dict[str, str]]) -> None:
    entries = {
        vessel["id"]: {
            "className": vessel["className"],
            "image": vessel["image"],
            "name": vessel["name"],
            "sourceUrl": vessel["detailUrl"],
        }
        for vessel in vessels
    }
    META_JSON.write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n")
    META_TS.write_text(render_typescript_metadata(entries))


# script entrypoint
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    META_JSON.parent.mkdir(parents=True, exist_ok=True)
    vessels = parse_vessel_list()
    # asset generation loop
    for vessel in vessels:
        vessel["image"] = fetch_image(vessel)
    write_metadata(vessels)
    print(f"Wrote {len(vessels)} vessel assets")


# direct execution guard
if __name__ == "__main__":
    main()
