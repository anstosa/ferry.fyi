"""Native-scale camera image preprocessing for vision-model requests."""

from __future__ import annotations

import base64
import colorsys
import hashlib
import io
import json
import math
from dataclasses import dataclass
from operator import attrgetter

from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageFilter,
    PngImagePlugin,
    UnidentifiedImageError,
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
_FINGERPRINT_VERSION = "ferry-fyi-camera-fingerprint-v1"


# normalized annotated area
@dataclass(frozen=True, kw_only=True, slots=True)
class CameraArea:
    area_id: str
    label: str
    polygon: tuple[tuple[float, float], ...]


# validated preprocessing configuration
@dataclass(frozen=True, kw_only=True, slots=True)
class CameraAreas:
    allowed: tuple[CameraArea, ...]
    excluded: tuple[CameraArea, ...]
    frame_size: tuple[int, int] | None


# serialized preprocessing response
@dataclass(frozen=True, kw_only=True, slots=True)
class PreparedCameraImage:
    image_base64: str
    fingerprint: str
    width: int
    height: int
    source_width: int
    source_height: int
    rotation_degrees: float
    lane_ids: tuple[str, ...]

    # response conversion
    def as_dict(self) -> dict[str, object]:
        return {
            "imageBase64": self.image_base64,
            "fingerprint": self.fingerprint,
            "width": self.width,
            "height": self.height,
            "sourceWidth": self.source_width,
            "sourceHeight": self.source_height,
            "rotationDegrees": self.rotation_degrees,
            "laneIds": list(self.lane_ids),
        }


# request validation error
class CameraPreparationError(ValueError):
    # error setup
    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# require a non-empty bounded identifier
def _parse_identifier(value: object, field_name: str) -> str:
    # string guard
    if not isinstance(value, str) or not value.strip():
        raise CameraPreparationError(f"{field_name} must be a non-empty string")
    identifier = value.strip()
    # size guard
    if len(identifier) > 256:
        raise CameraPreparationError(f"{field_name} must be at most 256 characters")
    return identifier


# validate one normalized polygon
def _parse_polygon(value: object) -> tuple[tuple[float, float], ...]:
    # collection guard
    if not isinstance(value, list) or len(value) < 3:
        raise CameraPreparationError("polygons must contain at least three points")
    points: list[tuple[float, float]] = []
    # point validation
    for point in value:
        # point shape guard
        if not isinstance(point, list) or len(point) != 2:
            raise CameraPreparationError("polygon points must be numeric [x, y] pairs")
        x_value, y_value = point
        # numeric guard
        if (
            isinstance(x_value, bool)
            or isinstance(y_value, bool)
            or not isinstance(x_value, (int, float))
            or not isinstance(y_value, (int, float))
        ):
            raise CameraPreparationError("polygon points must be numeric [x, y] pairs")
        x = float(x_value)
        y = float(y_value)
        # finite guard
        if not math.isfinite(x) or not math.isfinite(y):
            raise CameraPreparationError("polygon points must be finite")
        # normalized guard
        if x < 0.0 or x > 1.0 or y < 0.0 or y > 1.0:
            raise CameraPreparationError(
                "polygon points must be normalized between 0 and 1"
            )
        points.append((x, y))
    # distinct-point guard
    if len(set(points)) < 3:
        raise CameraPreparationError(
            "polygons must contain at least three distinct points"
        )
    signed_twice_area = 0.0
    # polygon-area scan
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        signed_twice_area += (point[0] * next_point[1]) - (next_point[0] * point[1])
    # nonzero-area guard
    if math.isclose(signed_twice_area, 0.0, abs_tol=1e-12):
        raise CameraPreparationError("polygons must enclose a nonzero area")
    return tuple(points)


# parse one annotated area
def _parse_area(value: object, field_name: str, require_identity: bool) -> CameraArea:
    # object guard
    if not isinstance(value, dict):
        raise CameraPreparationError(f"{field_name} entries must be objects")
    raw_id = value.get("id")
    raw_label = value.get("label", raw_id)
    # allowed identity guard
    if require_identity:
        area_id = _parse_identifier(raw_id, f"{field_name} id")
        label = _parse_identifier(raw_label, f"{field_name} label")
    else:
        # optional exclusion identity
        area_id = str(raw_id).strip() if isinstance(raw_id, str) else ""
        # optional exclusion label
        label = str(raw_label).strip() if isinstance(raw_label, str) else area_id
    polygon = _parse_polygon(value.get("polygon"))
    return CameraArea(area_id=area_id, label=label, polygon=polygon)


# parse the detection-area header
def parse_camera_areas(header: str | None) -> CameraAreas:
    # required-header guard
    if header is None:
        raise CameraPreparationError("X-Detection-Areas header is required")
    # json guard
    try:
        payload = json.loads(header)
    except json.JSONDecodeError as error:
        raise CameraPreparationError(
            f"invalid X-Detection-Areas header: {error.msg}"
        ) from error
    # object guard
    if not isinstance(payload, dict):
        raise CameraPreparationError(
            "invalid X-Detection-Areas header: expected an object"
        )
    allowed_values = payload.get("allowedAreas")
    excluded_values = payload.get("excludedAreas", [])
    # collection guard
    if not isinstance(allowed_values, list) or not isinstance(excluded_values, list):
        raise CameraPreparationError("detection areas must be arrays")
    # allowed-area guard
    if not allowed_values:
        raise CameraPreparationError("at least one allowed area is required")
    allowed: list[CameraArea] = []
    # allowed-area parse
    for value in allowed_values:
        allowed.append(_parse_area(value, "allowedAreas", require_identity=True))
    excluded: list[CameraArea] = []
    # excluded-area parse
    for value in excluded_values:
        excluded.append(_parse_area(value, "excludedAreas", require_identity=False))
    # allowed-id inventory
    allowed_ids = [area.area_id for area in allowed]
    # duplicate-id guard
    if len(set(allowed_ids)) != len(allowed_ids):
        raise CameraPreparationError("allowed area ids must be unique")
    raw_frame_size = payload.get("frameSize")
    frame_size: tuple[int, int] | None = None
    # optional-frame validation
    if raw_frame_size is not None:
        # frame object guard
        if not isinstance(raw_frame_size, dict):
            raise CameraPreparationError("frameSize must be an object")
        frame_width = raw_frame_size.get("width")
        frame_height = raw_frame_size.get("height")
        # positive-integer guard
        if (
            isinstance(frame_width, bool)
            or isinstance(frame_height, bool)
            or not isinstance(frame_width, int)
            or not isinstance(frame_height, int)
            or frame_width <= 0
            or frame_height <= 0
        ):
            raise CameraPreparationError(
                "frameSize width and height must be positive integers"
            )
        frame_size = (frame_width, frame_height)
    return CameraAreas(
        allowed=tuple(allowed), excluded=tuple(excluded), frame_size=frame_size
    )


# decode image bytes safely
def _decode_image(image_bytes: bytes) -> Image.Image:
    # empty-body guard
    if not image_bytes:
        raise CameraPreparationError("request body must contain image bytes")
    # encoded-size guard
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise CameraPreparationError(
            "request image exceeds the 10 MiB limit",
            status_code=413,
        )
    # image-decode guard
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise CameraPreparationError("request body is not a supported image") from error
    width, height = image.size
    # decoded-size guard
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise CameraPreparationError(
            "decoded image dimensions are unsupported", status_code=413
        )
    # pixel-decode guard
    try:
        image.load()
    except (OSError, ValueError) as error:
        raise CameraPreparationError("request body is not a supported image") from error
    return image.convert("RGB")


# convert normalized polygon points to source pixels
def _pixel_polygon(area: CameraArea, width: int, height: int) -> list[tuple[int, int]]:
    # normalized conversion
    return [(round(x * width), round(y * height)) for x, y in area.polygon]


# render one polygon collection into a mask
def _render_area_mask(
    size: tuple[int, int],
    areas: tuple[CameraArea, ...],
    excluded: tuple[CameraArea, ...],
) -> Image.Image:
    mask = Image.new("L", size, color=0)
    draw = ImageDraw.Draw(mask)
    width, height = size
    # inclusion pass
    for area in areas:
        draw.polygon(_pixel_polygon(area, width, height), fill=255)
    # exclusion pass
    for area in excluded:
        draw.polygon(_pixel_polygon(area, width, height), fill=0)
    return mask


# calculate the convex hull of mask pixel-square corners
def _mask_convex_hull(mask: Image.Image) -> list[tuple[int, int]]:
    width, height = mask.size
    pixels = mask.load()
    boundary_points: set[tuple[int, int]] = set()
    # row extrema scan
    for y in range(height):
        left: int | None = None
        right: int | None = None
        # selected-pixel scan
        for x in range(width):
            # selected-pixel branch
            if pixels[x, y]:
                # first-pixel branch
                if left is None:
                    left = x
                right = x
        # empty-row branch
        if left is None or right is None:
            continue
        boundary_points.update(
            {
                (left, y),
                (left, y + 1),
                (right + 1, y),
                (right + 1, y + 1),
            }
        )
    points = sorted(boundary_points)
    # degenerate guard
    if len(points) <= 1:
        return points

    # turn direction
    def cross(
        origin: tuple[int, int],
        first: tuple[int, int],
        second: tuple[int, int],
    ) -> int:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (
            first[1] - origin[1]
        ) * (second[0] - origin[0])

    lower: list[tuple[int, int]] = []
    # lower-hull pass
    for point in points:
        # remove clockwise turns
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[int, int]] = []
    # upper-hull pass
    for point in reversed(points):
        # remove clockwise turns
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


# normalize equivalent rectangle rotations
def _normalize_rotation(angle: float) -> float:
    normalized = ((angle + 45.0) % 90.0) - 45.0
    # negative-zero guard
    if math.isclose(normalized, 0.0, abs_tol=1e-10):
        return 0.0
    return normalized


# find the minimum-area native-scale mask rotation
def _minimum_area_rotation(
    mask: Image.Image,
) -> tuple[float, tuple[int, int, int, int]]:
    hull = _mask_convex_hull(mask)
    candidates = {0.0}
    # hull-edge candidates
    for index, point in enumerate(hull):
        next_point = hull[(index + 1) % len(hull)]
        edge_angle = math.degrees(
            math.atan2(next_point[1] - point[1], next_point[0] - point[0])
        )
        # image-coordinate slopes align under positive pillow rotations
        candidates.add(round(_normalize_rotation(edge_angle), 10))
    best: tuple[int, float, float, tuple[int, int, int, int]] | None = None
    # candidate measurement
    for angle in sorted(candidates):
        rotated_mask = mask.rotate(
            angle,
            resample=Image.Resampling.NEAREST,
            expand=True,
            fillcolor=0,
        )
        bbox = rotated_mask.getbbox()
        # empty-rotation guard
        if bbox is None:
            continue
        area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        candidate = (area, abs(angle), angle, bbox)
        # minimum-area selection
        if best is None or candidate < best:
            best = candidate
    # impossible-mask guard
    if best is None:
        raise CameraPreparationError("allowed areas select no source pixels")
    return best[2], best[3]


# canonicalize polygon identity
def _canonical_polygon(
    polygon: tuple[tuple[float, float], ...],
) -> tuple[tuple[float, float], ...]:
    variants: list[tuple[tuple[float, float], ...]] = []
    orientations = (polygon, tuple(reversed(polygon)))
    # winding pass
    for orientation in orientations:
        # starting-vertex pass
        for offset in range(len(orientation)):
            variants.append(orientation[offset:] + orientation[:offset])
    return min(variants)


# build a canonical countable-pixel fingerprint
def _fingerprint(image: Image.Image, mask: Image.Image, areas: CameraAreas) -> str:
    digest = hashlib.sha256()
    digest.update(_FINGERPRINT_VERSION.encode("ascii"))
    digest.update(image.width.to_bytes(4, "big"))
    digest.update(image.height.to_bytes(4, "big"))
    # label-independent geometry inventory
    canonical_allowed: list[dict[str, object]] = []
    # allowed-area canonicalization
    for area in sorted(areas.allowed, key=attrgetter("area_id")):
        canonical_allowed.append(
            {
                "id": area.area_id,
                "polygon": _canonical_polygon(area.polygon),
            }
        )
    canonical_excluded_polygons: list[tuple[tuple[float, float], ...]] = []
    # excluded-area canonicalization
    for area in areas.excluded:
        canonical_excluded_polygons.append(_canonical_polygon(area.polygon))
    canonical_excluded_polygons.sort()
    canonical_excluded: list[dict[str, object]] = []
    # excluded-area serialization
    for polygon in canonical_excluded_polygons:
        canonical_excluded.append({"polygon": polygon})
    canonical_config = {
        "allowedAreas": canonical_allowed,
        "excludedAreas": canonical_excluded,
    }
    digest.update(
        json.dumps(
            canonical_config,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("ascii")
    )
    digest.update(mask.tobytes())
    masked_image = Image.new("RGB", image.size, color="black")
    masked_image.paste(image, mask=mask)
    digest.update(masked_image.tobytes())
    return digest.hexdigest()


# preserve visible lane identity without covering or resampling target pixels
def _annotate_lanes(
    image: Image.Image,
    combined_mask: Image.Image,
    lane_masks: list[Image.Image],
    areas: tuple[CameraArea, ...],
) -> tuple[Image.Image, list[dict[str, object]]]:
    panel_size = (image.width + 2, image.height + 2)
    # bound padding before allocating a larger native-scale canvas
    if panel_size[0] * panel_size[1] > MAX_IMAGE_PIXELS or max(panel_size) > 20_000:
        raise CameraPreparationError(
            "annotated image dimensions are unsupported", status_code=413
        )
    panel = Image.new("RGB", panel_size, color="black")
    panel.paste(image, (1, 1))
    padded_combined = Image.new("L", panel_size, color=0)
    padded_combined.paste(combined_mask, (1, 1))
    annotations: list[dict[str, object]] = []
    legend_labels: list[str] = []
    needs_coordinates = False
    # reserve a unique outline and legend color for every supplied section
    for index, (area, lane_mask) in enumerate(zip(areas, lane_masks, strict=True)):
        padded_lane = Image.new("L", panel_size, color=0)
        padded_lane.paste(lane_mask, (1, 1))
        lane_bbox = padded_lane.getbbox()
        # a fully excluded section has no reliable image-to-id mapping
        if lane_bbox is None:
            raise CameraPreparationError("lane area selects no countable source pixels")
        color = tuple(
            round(channel * 255)
            for channel in colorsys.hsv_to_rgb(index / len(areas), 0.75, 1)
        )
        outer_edge = ImageChops.subtract(
            padded_lane.filter(ImageFilter.MaxFilter(3)), padded_combined
        )
        panel.paste(Image.new("RGB", panel_size, color=color), mask=outer_edge)
        marker = str(index + 1)
        legend_label = marker
        # interior or overlapping sections need an explicit positional fallback
        if outer_edge.getbbox() is None:
            legend_label += " [" + ",".join(str(value) for value in lane_bbox) + "]"
            needs_coordinates = True
        legend_labels.append(legend_label)
        annotations.append(
            {
                "marker": marker,
                "laneId": area.area_id,
                "label": area.label,
                "colorRgb": color,
                "transformedBounds": lane_bbox,
            }
        )
    measure = ImageDraw.Draw(panel)
    label_bounds = [measure.textbbox((0, 0), label) for label in legend_labels]
    cell_width = max(bounds[2] for bounds in label_bounds) + 16
    cell_height = max(bounds[3] for bounds in label_bounds) + 4
    caption = "bounds [x0,y0,x1,y1]" if needs_coordinates else ""
    caption_bounds = measure.textbbox((0, 0), caption)
    caption_height = caption_bounds[3] + 4 if caption else 0
    width = max(panel.width, cell_width, caption_bounds[2] + 4)
    columns = max(1, min(len(areas), width // cell_width))
    rows = math.ceil(len(areas) / columns)
    height = panel.height + caption_height + rows * cell_height + 4
    # reject annotation amplification rather than downsampling countable pixels
    if width * height > MAX_IMAGE_PIXELS or max(width, height) > 20_000:
        raise CameraPreparationError(
            "annotated image dimensions are unsupported", status_code=413
        )
    annotated = Image.new("RGB", (width, height), color="black")
    annotated.paste(panel)
    draw = ImageDraw.Draw(annotated)
    # explain positional entries only when an outline cannot identify an interior region
    if caption:
        draw.text((2, panel.height + 2), caption, fill="white")
    # every numeric marker is visibly rendered in the non-target legend
    for index, (annotation, legend_label) in enumerate(
        zip(annotations, legend_labels, strict=True)
    ):
        x = (index % columns) * cell_width
        y = panel.height + caption_height + (index // columns) * cell_height + 2
        color = annotation["colorRgb"]
        draw.rectangle((x + 2, y + 2, x + 8, y + 8), fill=color)
        marker_position = (x + 12, y + 2)
        draw.text(marker_position, legend_label, fill=color)
        annotation["markerPosition"] = marker_position
        annotation["legendBounds"] = (x, y, x + cell_width, y + cell_height)
    return annotated, annotations


# encode the prepared PNG with lane identity metadata
def _encode_png(
    image: Image.Image,
    camera_id: str,
    annotations: list[dict[str, object]],
    rotation_degrees: float,
) -> str:
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("cameraId", camera_id)
    metadata.add_text(
        "laneAnnotations",
        json.dumps(annotations, separators=(",", ":"), ensure_ascii=True),
    )
    metadata.add_text("rotationDegrees", str(rotation_degrees))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=metadata, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


# preserve identical native-scale transforms for combined and lane identity masks
def _rotate_crop_mask(
    mask: Image.Image,
    rotation_degrees: float,
    crop_bbox: tuple[int, int, int, int],
) -> Image.Image:
    return mask.rotate(
        rotation_degrees,
        resample=Image.Resampling.NEAREST,
        expand=True,
        fillcolor=0,
    ).crop(crop_bbox)


# prepare one camera image request
def prepare_camera_request(
    image_bytes: bytes,
    detection_areas_header: str | None,
    camera_id_header: str | None,
) -> PreparedCameraImage:
    camera_id = _parse_identifier(camera_id_header, "X-Camera-Id")
    areas = parse_camera_areas(detection_areas_header)
    image = _decode_image(image_bytes)
    source_width, source_height = image.size
    # source-geometry guard
    if areas.frame_size is not None and areas.frame_size != image.size:
        expected_width, expected_height = areas.frame_size
        raise CameraPreparationError(
            "frameSize does not match decoded image dimensions "
            f"({expected_width}x{expected_height} expected, "
            f"{source_width}x{source_height} received)"
        )
    combined_mask = _render_area_mask(image.size, areas.allowed, areas.excluded)
    # empty-selection guard
    if combined_mask.getbbox() is None:
        raise CameraPreparationError("allowed areas select no source pixels")
    fingerprint = _fingerprint(image, combined_mask, areas)
    rotation_degrees, crop_bbox = _minimum_area_rotation(combined_mask)
    masked_source = Image.new("RGB", image.size, color="black")
    masked_source.paste(image, mask=combined_mask)
    rotated_image = masked_source.rotate(
        rotation_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor="black",
    )
    rotated_combined_mask = _rotate_crop_mask(
        combined_mask, rotation_degrees, crop_bbox
    )
    prepared_image = Image.new("RGB", rotated_combined_mask.size, color="black")
    prepared_image.paste(rotated_image.crop(crop_bbox), mask=rotated_combined_mask)
    rotated_lane_masks: list[Image.Image] = []
    # lane-mask transformation
    for area in areas.allowed:
        lane_mask = _render_area_mask(image.size, (area,), areas.excluded)
        rotated_lane_masks.append(
            _rotate_crop_mask(lane_mask, rotation_degrees, crop_bbox)
        )
    prepared_image, annotations = _annotate_lanes(
        prepared_image,
        rotated_combined_mask,
        rotated_lane_masks,
        areas.allowed,
    )
    image_base64 = _encode_png(
        prepared_image,
        camera_id,
        annotations,
        round(rotation_degrees, 6),
    )
    return PreparedCameraImage(
        image_base64=image_base64,
        fingerprint=fingerprint,
        width=prepared_image.width,
        height=prepared_image.height,
        source_width=source_width,
        source_height=source_height,
        rotation_degrees=round(rotation_degrees, 6),
        # stable lane order
        lane_ids=tuple(area.area_id for area in areas.allowed),
    )
