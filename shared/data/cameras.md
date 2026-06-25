# Camera car-count metadata

`cameras.json` stores static display overrides for WSF ferry cameras.

- `carCapacity` is used for terminal holding cameras and displays as `X car capacity`.
- `carsToBoat` is used for upstream/tollbooth/road cameras and displays as `X cars to boat`.
- Camera rows with neither meaningful value intentionally use `null` for both fields.

## Estimate source

- Camera IDs, terminal IDs, titles, and camera image URLs come from `shared/data/wsf-core.json`, which mirrors WSDOT ferry camera data.
- Terminal holding-lane capacities come from WSDOT Terminal Design Manual M 3082.06, Chapter 520, Exhibit 520-2, published December 2025. WSDOT notes that these totals are based on terminal holding-lane drawings, assume a 20-foot average vehicle length, and do not include additional off-site lots or upstream queuing lanes.
- Upstream queue additions were measured on 2026-06-24 from WSDOT's current camera coordinates in `Terminals.ashx` to the selected terminal holding reference camera using OSRM public route results over OpenStreetMap road data. For one-way streets, the shorter of the two legal route directions was used so a camera-to-holding measurement does not add a non-queue loop.
- Conversion for upstream queue additions uses WSDOT's 20-foot average vehicle length assumption from Chapter 520.
- Camera sailings prefer the daily normal-route-vessel average that the backend stores in `NormalRouteVessels`; when that value has not been calculated yet, the UI falls back to route average vehicle capacities in `shared/data/wsf-core.json`. Those fallback route averages were calculated on 2026-06-24 from WSF schedule vessel assignments and WSF vessel vehicle capacities (`RegDeckSpace + TallDeckSpace` from WSF vessel verbose data).

## Terminal holding capacities used

| Terminal | Holding capacity |
| --- | ---: |
| Anacortes | 450 |
| Bainbridge Island | 212 |
| Bremerton | 230 |
| Clinton | 190 |
| Coupeville | 120 |
| Edmonds | 174 |
| Fauntleroy | 84 |
| Friday Harbor | 136 |
| Kingston | 288 |
| Lopez Island | 88 |
| Mukilteo | 246 |
| Orcas Island | 175 |
| Point Defiance | 50 |
| Port Townsend | 100 |
| Seattle | 650 |
| Southworth | 160 |
| Tahlequah | 4 |
| Vashon Island | 80 |

## Fallback route average vehicle capacities used

| Route | Average vehicle capacity |
| --- | ---: |
| Point Defiance / Tahlequah | 89 |
| Seattle / Bremerton | 177 |
| Seattle / Bainbridge Island | 270 |
| Edmonds / Kingston | 262 |
| Mukilteo / Clinton | 178 |
| Port Townsend / Coupeville | 89 |
| Anacortes / San Juan Islands | 167.7 |
| Fauntleroy / Southworth | 149 |
| Fauntleroy / Vashon | 149 |
| Southworth / Vashon | 149 |

## Research artifacts

Detailed research artifacts for the original map-derived update are under `.omx/research/`. The current checked-in values should be treated as the source of truth because they replace the original route-only estimates with WSDOT holding-lane capacities plus measured upstream queue additions.
