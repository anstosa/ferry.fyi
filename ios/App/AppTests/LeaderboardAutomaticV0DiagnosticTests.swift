import CoreLocation
import Foundation
import XCTest
@testable import Ferry_FYI

// define the native contract
final class AutomaticV0FleetEnvelopeParserTests: XCTestCase {
    // build one complete public vessel
    private func vessel(id: String = "144", latitude: Double = 47.6, longitude: Double = -122.5) -> [String: Any] {
        [
            "abbreviation": "KIN",
            "beam": "78 feet",
            "classId": "144",
            "hasCarDeckRestroom": true,
            "hasElevator": true,
            "hasGalley": true,
            "hasRestroom": true,
            "hasWiFi": true,
            "horsepower": 5_000,
            "id": id,
            "inMaintenance": false,
            "inService": true,
            "info": ["crossing": "test"],
            "isAdaAccessible": true,
            "isAtDock": false,
            "location": ["latitude": latitude, "longitude": longitude],
            "maxClearance": 15,
            "name": "Kitsap",
            "passengerCapacity": 1_200,
            "speed": 18,
            "tallVehicleCapacity": 30,
            "vesselWatchUrl": "https://example.invalid/vessel/144",
            "vehicleCapacity": 124,
            "weight": 2_000,
            "yearBuilt": 1980,
            "yearRebuilt": 2010,
        ]
    }

    // build the exact ordinary-api wrapper
    private func envelope(
        status: [String: Any] = ["offline": false, "coreReady": true, "warming": false],
        sourceUpdatedAt: Any = 1_720_000_000,
        vessels: [String: Any]? = nil
    ) -> [String: Any] {
        [
            "wsfStatus": status,
            "body": [
                "sourceUpdatedAt": sourceUpdatedAt,
                "vessels": vessels ?? ["144": vessel()],
            ],
        ]
    }

    // encode a json fixture
    private func data(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    // accept every operational status shape
    func testOperationalWrappedSnapshotsAreAccepted() throws {
        let statuses: [[String: Any]] = [
            ["offline": false],
            ["offline": false, "coreReady": true],
            ["offline": false, "warming": false],
            ["offline": false, "coreReady": true, "warming": false],
        ]

        // parse every operational variant
        for status in statuses {
            let context = AutomaticV0FleetEnvelopeParser.parse(try data(envelope(status: status)))
            XCTAssertEqual(context?.vessels.count, 1)
            XCTAssertEqual(context?.vessels.first?.id, "144")
        }
    }

    // reject non-operational and malformed status shapes
    func testInvalidStatusTableReturnsNoContext() throws {
        let statuses: [Any] = [
            ["offline": true],
            ["offline": false, "warming": true],
            ["offline": false, "coreReady": false],
            ["coreReady": true],
            ["offline": 0],
            ["offline": false, "coreReady": "yes"],
            ["offline": false, "warming": 0],
            ["offline": false, "unknown": true],
            NSNull(),
            "online",
        ]

        // reject every invalid status with one parser result
        for status in statuses {
            let fixture: [String: Any] = [
                "wsfStatus": status,
                "body": ["sourceUpdatedAt": 1_720_000_000, "vessels": [:]],
            ]
            XCTAssertNil(AutomaticV0FleetEnvelopeParser.parse(try data(fixture)))
        }
    }

    // reject bare, missing, null, and unknown outer shapes
    func testInvalidOuterEnvelopeTableReturnsNoContext() throws {
        let validBody = envelope()["body"] as Any
        let fixtures: [Any] = [
            validBody,
            ["body": validBody],
            ["wsfStatus": ["offline": false]],
            ["wsfStatus": ["offline": false], "body": NSNull()],
            ["wsfStatus": ["offline": false], "body": validBody, "extra": true],
            ["wsfStatus": ["offline": false], "body": []],
            [],
        ]

        // reject every invalid outer fixture
        for fixture in fixtures {
            XCTAssertNil(AutomaticV0FleetEnvelopeParser.parse(try data(fixture)))
        }
    }

    // reject malformed source and vessel shapes
    func testInvalidBodyAndVesselTableReturnsNoContext() throws {
        var missingRequired = vessel()
        missingRequired.removeValue(forKey: "inService")
        var unknownField = vessel()
        unknownField["secret"] = "unexpected"
        var mismatchedId = vessel()
        mismatchedId["id"] = "145"
        var malformedLocation = vessel()
        malformedLocation["location"] = ["latitude": 47.6]
        let fixtures: [[String: Any]] = [
            envelope(sourceUpdatedAt: NSNull()),
            envelope(sourceUpdatedAt: "1720000000"),
            envelope(sourceUpdatedAt: -1),
            envelope(sourceUpdatedAt: 9_007_199_254_741),
            envelope(vessels: ["144": missingRequired]),
            envelope(vessels: ["144": unknownField]),
            envelope(vessels: ["144": mismatchedId]),
            envelope(vessels: ["144": malformedLocation]),
            ["wsfStatus": ["offline": false], "body": ["sourceUpdatedAt": 1]],
            ["wsfStatus": ["offline": false], "body": ["sourceUpdatedAt": 1, "vessels": [:], "extra": true]],
        ]

        // reject every malformed body fixture
        for fixture in fixtures {
            XCTAssertNil(AutomaticV0FleetEnvelopeParser.parse(try data(fixture)))
        }
    }

    // reject duplicate semantic keys before foundation parsing
    func testDuplicateObjectKeysAreRejected() {
        let fixtures = [
            #"{"wsfStatus":{"offline":false},"wsfStatus":{"offline":false},"body":{"sourceUpdatedAt":1,"vessels":{}}}"#,
            #"{"wsfStatus":{"offline":false,"offline":false},"body":{"sourceUpdatedAt":1,"vessels":{}}}"#,
            #"{"wsfStatus":{"offline":false,"\u006ffline":false},"body":{"sourceUpdatedAt":1,"vessels":{}}}"#,
            #"{"wsfStatus":{"offline":false},"body":{"sourceUpdatedAt":1,"sourceUpdatedAt":1,"vessels":{}}}"#,
        ]

        // reject every duplicate-key fixture
        for fixture in fixtures {
            XCTAssertNil(AutomaticV0FleetEnvelopeParser.parse(Data(fixture.utf8)))
        }
    }

    // hash and cache only canonical body bytes
    func testCanonicalBodyExcludesOuterStatus() throws {
        let first = try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(try data(envelope(
            status: ["offline": false]
        ))))
        let second = try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(try data(envelope(
            status: ["offline": false, "coreReady": true, "warming": false]
        ))))

        XCTAssertEqual(first.canonicalBody, second.canonicalBody)
        XCTAssertEqual(first.bodyHashHex, second.bodyHashHex)
        XCTAssertNil(String(data: first.canonicalBody, encoding: .utf8)?.range(of: "wsfStatus"))
        XCTAssertEqual(
            AutomaticV0FleetEnvelopeParser.parseCanonicalBody(first.canonicalBody),
            first
        )
    }

    // accept the normalized live public vessel shape
    func testNormalizedLiveWireShapeIsAccepted() throws {
        var normalizedVessel = vessel()
        normalizedVessel.removeValue(forKey: "yearRebuilt")
        normalizedVessel["info"] = [:]
        normalizedVessel["gpsDelay"] = [
            "confidence": "low",
            "delaySeconds": 0,
            "explanation": "public gps estimate",
            "signals": [
                "dockDelaySeconds": NSNull(),
                "etaDelaySeconds": NSNull(),
                "progress": 0.5,
                "scheduledArrivalTime": 1_720_000_600,
                "scheduledDepartureTime": 1_720_000_000,
            ],
            "source": "gps",
        ]

        let context = AutomaticV0FleetEnvelopeParser.parse(try data(envelope(
            vessels: ["144": normalizedVessel]
        )))
        XCTAssertEqual(context?.vessels.map(\.id), ["144"])
    }

    // reject a null optional numeric field
    func testNormalizedOptionalYearRebuiltStillRejectsNull() throws {
        var invalidVessel = vessel()
        invalidVessel["yearRebuilt"] = NSNull()

        XCTAssertNil(AutomaticV0FleetEnvelopeParser.parse(try data(envelope(
            vessels: ["144": invalidVessel]
        ))))
    }
}

// define the native contract
final class AutomaticV0FleetFreshnessTests: XCTestCase {
    // accept both exact maximum-age equalities
    func testSourceAndReceiveAgeEqualityAreAccepted() {
        let nowMs: Int64 = 1_720_000_120_000
        XCTAssertTrue(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: 1_720_000_000,
            receivedAtMs: nowMs - automaticV0FleetContextMaxAgeMs,
            trustedNowMs: nowMs
        ))
    }

    // reject either maximum-age plus one
    func testSourceAndReceiveAgePlusOneAreRejected() {
        let nowMs: Int64 = 1_720_000_120_001
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: 1_720_000_000,
            receivedAtMs: nowMs,
            trustedNowMs: nowMs
        ))
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: Double(nowMs) / 1_000,
            receivedAtMs: nowMs - automaticV0FleetContextMaxAgeMs - 1,
            trustedNowMs: nowMs
        ))
    }

    // reject future, unit-mutated, and overflow values
    func testFutureAndUnitMutantsAreRejected() {
        let nowMs: Int64 = 1_720_000_000_000
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: 1_720_000_001,
            receivedAtMs: nowMs,
            trustedNowMs: nowMs
        ))
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: 1_720_000_000_000,
            receivedAtMs: nowMs,
            trustedNowMs: nowMs
        ))
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: .infinity,
            receivedAtMs: nowMs,
            trustedNowMs: nowMs
        ))
        XCTAssertFalse(AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: Double(nowMs) / 1_000,
            receivedAtMs: nowMs + 1,
            trustedNowMs: nowMs
        ))
    }
}

// define the native contract
final class AutomaticRegionManagerTests: XCTestCase {
    // define the native contract
    private final class FakeLocationRequester: AutomaticV0LocationRequesting {
        var requestCount = 0
        var stopCount = 0

        // count one request
        func requestOneLocation() {
            requestCount += 1
        }

        // count one stop
        func stopLocationRequest() {
            stopCount += 1
        }
    }

    // define the native contract
    private final class FakeFleetFetcher: AutomaticV0FleetSnapshotFetching {
        var fetchCount = 0
        var result: Result<Data, Error> = .failure(AutomaticV0FleetFetchError.transport)
        var deferredCompletion: ((Result<Data, Error>) -> Void)?
        var defers = false

        // return one configured result
        func fetchOnce(completion: @escaping (Result<Data, Error>) -> Void) {
            fetchCount += 1

            // defer only for boundary tests
            if defers {
                deferredCompletion = completion
            // branch on the current state
            } else {
                completion(result)
            }
        }

        // complete one deferred fetch
        func complete() {
            let completion = deferredCompletion
            deferredCompletion = nil
            completion?(result)
        }
    }

    // define the native contract
    private final class FakeFleetCache: AutomaticV0FleetContextCaching {
        var record: AutomaticV0FleetCacheRecord?
        var loadCount = 0
        var storeCount = 0
        var storeSucceeds = true

        // return one configured record
        func load() -> AutomaticV0FleetCacheRecord? {
            loadCount += 1
            return record
        }

        // count body-only replacement
        func store(_ record: AutomaticV0FleetCacheRecord) -> Bool {
            storeCount += 1

            // persist only on configured success
            if storeSucceeds {
                self.record = record
            }

            return storeSucceeds
        }
    }

    // define the native contract
    private final class FakeMetricRecorder: AutomaticV0MetricRecording {
        var metrics: [AutomaticV0Metric] = []

        // retain fixed metrics only
        func record(_ metric: AutomaticV0Metric) {
            metrics.append(metric)
        }
    }

    private var nowMs: Int64 = 1_720_000_000_000
    private var protectedDataAvailable = true
    private var requester: FakeLocationRequester!
    private var fetcher: FakeFleetFetcher!
    private var cache: FakeFleetCache!
    private var metrics: FakeMetricRecorder!

    // reset injected boundaries
    override func setUp() {
        super.setUp()
        nowMs = 1_720_000_000_000
        protectedDataAvailable = true
        requester = FakeLocationRequester()
        fetcher = FakeFleetFetcher()
        cache = FakeFleetCache()
        metrics = FakeMetricRecorder()
    }

    // build one strict wrapped snapshot
    private func wrappedSnapshot(
        vesselLocations: [(String, Double, Double)] = [("144", 47.6, -122.5)],
        sourceUpdatedAtSeconds: Double? = nil,
        status: [String: Any] = ["offline": false, "coreReady": true]
    ) throws -> Data {
        var vessels: [String: Any] = [:]

        // build every complete vessel record
        for (id, latitude, longitude) in vesselLocations {
            vessels[id] = [
                "abbreviation": "VES",
                "beam": "78 feet",
                "classId": "144",
                "hasCarDeckRestroom": true,
                "hasElevator": true,
                "hasGalley": true,
                "hasRestroom": true,
                "hasWiFi": true,
                "horsepower": 5_000,
                "id": id,
                "inMaintenance": false,
                "inService": true,
                "info": [:],
                "isAdaAccessible": true,
                "isAtDock": false,
                "location": ["latitude": latitude, "longitude": longitude],
                "maxClearance": 15,
                "name": "Vessel \(id)",
                "passengerCapacity": 1_200,
                "speed": 18,
                "tallVehicleCapacity": 30,
                "vesselWatchUrl": "https://example.invalid/vessel/\(id)",
                "vehicleCapacity": 124,
                "weight": 2_000,
                "yearBuilt": 1980,
                "yearRebuilt": 2010,
            ]
        }

        return try JSONSerialization.data(withJSONObject: [
            "wsfStatus": status,
            "body": [
                "sourceUpdatedAt": sourceUpdatedAtSeconds ?? Double(nowMs) / 1_000,
                "vessels": vessels,
            ],
        ], options: [.sortedKeys])
    }

    // build one diagnostic flow
    private func flow(
        policy: AutomaticV0DiagnosticPolicy = .provisionalV1
    ) -> AutomaticV0DiagnosticFlow {
        AutomaticV0DiagnosticFlow(
            locationRequester: requester,
            fleetFetcher: fetcher,
            fleetCache: cache,
            metricRecorder: metrics,
            // run the bounded callback
            protectedDataAvailable: { self.protectedDataAvailable },
            // run the bounded callback
            trustedNowMs: { self.nowMs },
            policy: policy
        )
    }

    // build one fresh location fix
    private func fix(
        latitude: Double = 47.6,
        longitude: Double = -122.5,
        accuracy: Double = 10
    ) -> AutomaticV0LocationFix {
        AutomaticV0LocationFix(
            latitude: latitude,
            longitude: longitude,
            horizontalAccuracyMeters: accuracy,
            timestampMs: nowMs
        )
    }

    // complete exactly one v0 sequence
    func testExitRequestsOneFixFetchesOneWrappedSnapshotAndWipesOneCandidate() throws {
        fetcher.result = .success(try wrappedSnapshot())
        let subject = flow()

        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        XCTAssertFalse(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())
        subject.receiveLocation(fix())

        XCTAssertEqual(requester.requestCount, 1)
        XCTAssertEqual(requester.stopCount, 1)
        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(cache.storeCount, 1)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 1)
        XCTAssertEqual(subject.wipedDiagnosticCandidateCount, 1)
        XCTAssertEqual(metrics.metrics.last?.outcome, .diagnosticCandidateWiped)
    }

    // keep entry t0 bounded and fleet-free
    func testEntryRequestsOneFixAndStopsWithoutFleetWork() {
        let subject = flow()

        XCTAssertTrue(subject.handleRegionEvent(.entry, lifecycle: .foreground))
        subject.receiveLocation(fix())

        XCTAssertEqual(requester.requestCount, 1)
        XCTAssertEqual(requester.stopCount, 1)
        XCTAssertEqual(fetcher.fetchCount, 0)
        XCTAssertEqual(cache.storeCount, 0)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
        XCTAssertEqual(metrics.metrics.last?.outcome, .terminalFixObserved)
    }

    // reject inaccurate, stale, and future fixes before fleet work
    func testInvalidFixTableStopsWithoutFleetOrCandidate() {
        let fixes = [
            fix(accuracy: 100.001),
            AutomaticV0LocationFix(
                latitude: 47.6,
                longitude: -122.5,
                horizontalAccuracyMeters: 10,
                timestampMs: nowMs - 30_001
            ),
            AutomaticV0LocationFix(
                latitude: 47.6,
                longitude: -122.5,
                horizontalAccuracyMeters: 10,
                timestampMs: nowMs + 1
            ),
        ]

        // run every invalid fix through a fresh wake
        for invalidFix in fixes {
            setUp()
            let subject = flow()
            XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
            subject.receiveLocation(invalidFix)
            XCTAssertEqual(requester.requestCount, 1)
            XCTAssertEqual(requester.stopCount, 1)
            XCTAssertEqual(fetcher.fetchCount, 0)
            XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
            XCTAssertEqual(metrics.metrics.last?.outcome, .fixInvalid)
        }
    }

    // fail closed before first unlock without plaintext work
    func testProtectedDataUnavailableCreatesNoFixCacheFetchOrCandidate() {
        protectedDataAvailable = false
        let subject = flow()

        XCTAssertFalse(subject.handleRegionEvent(.exit, lifecycle: .ordinaryRegionRelaunch))
        XCTAssertFalse(subject.prefetchFleetIfDue(lifecycle: .foreground))

        XCTAssertEqual(requester.requestCount, 0)
        XCTAssertEqual(fetcher.fetchCount, 0)
        XCTAssertEqual(cache.loadCount, 0)
        XCTAssertEqual(cache.storeCount, 0)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
        XCTAssertEqual(metrics.metrics.map(\.outcome), [
            .protectedDataUnavailable,
            .protectedDataUnavailable,
        ])
    }

    // reuse cache only below the exact refresh cadence
    func testReceiveAgeBelowFiftyFiveSecondsReusesCache() throws {
        let context = try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(try wrappedSnapshot()))
        cache.record = AutomaticV0FleetCacheRecord(
            context: context,
            receivedAtMs: nowMs - automaticV0FleetRefreshIntervalMs + 1
        )
        let subject = flow()

        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())

        XCTAssertEqual(fetcher.fetchCount, 0)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 1)
    }

    // fetch once at exact refresh cadence
    func testReceiveAgeExactlyFiftyFiveSecondsFetchesOnce() throws {
        let context = try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(try wrappedSnapshot()))
        cache.record = AutomaticV0FleetCacheRecord(
            context: context,
            receivedAtMs: nowMs - automaticV0FleetRefreshIntervalMs
        )
        fetcher.result = .success(try wrappedSnapshot())
        let subject = flow()

        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())

        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 1)
    }

    // prefetch only at the exact due boundary
    func testForegroundPrefetchUsesSameFiftyFiveSecondBoundary() throws {
        let context = try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(try wrappedSnapshot()))
        cache.record = AutomaticV0FleetCacheRecord(
            context: context,
            receivedAtMs: nowMs - automaticV0FleetRefreshIntervalMs + 1
        )
        fetcher.result = .success(try wrappedSnapshot())
        let subject = flow()

        XCTAssertFalse(subject.prefetchFleetIfDue(lifecycle: .foreground))
        XCTAssertEqual(fetcher.fetchCount, 0)

        cache.record = AutomaticV0FleetCacheRecord(
            context: context,
            receivedAtMs: nowMs - automaticV0FleetRefreshIntervalMs
        )
        XCTAssertTrue(subject.prefetchFleetIfDue(lifecycle: .foreground))
        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(metrics.metrics.last?.outcome, .fleetContextPrefetched)
    }

    // collapse malformed, non-operational, network, and cache failures
    func testEveryFleetFailureUsesOneFixedOutcomeWithoutRetry() throws {
        let invalidResults: [Result<Data, Error>] = [
            .failure(AutomaticV0FleetFetchError.transport),
            .success(Data(#"{"sourceUpdatedAt":1720000000,"vessels":{}}"#.utf8)),
            .success(try wrappedSnapshot(status: ["offline": true])),
            .success(Data(#"{"wsfStatus":{"offline":false},"body":{"sourceUpdatedAt":1,"vessels":{}},"extra":true}"#.utf8)),
        ]

        // run every failure through a fresh bounded wake
        for result in invalidResults {
            setUp()
            fetcher.result = result
            let subject = flow()
            XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
            subject.receiveLocation(fix())
            XCTAssertEqual(metrics.metrics.last?.outcome, .fleetContextInvalid)
            XCTAssertEqual(fetcher.fetchCount, 1)
            XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
        }

        setUp()
        fetcher.result = .success(try wrappedSnapshot())
        cache.storeSucceeds = false
        let subject = flow()
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())
        XCTAssertEqual(metrics.metrics.last?.outcome, .fleetContextInvalid)
        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
    }

    // report stale fleet through the same fixed outcome
    func testStaleFleetUsesFixedInvalidOutcome() throws {
        fetcher.result = .success(try wrappedSnapshot(
            sourceUpdatedAtSeconds: Double(nowMs - automaticV0FleetContextMaxAgeMs - 1) / 1_000
        ))
        let subject = flow()

        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())

        XCTAssertEqual(metrics.metrics.last?.outcome, .fleetContextInvalid)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
    }

    // include fix uncertainty in match boundary
    func testMatchDistanceIncludesAccuracyAtEqualityAndPlusEpsilon() throws {
        let policy = AutomaticV0DiagnosticPolicy(
            maximumFixAgeMs: 30_000,
            maximumFixAccuracyMeters: 200,
            maximumVesselMatchDistanceMeters: 100
        )
        fetcher.result = .success(try wrappedSnapshot())
        var subject = flow(policy: policy)

        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix(accuracy: 100))
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 1)

        setUp()
        fetcher.result = .success(try wrappedSnapshot())
        subject = flow(policy: policy)
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix(accuracy: 100.001))
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
        XCTAssertEqual(metrics.metrics.last?.outcome, .noVesselMatch)
    }

    // reject zero and multiple plausible matches
    func testZeroAndMultipleMatchesCreateNoCandidate() throws {
        fetcher.result = .success(try wrappedSnapshot(
            vesselLocations: [("144", 48.6, -123.5)]
        ))
        var subject = flow()
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())
        XCTAssertEqual(metrics.metrics.last?.outcome, .noVesselMatch)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)

        setUp()
        fetcher.result = .success(try wrappedSnapshot(
            vesselLocations: [("144", 47.6, -122.5), ("145", 47.6, -122.5)]
        ))
        subject = flow()
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())
        XCTAssertEqual(metrics.metrics.last?.outcome, .ambiguousVesselMatch)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
    }

    // accept one fetch completion only
    func testDeferredFetchCompletionCannotCreateASecondCandidate() throws {
        fetcher.defers = true
        fetcher.result = .success(try wrappedSnapshot())
        let subject = flow()
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())
        let completion = fetcher.deferredCompletion

        fetcher.complete()
        completion?(fetcher.result)

        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 1)
        XCTAssertEqual(subject.wipedDiagnosticCandidateCount, 1)
    }

    // invalidate an in-flight wake before late completion
    func testCancellationIgnoresLateFleetCompletion() throws {
        fetcher.defers = true
        fetcher.result = .success(try wrappedSnapshot())
        let subject = flow()
        XCTAssertTrue(subject.handleRegionEvent(.exit, lifecycle: .background))
        subject.receiveLocation(fix())

        subject.cancel()
        fetcher.complete()

        XCTAssertEqual(fetcher.fetchCount, 1)
        XCTAssertEqual(subject.createdDiagnosticCandidateCount, 0)
        XCTAssertEqual(subject.wipedDiagnosticCandidateCount, 0)
    }

    // expose only approved aggregate metric fields
    func testRuntimeMetricContainsOnlyApprovedRedactedFields() {
        let metric = AutomaticV0Metric(
            outcome: .diagnosticCandidateWiped,
            durationBucket: .underFiveSeconds
        )

        // collect stored metric fields
        let labels = Set(Mirror(reflecting: metric).children.compactMap { child in
            child.label
        })

        XCTAssertEqual(labels, [
            "schemaVersion", "capabilityVersion", "platformCohort", "detectorKind",
            "outcome", "count", "durationBucket",
        ])
        XCTAssertFalse(labels.contains("lifecycle"))
    }

    // distinguish ordinary relaunch from force-quit manual recovery
    func testLifecycleMatrixSeparatesOrdinaryTerminationAndForceQuit() {
        XCTAssertNotEqual(
            AutomaticV0LifecycleContext.ordinaryRegionRelaunch,
            AutomaticV0LifecycleContext.manualRelaunchAfterForceQuit
        )
    }

    // prove the v0 request has no credential or production route
    func testV0RequestHasNoCredentialUploadRefreshHistoryOrCreditSurface() throws {
        let request = try XCTUnwrap(AutomaticV0FleetSnapshotFetcher.diagnosticRequest())

        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://ferry.fyi/api/vessels/snapshot")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.httpBody)
        XCTAssertNotEqual(request.url?.path, "/api/vessels/refresh")
        XCTAssertFalse(request.url?.path.contains("leaderboards/native") == true)
        XCTAssertFalse(request.url?.path.contains("history") == true)
        XCTAssertFalse(request.url?.path.contains("credit") == true)
    }
}

#if DEBUG
// define the native contract
final class AutomaticV0DiagnosticHarnessTests: XCTestCase {
    // build one exact public diagnostic payload
    private func payloadData(contentHashOverride: String? = nil) throws -> Data {
        let generation = ConfigGeneration(value: 7)
        let regions = [AutomaticTerminalRegion(
            terminalId: "7",
            latitudeE7: 476_044_000,
            longitudeE7: -122_339_000,
            radiusMillimeters: 304_800,
            configGeneration: generation
        )]
        let contentHash = AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions)
        )
        let value: [String: Any] = [
            "schemaVersion": 1,
            "configGeneration": 7,
            "serverPolicyGeneration": 11,
            "contentHash": contentHashOverride ?? contentHash,
            "serverTimeMs": 1_720_000_000_000,
            "regions": [[
                "configGeneration": 7,
                "latitudeE7": 476_044_000,
                "longitudeE7": -122_339_000,
                "radiusMillimeters": 304_800,
                "terminalId": "7",
            ]],
        ]
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    // require one explicit debug launch argument
    func testHarnessRequiresExplicitLaunchAndSupportsReset() {
        XCTAssertFalse(AutomaticV0DiagnosticHarness.isRequested(arguments: ["Ferry FYI"]))
        XCTAssertTrue(AutomaticV0DiagnosticHarness.isRequested(arguments: [
            "Ferry FYI", AutomaticV0DiagnosticHarness.launchArgument,
        ]))
        XCTAssertTrue(AutomaticV0DiagnosticHarness.isResetRequested(arguments: [
            "Ferry FYI", AutomaticV0DiagnosticHarness.resetLaunchArgument,
        ]))
        XCTAssertTrue(AutomaticV0DiagnosticHarness.isForceQuitRecoveryRequested(arguments: [
            "Ferry FYI", AutomaticV0DiagnosticHarness.forceQuitRecoveryLaunchArgument,
        ]))
    }

    // parse one complete hash-bound physical input
    func testHarnessParsesOnlyCompletePublicConfig() throws {
        let data = try payloadData()
        let parsed = try XCTUnwrap(AutomaticV0DiagnosticHarness.parse(
            base64Payload: data.base64EncodedString()
        ))

        XCTAssertEqual(parsed.0, data)
        XCTAssertEqual(parsed.1.serverTimeMs, 1_720_000_000_000)
        XCTAssertEqual(parsed.1.config.configGeneration, ConfigGeneration(value: 7))
        XCTAssertEqual(parsed.1.config.regions.map(\.terminalId), ["7"])
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.regionIdentifiers(for: parsed.1.config),
            ["ferry-fyi-v0:7:Nw"]
        )
        XCTAssertNil(AutomaticV0DiagnosticHarness.parse(
            base64Payload: try payloadData(
                contentHashOverride: String(repeating: "0", count: 64)
            ).base64EncodedString()
        ))
    }

    // reject duplicate and unknown physical input fields
    func testHarnessRejectsNonExactJson() throws {
        let duplicate = Data(#"{"schemaVersion":1,"schemaVersion":1}"#.utf8)
        var unknown = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: payloadData()) as? [String: Any]
        )
        unknown["credential"] = "forbidden"
        let unknownData = try JSONSerialization.data(withJSONObject: unknown)

        XCTAssertNil(AutomaticV0DiagnosticHarness.parse(data: duplicate))
        XCTAssertNil(AutomaticV0DiagnosticHarness.parse(data: unknownData))
    }

    // preserve wall-progressed server time and fail rollback
    func testHarnessRelaunchAnchorBoundaries() {
        XCTAssertEqual(
            AutomaticV0DiagnosticHarness.adjustedServerTimeMs(
                serverTimeMs: 1_000,
                anchoredAtWallTimeMs: 500,
                currentWallTimeMs: 501
            ),
            1_001
        )
        XCTAssertNil(AutomaticV0DiagnosticHarness.adjustedServerTimeMs(
            serverTimeMs: 1_000,
            anchoredAtWallTimeMs: 500,
            currentWallTimeMs: 499
        ))
        XCTAssertNil(AutomaticV0DiagnosticHarness.adjustedServerTimeMs(
            serverTimeMs: 9_007_199_254_740_991,
            anchoredAtWallTimeMs: 0,
            currentWallTimeMs: 1
        ))
        XCTAssertEqual(
            AutomaticV0DiagnosticHarness.bootEpochMs(
                wallTimeMs: 1_720_000_010_000,
                systemUptimeSeconds: 10
            ),
            1_720_000_000_000
        )
        XCTAssertTrue(AutomaticV0DiagnosticHarness.isSameBoot(
            anchorBootEpochMs: 1_720_000_000_000,
            currentBootEpochMs: 1_720_000_005_000
        ))
        XCTAssertFalse(AutomaticV0DiagnosticHarness.isSameBoot(
            anchorBootEpochMs: 1_720_000_000_000,
            currentBootEpochMs: 1_720_000_005_001
        ))
    }

    // persist only protected no-backup public harness input
    func testHarnessStoreIsProtectedAtomicAndResettable() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ferry-v0-harness-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("harness.plist")
        // release protected state
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AutomaticV0DiagnosticHarnessStore(recordURL: url)
        let record = AutomaticV0DiagnosticHarnessRecord(
            payloadData: try payloadData(),
            anchoredAtWallTimeMs: 1_720_000_000_100,
            bootEpochMs: 1_719_999_000_000
        )

        XCTAssertTrue(store.store(record))
        XCTAssertTrue(store.hasRecord())
        XCTAssertEqual(store.load(), record)
        XCTAssertEqual(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        let protection = try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
            as? FileProtectionType
        #if targetEnvironment(simulator)
        // simulator omits protection metadata
        XCTAssertNil(protection)
        #else
        // devices enforce first-unlock protection
        XCTAssertEqual(protection, .completeUntilFirstUserAuthentication)
        #endif

        store.remove()
        XCTAssertFalse(store.hasRecord())
        XCTAssertNil(store.load())
    }
}
#endif

// define the native contract
final class AutomaticV0BuildConfigurationTests: XCTestCase {
    // keep ordinary builds disabled by default
    func testAppBundleKeepsDiagnosticFlagOff() {
        let appBundle = Bundle(for: GateABackgroundLocationFeasibility.self)
        XCTAssertEqual(
            appBundle.object(forInfoDictionaryKey: "GateABackgroundLocationFeasibilityEnabled") as? Bool,
            false
        )
    }

    // keep location background mode absent
    func testAppBundleHasNoLocationBackgroundMode() {
        let appBundle = Bundle(for: GateABackgroundLocationFeasibility.self)
        let modes = appBundle.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        XCTAssertFalse(modes.contains("location"))
    }

    // select persisted owned regions for bar-off cleanup
    func testPersistedOwnedRegionsAreRecoverableBeforeBARGate() {
        let owned = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 47.6, longitude: -122.5),
            radius: 100,
            identifier: "ferry-fyi-v0:7:MTQ0"
        )
        let unrelated = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 47.6, longitude: -122.5),
            radius: 100,
            identifier: "another-capability"
        )

        XCTAssertEqual(
            GateABackgroundLocationFeasibility.ownedIdentifiers(in: [owned, unrelated]),
            [owned.identifier]
        )
    }

    // stop persisted monitoring before downgraded relaunch health
    func testAuthorizationDowngradeStopsPersistedRegionsBeforeWork() {
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldStopPersistedMonitoring(
            authorizationStatus: .authorizedWhenInUse,
            ownedIdentifiers: ["ferry-fyi-v0:7:Nw"]
        ))
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldStopPersistedMonitoring(
            authorizationStatus: .denied,
            ownedIdentifiers: ["ferry-fyi-v0:7:Nw"]
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.shouldStopPersistedMonitoring(
            authorizationStatus: .authorizedAlways,
            ownedIdentifiers: ["ferry-fyi-v0:7:Nw"]
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.shouldStopPersistedMonitoring(
            authorizationStatus: .notDetermined,
            ownedIdentifiers: []
        ))
    }

    // retain pending siblings through asynchronous rollback
    func testRollbackRetainsAttemptedAndMonitoredIdentifiers() {
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.rollbackIdentifiers(
                attemptedIdentifiers: ["one", "two"],
                monitoredIdentifiers: ["one", "three"]
            ),
            ["one", "two", "three"]
        )
    }

    // stop late abandoned callbacks without touching unrelated regions
    func testLateStartedRegionsAreStoppedAfterRollback() {
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldStopStartedRegion(
            identifier: "ferry-fyi-v0:7:one",
            currentIdentifiers: [],
            cancelledIdentifiers: ["ferry-fyi-v0:7:one"],
            registrationTerminated: false
        ))
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldStopStartedRegion(
            identifier: "ferry-fyi-v0:7:two",
            currentIdentifiers: ["ferry-fyi-v0:7:two"],
            cancelledIdentifiers: [],
            registrationTerminated: true
        ))
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldStopStartedRegion(
            identifier: "ferry-fyi-v0:7:unknown",
            currentIdentifiers: ["ferry-fyi-v0:7:current"],
            cancelledIdentifiers: [],
            registrationTerminated: false
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.shouldStopStartedRegion(
            identifier: "ferry-fyi-v0:7:current",
            currentIdentifiers: ["ferry-fyi-v0:7:current"],
            cancelledIdentifiers: [],
            registrationTerminated: false
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.shouldStopStartedRegion(
            identifier: "another-capability",
            currentIdentifiers: [],
            cancelledIdentifiers: [],
            registrationTerminated: true
        ))
    }

    // activate only one exact confirmed os-owned generation
    func testRegistrationActivationRequiresExactCompleteSet() {
        XCTAssertTrue(GateABackgroundLocationFeasibility.isCompleteOwnedRegistration(
            ownedIdentifiers: ["one", "two"],
            confirmedIdentifiers: ["one", "two"],
            monitoredIdentifiers: ["one", "two"],
            registrationTerminated: false
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.isCompleteOwnedRegistration(
            ownedIdentifiers: ["one", "two"],
            confirmedIdentifiers: ["one"],
            monitoredIdentifiers: ["one", "two"],
            registrationTerminated: false
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.isCompleteOwnedRegistration(
            ownedIdentifiers: ["one", "two"],
            confirmedIdentifiers: ["one", "two"],
            monitoredIdentifiers: ["one", "two", "late"],
            registrationTerminated: false
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.isCompleteOwnedRegistration(
            ownedIdentifiers: ["one", "two"],
            confirmedIdentifiers: ["one", "two"],
            monitoredIdentifiers: ["one", "two"],
            registrationTerminated: true
        ))
    }

    // preserve health only for one complete confirmed set
    func testForegroundConfigurationDoesNotDowngradeOrOverstateHealth() {
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.resolvedCapabilityState(
                currentState: .monitoring,
                ownedIdentifiers: ["one", "two"],
                confirmedIdentifiers: ["one", "two"],
                hasTrustedServerTime: true
            ),
            .monitoring
        )
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.resolvedCapabilityState(
                currentState: .monitoring,
                ownedIdentifiers: ["one", "two"],
                confirmedIdentifiers: ["one"],
                hasTrustedServerTime: true
            ),
            .diagnosticReady
        )
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.resolvedCapabilityState(
                currentState: .disabled,
                ownedIdentifiers: ["one", "two"],
                confirmedIdentifiers: ["one", "two"],
                hasTrustedServerTime: true
            ),
            .monitoring
        )
        XCTAssertEqual(
            GateABackgroundLocationFeasibility.resolvedCapabilityState(
                currentState: .disabled,
                ownedIdentifiers: ["one", "two"],
                confirmedIdentifiers: ["one", "two"],
                hasTrustedServerTime: false
            ),
            .awaitingServerTime
        )
    }

    // reserve ordinary relaunch work for the region callback
    func testOrdinaryRelaunchDoesNotRacePolicyPrefetch() {
        XCTAssertTrue(GateABackgroundLocationFeasibility.shouldPrefetchAfterPolicyContact(
            lifecycle: .foreground
        ))
        XCTAssertFalse(GateABackgroundLocationFeasibility.shouldPrefetchAfterPolicyContact(
            lifecycle: .ordinaryRegionRelaunch
        ))
    }
}

// define the native contract
final class AutomaticV0FleetFileCacheTests: XCTestCase {
    // build one body-only context
    private func context() throws -> AutomaticV0FleetContext {
        let data = Data(#"{"wsfStatus":{"offline":false},"body":{"sourceUpdatedAt":1720000000,"vessels":{}}}"#.utf8)
        return try XCTUnwrap(AutomaticV0FleetEnvelopeParser.parse(data))
    }

    // persist only canonical body hash and receive time
    func testCacheRecordContainsNoOuterStatusCandidateOrCredential() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ferry-v0-cache-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("fleet.plist")
        // release protected state
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = AutomaticV0FleetFileCache(cacheURL: url)
        let record = AutomaticV0FleetCacheRecord(context: try context(), receivedAtMs: 1_720_000_000_000)

        XCTAssertTrue(cache.store(record))
        let replacement = AutomaticV0FleetCacheRecord(
            context: record.context,
            receivedAtMs: record.receivedAtMs + 1
        )
        XCTAssertTrue(cache.store(replacement))
        XCTAssertEqual(cache.load(), replacement)

        let bytes = try Data(contentsOf: url)
        let value = try XCTUnwrap(
            try PropertyListSerialization.propertyList(from: bytes, format: nil) as? [String: Any]
        )
        XCTAssertEqual(Set(value.keys), ["body", "bodyHashHex", "receivedAtMs"])
        XCTAssertNil(value["wsfStatus"])
        XCTAssertNil(value["candidate"])
        XCTAssertNil(value["credential"])
        XCTAssertEqual(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        let protection = try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
            as? FileProtectionType
        #if targetEnvironment(simulator)
        // simulator omits protection metadata
        XCTAssertNil(protection)
        #else
        // devices enforce first-unlock protection
        XCTAssertEqual(protection, .completeUntilFirstUserAuthentication)
        #endif
    }

    // reject a corrupted body hash
    func testCacheHashCorruptionFailsClosed() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ferry-v0-cache-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("fleet.plist")
        // release protected state
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let payload: [String: Any] = [
            "body": try context().canonicalBody,
            "bodyHashHex": String(repeating: "0", count: 64),
            "receivedAtMs": 1_720_000_000_000,
        ]
        let bytes = try PropertyListSerialization.data(
            fromPropertyList: payload,
            format: .binary,
            options: 0
        )
        try bytes.write(to: url)

        XCTAssertNil(AutomaticV0FleetFileCache(cacheURL: url).load())
    }
}
