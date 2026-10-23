"""camera image preprocessing tests."""

from __future__ import annotations

import base64
import io
import json
import math

import pytest
from app.camera_preprocessing import (
    MAX_IMAGE_BYTES,
    CameraPreparationError,
    prepare_camera_request,
)
from app.main import create_app
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw


# non-loading provider spy
class ProviderSpy:
    # spy setup
    def __init__(self) -> None:
        self.ready_calls = 0
        self.detect_calls = 0

    # provider name
    @property
    def name(self) -> str:
        return "spy"

    # readiness spy
    def ready(self) -> None:
        self.ready_calls += 1

    # detection spy
    def detect(self, image: Image.Image) -> list:
        self.detect_calls += 1
        return []


# encode a synthetic image
def encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


# create canonical request geometry
def area_header(
    *,
    label: str = "lane one",
    frame_size: tuple[int, int] | None = (20, 20),
    polygon: list[list[float]] | None = None,
    excluded: list[dict[str, object]] | None = None,
) -> str:
    # default polygon selection
    selected_polygon = (
        polygon
        if polygon is not None
        else [
            [0.2, 0.2],
            [0.8, 0.2],
            [0.8, 0.8],
            [0.2, 0.8],
        ]
    )
    # default exclusion selection
    selected_excluded = (
        excluded
        if excluded is not None
        else [
            {
                "id": "center-hole",
                "label": "center hole",
                "polygon": [
                    [0.45, 0.45],
                    [0.55, 0.45],
                    [0.55, 0.55],
                    [0.45, 0.55],
                ],
            }
        ]
    )
    payload: dict[str, object] = {
        "allowedAreas": [
            {
                "id": "camera_lane_1_front",
                "label": label,
                "polygon": selected_polygon,
            }
        ],
        "excludedAreas": selected_excluded,
    }
    # optional-frame branch
    if frame_size is not None:
        payload["frameSize"] = {"width": frame_size[0], "height": frame_size[1]}
    return json.dumps(payload)


# decode one preprocessing response image
def decode_prepared_image(image_base64: str) -> Image.Image:
    image = Image.open(io.BytesIO(base64.b64decode(image_base64)))
    image.load()
    return image


# canonical countable-pixel fingerprint behavior
def test_fingerprint_ignores_labels_and_non_countable_pixels() -> None:
    base = Image.new("RGB", (20, 20), color=(20, 30, 40))
    outside_changed = base.copy()
    outside_changed.putpixel((1, 1), (255, 0, 0))
    outside_changed.putpixel((10, 10), (0, 255, 0))

    first = prepare_camera_request(encode_png(base), area_header(), "camera-1")
    changed = prepare_camera_request(
        encode_png(outside_changed),
        area_header(label="renamed lane"),
        "camera-1",
    )

    assert first.fingerprint == changed.fingerprint
    assert first.image_base64 != changed.image_base64


# countable changes invalidate reuse
def test_fingerprint_changes_for_selected_lane_pixels() -> None:
    base = Image.new("RGB", (20, 20), color=(20, 30, 40))
    changed = base.copy()
    changed.putpixel((6, 6), (255, 0, 0))

    first = prepare_camera_request(encode_png(base), area_header(), "camera-1")
    second = prepare_camera_request(encode_png(changed), area_header(), "camera-1")

    assert first.fingerprint != second.fingerprint


# semantic geometry order stays fingerprint-stable
def test_fingerprint_canonicalizes_area_and_polygon_order() -> None:
    image = Image.new("RGB", (20, 20), color=(20, 30, 40))
    left = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.9], [0.1, 0.9]]
    right = [[0.6, 0.1], [0.9, 0.1], [0.9, 0.9], [0.6, 0.9]]
    first_header = json.dumps(
        {
            "frameSize": {"width": 20, "height": 20},
            "allowedAreas": [
                {"id": "left", "label": "left", "polygon": left},
                {"id": "right", "label": "right", "polygon": right},
            ],
            "excludedAreas": [],
        }
    )
    second_header = json.dumps(
        {
            "frameSize": {"width": 20, "height": 20},
            "allowedAreas": [
                {
                    "id": "right",
                    "label": "renamed right",
                    "polygon": list(reversed(right[1:] + right[:1])),
                },
                {
                    "id": "left",
                    "label": "renamed left",
                    "polygon": left[2:] + left[:2],
                },
            ],
            "excludedAreas": [],
        }
    )

    first = prepare_camera_request(encode_png(image), first_header, "camera-1")
    second = prepare_camera_request(encode_png(image), second_header, "camera-1")

    assert first.fingerprint == second.fingerprint


# exclusion holes and outside pixels are blacked out
def test_prepared_png_masks_exclusions_and_preserves_identity_metadata() -> None:
    image = Image.new("RGB", (20, 20), color="white")

    prepared = prepare_camera_request(encode_png(image), area_header(), "camera-1")
    decoded = decode_prepared_image(prepared.image_base64)
    annotations = json.loads(decoded.info["laneAnnotations"])

    assert prepared.source_width == 20
    assert prepared.source_height == 20
    assert decoded.size == (prepared.width, prepared.height)
    assert decoded.info["cameraId"] == "camera-1"
    assert annotations[0]["laneId"] == "camera_lane_1_front"
    assert annotations[0]["marker"] == "1"
    assert annotations[0]["transformedBounds"] is not None
    # rendered color inventory
    colors = {
        color
        for _, color in decoded.getcolors(maxcolors=decoded.width * decoded.height)
    }
    assert (0, 0, 0) in colors
    assert (255, 255, 255) in colors


# diagonal lanes use a deterministic smaller native-scale rectangle
def test_diagonal_lane_rotates_to_smallest_bbox_without_downsampling() -> None:
    image = Image.new("RGB", (100, 100), color="white")
    diagonal = [
        [0.08, 0.12],
        [0.12, 0.08],
        [0.92, 0.88],
        [0.88, 0.92],
    ]
    header = area_header(frame_size=(100, 100), polygon=diagonal, excluded=[])

    first = prepare_camera_request(encode_png(image), header, "diagonal-camera")
    second = prepare_camera_request(encode_png(image), header, "diagonal-camera")

    assert first.rotation_degrees == second.rotation_degrees
    assert (first.width, first.height) == (second.width, second.height)
    assert abs(first.rotation_degrees) == pytest.approx(45.0)
    assert first.width * first.height < 85 * 85
    assert max(first.width, first.height) >= 112
    assert min(first.width, first.height) >= 5


# transformed lane landmarks retain scale and identity around an exclusion
def test_rotated_lane_landmarks_preserve_scale_bounds_and_masking() -> None:
    image = Image.new("RGB", (200, 160), color=(12, 18, 24))
    draw = ImageDraw.Draw(image)
    polygons = [
        [(20, 20), (180, 100), (174, 112), (14, 32)],
        [(20, 60), (180, 140), (174, 152), (14, 72)],
    ]
    landmarks = [
        [
            ((32, 34), (231, 37, 119)),
            ((96, 66), (32, 202, 173)),
            ((160, 98), (153, 91, 31)),
        ],
        [
            ((32, 74), (79, 113, 213)),
            ((96, 106), (217, 173, 53)),
            ((160, 138), (121, 51, 183)),
        ],
    ]
    # paint separate lane content and six distinct interior landmarks
    for polygon, lane_landmarks in zip(polygons, landmarks, strict=True):
        draw.polygon(polygon, fill="white")
        # keep each landmark large enough to retain an interpolation-safe core
        for (x, y), color in lane_landmarks:
            draw.rectangle((x - 4, y - 4, x + 4, y + 4), fill=color)
    excluded_color = (255, 0, 250)
    draw.rectangle((123, 77, 133, 87), fill=excluded_color)
    lane_ids = ["diagonal-front", "diagonal-back"]
    header = json.dumps(
        {
            "frameSize": {"width": 200, "height": 160},
            "allowedAreas": [
                {
                    "id": lane_id,
                    "label": lane_id,
                    "polygon": [[x / 200, y / 160] for x, y in polygon],
                }
                for lane_id, polygon in zip(lane_ids, polygons, strict=True)
            ],
            "excludedAreas": [
                {
                    "id": "excluded-gap",
                    "label": "excluded gap",
                    "polygon": [
                        [123 / 200, 77 / 160],
                        [133 / 200, 77 / 160],
                        [133 / 200, 87 / 160],
                        [123 / 200, 87 / 160],
                    ],
                }
            ],
        }
    )
    prepared = prepare_camera_request(encode_png(image), header, "diagonal-camera")
    decoded = decode_prepared_image(prepared.image_base64)
    annotations = json.loads(decoded.info["laneAnnotations"])
    assert 1 < abs(prepared.rotation_degrees) < 89
    assert prepared.lane_ids == tuple(lane_ids)
    assert excluded_color not in {
        color for _, color in decoded.getcolors(decoded.width * decoded.height)
    }
    transformed_centers = []
    # associate each visible landmark with its lane's public transformed bounds
    for index, (annotation, lane_landmarks) in enumerate(
        zip(annotations, landmarks, strict=True)
    ):
        assert annotation["laneId"] == lane_ids[index]
        assert annotation["marker"] == str(index + 1)
        left, top, right, bottom = annotation["transformedBounds"]
        assert 0 <= left < right <= decoded.width
        assert 0 <= top < bottom <= decoded.height
        centers = []
        # derive public-output landmark centers without production geometry helpers
        for _, color in lane_landmarks:
            pixels = [
                (x, y)
                for y in range(decoded.height)
                for x in range(decoded.width)
                if decoded.getpixel((x, y)) == color
            ]
            assert len(pixels) >= 8
            assert all(left <= x < right and top <= y < bottom for x, y in pixels)
            centers.append(
                (
                    sum(x for x, _ in pixels) / len(pixels),
                    sum(y for _, y in pixels) / len(pixels),
                )
            )
        assert math.dist(centers[0], centers[-1]) == pytest.approx(
            math.dist(lane_landmarks[0][0], lane_landmarks[-1][0]), abs=1.5
        )
        transformed_centers.append(centers)
    first, last = transformed_centers[0][0], transformed_centers[0][-1]
    hole_center = tuple(
        round(a + 0.75 * (b - a)) for a, b in zip(first, last, strict=True)
    )
    assert decoded.getpixel(hole_center) == (0, 0, 0)


# dense sections retain visible unique identities without painting over target pixels
@pytest.mark.parametrize("nested", [False, True])
def test_dense_fourteen_section_crop_keeps_every_marker_visible(nested: bool) -> None:
    image = Image.new("RGB", (280, 48), color=(23, 29, 41))
    areas = []
    # cover the full crop, including cases with interior-only section boundaries
    for index in range(14):
        left = index / 14
        right = (index + 1) / 14
        top, bottom = 0.0, 1.0
        # leave interior masks at least two source pixels from the outer perimeter
        if nested:
            left = (index + 1) / 56 if index else 0.0
            right = 1 - left
            top = left
            bottom = right
        areas.append(
            {
                "id": f"lane-{index + 1}",
                "label": f"lane {index + 1}",
                "polygon": [[left, top], [right, top], [right, bottom], [left, bottom]],
            }
        )
    header = json.dumps({"allowedAreas": areas, "excludedAreas": []})
    prepared = prepare_camera_request(encode_png(image), header, "dense-camera")
    decoded = decode_prepared_image(prepared.image_base64)
    annotations = json.loads(decoded.info["laneAnnotations"])
    assert len(annotations) == 14
    assert len({tuple(annotation["colorRgb"]) for annotation in annotations}) == 14
    assert [annotation["laneId"] for annotation in annotations] == [
        area["id"] for area in areas
    ]
    bounds = [annotation["transformedBounds"] for annotation in annotations]
    panel_box = (
        min(bound[0] for bound in bounds),
        min(bound[1] for bound in bounds),
        max(bound[2] for bound in bounds),
        max(bound[3] for bound in bounds),
    )
    assert decoded.crop(panel_box).size == image.size
    assert decoded.crop(panel_box).tobytes() == image.tobytes()
    measure = ImageDraw.Draw(decoded)
    # verify actual numeric glyph ink outside the untouched lane panel
    for index, annotation in enumerate(annotations):
        marker = str(index + 1)
        assert annotation["marker"] == marker
        assert annotation["markerPosition"] is not None
        x, y = annotation["markerPosition"]
        # bind each boundary segment to the same color as its numeric legend
        if not nested:
            left, top, right, _ = annotation["transformedBounds"]
            edge = decoded.crop((left, top - 1, right, top))
            edge_colors = {color for _, color in edge.getcolors(decoded.width)}
            assert tuple(annotation["colorRgb"]) in edge_colors
        glyph_box = measure.textbbox((x, y), marker)
        assert glyph_box[1] >= panel_box[3]
        assert glyph_box[2] <= decoded.width
        assert glyph_box[3] <= decoded.height
        colors = {color for _, color in decoded.crop(glyph_box).getcolors(1000)}
        ink = max(colors, key=sum)
        scale = max(ink) / max(annotation["colorRgb"])
        assert scale > 0.5
        assert ink == pytest.approx(
            tuple(channel * scale for channel in annotation["colorRgb"]), abs=1
        )
        expected_label = marker
        # interior sections must render their actual native bounds, not only an id
        if nested and index > 0:
            expected_label += (
                " ["
                + ",".join(str(value) for value in annotation["transformedBounds"])
                + "]"
            )
        label_box = measure.textbbox((x, y), expected_label)
        legend_box = annotation["legendBounds"]
        assert label_box[2] <= legend_box[2]
        assert label_box[3] <= legend_box[3]
        glyph_origin = measure.textbbox((0, 0), expected_label)
        expected_ink = Image.new(
            "RGB",
            (label_box[2] - label_box[0], label_box[3] - label_box[1]),
            color="black",
        )
        ImageDraw.Draw(expected_ink).text(
            (-glyph_origin[0], -glyph_origin[1]),
            expected_label,
            fill=tuple(annotation["colorRgb"]),
        )
        assert decoded.crop(label_box).tobytes() == expected_ink.tobytes()
    # the visible caption defines the positional legend contract
    if nested:
        band = decoded.crop(
            (0, panel_box[3] + 1, decoded.width, annotations[0]["legendBounds"][1])
        )
        caption_box = band.getbbox()
        assert caption_box is not None
        caption = "bounds [x0,y0,x1,y1]"
        origin = measure.textbbox((0, 0), caption)
        expected_caption = Image.new(
            "RGB", (origin[2] - origin[0], origin[3] - origin[1]), color="black"
        )
        ImageDraw.Draw(expected_caption).text(
            (-origin[0], -origin[1]), caption, fill="white"
        )
        expected_box = expected_caption.getbbox()
        assert expected_box is not None
        expected_caption = expected_caption.crop(expected_box)
        assert band.crop(caption_box).size == expected_caption.size
        assert band.crop(caption_box).tobytes() == expected_caption.tobytes()


# an entirely excluded section cannot be assigned an invented visual identity
def test_fully_masked_section_rejects_ambiguous_preparation() -> None:
    image = Image.new("RGB", (40, 20), color="white")
    left = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]
    right = [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]
    header = json.dumps(
        {
            "allowedAreas": [
                {"id": "left", "label": "left", "polygon": left},
                {"id": "right", "label": "right", "polygon": right},
            ],
            "excludedAreas": [{"polygon": left}],
        }
    )
    with pytest.raises(CameraPreparationError):
        prepare_camera_request(encode_png(image), header, "masked-section-camera")


# the endpoint never resolves or invokes inference
def test_prepare_endpoint_returns_contract_without_provider_calls() -> None:
    provider = ProviderSpy()
    client = TestClient(create_app(provider))
    image = Image.new("RGB", (20, 20), color="white")

    response = client.post(
        "/prepare",
        content=encode_png(image),
        headers={
            "X-Camera-Id": "camera-1",
            "X-Detection-Areas": area_header(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "imageBase64",
        "fingerprint",
        "width",
        "height",
        "sourceWidth",
        "sourceHeight",
        "rotationDegrees",
        "laneIds",
    }
    assert payload["laneIds"] == ["camera_lane_1_front"]
    assert payload["sourceWidth"] == 20
    assert payload["sourceHeight"] == 20
    assert not payload["imageBase64"].startswith("data:")
    assert len(payload["fingerprint"]) == 64
    assert provider.ready_calls == 0
    assert provider.detect_calls == 0


# invalid request cases fail before preprocessing
@pytest.mark.parametrize(
    ("camera_id", "header", "detail"),
    [
        (None, area_header(), "X-Camera-Id must be a non-empty string"),
        ("camera-1", None, "X-Detection-Areas header is required"),
        (
            "camera-1",
            json.dumps({"allowedAreas": [], "excludedAreas": []}),
            "at least one allowed area is required",
        ),
        (
            "camera-1",
            json.dumps(
                {
                    "allowedAreas": [
                        {
                            "id": "lane",
                            "label": "lane",
                            "polygon": [[-0.1, 0], [1, 0], [1, 1]],
                        }
                    ],
                    "excludedAreas": [],
                }
            ),
            "polygon points must be normalized between 0 and 1",
        ),
        (
            "camera-1",
            json.dumps(
                {
                    "allowedAreas": [
                        {
                            "id": "lane",
                            "label": "first",
                            "polygon": [[0, 0], [0.5, 0], [0.5, 0.5]],
                        },
                        {
                            "id": "lane",
                            "label": "duplicate",
                            "polygon": [[0.5, 0.5], [1, 0.5], [1, 1]],
                        },
                    ],
                    "excludedAreas": [],
                }
            ),
            "allowed area ids must be unique",
        ),
    ],
)
def test_prepare_rejects_invalid_headers(
    camera_id: str | None,
    header: str | None,
    detail: str,
) -> None:
    client = TestClient(create_app(ProviderSpy()))
    image = Image.new("RGB", (20, 20), color="white")
    headers = {}
    # optional-camera header
    if camera_id is not None:
        headers["X-Camera-Id"] = camera_id
    # optional-area header
    if header is not None:
        headers["X-Detection-Areas"] = header

    response = client.post("/prepare", content=encode_png(image), headers=headers)

    assert response.status_code == 400
    assert response.json() == {"detail": detail}


# stale source geometry is rejected explicitly
def test_prepare_rejects_frame_size_mismatch() -> None:
    client = TestClient(create_app(ProviderSpy()))
    image = Image.new("RGB", (20, 20), color="white")

    response = client.post(
        "/prepare",
        content=encode_png(image),
        headers={
            "X-Camera-Id": "camera-1",
            "X-Detection-Areas": area_header(frame_size=(21, 20)),
        },
    )

    assert response.status_code == 400
    assert (
        "frameSize does not match decoded image dimensions" in response.json()["detail"]
    )


# oversized encoded inputs stop before image decoding
def test_prepare_rejects_oversized_body() -> None:
    with pytest.raises(CameraPreparationError) as error_info:
        prepare_camera_request(
            b"x" * (MAX_IMAGE_BYTES + 1),
            area_header(),
            "camera-1",
        )

    assert error_info.value.status_code == 413
    assert error_info.value.detail == "request image exceeds the 10 MiB limit"


# exclusions may remove the complete selected mask
def test_prepare_rejects_empty_effective_mask() -> None:
    image = Image.new("RGB", (20, 20), color="white")
    full_exclusion = [
        {
            "id": "all",
            "label": "all",
            "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
        }
    ]

    with pytest.raises(
        CameraPreparationError, match="allowed areas select no source pixels"
    ):
        prepare_camera_request(
            encode_png(image),
            area_header(excluded=full_exclusion),
            "camera-1",
        )
