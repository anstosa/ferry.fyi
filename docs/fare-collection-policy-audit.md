# Fare collection policy audit

`shared/lib/fareCollectionPolicy.ts` is the maintained, direction-specific
collection policy used by the Fare API. It deliberately fails closed when the
WSDOT fare cache generation differs from the reviewed generation or the review
is older than 90 days.

## 2026-07-18 audit record

- Reviewer: `omx-fare-policy-audit`
- Reviewed at: `2026-07-18T20:51:40.000Z`
- Valid trip date: `2026-07-18` (the start of the live WSDOT valid-date range)
- WSDOT `cacheflushdate`: `/Date(1784324310423-0700)/`
- Method: queried the documented `terminalcomboverbose/2026-07-18` directory
  and each listed `terminalcombo/2026-07-18/{departure}/{arrival}` resource.
  The 18 individual collection descriptions matched the corresponding bulk
  entries.

These source URLs intentionally omit `apiaccesscode`; they identify the
official resource, not a replayable credential-bearing request.

| Direction | WSDOT terminal-combo source |
| --- | --- |
| 16 → 21 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/16/21` |
| 21 → 16 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/21/16` |
| 4 → 7 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/4/7` |
| 7 → 4 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/7/4` |
| 3 → 7 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/3/7` |
| 7 → 3 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/7/3` |
| 12 → 8 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/12/8` |
| 8 → 12 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/8/12` |
| 14 → 5 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/14/5` |
| 5 → 14 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/5/14` |
| 11 → 17 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/11/17` |
| 17 → 11 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/17/11` |
| 20 → 9 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/20/9` |
| 9 → 20 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/9/20` |
| 22 → 9 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/22/9` |
| 9 → 22 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/9/22` |
| 20 → 22 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/20/22` |
| 22 → 20 | `https://www.wsdot.wa.gov/ferries/api/fares/rest/terminalcombo/2026-07-18/22/20` |

The audited descriptions identify three no-fare departures:

- `21 → 16`: “No fares are collected at Tahlequah.”
- `22 → 9` and `22 → 20`: “No fares are collected at Vashon Island.”

Other directions may have limited passenger or vehicle collection, but are not
declared no-fare: the policy does not infer price or eligibility from that
prose. Each existing `roundTrip: true` value was retained as an explicit
product decision; this collection-description audit does not establish a
different provider mode.

## Operator update procedure

Run this procedure whenever the live `cacheflushdate` changes, before the
90-day review limit, or when WSDOT changes the supported terminal pairs.

1. Load the local credential without printing it (for example, source the
   untracked `.envrc` in a local shell). Never place an access code in source,
   fixtures, documentation, logs, issue text, or commit messages.
2. Request `GET /ferries/api/fares/rest/cacheflushdate`, then request
   `validdaterange` with the access code supplied only as a query parameter.
   Choose an in-range trip date.
3. Request `terminalcomboverbose/{tripDate}` and every supported individual
   `terminalcombo/{tripDate}/{departure}/{arrival}` endpoint. Confirm all 18
   policy directions exist and that each individual `CollectionDescription`
   matches the bulk response.
4. Update the exact returned generation, UTC review time, reviewer identifier,
   trip-date source URLs (without any query string), and no-fare messages only
   when the observed description establishes no fare at the departure terminal.
   Keep `roundTrip` unchanged unless separate authoritative evidence supports
   an intentional policy decision.
5. Update this audit record with sanitized observations. Run
   `yarn vitest run tests/shared/fareCollectionPolicy.test.ts`,
   `yarn lint:js:shared`, and `yarn type-check` before committing. Review the
   diff for credential strings before the commit.
