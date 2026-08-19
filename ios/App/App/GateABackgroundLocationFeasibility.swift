import CoreLocation
import CoreFoundation
import Foundation
import UIKit

#if DEBUG
// define the native contract
struct AutomaticV0DiagnosticHarnessPayload: Equatable {
    let serverTimeMs: Int64
    let config: AutomaticTerminalConfigGeneration
}

// define the native contract
struct AutomaticV0DiagnosticHarnessRecord: Equatable {
    let payloadData: Data
    let anchoredAtWallTimeMs: Int64
    let bootEpochMs: Int64
}

/// debug-only physical-device control surface
enum AutomaticV0DiagnosticHarness {
    static let launchArgument = "-FerryFYIAutomaticV0Diagnostic"
    static let resetLaunchArgument = "-FerryFYIAutomaticV0DiagnosticReset"
    static let forceQuitRecoveryLaunchArgument = "-FerryFYIAutomaticV0DiagnosticForceQuitRecovery"
    static let payloadEnvironmentKey = "FERRY_FYI_V0_DIAGNOSTIC_PAYLOAD_BASE64"
    private static let payloadKeys: Set<String> = [
        "schemaVersion", "configGeneration", "serverPolicyGeneration", "contentHash",
        "serverTimeMs", "regions",
    ]
    private static let regionKeys: Set<String> = [
        "configGeneration", "latitudeE7", "longitudeE7", "radiusMillimeters", "terminalId",
    ]
    private static let maximumSafeInteger: Int64 = 9_007_199_254_740_991
    private static let bootEpochToleranceMs: Int64 = 5_000

    // detect one explicit diagnostic launch
    static func isRequested(arguments: [String]) -> Bool {
        arguments.contains(launchArgument)
    }

    // detect one explicit diagnostic reset
    static func isResetRequested(arguments: [String]) -> Bool {
        arguments.contains(resetLaunchArgument)
    }

    // detect an explicitly observed manual force-quit recovery
    static func isForceQuitRecoveryRequested(arguments: [String]) -> Bool {
        arguments.contains(forceQuitRecoveryLaunchArgument)
    }

    // decode one exact public diagnostic config
    static func parse(base64Payload: String) -> (Data, AutomaticV0DiagnosticHarnessPayload)? {
        // require canonical base64 input
        guard let data = Data(base64Encoded: base64Payload),
              let payload = parse(data: data) else {
            return nil
        }

        return (data, payload)
    }

    // parse one exact public diagnostic config
    static func parse(data: Data) -> AutomaticV0DiagnosticHarnessPayload? {
        // require the exact top-level shape
        guard StrictJSONDuplicateKeyValidator.validate(data),
              let rawValue = try? JSONSerialization.jsonObject(with: data),
              let value = rawValue as? [String: Any],
              Set(value.keys) == payloadKeys,
              strictInt(value["schemaVersion"]) == 1,
              let configGeneration = strictInt64(value["configGeneration"]),
              configGeneration > 0,
              let serverPolicyGeneration = strictInt64(value["serverPolicyGeneration"]),
              serverPolicyGeneration >= 0,
              let serverTimeMs = strictInt64(value["serverTimeMs"]),
              serverTimeMs >= 0,
              let contentHash = value["contentHash"] as? String,
              contentHash.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let rawRegions = value["regions"] as? [Any],
              !rawRegions.isEmpty,
              rawRegions.count <= 20 else {
            return nil
        }

        let generation = ConfigGeneration(value: configGeneration)
        var terminalIds = Set<String>()
        var regions: [AutomaticTerminalRegion] = []

        // validate every fixed region
        for rawRegion in rawRegions {
            // require exact generation-bound geometry
            guard let region = rawRegion as? [String: Any],
                  Set(region.keys) == regionKeys,
                  let regionGeneration = strictInt64(region["configGeneration"]),
                  regionGeneration == configGeneration,
                  let latitudeE7 = strictInt32(region["latitudeE7"]),
                  (Int32(-900_000_000)...Int32(900_000_000)).contains(latitudeE7),
                  let longitudeE7 = strictInt32(region["longitudeE7"]),
                  (Int32(-1_800_000_000)...Int32(1_800_000_000)).contains(longitudeE7),
                  let radiusMillimeters = strictUInt32(region["radiusMillimeters"]),
                  radiusMillimeters > 0,
                  let terminalId = region["terminalId"] as? String,
                  isValidTerminalId(terminalId),
                  terminalIds.insert(terminalId).inserted else {
                return nil
            }

            regions.append(AutomaticTerminalRegion(
                terminalId: terminalId,
                latitudeE7: latitudeE7,
                longitudeE7: longitudeE7,
                radiusMillimeters: radiusMillimeters,
                configGeneration: generation
            ))
        }

        // require the canonical public content hash
        guard AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions)
        ) == contentHash else {
            return nil
        }

        return AutomaticV0DiagnosticHarnessPayload(
            serverTimeMs: serverTimeMs,
            config: AutomaticTerminalConfigGeneration(
                schemaVersion: 1,
                configGeneration: generation,
                serverPolicyGeneration: ServerPolicyGeneration(value: serverPolicyGeneration),
                contentHashHex: contentHash,
                regions: regions
            )
        )
    }

    // advance one persisted server anchor conservatively
    static func adjustedServerTimeMs(
        serverTimeMs: Int64,
        anchoredAtWallTimeMs: Int64,
        currentWallTimeMs: Int64
    ) -> Int64? {
        // reject rollback and unsafe anchors
        guard serverTimeMs >= 0,
              serverTimeMs <= maximumSafeInteger,
              anchoredAtWallTimeMs >= 0,
              currentWallTimeMs >= anchoredAtWallTimeMs else {
            return nil
        }

        let (elapsedMs, elapsedOverflow) = currentWallTimeMs.subtractingReportingOverflow(
            anchoredAtWallTimeMs
        )
        let (adjustedTimeMs, adjustedOverflow) = serverTimeMs.addingReportingOverflow(elapsedMs)
        // reject adjusted-time overflow
        guard !elapsedOverflow,
              !adjustedOverflow,
              adjustedTimeMs <= maximumSafeInteger else {
            return nil
        }

        return adjustedTimeMs
    }

    // derive one debug-only boot identity
    static func bootEpochMs(wallTimeMs: Int64, systemUptimeSeconds: TimeInterval) -> Int64? {
        let uptimeMs = systemUptimeSeconds * 1_000
        // require bounded elapsed time
        guard wallTimeMs >= 0,
              systemUptimeSeconds.isFinite,
              systemUptimeSeconds >= 0,
              uptimeMs <= Double(maximumSafeInteger) else {
            return nil
        }

        let roundedUptimeMs = Int64(uptimeMs.rounded(.down))
        // reject impossible wall ordering
        guard wallTimeMs >= roundedUptimeMs else {
            return nil
        }

        return wallTimeMs - roundedUptimeMs
    }

    // compare one bounded boot identity
    static func isSameBoot(anchorBootEpochMs: Int64, currentBootEpochMs: Int64) -> Bool {
        let (difference, overflow) = anchorBootEpochMs.subtractingReportingOverflow(currentBootEpochMs)
        // reject unrepresentable differences
        guard !overflow,
              difference != Int64.min else {
            return false
        }

        return abs(difference) <= bootEpochToleranceMs
    }

    // parse one exact signed integer
    private static func strictInt64(_ value: Any?) -> Int64? {
        // require a json safe integer
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(Int64.min),
              number.doubleValue <= Double(maximumSafeInteger) else {
            return nil
        }

        return number.int64Value
    }

    // parse one exact platform integer
    private static func strictInt(_ value: Any?) -> Int? {
        // require platform bounds
        guard let integer = strictInt64(value),
              integer >= Int64(Int.min),
              integer <= Int64(Int.max) else {
            return nil
        }

        return Int(integer)
    }

    // parse one exact signed coordinate
    private static func strictInt32(_ value: Any?) -> Int32? {
        // require signed coordinate bounds
        guard let integer = strictInt64(value),
              integer >= Int64(Int32.min),
              integer <= Int64(Int32.max) else {
            return nil
        }

        return Int32(integer)
    }

    // parse one exact unsigned radius
    private static func strictUInt32(_ value: Any?) -> UInt32? {
        // require unsigned radius bounds
        guard let integer = strictInt64(value),
              integer >= 0,
              integer <= Int64(UInt32.max) else {
            return nil
        }

        return UInt32(integer)
    }

    // validate one bounded public terminal id
    private static func isValidTerminalId(_ value: String) -> Bool {
        // reject empty, oversized, or control-bearing ids
        if value.isEmpty || value.utf8.count > 128 || value.unicodeScalars.contains(where: { scalar in
            scalar.value <= 0x1f || scalar.value == 0x7f
        }) {
            return false
        }

        return true
    }
}

/// protected debug-only relaunch configuration
final class AutomaticV0DiagnosticHarnessStore {
    private static let recordKeys: Set<String> = ["payloadData", "anchoredAtWallTimeMs", "bootEpochMs"]
    private let fileManager: FileManager
    private let recordURL: URL

    // inject one protected no-backup location
    init(fileManager: FileManager = .default, recordURL: URL? = nil) {
        self.fileManager = fileManager
        self.recordURL = recordURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("leaderboard-v0-diagnostic-harness.plist", isDirectory: false)
    }

    // report whether an opt-in record exists
    func hasRecord() -> Bool {
        fileManager.fileExists(atPath: recordURL.path)
    }

    // load one exact public configuration record
    func load() -> AutomaticV0DiagnosticHarnessRecord? {
        // require exact protected record fields
        guard let data = try? Data(contentsOf: recordURL),
              let rawValue = try? PropertyListSerialization.propertyList(from: data, format: nil),
              let value = rawValue as? [String: Any],
              Set(value.keys) == Self.recordKeys,
              let payloadData = value["payloadData"] as? Data,
              let anchoredAtWallTimeMs = Self.strictTimestamp(value["anchoredAtWallTimeMs"]),
              let bootEpochMs = Self.strictTimestamp(value["bootEpochMs"]),
              StrictJSONDuplicateKeyValidator.validate(payloadData) else {
            return nil
        }

        return AutomaticV0DiagnosticHarnessRecord(
            payloadData: payloadData,
            anchoredAtWallTimeMs: anchoredAtWallTimeMs,
            bootEpochMs: bootEpochMs
        )
    }

    // atomically persist only public harness inputs
    func store(_ record: AutomaticV0DiagnosticHarnessRecord) -> Bool {
        let directoryURL = recordURL.deletingLastPathComponent()

        // create the protected directory
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        // fail closed on the error
        } catch {
            return false
        }

        let value: [String: Any] = [
            "payloadData": record.payloadData,
            "anchoredAtWallTimeMs": record.anchoredAtWallTimeMs,
            "bootEpochMs": record.bootEpochMs,
        ]
        // require one binary public record
        guard let data = try? PropertyListSerialization.data(
            fromPropertyList: value,
            format: .binary,
            options: 0
        ) else {
            return false
        }

        let temporaryURL = directoryURL.appendingPathComponent(".v0-harness-\(UUID().uuidString).tmp")

        // replace the harness record atomically
        do {
            try data.write(to: temporaryURL)
            try protectAndExclude(temporaryURL)

            // replace an earlier opt-in record
            if fileManager.fileExists(atPath: recordURL.path) {
                _ = try fileManager.replaceItemAt(recordURL, withItemAt: temporaryURL)
            // branch on the current state
            } else {
                try fileManager.moveItem(at: temporaryURL, to: recordURL)
            }

            try protectAndExclude(recordURL)
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
    }

    // remove one explicit diagnostic opt-in
    func remove() {
        try? fileManager.removeItem(at: recordURL)
    }

    // parse one exact protected timestamp
    private static func strictTimestamp(_ value: Any?) -> Int64? {
        // require one json-safe timestamp
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= 0,
              number.doubleValue <= 9_007_199_254_740_991 else {
            return nil
        }

        return number.int64Value
    }

    // apply first-unlock and no-backup policy
    private func protectAndExclude(_ url: URL) throws {
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = url
        try mutableURL.setResourceValues(values)
    }
}
#endif

// define the native contract
enum GateAAutomaticCapabilityState: String, Equatable {
    case disabled
    case manualFallbackRequired
    case awaitingServerTime
    case diagnosticReady
    case registering
    case monitoring
    case degraded
}

/// disabled-by-default t0/v0 native feasibility manager
final class GateABackgroundLocationFeasibility: NSObject {
    static let shared = GateABackgroundLocationFeasibility()

    private static let ownedRegionPrefix = "ferry-fyi-v0:"
    private static let maximumOwnedRegions = 20
    private var locationManager: CLLocationManager?
    private var diagnosticFlow: AutomaticV0DiagnosticFlow?
    private var trustedServerTimeMs: Int64?
    private var trustedServerTimeReceivedAtMs: Int64?
    private var lifecycleContext: AutomaticV0LifecycleContext = .foreground
    private var ownedRegionIdentifiers = Set<String>()
    private var confirmedRegionIdentifiers = Set<String>()
    private var attemptedRegionsByIdentifier: [String: CLRegion] = [:]
    private var cancelledRegionIdentifiers = Set<String>()
    private var registrationTerminated = false
    private var authorizationDowngradeDiscovered = false
    private(set) var capabilityState: GateAAutomaticCapabilityState = .disabled
    private(set) var lastMetric: AutomaticV0Metric?
    private(set) var lastLifecycleContext: AutomaticV0LifecycleContext = .foreground
#if DEBUG
    private let diagnosticHarnessStore = AutomaticV0DiagnosticHarnessStore()
    private var diagnosticHarnessPayload: AutomaticV0DiagnosticHarnessPayload?
    private var diagnosticHarnessAnchoredAtWallTimeMs: Int64?
    private var diagnosticHarnessBootEpochMs: Int64?
    private var diagnosticHarnessForegroundPermissionRequested = false
    private var diagnosticHarnessBackgroundPermissionRequested = false
#endif

    // derive the current native value
    private var isEnabled: Bool {
#if DEBUG
        let processInfo = ProcessInfo.processInfo

        // make an explicit reset terminal
        if AutomaticV0DiagnosticHarness.isResetRequested(arguments: processInfo.arguments) {
            return false
        }

        // allow only an explicit debug opt-in or its protected relaunch record
        if AutomaticV0DiagnosticHarness.isRequested(arguments: processInfo.arguments) {
            return true
        }

        return UIApplication.shared.isProtectedDataAvailable && diagnosticHarnessStore.hasRecord()
#else
        return false
#endif
    }

#if DEBUG
    // persist one explicit debug-only physical-run input
    func prepareDiagnosticHarnessAtLaunch() {
        let processInfo = ProcessInfo.processInfo

        // remove the relaunch opt-in explicitly
        if AutomaticV0DiagnosticHarness.isResetRequested(arguments: processInfo.arguments) {
            // recover persisted owned regions before clearing opt-in state
            if locationManager == nil {
                let manager = CLLocationManager()
                manager.delegate = self
                locationManager = manager
                ownedRegionIdentifiers = Self.ownedIdentifiers(in: manager.monitoredRegions)
                confirmedRegionIdentifiers = ownedRegionIdentifiers
            }

            stopOwnedMonitoring()
            diagnosticHarnessStore.remove()
            diagnosticHarnessPayload = nil
            diagnosticHarnessAnchoredAtWallTimeMs = nil
            diagnosticHarnessBootEpochMs = nil
            capabilityState = .disabled
            return
        }

        // ignore ordinary debug launches
        guard AutomaticV0DiagnosticHarness.isRequested(arguments: processInfo.arguments) else {
            return
        }

        // never materialize harness input before first unlock
        guard UIApplication.shared.isProtectedDataAvailable else {
            return
        }

        // require an exact launch payload
        guard let base64Payload = processInfo.environment[
            AutomaticV0DiagnosticHarness.payloadEnvironmentKey
        ],
              let (payloadData, payload) = AutomaticV0DiagnosticHarness.parse(
                  base64Payload: base64Payload
              ) else {
            diagnosticHarnessStore.remove()
            return
        }

        let anchoredAtWallTimeMs = Self.wallClockMs()
        // bind the input to this boot
        guard let bootEpochMs = AutomaticV0DiagnosticHarness.bootEpochMs(
            wallTimeMs: anchoredAtWallTimeMs,
            systemUptimeSeconds: ProcessInfo.processInfo.systemUptime
        ) else {
            diagnosticHarnessStore.remove()
            return
        }

        let record = AutomaticV0DiagnosticHarnessRecord(
            payloadData: payloadData,
            anchoredAtWallTimeMs: anchoredAtWallTimeMs,
            bootEpochMs: bootEpochMs
        )
        // require protected relaunch continuity
        guard diagnosticHarnessStore.store(record) else {
            diagnosticHarnessStore.remove()
            return
        }

        diagnosticHarnessPayload = payload
        diagnosticHarnessAnchoredAtWallTimeMs = anchoredAtWallTimeMs
        diagnosticHarnessBootEpochMs = bootEpochMs
    }

    // advance permission and registration for one physical run
    func reconcileDiagnosticHarnessIfEnabled() {
        // remain inert outside explicit runs
        guard isEnabled else {
            return
        }

        configureIfEnabled()

        // stop relaunch reconciliation after an authorization downgrade
        guard !authorizationDowngradeDiscovered else {
            return
        }

        // keep a failed registration terminal for this process
        guard !registrationTerminated else {
            return
        }

        // label only an explicit physical force-quit recovery
        if AutomaticV0DiagnosticHarness.isForceQuitRecoveryRequested(
            arguments: ProcessInfo.processInfo.arguments
        ) {
            noteManualRelaunchAfterForceQuitForDiagnostic()
        }

        // preserve bar-off as terminal manual fallback
        guard UIApplication.shared.backgroundRefreshStatus == .available else {
            return
        }

        // stop before protected public input can be read
        guard UIApplication.shared.isProtectedDataAvailable else {
            capabilityState = .manualFallbackRequired
            recordFixed(.protectedDataUnavailable)
            return
        }

        // restore public config for an ordinary os relaunch
        if diagnosticHarnessPayload == nil ||
            diagnosticHarnessAnchoredAtWallTimeMs == nil ||
            diagnosticHarnessBootEpochMs == nil {
            // require one valid protected relaunch input
            guard let record = diagnosticHarnessStore.load(),
                  let payload = AutomaticV0DiagnosticHarness.parse(data: record.payloadData) else {
                capabilityState = .degraded
                recordFixed(.monitoringUnavailable)
                return
            }

            diagnosticHarnessPayload = payload
            diagnosticHarnessAnchoredAtWallTimeMs = record.anchoredAtWallTimeMs
            diagnosticHarnessBootEpochMs = record.bootEpochMs
        }

        let currentWallTimeMs = Self.wallClockMs()
        // require same-boot trusted setup state
        guard let payload = diagnosticHarnessPayload,
              let anchoredAtWallTimeMs = diagnosticHarnessAnchoredAtWallTimeMs,
              let anchorBootEpochMs = diagnosticHarnessBootEpochMs,
              let currentBootEpochMs = AutomaticV0DiagnosticHarness.bootEpochMs(
                wallTimeMs: currentWallTimeMs,
                systemUptimeSeconds: ProcessInfo.processInfo.systemUptime
              ),
              AutomaticV0DiagnosticHarness.isSameBoot(
                anchorBootEpochMs: anchorBootEpochMs,
                currentBootEpochMs: currentBootEpochMs
              ),
              let adjustedServerTimeMs = AutomaticV0DiagnosticHarness.adjustedServerTimeMs(
                serverTimeMs: payload.serverTimeMs,
                anchoredAtWallTimeMs: anchoredAtWallTimeMs,
                currentWallTimeMs: currentWallTimeMs
              ),
              refreshServerTimeIfEnabled(adjustedServerTimeMs),
              let locationManager else {
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
            return
        }

        let expectedIdentifiers = Self.regionIdentifiers(for: payload.config)

        // reject a persisted set from another generation
        if capabilityState != .registering &&
            (ownedRegionIdentifiers != expectedIdentifiers ||
                confirmedRegionIdentifiers != expectedIdentifiers) {
            capabilityState = .diagnosticReady
        }

        // progress the explicit foreground-then-always sequence
        switch locationManager.authorizationStatus {
        case .notDetermined:
            // avoid duplicate foreground prompts
            if !diagnosticHarnessForegroundPermissionRequested {
                diagnosticHarnessForegroundPermissionRequested = true
                _ = requestForegroundAuthorizationIfEnabled()
            }
        case .authorizedWhenInUse:
            // avoid duplicate always prompts
            if !diagnosticHarnessBackgroundPermissionRequested {
                diagnosticHarnessBackgroundPermissionRequested = true
                _ = requestBackgroundAuthorizationIfEnabled()
            }
        case .authorizedAlways:
            // preserve an active complete generation
            if capabilityState != .monitoring && capabilityState != .registering {
                _ = installDiagnosticRegionsIfEnabled(payload.config)
            }
        case .denied, .restricted:
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
        @unknown default:
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
        }
    }
#endif

    // configure only the explicit diagnostic build
    func configureIfEnabled(launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) {
        // remain inert by default
        guard isEnabled else {
            capabilityState = .disabled
            return
        }

        // install one core location boundary
        if locationManager == nil {
            lifecycleContext = launchOptions?[.location] == nil ? .foreground : .ordinaryRegionRelaunch
            lastLifecycleContext = lifecycleContext
            let manager = CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            locationManager = manager
            ownedRegionIdentifiers = Self.ownedIdentifiers(in: manager.monitoredRegions)
            confirmedRegionIdentifiers = ownedRegionIdentifiers
        }

        // stop persisted monitoring before any downgraded relaunch work
        if let locationManager,
           Self.shouldStopPersistedMonitoring(
               authorizationStatus: locationManager.authorizationStatus,
               ownedIdentifiers: ownedRegionIdentifiers
           ) {
            authorizationDowngradeDiscovered = true
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
            return
        }

        // require background app refresh
        guard UIApplication.shared.backgroundRefreshStatus == .available else {
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.backgroundRefreshUnavailable)
            return
        }

        // install one bounded diagnostic flow
        if diagnosticFlow == nil {
            diagnosticFlow = AutomaticV0DiagnosticFlow(
                locationRequester: self,
                fleetFetcher: AutomaticV0FleetSnapshotFetcher(),
                fleetCache: AutomaticV0FleetFileCache(),
                metricRecorder: self,
                // run the bounded callback
                protectedDataAvailable: {
                    UIApplication.shared.isProtectedDataAvailable
                },
                // run the bounded callback
                trustedNowMs: { [weak self] in
                    self?.trustedNowMs()
                }
            )
        }

        capabilityState = Self.resolvedCapabilityState(
            currentState: capabilityState,
            ownedIdentifiers: ownedRegionIdentifiers,
            confirmedIdentifiers: confirmedRegionIdentifiers,
            hasTrustedServerTime: trustedServerTimeMs != nil
        )
    }

    // anchor diagnostic freshness after https policy contact
    @discardableResult
    func refreshServerTimeIfEnabled(_ serverTimeMs: Int64) -> Bool {
        // require one active non-terminal diagnostic run
        guard isEnabled,
              !authorizationDowngradeDiscovered,
              !registrationTerminated,
              serverTimeMs >= 0,
              serverTimeMs <= 9_007_199_254_740_991 else {
            return false
        }

        trustedServerTimeMs = serverTimeMs
        trustedServerTimeReceivedAtMs = Self.wallClockMs()

        // expose truthful relaunch health after a valid anchor
        capabilityState = Self.resolvedCapabilityState(
            currentState: capabilityState,
            ownedIdentifiers: ownedRegionIdentifiers,
            confirmedIdentifiers: confirmedRegionIdentifiers,
            hasTrustedServerTime: true
        )

        // reserve an ordinary region relaunch for its callback
        if Self.shouldPrefetchAfterPolicyContact(lifecycle: lifecycleContext) {
            _ = diagnosticFlow?.prefetchFleetIfDue(lifecycle: lifecycleContext)
        }

        return true
    }

    // request foreground permission first
    @discardableResult
    func requestForegroundAuthorizationIfEnabled() -> Bool {
        // branch on the current state
        guard isEnabled else {
            return false
        }

        configureIfEnabled()

        // require a live registration process
        guard let locationManager,
              !registrationTerminated,
              locationManager.authorizationStatus == .notDetermined else {
            return false
        }

        locationManager.requestWhenInUseAuthorization()
        return true
    }

    // request always only after foreground grant
    @discardableResult
    func requestBackgroundAuthorizationIfEnabled() -> Bool {
        // branch on the current state
        guard isEnabled else {
            return false
        }

        configureIfEnabled()

        // require a live registration process
        guard let locationManager,
              !registrationTerminated,
              locationManager.authorizationStatus == .authorizedWhenInUse else {
            return false
        }

        locationManager.requestAlwaysAuthorization()
        return true
    }

    // install one complete native-only diagnostic generation
    @discardableResult
    func installDiagnosticRegionsIfEnabled(_ config: AutomaticTerminalConfigGeneration) -> Bool {
        // branch on the current state
        guard isEnabled else {
            return false
        }

        configureIfEnabled()

        // fail closed before first unlock
        if !UIApplication.shared.isProtectedDataAvailable {
            capabilityState = .manualFallbackRequired
            recordFixed(.protectedDataUnavailable)
            return false
        }

        // require the complete healthy diagnostic boundary
        guard let locationManager,
              !registrationTerminated,
              !authorizationDowngradeDiscovered,
              capabilityState == .diagnosticReady || capabilityState == .monitoring,
              UIApplication.shared.backgroundRefreshStatus == .available,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
              locationManager.authorizationStatus == .authorizedAlways,
              isCompleteDiagnosticConfig(config) else {
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
            return false
        }

        let maximumRadius = locationManager.maximumRegionMonitoringDistance
        var attemptedRegions: [CLCircularRegion] = []

        // build the complete fixed set first
        for region in config.regions {
            let radiusMeters = Double(region.radiusMillimeters) / 1_000

            // reject invalid or unsupported regions
            if radiusMeters <= 0 || radiusMeters > maximumRadius {
                capabilityState = .degraded
                recordFixed(.monitoringFailed)
                return false
            }

            let identifier = Self.regionIdentifier(
                generation: config.configGeneration,
                terminalId: region.terminalId
            )
            let monitoredRegion = CLCircularRegion(
                center: CLLocationCoordinate2D(
                    latitude: Double(region.latitudeE7) / 10_000_000,
                    longitude: Double(region.longitudeE7) / 10_000_000
                ),
                radius: radiusMeters,
                identifier: identifier
            )
            monitoredRegion.notifyOnEntry = true
            monitoredRegion.notifyOnExit = true
            attemptedRegions.append(monitoredRegion)
        }

        let attemptedIdentifiers = Set(attemptedRegions.map(\.identifier))

        // keep an already complete generation idempotent
        if capabilityState == .monitoring,
           ownedRegionIdentifiers == attemptedIdentifiers,
           confirmedRegionIdentifiers == attemptedIdentifiers {
            return true
        }

        // never reuse an in-flight or cancelled identifier in this process
        guard ownedRegionIdentifiers.isDisjoint(with: attemptedIdentifiers),
              cancelledRegionIdentifiers.isDisjoint(with: attemptedIdentifiers) else {
            capabilityState = .degraded
            recordFixed(.monitoringFailed)
            return false
        }

        stopOwnedMonitoring(blockFurtherRegistration: false)
        ownedRegionIdentifiers = attemptedIdentifiers
        confirmedRegionIdentifiers.removeAll()
        // retain concrete regions until activation completes
        attemptedRegionsByIdentifier = Dictionary(
            // run the bounded callback
            uniqueKeysWithValues: attemptedRegions.map { region in
                (region.identifier, region)
            }
        )
        capabilityState = .registering

        // register each fixed region without a timer
        for region in attemptedRegions {
            locationManager.startMonitoring(for: region)
        }

        return true
    }

    // recheck truthful background state
    func applicationDidEnterBackground() {
        // branch on the current state
        guard isEnabled else {
            return
        }

        lifecycleContext = .background
        lastLifecycleContext = lifecycleContext

        // stop new work when bar is off
        if UIApplication.shared.backgroundRefreshStatus != .available {
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.backgroundRefreshUnavailable)
        }
    }

    // reconcile after manual foreground open
    func applicationWillEnterForeground() {
        // branch on the current state
        guard isEnabled else {
            return
        }

        lifecycleContext = .foreground
        lastLifecycleContext = lifecycleContext
        configureIfEnabled()

        // preserve manual fallback after an authorization downgrade
        guard !authorizationDowngradeDiscovered,
              !registrationTerminated else {
            return
        }

        _ = diagnosticFlow?.prefetchFleetIfDue(lifecycle: lifecycleContext)
    }

    // label explicit force-quit recovery only after manual open
    func noteManualRelaunchAfterForceQuitForDiagnostic() {
        // branch on the current state
        guard isEnabled else {
            return
        }

        lifecycleContext = .manualRelaunchAfterForceQuit
        lastLifecycleContext = lifecycleContext
    }

    // derive anchored diagnostic time
    private func trustedNowMs() -> Int64? {
        // branch on the current state
        guard let trustedServerTimeMs,
              let trustedServerTimeReceivedAtMs else {
            return nil
        }

        let currentWallTimeMs = Self.wallClockMs()

        // fail closed on wall rollback
        if currentWallTimeMs < trustedServerTimeReceivedAtMs {
            return nil
        }

        let (elapsedMs, elapsedOverflow) = currentWallTimeMs.subtractingReportingOverflow(
            trustedServerTimeReceivedAtMs
        )
        let (trustedNowMs, trustedOverflow) = trustedServerTimeMs.addingReportingOverflow(elapsedMs)
        return elapsedOverflow || trustedOverflow ? nil : trustedNowMs
    }

    // return millisecond wall time
    private static func wallClockMs() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1_000).rounded(.down))
    }

    // namespace one owned region
    private static func regionIdentifier(generation: ConfigGeneration, terminalId: String) -> String {
        let terminalData = Data(terminalId.utf8)
        let terminalToken = terminalData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "\(ownedRegionPrefix)\(generation.value):\(terminalToken)"
    }

    // derive one complete owned namespace
    static func regionIdentifiers(for config: AutomaticTerminalConfigGeneration) -> Set<String> {
        // run the bounded callback
        Set(config.regions.map { region in
            regionIdentifier(
                generation: config.configGeneration,
                terminalId: region.terminalId
            )
        })
    }

    // select only this capability namespace
    static func ownedIdentifiers(in regions: Set<CLRegion>) -> Set<String> {
        // run the bounded callback
        let identifiers = regions.compactMap { region in
            region.identifier.hasPrefix(ownedRegionPrefix) ? region.identifier : nil
        }
        return Set(identifiers)
    }

    // detect a persisted-region authorization downgrade
    static func shouldStopPersistedMonitoring(
        authorizationStatus: CLAuthorizationStatus,
        ownedIdentifiers: Set<String>
    ) -> Bool {
        !ownedIdentifiers.isEmpty && authorizationStatus != .authorizedAlways
    }

    // retain every pending or registered rollback identifier
    static func rollbackIdentifiers(
        attemptedIdentifiers: Set<String>,
        monitoredIdentifiers: Set<String>
    ) -> Set<String> {
        attemptedIdentifiers.union(monitoredIdentifiers)
    }

    // reject late callbacks from a terminated registration
    static func shouldStopStartedRegion(
        identifier: String,
        currentIdentifiers: Set<String>,
        cancelledIdentifiers: Set<String>,
        registrationTerminated: Bool
    ) -> Bool {
        identifier.hasPrefix(ownedRegionPrefix) &&
            (registrationTerminated ||
                cancelledIdentifiers.contains(identifier) ||
                !currentIdentifiers.contains(identifier))
    }

    // require one exact confirmed and monitored generation
    static func isCompleteOwnedRegistration(
        ownedIdentifiers: Set<String>,
        confirmedIdentifiers: Set<String>,
        monitoredIdentifiers: Set<String>,
        registrationTerminated: Bool
    ) -> Bool {
        !registrationTerminated &&
            !ownedIdentifiers.isEmpty &&
            confirmedIdentifiers == ownedIdentifiers &&
            monitoredIdentifiers == ownedIdentifiers
    }

    // preserve only complete confirmed health
    static func resolvedCapabilityState(
        currentState: GateAAutomaticCapabilityState,
        ownedIdentifiers: Set<String>,
        confirmedIdentifiers: Set<String>,
        hasTrustedServerTime: Bool
    ) -> GateAAutomaticCapabilityState {
        // recover monitoring only for one complete anchored set
        if hasTrustedServerTime,
           !ownedIdentifiers.isEmpty,
           confirmedIdentifiers == ownedIdentifiers {
            return .monitoring
        }

        return hasTrustedServerTime ? .diagnosticReady : .awaitingServerTime
    }

    // avoid racing prefetch against a region relaunch
    static func shouldPrefetchAfterPolicyContact(lifecycle: AutomaticV0LifecycleContext) -> Bool {
        lifecycle != .ordinaryRegionRelaunch
    }

    // validate one complete immutable generation
    private func isCompleteDiagnosticConfig(_ config: AutomaticTerminalConfigGeneration) -> Bool {
        // require fixed schema and platform capacity
        if config.schemaVersion != 1 ||
            config.configGeneration.value <= 0 ||
            config.regions.isEmpty ||
            config.regions.count > Self.maximumOwnedRegions {
            return false
        }

        var terminalIds = Set<String>()

        // require one unique generation-bound region per terminal
        for region in config.regions {
            // branch on the current state
            if !terminalIds.insert(region.terminalId).inserted ||
                region.configGeneration != config.configGeneration {
                return false
            }
        }

        return AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(config.regions)
        ) == config.contentHashHex
    }

    // classify only owned fixed regions
    private func isOwnedRegion(_ region: CLRegion) -> Bool {
        confirmedRegionIdentifiers.contains(region.identifier) &&
            region.identifier.hasPrefix(Self.ownedRegionPrefix)
    }

    // classify an attempted fixed region
    private func isAttemptedRegion(_ region: CLRegion) -> Bool {
        attemptedRegionsByIdentifier[region.identifier] != nil &&
            region.identifier.hasPrefix(Self.ownedRegionPrefix)
    }

    // classify current attempted or active ownership
    private func isTrackedRegion(_ region: CLRegion) -> Bool {
        (attemptedRegionsByIdentifier[region.identifier] != nil ||
            ownedRegionIdentifiers.contains(region.identifier)) &&
            region.identifier.hasPrefix(Self.ownedRegionPrefix)
    }

    // stop every owned region
    private func stopOwnedMonitoring(blockFurtherRegistration: Bool = true) {
        diagnosticFlow?.cancel()

        // make terminal stops reject every late callback
        if blockFurtherRegistration {
            registrationTerminated = true
        }

        let attemptedIdentifiers = Set(attemptedRegionsByIdentifier.keys)
            .union(ownedRegionIdentifiers)

        // clear local state even without a manager
        guard let locationManager else {
            cancelledRegionIdentifiers.formUnion(attemptedIdentifiers)
            attemptedRegionsByIdentifier.removeAll()
            ownedRegionIdentifiers.removeAll()
            confirmedRegionIdentifiers.removeAll()
            return
        }

        // retain every currently registered owned region
        let monitoredRegions = locationManager.monitoredRegions.filter { region in
            region.identifier.hasPrefix(Self.ownedRegionPrefix)
        }
        let monitoredIdentifiers = Set(monitoredRegions.map(\.identifier))
        let rollbackIdentifiers = Self.rollbackIdentifiers(
            attemptedIdentifiers: attemptedIdentifiers,
            monitoredIdentifiers: monitoredIdentifiers
        )
        cancelledRegionIdentifiers.formUnion(rollbackIdentifiers)
        var rollbackRegionsByIdentifier = attemptedRegionsByIdentifier

        // include every already registered owned region
        for region in monitoredRegions {
            rollbackRegionsByIdentifier[region.identifier] = region
        }

        // stop pending and registered regions explicitly
        for region in rollbackRegionsByIdentifier.values {
            locationManager.stopMonitoring(for: region)
        }

        attemptedRegionsByIdentifier.removeAll()
        ownedRegionIdentifiers.removeAll()
        confirmedRegionIdentifiers.removeAll()
    }

    // record one fixed local outcome
    private func recordFixed(_ outcome: AutomaticV0Outcome) {
        record(AutomaticV0Metric(
            outcome: outcome,
            durationBucket: .underFiveSeconds
        ))
    }
}

// define the native contract
extension GateABackgroundLocationFeasibility: AutomaticV0LocationRequesting {
    // request exactly one fix
    func requestOneLocation() {
        locationManager?.requestLocation()
    }

    // stop any standard updates defensively
    func stopLocationRequest() {
        locationManager?.stopUpdatingLocation()
    }
}

// define the native contract
extension GateABackgroundLocationFeasibility: AutomaticV0MetricRecording {
    // retain only one fixed redacted metric
    func record(_ metric: AutomaticV0Metric) {
        lastMetric = metric
    }
}

// define the native contract
extension GateABackgroundLocationFeasibility: CLLocationManagerDelegate {
    // react to permission degradation
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // keep only always authorization healthy
        if manager.authorizationStatus != .authorizedAlways &&
            (!ownedRegionIdentifiers.isEmpty || !attemptedRegionsByIdentifier.isEmpty) {
            authorizationDowngradeDiscovered = true
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.monitoringUnavailable)
        }

#if DEBUG
        // advance the explicit physical harness
        reconcileDiagnosticHarnessIfEnabled()
#endif
    }

    // confirm the complete attempted generation
    func locationManager(_ manager: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        // stop every late callback from an abandoned attempt
        if Self.shouldStopStartedRegion(
            identifier: region.identifier,
            currentIdentifiers: Set(attemptedRegionsByIdentifier.keys),
            cancelledIdentifiers: cancelledRegionIdentifiers,
            registrationTerminated: registrationTerminated
        ) {
            manager.stopMonitoring(for: region)
            return
        }

        // accept only the current retained attempt
        guard isAttemptedRegion(region) else {
            return
        }

        confirmedRegionIdentifiers.insert(region.identifier)

        // verify the exact os-owned set after full confirmation
        if confirmedRegionIdentifiers == ownedRegionIdentifiers,
           !ownedRegionIdentifiers.isEmpty {
            let monitoredIdentifiers = Self.ownedIdentifiers(in: manager.monitoredRegions)

            // activate only one exact complete generation
            if Self.isCompleteOwnedRegistration(
                ownedIdentifiers: ownedRegionIdentifiers,
                confirmedIdentifiers: confirmedRegionIdentifiers,
                monitoredIdentifiers: monitoredIdentifiers,
                registrationTerminated: registrationTerminated
            ) {
                capabilityState = .monitoring
                return
            }

            stopOwnedMonitoring()
            capabilityState = .degraded
            recordFixed(.monitoringFailed)
        }
    }

    // request one t0 entry fix
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        // branch on the current state
        guard isEnabled,
              isOwnedRegion(region) else {
            return
        }

        // stop when bar is unavailable
        if UIApplication.shared.backgroundRefreshStatus != .available {
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.backgroundRefreshUnavailable)
            return
        }

        _ = diagnosticFlow?.handleRegionEvent(.entry, lifecycle: lifecycleContext)
    }

    // request one v0 exit fix
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        // branch on the current state
        guard isEnabled,
              isOwnedRegion(region) else {
            return
        }

        // stop when bar is unavailable
        if UIApplication.shared.backgroundRefreshStatus != .available {
            stopOwnedMonitoring()
            capabilityState = .manualFallbackRequired
            recordFixed(.backgroundRefreshUnavailable)
            return
        }

        _ = diagnosticFlow?.handleRegionEvent(.exit, lifecycle: lifecycleContext)
    }

    // consume one acceptable callback only
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // branch on the current state
        guard let location = locations.last else {
            diagnosticFlow?.receiveLocationFailure()
            return
        }

        diagnosticFlow?.receiveLocation(AutomaticV0LocationFix(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            horizontalAccuracyMeters: location.horizontalAccuracy,
            timestampMs: Int64((location.timestamp.timeIntervalSince1970 * 1_000).rounded(.down))
        ))
    }

    // stop one failed request
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        diagnosticFlow?.receiveLocationFailure()
    }

    // roll back the attempted owned set
    func locationManager(
        _ manager: CLLocationManager,
        monitoringDidFailFor region: CLRegion?,
        withError error: Error
    ) {
        // ignore failures outside the owned namespace
        if let region, !isTrackedRegion(region) {
            return
        }

        stopOwnedMonitoring()
        capabilityState = .degraded
        recordFixed(.monitoringFailed)
    }
}
