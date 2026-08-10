# Camera Line Detection Pilot List

## Scope

Pilot route: Mukilteo / Clinton.

First user-facing metric: the farthest reliable marker the ferry queue appears to reach. This list intentionally avoids exact dynamic car-count claims.

Static `carsToBoat` and `carCapacity` values below come from `shared/data/cameras.json`. Camera IDs, image URLs, dimensions, and coordinates come from `shared/data/wsf-core.json`.

## Detection-area rule

Each included camera must get explicit normalized image-space regions before automated inference is trusted:

- `holding_lot`: terminal vehicle holding lanes only.
- `queue_lane`: the specific ferry queue lane that backs up toward the boat.
- `excluded`: visible road lanes, oncoming lanes, parking areas, cross streets, shoulders, sidewalks, and unrelated staging areas.

Detections outside `holding_lot` or `queue_lane` must not advance the reported marker.

## Mukilteo candidates

| Priority | Camera ID | Marker label | Existing metadata | Image | Initial decision | ROI notes |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `9164` | Holding | `carCapacity: 246` | `400x246`, `wsf/Mukilteo/Terminal/mukterm.jpg` | Include | Draw terminal holding-lane polygons. Exclude ferry dock apron, pedestrians, non-queue parking, and water/terminal background. This is the baseline marker: line is at least in holding when occupancy is visible. |
| 2 | `9944` | Tollbooth / 1st Street | `carsToBoat: 257`, `orderFromTerminal: 2` | `335x209`, `nw/525vc00858.jpg` | Include | Draw only the ferry-bound approach lane near the tollbooth/terminal entrance. Exclude the opposite lane, terminal building area, sidewalks, landscaping, and non-queue vehicles near the booth. |
| 3 | `9394` | 5th Street north / facing toward terminal | `carsToBoat: 334`, `orderFromTerminal: 3` | `335x249`, `nw/525vc00820.jpg` | Include | Draw only the ferry-bound SR 525 lane segment approaching the terminal. Exclude opposing/through lanes, cross-street traffic, and any visible parked cars. Useful first upstream marker. |
| 4 | `9728` | 5th Street south / facing away from terminal | `carsToBoat: 337`, `orderFromTerminal: 4` | `335x249`, `nw/525vc00819.jpg` | Include as validation pair | Same physical marker area as `9394`, opposite view. Use to confirm/deny 5th Street reach, not as a separate farther marker. Exclude all non-ferry lanes. |
| 5 | `9161` | Clover Lane | `carsToBoat: 546`, `orderFromTerminal: 5` | `335x249`, `nw/525vc00740.jpg` | Maybe later | Include only if 5th Street benchmark works. Draw ferry-bound lane only; exclude normal SR 525 traffic that is not queued for the ferry. Higher false-positive risk because distance from terminal increases. |
| 6 | `9162` | 76th Street north / school | `carsToBoat: 666`, `orderFromTerminal: 6` | `335x249`, `nw/525vc00695.jpg` | Exclude from first pass | Too far upstream for lean pilot unless queues regularly reach this marker. Keep as overflow marker after manual benchmark. |
| 7 | `9163` | 76th Street south / school | `carsToBoat: 669`, `orderFromTerminal: 7` | `335x249`, `nw/525vc00694.jpg` | Exclude from first pass | Opposite view of the school-area marker. Use later as validation pair only if overflow detection is needed. |

### Mukilteo marker order

1. `holding`: line visible in terminal holding area (`9164`).
2. `tollbooth`: line reaches Tollbooth / 1st Street (`9944`).
3. `5th_street`: line reaches 5th Street (`9394` and/or `9728`).
4. `clover_lane`: line reaches Clover Lane (`9161`) — later/optional.
5. `school_76th`: line reaches 76th Street / school cameras (`9162` and/or `9163`) — later/overflow only.

## Clinton candidates

| Priority | Camera ID | Marker label | Existing metadata | Image | Initial decision | ROI notes |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `9166` | Holding | `carCapacity: 190` | `400x421`, `wsf/clinton/terminal/clinton.jpg` | Include | Draw terminal holding-lane polygons only. Exclude dock, pedestrian/loading areas, non-queue parking, and terminal background. Baseline marker for terminal occupancy. |
| 2 | `9172` | Tollbooth / uphill | `carsToBoat: 190`, `orderFromTerminal: 2` | `400x137`, `wsf/clinton/boothhill.jpg` | Include | Draw ferry-bound lane around the tollbooth/uphill queue. Exclude non-queue road movement and any visible dock/terminal-side vehicles not in the queue lane. |
| 3 | `9174` | Food Mart / east SR 525 | `carsToBoat: 292`, `orderFromTerminal: 3` | `400x140`, `wsf/clinton/clinteast.jpg` | Include | Draw the specific ferry queue lane backing up toward the terminal. Exclude through traffic, cross traffic, shoulders, and parking-lot traffic near businesses. |
| 4 | `9175` | Post Office / west SR 525 | `carsToBoat: 322`, `orderFromTerminal: 4` | `400x140`, `wsf/clinton/clintwest.jpg` | Include as farthest marker | Draw ferry-bound queue lane only. Exclude opposing lane, through traffic, side streets, and parked cars. This is the farthest first-pass Clinton marker. |
| 5 | `9173` | Dock | no dynamic queue metadata | `400x137`, `wsf/clinton/boothdock.jpg` | Exclude from line reach | Dock view is not useful for upstream line length. Keep for display/manual context only unless later benchmark proves it helps detect loading state. |

### Clinton marker order

1. `holding`: line visible in terminal holding area (`9166`).
2. `tollbooth`: line reaches tollbooth/uphill (`9172`).
3. `food_mart`: line reaches Food Mart / east SR 525 (`9174`).
4. `post_office`: line reaches Post Office / west SR 525 (`9175`).

## First benchmark set

Use this subset for the first manual/CV benchmark:

- Mukilteo: `9164`, `9944`, `9394`, `9728`.
- Clinton: `9166`, `9172`, `9174`, `9175`.

This is eight camera images per test round. The repository keeps a deliberately small immutable labeled benchmark under `benchmarks/camera-detection`; continuous operational sampling should still store only derived states plus short-lived metadata rather than a raw frame archive.

## Open items before implementation

1. Review the normalized polygon ROIs against labeled daylight and adverse-condition samples.
2. Grow the seed benchmark across empty, minority-full, majority-full, full, dark, rain, glare, and stale-frame cases.
3. Define marker conflict behavior, especially paired 5th Street Mukilteo cameras.
4. Validate the current self-hosted detector's spatial occupancy states against the manual control labels.
5. Add negative tests where visible non-queue cars do not advance the marker.
