# Camera cars-to-boat metadata

`cameras.json` stores static display overrides for WSF ferry cameras. The `carsToBoat` field is a best-effort estimate of how many queued cars would be ahead of the user if the line reached that camera.

## Estimate source

- Camera IDs, terminal IDs, titles, and coordinates come from `shared/data/wsf-core.json`, which mirrors WSDOT ferry camera data.
- Route distances were measured on 2026-06-22 using OSRM public route results over OpenStreetMap road data.
- Conversion uses 22 feet per queued car, calibrated to the repo's previous queue metadata examples: 4,080 ft / 185 cars and 2,360 ft / 107 cars.
- Cameras that do not map to a meaningful upstream queue or holding position intentionally use `null`.

## Research artifacts

Detailed research artifacts for this update are under:

- `.omx/research/camera-cars-to-boat-inventory.md`
- `.omx/research/camera-cars-to-boat-estimates.md`
- `.omx/research/camera-cars-to-boat-estimates.json`
