"""detector runtime tests."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import NoopProvider, PixelBox, PixelDetection, create_app


# fake provider
class FakeProvider:
    # provider setup
    def __init__(self) -> None:
        self.ready_calls = 0
        self.detect_calls = 0

    # provider name
    @property
    def name(self) -> str:
        return "fake"

    # fake readiness
    def ready(self) -> None:
        self.ready_calls += 1

    # fake detections
    def detect(self, image: Image.Image) -> list[PixelDetection]:
        self.detect_calls += 1
        return [
            PixelDetection(
                label="vehicle",
                confidence=0.75,
                box=PixelBox(x=20, y=10, width=40, height=20),
            ),
        ]


# failing provider
class FailingReadyProvider(FakeProvider):
    # provider name
    @property
    def name(self) -> str:
        return "failing"

    # readiness failure
    def ready(self) -> None:
        self.ready_calls += 1
        raise RuntimeError("model failed to load")


# mask inspection provider
class MaskInspectingProvider(FakeProvider):
    # provider setup
    def __init__(self) -> None:
        super().__init__()
        self.image: Image.Image | None = None

    # retain processed image
    def detect(self, image: Image.Image) -> list[PixelDetection]:
        self.image = image.copy()
        return super().detect(image)


# image fixture
def png_bytes(width: int = 100, height: int = 50) -> bytes:
    image = Image.new("RGB", (width, height), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


# health test
def test_health_reports_provider_without_readiness_load() -> None:
    provider = FakeProvider()
    client = TestClient(create_app(provider))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "provider": "fake"}
    assert provider.ready_calls == 0
    assert provider.detect_calls == 0


# readiness test
def test_ready_loads_provider_without_detection() -> None:
    provider = FakeProvider()
    client = TestClient(create_app(provider))

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "provider": "fake"}
    assert provider.ready_calls == 1
    assert provider.detect_calls == 0


# noop readiness test
def test_noop_provider_health_and_ready() -> None:
    client = TestClient(create_app(NoopProvider()))

    health_response = client.get("/health")
    ready_response = client.get("/ready")

    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok", "provider": "noop"}
    assert ready_response.status_code == 200
    assert ready_response.json() == {"status": "ready", "provider": "noop"}


# readiness failure test
def test_ready_reports_unavailable_when_provider_load_fails() -> None:
    provider = FailingReadyProvider()
    client = TestClient(create_app(provider))

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "detector is not ready"}
    assert provider.ready_calls == 1
    assert provider.detect_calls == 0


# detect test
def test_detect_returns_normalized_boxes() -> None:
    client = TestClient(create_app(FakeProvider()))

    response = client.post("/detect", content=png_bytes())

    assert response.status_code == 200
    assert response.json() == {
        "detections": [
            {
                "label": "vehicle",
                "confidence": 0.75,
                "box": {"x": 0.2, "y": 0.2, "width": 0.4, "height": 0.4},
            },
        ],
    }


# detection mask test
def test_detect_masks_and_crops_to_countable_areas() -> None:
    provider = MaskInspectingProvider()
    client = TestClient(create_app(provider))

    response = client.post(
        "/detect",
        content=png_bytes(),
        headers={
            "X-Detection-Areas": '{"allowedAreas":[{"polygon":[[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]]}],"excludedAreas":[{"polygon":[[0.45,0.45],[0.55,0.45],[0.55,0.55],[0.45,0.55]]}]}'
        },
    )

    assert response.status_code == 200
    assert provider.image is not None
    assert provider.image.size == (61, 31)
    assert provider.image.getpixel((30, 15)) == (0, 0, 0)
    assert response.json()["detections"][0]["box"] == {
        "x": 0.4,
        "y": 0.4,
        "width": 0.4,
        "height": 0.4,
    }


# invalid input test
def test_detect_rejects_non_image_body() -> None:
    client = TestClient(create_app(FakeProvider()))

    response = client.post("/detect", content=b"not an image")

    assert response.status_code == 400
    assert response.json() == {"detail": "request body is not a supported image"}
