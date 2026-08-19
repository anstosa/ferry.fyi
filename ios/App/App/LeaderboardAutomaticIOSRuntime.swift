import CoreFoundation
import CoreLocation
import Darwin
import Foundation
import UIKit
import UserNotifications

// define the native contract
final class AutomaticIOSBootIdentityProvider {
    private let loadBootTime: () -> (seconds: Int64, microseconds: Int64)?

    // isolate one kernel-provided boot identity seam
    init(
        loadBootTime: @escaping () -> (seconds: Int64, microseconds: Int64)? =
            AutomaticIOSBootIdentityProvider.platformBootTime
    ) {
        self.loadBootTime = loadBootTime
    }

    // return one stable identity unaffected by wall-clock changes
    func current() -> String {
        // branch on the current state
        guard let bootTime = loadBootTime(),
              bootTime.seconds >= 0,
              bootTime.microseconds >= 0,
              bootTime.microseconds < 1_000_000 else {
            return ""
        }
        return "\(bootTime.seconds):\(bootTime.microseconds)"
    }

    // read the kernel boot-time identity
    static func platformBootTime() -> (seconds: Int64, microseconds: Int64)? {
        var bootTime = timeval()
        var size = MemoryLayout<timeval>.size
        let status = sysctlbyname("kern.boottime", &bootTime, &size, nil, 0)

        // require one complete kernel response
        guard status == 0,
              size == MemoryLayout<timeval>.size else {
            return nil
        }
        return (Int64(bootTime.tv_sec), Int64(bootTime.tv_usec))
    }
}

// define the native contract
struct AutomaticNativeRuntimeParameters: Equatable {
    let candidateRetentionMs: Int64
    let fleetContextMaxAgeMs: Int64
    let futureToleranceMs: Int64
    let maxLocationAccuracyMillimeters: UInt32
    let maxPendingCandidates: Int
}

// define the native contract
struct AutomaticNativeRuntimeConfig: Equatable {
    let generation: AutomaticTerminalConfigGeneration
    let serverTimeMs: Int64
    let generatedAtMs: Int64
    let terminalEnabled: Bool
    let vesselEnabled: Bool
    let parameters: AutomaticNativeRuntimeParameters
    let urls: AutomaticNativeEndpointUrls
}

// define the native contract
struct AutomaticNativeRuntimeStatus: Equatable {
    let automaticEnabled: Bool
    let credentialExpiryBucket: String
    let rotateRecommended: Bool
    let serverPolicyGeneration: Int64
}

// define the native contract
enum AutomaticConfigCommitPolicy {
    // permit only monotonic immutable config commits
    static func permits(
        candidate: AutomaticTerminalConfigGeneration,
        current: AutomaticTerminalConfigGeneration?
    ) -> Bool {
        // admit the first complete generation
        guard let current else {
            return true
        }

        // reject rollback or same-generation mutation
        if candidate.configGeneration.value < current.configGeneration.value ||
            (candidate.configGeneration == current.configGeneration &&
                candidate.contentHashHex != current.contentHashHex) {
            return false
        }
        return true
    }
}

// define the native contract
enum AutomaticProductionNativeEndpointPolicy {
    static let expectedOrigin = "https://ferry.fyi"

    // validate only the compiled production origin and exact paths
    static func validates(_ urls: AutomaticNativeEndpointUrls) -> Bool {
        AutomaticNativeEndpointValidator(expectedOrigin: expectedOrigin).validate(
            urls,
            source: .trustedServerConfig
        )
    }
}

// define the native contract
enum AutomaticNativeRuntimeContractParser {
    private static let maximumSafeInteger: Int64 = 9_007_199_254_740_991
    private static let configKeys: Set<String> = [
        "configGeneration", "contentHash", "detectors", "generatedAtMs", "parameters",
        "regions", "schemaVersion", "serverPolicyGeneration", "serverTimeMs", "urls",
    ]
    private static let detectorKeys: Set<String> = ["terminalEnabled", "vesselEnabled"]
    private static let parameterKeys: Set<String> = [
        "candidateRetentionMs", "fleetContextMaxAgeMs", "futureToleranceMs",
        "maxLocationAccuracyMillimeters", "maxPendingCandidates",
    ]
    private static let regionKeys: Set<String> = [
        "configGeneration", "latitudeE7", "longitudeE7", "radiusMillimeters", "terminalId",
    ]
    private static let urlKeys: Set<String> = ["candidates", "config", "enrollment", "status"]
    private static let statusKeys: Set<String> = [
        "automaticEnabled", "credentialExpiryBucket", "rotateRecommended", "schemaVersion",
        "serverPolicyGeneration",
    ]
    private static let expiryBuckets: Set<String> = [
        "expired", "less_than_1_day", "less_than_7_days", "seven_days_or_more", "unavailable",
    ]

    // parse one strict trusted native configuration
    static func parseConfig(
        _ data: Data,
        expectedOrigin: String,
        maximumRegionCount: Int = 20
    ) -> AutomaticNativeRuntimeConfig? {
        // require one bounded strict config
        guard data.count <= 128 * 1_024,
              StrictJSONDuplicateKeyValidator.validate(data),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let value = raw as? [String: Any],
              Set(value.keys) == configKeys,
              strictInt(value["schemaVersion"]) == 1,
              let configGeneration = strictInt64(value["configGeneration"]),
              configGeneration > 0,
              let serverPolicyGeneration = strictInt64(value["serverPolicyGeneration"]),
              let serverTimeMs = strictInt64(value["serverTimeMs"]),
              let generatedAtMs = strictInt64(value["generatedAtMs"]),
              let contentHash = value["contentHash"] as? String,
              contentHash.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let detectors = value["detectors"] as? [String: Any],
              Set(detectors.keys) == detectorKeys,
              let terminalEnabled = detectors["terminalEnabled"] as? Bool,
              let vesselEnabled = detectors["vesselEnabled"] as? Bool,
              let rawParameters = value["parameters"] as? [String: Any],
              Set(rawParameters.keys) == parameterKeys,
              strictInt64(rawParameters["candidateRetentionMs"]) == automaticCandidateRetentionMs,
              let fleetContextMaxAgeMs = strictInt64(rawParameters["fleetContextMaxAgeMs"]),
              fleetContextMaxAgeMs > 0,
              let futureToleranceMs = strictInt64(rawParameters["futureToleranceMs"]),
              let maxAccuracy = strictUInt32(rawParameters["maxLocationAccuracyMillimeters"]),
              maxAccuracy > 0,
              let maxPending = strictInt(rawParameters["maxPendingCandidates"]),
              maxPending > 0,
              let rawUrls = value["urls"] as? [String: Any],
              Set(rawUrls.keys) == urlKeys,
              let urls = parseUrls(rawUrls),
              AutomaticNativeEndpointValidator(expectedOrigin: expectedOrigin).validate(
                urls,
                source: .trustedServerConfig
              ),
              let rawRegions = value["regions"] as? [Any],
              !rawRegions.isEmpty,
              rawRegions.count <= maximumRegionCount else {
            return nil
        }

        let generation = ConfigGeneration(value: configGeneration)
        var regions: [AutomaticTerminalRegion] = []
        var terminalIds = Set<String>()
        var priorTerminalBytes: Data?

        // validate the complete canonical order
        for rawRegion in rawRegions {
            // branch on the current state
            guard let region = rawRegion as? [String: Any],
                  Set(region.keys) == regionKeys,
                  strictInt64(region["configGeneration"]) == configGeneration,
                  let latitudeE7 = strictInt32(region["latitudeE7"]),
                  (Int32(-900_000_000)...Int32(900_000_000)).contains(latitudeE7),
                  let longitudeE7 = strictInt32(region["longitudeE7"]),
                  (Int32(-1_800_000_000)...Int32(1_800_000_000)).contains(longitudeE7),
                  let radiusMillimeters = strictUInt32(region["radiusMillimeters"]),
                  radiusMillimeters > 0,
                  let terminalId = region["terminalId"] as? String,
                  isIdentifier(terminalId),
                  terminalIds.insert(terminalId).inserted else {
                return nil
            }
            let terminalBytes = Data(terminalId.utf8)

            // require strictly ascending utf-8 terminal ids
            if let priorTerminalBytes,
               !priorTerminalBytes.lexicographicallyPrecedes(terminalBytes) {
                return nil
            }

            priorTerminalBytes = terminalBytes
            regions.append(AutomaticTerminalRegion(
                terminalId: terminalId,
                latitudeE7: latitudeE7,
                longitudeE7: longitudeE7,
                radiusMillimeters: radiusMillimeters,
                configGeneration: generation
            ))
        }

        // require the canonical public region digest
        if AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions)
        ) != contentHash {
            return nil
        }

        return AutomaticNativeRuntimeConfig(
            generation: AutomaticTerminalConfigGeneration(
                schemaVersion: 1,
                configGeneration: generation,
                serverPolicyGeneration: ServerPolicyGeneration(value: serverPolicyGeneration),
                contentHashHex: contentHash,
                regions: regions
            ),
            serverTimeMs: serverTimeMs,
            generatedAtMs: generatedAtMs,
            terminalEnabled: terminalEnabled,
            vesselEnabled: vesselEnabled,
            parameters: AutomaticNativeRuntimeParameters(
                candidateRetentionMs: automaticCandidateRetentionMs,
                fleetContextMaxAgeMs: fleetContextMaxAgeMs,
                futureToleranceMs: futureToleranceMs,
                maxLocationAccuracyMillimeters: maxAccuracy,
                maxPendingCandidates: maxPending
            ),
            urls: urls
        )
    }

    // parse one strict detail-free policy status
    static func parseStatus(_ data: Data) -> AutomaticNativeRuntimeStatus? {
        // branch on the current state
        guard data.count <= automaticNativeMaximumBodyBytes,
              StrictJSONDuplicateKeyValidator.validate(data),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let value = raw as? [String: Any],
              Set(value.keys) == statusKeys,
              strictInt(value["schemaVersion"]) == 1,
              let automaticEnabled = value["automaticEnabled"] as? Bool,
              let rotateRecommended = value["rotateRecommended"] as? Bool,
              let bucket = value["credentialExpiryBucket"] as? String,
              expiryBuckets.contains(bucket),
              let generation = strictInt64(value["serverPolicyGeneration"]) else {
            return nil
        }

        return AutomaticNativeRuntimeStatus(
            automaticEnabled: automaticEnabled,
            credentialExpiryBucket: bucket,
            rotateRecommended: rotateRecommended,
            serverPolicyGeneration: generation
        )
    }

    // parse the exact four endpoint urls
    private static func parseUrls(_ value: [String: Any]) -> AutomaticNativeEndpointUrls? {
        // branch on the current state
        guard let candidates = value["candidates"] as? String,
              let config = value["config"] as? String,
              let enrollment = value["enrollment"] as? String,
              let status = value["status"] as? String else {
            return nil
        }

        return AutomaticNativeEndpointUrls(
            config: config,
            status: status,
            candidates: candidates,
            enrollment: enrollment
        )
    }

    // validate one bounded identifier
    private static func isIdentifier(_ value: String) -> Bool {
        // reject empty, oversized, or control-bearing values
        if value.isEmpty || value.utf8.count > 128 || value.unicodeScalars.contains(where: { scalar in
            scalar.value <= 0x1f || scalar.value == 0x7f
        }) {
            return false
        }

        return true
    }

    // parse one json-safe integer
    private static func strictInt64(_ value: Any?) -> Int64? {
        // branch on the current state
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= 0,
              number.doubleValue <= Double(maximumSafeInteger) else {
            return nil
        }

        return number.int64Value
    }

    // parse one platform integer
    private static func strictInt(_ value: Any?) -> Int? {
        // branch on the current state
        guard let integer = strictInt64(value), integer <= Int64(Int.max) else {
            return nil
        }

        return Int(integer)
    }

    // parse one signed coordinate
    private static func strictInt32(_ value: Any?) -> Int32? {
        // branch on the current state
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(Int32.min),
              number.doubleValue <= Double(Int32.max) else {
            return nil
        }

        return Int32(number.int64Value)
    }

    // parse one uint32 policy value
    private static func strictUInt32(_ value: Any?) -> UInt32? {
        // branch on the current state
        guard let integer = strictInt64(value), integer <= Int64(UInt32.max) else {
            return nil
        }

        return UInt32(integer)
    }
}

// define the native contract
protocol AutomaticNativePolicyTransporting: AnyObject {
    // fetch one authoritative config or status response
    func fetch(
        kind: AutomaticNativeEndpointKind,
        credentialLease: AutomaticCredentialLease,
        completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
    )

    // revoke one enrollment without delaying local purge
    func revokeEnrollment(
        credentialLease: AutomaticCredentialLease,
        completion: @escaping () -> Void
    )
}

// define the native contract
final class AutomaticURLSessionNativeTransport: NSObject,
    AutomaticCandidateTransporting,
    AutomaticNativePolicyTransporting,
    URLSessionTaskDelegate {
    private let lock = NSLock()
    // run the bounded callback
    private let delegateQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "fyi.ferry.automatic-native-transport"
        queue.maxConcurrentOperationCount = 1
        return queue
    }()
    private let didReleaseSensitiveRequest: (() -> Void)?
    private var tasks: [Int: URLSessionTask] = [:]
    private var redirectedTaskIds: Set<Int> = []
    // run the bounded callback
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
    }()

    // inject an ownership-release assertion seam
    init(didReleaseSensitiveRequest: (() -> Void)? = nil) {
        self.didReleaseSensitiveRequest = didReleaseSensitiveRequest
        super.init()
    }

    // upload one bounded identity-encoded candidate
    func upload(
        body: Data,
        credentialLease: AutomaticCredentialLease,
        localWorkGeneration _: LocalWorkGeneration,
        completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
    ) {
        // require one fixed candidate url
        guard let endpointUrls = credentialLease.endpointUrls(),
              AutomaticProductionNativeEndpointPolicy.validates(endpointUrls),
              let value = credentialLease.endpointURL(.candidates),
              let url = URL(string: value),
              let request = authorizedRequest(url: url, credentialLease: credentialLease) else {
            completion(.failure(AutomaticSecureRuntimeError.invalidConfiguration))
            return
        }
        var uploadRequest = request
        uploadRequest.httpMethod = "POST"
        uploadRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        uploadRequest.setValue("identity", forHTTPHeaderField: "Content-Encoding")
        uploadRequest.httpBody = body
        execute(uploadRequest, completion: completion)
    }

    // fetch one fixed policy endpoint
    func fetch(
        kind: AutomaticNativeEndpointKind,
        credentialLease: AutomaticCredentialLease,
        completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
    ) {
        let value = credentialLease.endpointURL(kind)
        // allow only read-only policy endpoints
        guard kind == .config || kind == .status,
              let endpointUrls = credentialLease.endpointUrls(),
              AutomaticProductionNativeEndpointPolicy.validates(endpointUrls),
              let value,
              let url = URL(string: value),
              let request = authorizedRequest(url: url, credentialLease: credentialLease) else {
            completion(.failure(AutomaticSecureRuntimeError.invalidConfiguration))
            return
        }
        var fetchRequest = request
        fetchRequest.httpMethod = "GET"
        execute(fetchRequest, completion: completion)
    }

    // issue one strict best-effort enrollment deletion
    func revokeEnrollment(
        credentialLease: AutomaticCredentialLease,
        completion: @escaping () -> Void
    ) {
        // require only the compiled enrollment endpoint
        guard let endpointUrls = credentialLease.endpointUrls(),
              AutomaticProductionNativeEndpointPolicy.validates(endpointUrls),
              let value = credentialLease.endpointURL(.enrollment),
              let url = URL(string: value),
              let request = authorizedRequest(url: url, credentialLease: credentialLease) else {
            credentialLease.wipe()
            completion()
            return
        }
        var revokeRequest = request
        revokeRequest.httpMethod = "DELETE"
        // run the bounded callback
        execute(revokeRequest) { result in
            // wipe any bounded revocation response bytes
            if case let .success(response) = result {
                response.wipe()
            }
            // wipe the isolated revocation lease on every result
            credentialLease.wipe()
            completion()
        }
    }

    // cancel all controllable native requests
    func cancelAll() {
        lock.lock()
        let activeTasks = Array(tasks.values)
        tasks.removeAll()
        redirectedTaskIds.removeAll()
        lock.unlock()

        // cancel every active request
        for task in activeTasks {
            task.cancel()
        }
    }

    // reject every redirect before credentials move origins
    func urlSession(
        _: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest _: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        lock.lock()
        redirectedTaskIds.insert(task.taskIdentifier)
        lock.unlock()
        completionHandler(nil)
    }

    // build one no-store bearer request
    private func authorizedRequest(
        url: URL,
        credentialLease: AutomaticCredentialLease
    ) -> URLRequest? {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        var authorizationBytes = Data("Bearer ".utf8)
        // require one live scoped bearer buffer
        guard credentialLease.withBearerBytes({ bearerBytes in
            authorizationBytes.append(bearerBytes)
        }) != nil else {
            authorizationBytes.resetBytes(in: 0..<authorizationBytes.count)
            authorizationBytes.removeAll(keepingCapacity: false)
            return nil
        }
        request.setValue(String(decoding: authorizationBytes, as: UTF8.self), forHTTPHeaderField: "Authorization")
        authorizationBytes.resetBytes(in: 0..<authorizationBytes.count)
        authorizationBytes.removeAll(keepingCapacity: false)
        return request
    }

    // execute one bounded native request
    private func execute(
        _ request: URLRequest,
        completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
    ) {
        let requestedURL = request.url?.absoluteString ?? ""
        let handoffQueue = delegateQueue
        let didReleaseSensitiveRequest = didReleaseSensitiveRequest

        // deliver only after the serial urlsession callback releases its task
        func handoffAfterRelease(
            _ result: Result<AutomaticCandidateTransportResponse, Error>
        ) {
            // run the bounded callback
            handoffQueue.addOperation {
                didReleaseSensitiveRequest?()
                completion(result)
            }
        }

        var task: URLSessionDataTask!
        // run the bounded callback
        task = session.dataTask(with: request) { [weak self] data, response, error in
            var receivedData = data ?? Data()
            let completedTaskIdentifier = task.taskIdentifier
            task = nil
            // release protected state
            defer {
                // wipe urlsession response bytes after ownership transfer
                receivedData.resetBytes(in: 0..<receivedData.count)
                receivedData.removeAll(keepingCapacity: false)
            }
            // require the active transport owner
            guard let self else {
                handoffAfterRelease(.failure(AutomaticSecureRuntimeError.invalidResponse))
                return
            }
            self.lock.lock()
            self.tasks.removeValue(forKey: completedTaskIdentifier)
            let redirected = self.redirectedTaskIds.remove(completedTaskIdentifier) != nil
            self.lock.unlock()

            // surface transport ambiguity without parsing
            if let error {
                handoffAfterRelease(.failure(error))
                return
            }

            // require one json http response
            guard let response = response as? HTTPURLResponse,
                  data != nil,
                  response.mimeType == "application/json",
                  response.value(forHTTPHeaderField: "Content-Encoding").map({
                    $0.lowercased() == "identity"
                  }) != false else {
                handoffAfterRelease(.failure(AutomaticSecureRuntimeError.invalidResponse))
                return
            }

            handoffAfterRelease(.success(AutomaticCandidateTransportResponse(
                data: receivedData,
                requestedURL: requestedURL,
                resolvedURL: response.url?.absoluteString ?? "",
                statusCode: response.statusCode,
                wasRedirected: redirected
            )))
        }
        lock.lock()
        tasks[task.taskIdentifier] = task
        lock.unlock()
        task.resume()
    }
}

// define the native contract
extension Notification.Name {
    static let automaticLeaderboardCheckinsChanged = Notification.Name(
        "leaderboard-checkins-changed"
    )
}

// define the native contract
final class AutomaticCreditedEffectEmitter: AutomaticCreditedEffectEmitting {
    static let notificationBody = "A leaderboard check-in was verified."
    static let notificationThread = "leaderboard-checkins"
    static let bridgeEventName = "leaderboard-checkins-changed"
    private let notificationCenter: UNUserNotificationCenter
    private let nativeNotificationCenter: NotificationCenter

    // inject user notification and native event boundaries
    init(
        notificationCenter: UNUserNotificationCenter = .current(),
        nativeNotificationCenter: NotificationCenter = .default
    ) {
        self.notificationCenter = notificationCenter
        self.nativeNotificationCenter = nativeNotificationCenter
    }

    // emit generic credit effects without detail
    func emitCredited() {
        let content = UNMutableNotificationContent()
        content.title = "Ferry FYI"
        content.body = Self.notificationBody
        content.threadIdentifier = Self.notificationThread
        content.userInfo = [:]
        let request = UNNotificationRequest(
            identifier: "leaderboard-checkin-verified",
            content: content,
            trigger: nil
        )
        notificationCenter.add(request)
        nativeNotificationCenter.post(
            name: .automaticLeaderboardCheckinsChanged,
            object: nil,
            userInfo: nil
        )
    }
}

// define the native contract
enum AutomaticBridgeEventContract {
    static let name = AutomaticCreditedEffectEmitter.bridgeEventName
    static let detail: [String: Any]? = nil
}

// define the native contract
enum AutomaticIOSCandidateWakePolicy {
    // wake for upload or deletion-only cleanup without candidate data
    static func shouldWake(
        candidateStored: Bool,
        mutationError: AutomaticSecureRuntimeError?
    ) -> Bool {
        candidateStored || mutationError == .cleanupRequired
    }
}

// define the native contract
protocol AutomaticIOSRegionManagerDelegate: AnyObject {
    // atomically commit one completely registered generation
    func regionManager(
        _ manager: AutomaticIOSRegionManager,
        shouldCommit config: AutomaticNativeRuntimeConfig,
        localWorkGeneration: LocalWorkGeneration
    ) -> Bool

    // schedule deletion-only cleanup without location capture
    func regionManagerNeedsCleanupWake(
        _ manager: AutomaticIOSRegionManager,
        localWorkGeneration: LocalWorkGeneration
    )

    // create one bounded terminal candidate
    func regionManager(
        _ manager: AutomaticIOSRegionManager,
        created candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration
    )

    // apply one known local stop trigger
    func regionManager(
        _ manager: AutomaticIOSRegionManager,
        stoppedFor trigger: AutomaticRuntimeStopTrigger
    )
}

// define the native contract
protocol AutomaticIOSLocationManaging: AnyObject {
    var delegate: CLLocationManagerDelegate? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    var accuracyAuthorization: CLAccuracyAuthorization { get }
    var maximumRegionMonitoringDistance: CLLocationDistance { get }
    var monitoredRegions: Set<CLRegion> { get }

    // register one platform region
    func startMonitoring(for region: CLRegion)

    // unregister one platform region
    func stopMonitoring(for region: CLRegion)

    // request one bounded location fix
    func requestLocation()

    // stop any in-flight location fixes
    func stopUpdatingLocation()
}

// define the native contract
extension CLLocationManager: AutomaticIOSLocationManaging {}

// define the native contract
enum AutomaticIOSRegionHealth: String, Equatable {
    case backgroundRefreshOff
    case firstUnlockRequired
    case healthy
    case needsConfig
    case permissionDenied
    case reducedAccuracy
    case registrationFailed
    case stopped
}

// define the native contract
enum AutomaticBridgeStatusContract {
    static let exactKeys: Set<String> = [
        "capabilityVersion", "configGeneration", "credentialExpiryBucket", "lastOutcome",
        "monitorHealth", "pendingCandidateCount", "permissionHealth", "platform",
        "schemaVersion", "serverPolicyGeneration",
    ]
    static let aggregateOutcomes: Set<String> = [
        "authentication_failed", "candidate_conflict", "cleanup_required", "credited",
        "detector_disabled", "enrollment_expired", "enrollment_revoked", "expired",
        "fleet_context_invalid", "future_timestamp", "history_unavailable", "history_warming",
        "invalid_candidate", "location_accuracy_too_low", "malformed_payload", "outside_terminal",
        "payload_too_large", "policy_disabled", "rate_limited", "sailing_already_credited",
        "stale_event", "temporarily_unavailable", "terminal_config_unavailable",
        "terminal_not_found", "too_close_to_shore", "unsupported_encoding",
        "unsupported_media_type", "unsupported_os", "vessel_not_found",
    ]

    // project only the strict detail-free shared status shape
    static func project(
        configGeneration: Int64?,
        credentialExpiryBucket: String,
        lastOutcome: String?,
        monitorHealth: String,
        pendingCandidateCount: Int,
        permissionHealth: String,
        serverPolicyGeneration: Int64
    ) -> [String: Any] {
        // run the bounded callback
        let safeOutcome = lastOutcome.flatMap { outcome in
            aggregateOutcomes.contains(outcome) ? outcome : nil
        }
        // run the bounded callback
        let configValue: Any = configGeneration.map { $0 as Any } ?? NSNull()
        // run the bounded callback
        let outcomeValue: Any = safeOutcome.map { $0 as Any } ?? NSNull()
        return [
            "capabilityVersion": automaticNativeCapabilityVersion,
            "configGeneration": configValue,
            "credentialExpiryBucket": credentialExpiryBucket,
            "lastOutcome": outcomeValue,
            "monitorHealth": monitorHealth,
            "pendingCandidateCount": min(max(0, pendingCandidateCount), Int(UInt32.max)),
            "permissionHealth": permissionHealth,
            "platform": "ios",
            "schemaVersion": 1,
            "serverPolicyGeneration": max(0, serverPolicyGeneration),
        ]
    }

    // return one inert default-off status without runtime construction
    static func disabled() -> [String: Any] {
        project(
            configGeneration: nil,
            credentialExpiryBucket: "unavailable",
            lastOutcome: nil,
            monitorHealth: "disabled",
            pendingCandidateCount: 0,
            permissionHealth: "not_determined",
            serverPolicyGeneration: 0
        )
    }
}

// define the native contract
enum AutomaticTerminalRegionTransition: Equatable {
    case enter
    case exit
}

// define the native contract
enum AutomaticTerminalSpatialDecision: Equatable {
    case inside
    case outside
    case uncertain
}

// define the native contract
enum AutomaticTerminalSpatialClassifier {
    // classify the entire accuracy circle against immutable radius
    static func classify(
        distanceMillimeters: Double,
        accuracyMillimeters: Double,
        radiusMillimeters: Double
    ) -> AutomaticTerminalSpatialDecision {
        // require finite circle geometry
        guard distanceMillimeters.isFinite,
              accuracyMillimeters.isFinite,
              radiusMillimeters.isFinite,
              distanceMillimeters >= 0,
              accuracyMillimeters >= 0,
              radiusMillimeters > 0 else {
            return .uncertain
        }

        // require the complete circle inside
        if distanceMillimeters + accuracyMillimeters < radiusMillimeters {
            return .inside
        }

        // require the complete circle outside
        if distanceMillimeters - accuracyMillimeters > radiusMillimeters {
            return .outside
        }

        return .uncertain
    }

    // calculate one haversine distance before circle classification
    static func classify(
        latitude: Double,
        longitude: Double,
        accuracyMeters: Double,
        region: AutomaticTerminalRegion
    ) -> AutomaticTerminalSpatialDecision {
        let latitudeRadians = latitude * .pi / 180
        let regionLatitudeRadians = Double(region.latitudeE7) / 10_000_000 * .pi / 180
        let latitudeDelta = regionLatitudeRadians - latitudeRadians
        let longitudeDelta = (
            Double(region.longitudeE7) / 10_000_000 - longitude
        ) * .pi / 180
        let haversine = pow(sin(latitudeDelta / 2), 2) +
            cos(latitudeRadians) * cos(regionLatitudeRadians) *
            pow(sin(longitudeDelta / 2), 2)
        let angularDistance = 2 * atan2(sqrt(haversine), sqrt(max(0, 1 - haversine)))
        let distanceMillimeters = 6_371_000 * angularDistance * 1_000
        return classify(
            distanceMillimeters: distanceMillimeters,
            accuracyMillimeters: accuracyMeters * 1_000,
            radiusMillimeters: Double(region.radiusMillimeters)
        )
    }

    // require transition-consistent definitive proof
    static func permitsCandidate(
        transition: AutomaticTerminalRegionTransition,
        decision: AutomaticTerminalSpatialDecision
    ) -> Bool {
        // bind callback direction to current definitive state
        switch (transition, decision) {
        case (.enter, .inside), (.exit, .outside):
            return true
        case (.enter, .outside), (.enter, .uncertain),
             (.exit, .inside), (.exit, .uncertain):
            return false
        }
    }
}

// define the native contract
enum AutomaticIOSLifecyclePolicy {
    // require manual open after an explicitly observed force quit
    static func permitsPassiveReconciliation(
        forceQuitObserved: Bool,
        manualOpen: Bool
    ) -> Bool {
        !forceQuitObserved || manualOpen
    }

    // classify first-unlock, bar, permission, and accuracy gates
    static func platformHealth(
        protectedDataAvailable: Bool,
        backgroundRefreshAvailable: Bool,
        authorizationStatus: CLAuthorizationStatus,
        accuracyAuthorization: CLAccuracyAuthorization
    ) -> AutomaticIOSRegionHealth? {
        // fail closed before first unlock
        if !protectedDataAvailable {
            return .firstUnlockRequired
        }

        // treat bar-off as non-operational
        if !backgroundRefreshAvailable {
            return .backgroundRefreshOff
        }

        // require always authorization
        if authorizationStatus != .authorizedAlways {
            return .permissionDenied
        }

        // require precise accuracy policy
        if accuracyAuthorization != .fullAccuracy {
            return .reducedAccuracy
        }

        return nil
    }
}

// define the native contract
final class AutomaticIOSRegionManager: NSObject,
    CLLocationManagerDelegate,
    AutomaticRegionRuntimeControlling {
    private static let prefix = "ferry-fyi-auto:"
    private let locationManager: AutomaticIOSLocationManaging
    private let monitoringAvailable: () -> Bool
    private let protectedDataAvailable: () -> Bool
    private let backgroundRefreshAvailable: () -> Bool
    private let trustedClock: AutomaticTrustedClock
    private let localGeneration: () -> LocalWorkGeneration
    private let captureAvailable: () -> Bool
    private let randomCandidateId: () throws -> String
    private var activeConfig: AutomaticNativeRuntimeConfig?
    private var activeGeneration: LocalWorkGeneration?
    private var priorConfig: (
        config: AutomaticNativeRuntimeConfig,
        generation: LocalWorkGeneration
    )?
    private var attemptedConfig: AutomaticNativeRuntimeConfig?
    private var attemptedGeneration: LocalWorkGeneration?
    private var activeRegions: [String: CLCircularRegion] = [:]
    private var attemptedRegions: [String: CLCircularRegion] = [:]
    private var confirmedIdentifiers = Set<String>()
    private var awaitingObservation: (
        region: AutomaticTerminalRegion,
        transition: AutomaticTerminalRegionTransition
    )?
    private var awaitingGeneration: LocalWorkGeneration?
    private var registrationFailed = false
    private(set) var health: AutomaticIOSRegionHealth = .stopped
    weak var delegate: AutomaticIOSRegionManagerDelegate?

    // inject platform lifecycle seams
    init(
        locationManager: AutomaticIOSLocationManaging = CLLocationManager(),
        // run the bounded callback
        protectedDataAvailable: @escaping () -> Bool = {
            AutomaticFirstUnlockProbe.shared.isAvailable()
        },
        // run the bounded callback
        backgroundRefreshAvailable: @escaping () -> Bool = {
            UIApplication.shared.backgroundRefreshStatus == .available
        },
        trustedClock: AutomaticTrustedClock,
        localGeneration: @escaping () -> LocalWorkGeneration,
        // run the bounded callback
        captureAvailable: @escaping () -> Bool = { true },
        // run the bounded callback
        monitoringAvailable: @escaping () -> Bool = {
            CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        },
        randomCandidateId: @escaping () throws -> String = AutomaticIOSRegionManager.candidateId
    ) {
        self.locationManager = locationManager
        self.protectedDataAvailable = protectedDataAvailable
        self.backgroundRefreshAvailable = backgroundRefreshAvailable
        self.trustedClock = trustedClock
        self.localGeneration = localGeneration
        self.captureAvailable = captureAvailable
        self.monitoringAvailable = monitoringAvailable
        self.randomCandidateId = randomCandidateId
        super.init()
        self.locationManager.delegate = self
    }

    // stage one complete immutable region generation
    func activate(_ config: AutomaticNativeRuntimeConfig) -> Bool {
        // serialize every core location mutation on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.activate(config) }
        }
        return stage(config, generation: localGeneration(), preservePrior: true)
    }

    // stage one generation with an exact callback generation
    private func stage(
        _ config: AutomaticNativeRuntimeConfig,
        generation: LocalWorkGeneration,
        preservePrior: Bool
    ) -> Bool {
        let platformHealth = AutomaticIOSLifecyclePolicy.platformHealth(
            protectedDataAvailable: protectedDataAvailable(),
            backgroundRefreshAvailable: backgroundRefreshAvailable(),
            authorizationStatus: locationManager.authorizationStatus,
            accuracyAuthorization: locationManager.accuracyAuthorization
        )

        // stop on any platform capability gate
        if let platformHealth {
            stopAll()
            health = platformHealth
            return false
        }

        // reject rollback or mutation of immutable active config
        if let activeConfig,
           (config.generation.configGeneration.value < activeConfig.generation.configGeneration.value ||
            (config.generation.configGeneration == activeConfig.generation.configGeneration &&
                config.generation.contentHashHex != activeConfig.generation.contentHashHex)) {
            return false
        }

        // require complete platform-compatible configuration
        if !config.terminalEnabled ||
            config.generation.regions.isEmpty ||
            config.generation.regions.count > 20 ||
            !monitoringAvailable() {
            // preserve one already confirmed prior generation
            if activeConfig == nil || health != .healthy {
                health = .registrationFailed
            }
            return false
        }

        // preserve an already healthy immutable generation
        if let activeConfig,
           activeConfig.generation.configGeneration == config.generation.configGeneration,
           activeConfig.generation.contentHashHex == config.generation.contentHashHex,
           activeGeneration == generation,
           health == .healthy {
            return true
        }

        let maximumRadius = locationManager.maximumRegionMonitoringDistance
        var nextRegions: [String: CLCircularRegion] = [:]

        // construct every region before registration
        for region in config.generation.regions {
            let radius = Double(region.radiusMillimeters) / 1_000

            // reject unsupported geometry before partial registration
            if radius <= 0 || radius > maximumRadius {
                // preserve one already confirmed prior generation
                if activeConfig == nil || health != .healthy {
                    health = .registrationFailed
                }
                return false
            }

            let identifier = Self.identifier(region: region, localWorkGeneration: generation)
            let circular = CLCircularRegion(
                center: CLLocationCoordinate2D(
                    latitude: Double(region.latitudeE7) / 10_000_000,
                    longitude: Double(region.longitudeE7) / 10_000_000
                ),
                radius: radius,
                identifier: identifier
            )
            circular.notifyOnEntry = true
            circular.notifyOnExit = true
            nextRegions[identifier] = circular
        }

        // preserve only one previously confirmed complete generation
        if preservePrior,
           let activeConfig,
           let activeGeneration,
           health == .healthy {
            priorConfig = (activeConfig, activeGeneration)
        // branch on the current state
        } else if !preservePrior {
            priorConfig = nil
        }
        stopOwnedRegions()
        activeRegions.removeAll()
        attemptedRegions = nextRegions
        attemptedConfig = config
        attemptedGeneration = generation
        confirmedIdentifiers.removeAll()
        registrationFailed = false
        health = .needsConfig

        // register one complete attempted namespace
        for region in attemptedRegions.values {
            locationManager.startMonitoring(for: region)
        }

        return true
    }

    // stop all owned regions and pending one-shot work
    func stopAll() {
        // serialize every core location mutation on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.stopAll() }
            return
        }
        stopOwnedRegions()
        locationManager.stopUpdatingLocation()
        awaitingObservation = nil
        awaitingGeneration = nil
        attemptedRegions.removeAll()
        activeRegions.removeAll()
        attemptedConfig = nil
        attemptedGeneration = nil
        confirmedIdentifiers.removeAll()
        health = .stopped
    }

    // mark immutable configuration unusable
    func invalidateConfiguration() {
        // serialize every core location mutation on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.invalidateConfiguration() }
            return
        }
        activeConfig = nil
        activeGeneration = nil
        activeRegions.removeAll()
        priorConfig = nil
    }

    // expose only the active immutable config generation
    func configGeneration() -> Int64? {
        // serialize core location state reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.configGeneration() }
        }
        // expose only fully confirmed monitoring state
        guard health == .healthy else {
            return nil
        }
        return activeConfig?.generation.configGeneration.value
    }

    // map platform authorization to the shared aggregate enum
    func permissionHealth() -> String {
        // serialize core location state reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.permissionHealth() }
        }
        // classify exact location authorization
        switch locationManager.authorizationStatus {
        case .authorizedAlways:
            return locationManager.accuracyAuthorization == .fullAccuracy
                ? "authorized"
                : "limited_accuracy"
        case .authorizedWhenInUse, .denied:
            return "denied"
        case .notDetermined:
            return "not_determined"
        case .restricted:
            return "restricted"
        @unknown default:
            return "restricted"
        }
    }

    // map private runtime health to the shared aggregate enum
    func monitorHealth(lastOutcome: String?) -> String {
        // serialize core location state reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.monitorHealth(lastOutcome: lastOutcome) }
        }
        // preserve authoritative policy denial separately
        if lastOutcome == "detector_disabled" || lastOutcome == "policy_disabled" {
            return "policy_disabled"
        }

        // classify the current region owner state
        switch health {
        case .backgroundRefreshOff:
            return "background_refresh_off"
        case .firstUnlockRequired:
            return "first_unlock_required"
        case .healthy:
            return "healthy"
        case .needsConfig:
            return "needs_config"
        case .registrationFailed:
            return "registration_failed"
        case .permissionDenied, .reducedAccuracy, .stopped:
            return "stopped"
        }
    }

    // re-evaluate bar, protected data, permission, and accuracy
    func reconcilePlatformState() {
        // serialize every core location mutation on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.reconcilePlatformState() }
            return
        }
        // stop plaintext work before first unlock
        if !protectedDataAvailable() {
            stopAll()
            health = .firstUnlockRequired
            return
        }

        // stop new work while bar is off
        if !backgroundRefreshAvailable() {
            stopAll()
            health = .backgroundRefreshOff
            return
        }

        // report known permission revocation
        if locationManager.authorizationStatus != .authorizedAlways {
            let alreadyStopped = health == .permissionDenied
            stopAll()

            // avoid repeated generation invalidation for one unchanged gate
            if !alreadyStopped {
                delegate?.regionManager(self, stoppedFor: .backgroundPermissionRevoked)
            }
            health = .permissionDenied
            return
        }

        // report known reduced accuracy
        if locationManager.accuracyAuthorization != .fullAccuracy {
            let alreadyStopped = health == .reducedAccuracy
            stopAll()

            // avoid repeated generation invalidation for one unchanged gate
            if !alreadyStopped {
                delegate?.regionManager(self, stoppedFor: .accuracyDowngrade)
            }
            health = .reducedAccuracy
            return
        }

        // recover from a previously failed platform gate
        if health == .backgroundRefreshOff ||
            health == .firstUnlockRequired ||
            health == .permissionDenied ||
            health == .reducedAccuracy {
            health = .needsConfig
        }
    }

    // confirm one attempted region registration
    func locationManager(_: CLLocationManager, didStartMonitoringFor region: CLRegion) {
        // ignore a duplicate callback for the committed exact set
        if activeRegions[region.identifier] != nil,
           health == .healthy {
            return
        }
        // remove any abandoned owned late registration
        if attemptedRegions[region.identifier] == nil,
           region.identifier.hasPrefix(Self.prefix) {
            locationManager.stopMonitoring(for: region)
            return
        }
        // branch on the current state
        guard attemptedRegions[region.identifier] != nil,
              !registrationFailed else {
            return
        }
        confirmedIdentifiers.insert(region.identifier)

        // expose health only after complete confirmation
        if confirmedIdentifiers == Set(attemptedRegions.keys) {
            let exactOwnedIdentifiers = Set(
                // run the bounded callback
                locationManager.monitoredRegions.compactMap { monitored in
                    monitored.identifier.hasPrefix(Self.prefix)
                        ? monitored.identifier
                        : nil
                }
            )
            // require the exact complete owned set without abandoned regions
            guard exactOwnedIdentifiers == Set(attemptedRegions.keys) else {
                rollbackRegistration()
                return
            }
            // branch on the current state
            guard let attemptedConfig,
                  let attemptedGeneration,
                  delegate?.regionManager(
                      self,
                      shouldCommit: attemptedConfig,
                      localWorkGeneration: attemptedGeneration
                  ) == true else {
                rollbackRegistration()
                return
            }
            activeConfig = attemptedConfig
            activeGeneration = attemptedGeneration
            activeRegions = attemptedRegions
            attemptedRegions.removeAll()
            confirmedIdentifiers.removeAll()
            self.attemptedConfig = nil
            self.attemptedGeneration = nil
            priorConfig = nil
            health = .healthy
        }
    }

    // roll back any partial generation failure
    func locationManager(
        _: CLLocationManager,
        monitoringDidFailFor region: CLRegion?,
        withError _: Error
    ) {
        // ignore late failures outside the attempted namespace
        if let region, attemptedRegions[region.identifier] == nil {
            return
        }

        rollbackRegistration()
    }

    // request one bounded fix for a terminal entry
    func locationManager(_: CLLocationManager, didEnterRegion region: CLRegion) {
        requestOneFix(region: region, transition: .enter)
    }

    // request one bounded fix for a terminal exit
    func locationManager(_: CLLocationManager, didExitRegion region: CLRegion) {
        requestOneFix(region: region, transition: .exit)
    }

    // bind one callback transition to immutable geometry
    private func requestOneFix(
        region: CLRegion,
        transition: AutomaticTerminalRegionTransition
    ) {
        let generation = localGeneration()
        // require one active immutable callback
        guard protectedDataAvailable(),
              backgroundRefreshAvailable(),
              health == .healthy,
              awaitingObservation == nil,
              let activeConfig,
              let activeGeneration,
              activeGeneration == generation,
              let terminalRegion = Self.terminalRegion(
                identifier: region.identifier,
                config: activeConfig.generation,
                localWorkGeneration: activeGeneration
              ) else {
            return
        }

        // schedule cleanup without obtaining a location fix
        if !captureAvailable() {
            delegate?.regionManagerNeedsCleanupWake(
                self,
                localWorkGeneration: generation
            )
            return
        }
        awaitingObservation = (terminalRegion, transition)
        awaitingGeneration = activeGeneration
        locationManager.requestLocation()
    }

    // consume at most one fresh precise fix
    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // branch on the current state
        guard let observation = awaitingObservation,
              let generation = awaitingGeneration,
              let config = activeConfig else {
            return
        }
        awaitingObservation = nil
        awaitingGeneration = nil
        // require one fresh definitive fix
        guard let location = locations.last,
              location.horizontalAccuracy >= 0,
              location.horizontalAccuracy * 1_000 <= Double(
                config.parameters.maxLocationAccuracyMillimeters
              ),
              abs(location.timestamp.timeIntervalSinceNow) <= 120,
              generation == localGeneration(),
              AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: observation.transition,
                decision: AutomaticTerminalSpatialClassifier.classify(
                    latitude: location.coordinate.latitude,
                    longitude: location.coordinate.longitude,
                    accuracyMeters: location.horizontalAccuracy,
                    region: observation.region
                )
              ),
              let capturedAtMs = trustedClock.capturedAtMs(),
              capturedAtMs >= 0,
              let candidateId = try? randomCandidateId() else {
            return
        }
        let latitudeE7 = Int64((location.coordinate.latitude * 10_000_000).rounded())
        let longitudeE7 = Int64((location.coordinate.longitude * 10_000_000).rounded())
        let accuracyMillimeters = location.horizontalAccuracy * 1_000
        // require bounded scaled coordinates
        guard latitudeE7 >= Int64(Int32.min),
              latitudeE7 <= Int64(Int32.max),
              longitudeE7 >= Int64(Int32.min),
              longitudeE7 <= Int64(Int32.max),
              accuracyMillimeters <= Double(UInt32.max) else {
            return
        }
        let candidate = AutomaticCheckinCandidateV1.terminal(
            common: .init(
                accuracyMillimeters: UInt32(accuracyMillimeters.rounded(.up)),
                candidateId: candidateId,
                capturedAtMs: UInt64(capturedAtMs),
                latitudeE7: Int32(latitudeE7),
                longitudeE7: Int32(longitudeE7)
            ),
            terminalId: observation.region.terminalId,
            configGeneration: UInt64(observation.region.configGeneration.value)
        )
        delegate?.regionManager(self, created: candidate, localWorkGeneration: generation)
    }

    // clear one failed location request without retry
    func locationManager(_: CLLocationManager, didFailWithError _: Error) {
        awaitingObservation = nil
        awaitingGeneration = nil
    }

    // reconcile permission and accuracy callbacks
    func locationManagerDidChangeAuthorization(_: CLLocationManager) {
        reconcilePlatformState()
    }

    // stop only this capability namespace
    private func stopOwnedRegions() {
        // run the bounded callback
        let owned = locationManager.monitoredRegions.filter { region in
            region.identifier.hasPrefix(Self.prefix)
        }

        // unregister every owned region
        for region in owned {
            locationManager.stopMonitoring(for: region)
        }

        // unregister every attempted region not yet visible in monitoredRegions
        for region in attemptedRegions.values {
            locationManager.stopMonitoring(for: region)
        }

        // unregister every committed region not yet visible in monitoredRegions
        for region in activeRegions.values {
            locationManager.stopMonitoring(for: region)
        }
    }

    // discard an attempted generation and restore prior complete config
    private func rollbackRegistration() {
        registrationFailed = true
        stopOwnedRegions()
        attemptedRegions.removeAll()
        attemptedConfig = nil
        attemptedGeneration = nil
        activeRegions.removeAll()
        confirmedIdentifiers.removeAll()
        activeConfig = nil
        activeGeneration = nil
        health = .registrationFailed
        let restore = priorConfig
        priorConfig = nil

        // restore only one prior complete generation
        if let restore {
            // preserve the exact prior callback generation
            if stage(
                restore.config,
                generation: restore.generation,
                preservePrior: false
            ) {
                return
            }
        }
        delegate?.regionManager(self, stoppedFor: .geofenceUnavailable)
    }

    // create one canonical 128-bit base64url candidate id
    private static func candidateId() throws -> String {
        let bytes = try AutomaticRandom.bytes(count: 16)
        return bytes.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // namespace one terminal without plaintext job metadata
    static func identifier(
        region: AutomaticTerminalRegion,
        localWorkGeneration: LocalWorkGeneration
    ) -> String {
        let token = Data(region.terminalId.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "\(prefix)\(localWorkGeneration.value):\(region.configGeneration.value):\(token)"
    }

    // resolve only an exact active namespace member
    static func terminalRegion(
        identifier: String,
        config: AutomaticTerminalConfigGeneration,
        localWorkGeneration: LocalWorkGeneration
    ) -> AutomaticTerminalRegion? {
        // run the bounded callback
        config.regions.first { region in
            Self.identifier(
                region: region,
                localWorkGeneration: localWorkGeneration
            ) == identifier
        }
    }
}

// define the native contract
private struct AutomaticProtectedRuntimeCacheRecord: Codable {
    let bootIdentity: String
    let configData: Data
    let monotonicTimeMs: Int64
    let serverTimeMs: Int64
    let wallTimeMs: Int64
}

// define the native contract
final class AutomaticProtectedRuntimeCacheStore {
    private let fileManager: FileManager
    private let fileURL: URL
    private let invalidationURL: URL
    private let removeItem: (URL) throws -> Void

    // isolate one protected public-config and time-anchor cache
    init(
        fileManager: FileManager = .default,
        fileURL: URL? = nil,
        removeItem: ((URL) throws -> Void)? = nil
    ) {
        self.fileManager = fileManager
        self.fileURL = fileURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("leaderboard-automatic-runtime-cache.v1", isDirectory: false)
        invalidationURL = self.fileURL.appendingPathExtension("invalid")
        self.removeItem = removeItem ?? { try fileManager.removeItem(at: $0) }
    }

    // load one exact protected cache record
    func load() -> (Data, TrustedTimeAnchor)? {
        // reject a cache behind durable invalidation authority
        guard !fileManager.fileExists(atPath: invalidationURL.path),
              let data = try? Data(contentsOf: fileURL),
              let record = try? PropertyListDecoder().decode(
                AutomaticProtectedRuntimeCacheRecord.self,
                from: data
              ),
              record.configData.count <= 128 * 1_024,
              record.monotonicTimeMs >= 0,
              record.serverTimeMs >= 0,
              record.wallTimeMs >= 0,
              !record.bootIdentity.isEmpty else {
            return nil
        }

        return (
            record.configData,
            TrustedTimeAnchor(
                bootIdentity: record.bootIdentity,
                monotonicTimeMs: record.monotonicTimeMs,
                serverTimeMs: record.serverTimeMs,
                wallTimeMs: record.wallTimeMs
            )
        )
    }

    // atomically persist public config and a non-location anchor
    func store(configData: Data, anchor: TrustedTimeAnchor) -> Bool {
        // branch on the current state
        guard configData.count <= 128 * 1_024 else {
            return false
        }
        let record = AutomaticProtectedRuntimeCacheRecord(
            bootIdentity: anchor.bootIdentity,
            configData: configData,
            monotonicTimeMs: anchor.monotonicTimeMs,
            serverTimeMs: anchor.serverTimeMs,
            wallTimeMs: anchor.wallTimeMs
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        // require one encodable cache record
        guard let data = try? encoder.encode(record) else {
            return false
        }
        let directoryURL = fileURL.deletingLastPathComponent()
        let temporaryURL = directoryURL.appendingPathComponent(
            ".runtime-cache-\(UUID().uuidString).tmp",
            isDirectory: false
        )

        // persist only protected no-backup bytes
        do {
            try AutomaticProtectedFile.applyDirectoryPolicy(directoryURL, fileManager: fileManager)
            try data.write(to: temporaryURL, options: .withoutOverwriting)
            try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
            try AutomaticProtectedFile.atomicReplace(
                temporaryURL: temporaryURL,
                destinationURL: fileURL,
                fileManager: fileManager
            )
            try AutomaticProtectedFile.applyFilePolicy(fileURL, fileManager: fileManager)
            // publish only after clearing prior invalidation authority
            if fileManager.fileExists(atPath: invalidationURL.path) {
                try removeItem(invalidationURL)
            }
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
    }

    // durably invalidate stale config before best-effort removal
    func invalidate() -> Bool {
        let directoryURL = fileURL.deletingLastPathComponent()
        let temporaryURL = directoryURL.appendingPathComponent(
            ".runtime-cache-invalid-\(UUID().uuidString).tmp",
            isDirectory: false
        )

        // attempt the protected operation
        do {
            try AutomaticProtectedFile.applyDirectoryPolicy(directoryURL, fileManager: fileManager)
            try Data([1]).write(to: temporaryURL, options: .withoutOverwriting)
            try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
            try AutomaticProtectedFile.atomicReplace(
                temporaryURL: temporaryURL,
                destinationURL: invalidationURL,
                fileManager: fileManager
            )
            try AutomaticProtectedFile.applyFilePolicy(invalidationURL, fileManager: fileManager)

            // retain the invalid marker even when stale bytes cannot be removed
            if fileManager.fileExists(atPath: fileURL.path) {
                try removeItem(fileURL)
            }
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
    }
}

/// default-off production runtime; enrollment ui wiring is owned by the next goal
final class AutomaticLeaderboardIOSRuntime: AutomaticIOSRegionManagerDelegate {
    static let shared = AutomaticLeaderboardIOSRuntime()
    private static let enableKey = "AutomaticLeaderboardCheckinsEnabled"
    static let debugOptInEnvironmentKey = "FERRY_FYI_AUTOMATIC_N1"

    // expose only the compiled default-off capability gate
    static var isBuildEnabled: Bool {
        #if DEBUG
        // admit only the explicit shared n1 debug scheme
        if ProcessInfo.processInfo.environment[debugOptInEnvironmentKey] == "1" {
            return true
        }
        #endif
        return Bundle.main.object(forInfoDictionaryKey: enableKey) as? Bool == true
    }
    private let protectedDataAvailable: () -> Bool
    private let enabled: () -> Bool
    private let queue: AutomaticCandidateQueueing
    private let vault: AutomaticCredentialVault
    private let transport: AutomaticURLSessionNativeTransport
    private let coordinator: AutomaticSecureRuntimeCoordinator
    private let regionManager: AutomaticIOSRegionManager
    private let trustedClock: AutomaticTrustedClock
    private let effects: AutomaticCreditedEffectEmitter
    private let runtimeCache: AutomaticProtectedRuntimeCacheStore
    private var uploader: AutomaticCheckinUploader?
    private var currentConfig: AutomaticNativeRuntimeConfig?
    private var pendingRuntimeCommit: (
        config: AutomaticNativeRuntimeConfig,
        data: Data,
        anchor: TrustedTimeAnchor
    )?

    // assemble one inert production capability
    private init() {
        // run the bounded callback
        protectedDataAvailable = { AutomaticFirstUnlockProbe.shared.isAvailable() }
        // run the bounded callback
        enabled = {
            Self.isBuildEnabled
        }
        let secureStore = AutomaticIOSKeychainStore()
        let sentinelStore = AutomaticInstallationSentinelStore()
        var queueReference: AutomaticCandidateQueueing?
        let credentialVault = AutomaticCredentialVault(
            secureStore: secureStore,
            sentinelStore: sentinelStore,
            // run the bounded callback
            purgeQueue: { queueReference?.purge() ?? true }
        )
        vault = credentialVault
        let encryptedQueue = AutomaticEncryptedCandidateQueue(
            // run the bounded callback
            keyProvider: { try credentialVault.queueKey() }
        )
        queue = encryptedQueue
        queueReference = encryptedQueue
        transport = AutomaticURLSessionNativeTransport()
        let bootIdentityProvider = AutomaticIOSBootIdentityProvider()
        trustedClock = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: {
                Int64((Date().timeIntervalSince1970 * 1_000).rounded(.down))
            },
            // run the bounded callback
            monotonicClockMs: {
                Int64((ProcessInfo.processInfo.systemUptime * 1_000).rounded(.down))
            },
            // run the bounded callback
            bootIdentity: {
                bootIdentityProvider.current()
            }
        )
        effects = AutomaticCreditedEffectEmitter()
        let protectedRuntimeCache = AutomaticProtectedRuntimeCacheStore()
        runtimeCache = protectedRuntimeCache
        let runtimeCoordinator = AutomaticSecureRuntimeCoordinator(
            queue: encryptedQueue,
            vault: credentialVault,
            trustedClock: trustedClock,
            transport: transport,
            generationStore: AutomaticProtectedLocalGenerationStore(),
            stopAuthorityStore: AutomaticKeychainPendingStopAuthorityStore(),
            // run the bounded callback
            invalidateProtectedCache: { protectedRuntimeCache.invalidate() }
        )
        coordinator = runtimeCoordinator
        regionManager = AutomaticIOSRegionManager(
            trustedClock: trustedClock,
            // run the bounded callback
            localGeneration: { runtimeCoordinator.generation() },
            // run the bounded callback
            captureAvailable: { !encryptedQueue.hasCleanupRequired() }
        )
        runtimeCoordinator.attachRegions(regionManager)
        regionManager.delegate = self
    }

    // reconcile only when the production build gate is explicit
    func configureIfEnabled() {
        // serialize lifecycle and config state on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.configureIfEnabled() }
            return
        }
        // require the explicit build capability
        guard enabled() else {
            return
        }
        // report first-unlock health without accessing runtime material
        guard protectedDataAvailable() else {
            regionManager.reconcilePlatformState()
            return
        }
        // replay stop authority before any other native lifecycle work
        guard coordinator.recoverPendingStop() else {
            coordinator.recordOutcome("cleanup_required")
            return
        }
        // recover a pre-unlock protected counter read
        guard coordinator.recoverGenerationPersistence() else {
            coordinator.recordOutcome("cleanup_required")
            return
        }
        regionManager.reconcilePlatformState()

        // preserve ciphertext while bar is unavailable
        if regionManager.health == .backgroundRefreshOff {
            _ = coordinator.holdForBackgroundRefresh()
            return
        }

        // stop after synchronous settings permission loss
        if regionManager.health == .permissionDenied ||
            regionManager.health == .reducedAccuracy ||
            regionManager.health == .firstUnlockRequired {
            return
        }
        // require retained queue convergence
        guard coordinator.resumeAfterBackgroundRefresh() else {
            coordinator.recordOutcome("cleanup_required")
            return
        }

        // attempt the protected operation
        do {
            _ = try vault.reconcileInstallation()
            // require one trusted reference-owned credential
            guard let credentialLease = try vault.loadCredentialLease() else {
                return
            }
            // reject malformed stored metadata without retaining bearer bytes
            guard let endpointUrls = credentialLease.endpointUrls(),
                  AutomaticProductionNativeEndpointPolicy.validates(endpointUrls),
                  let metadata = credentialLease.expiryMetadata() else {
                credentialLease.wipe()
                return
            }
            configureUploader()
            // retry deletion-only cleanup on every native lifecycle execution
            uploader?.wake(localWorkGeneration: coordinator.generation()) {}
            restoreProtectedRuntimeIfPossible()

            // stop at trusted credential expiry before network
            if let trustedNowMs = trustedClock.trustedNowMs(),
               metadata.expiresAtMs <= trustedNowMs {
                credentialLease.wipe()
                currentConfig = nil
                pendingRuntimeCommit = nil
                coordinator.stop(trigger: .enrollmentExpired)
                return
            }
            reconcileStatusThenConfig(credentialLease: credentialLease)
        // fail closed on the error
        } catch {
            coordinator.recordOutcome("cleanup_required")
        }
    }

    // prepare one native installation nonce for authenticated enrollment
    func prepareEnrollment() -> String? {
        // serialize credential bootstrap state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.prepareEnrollment() }
        }
        // require enabled unlocked bootstrap access
        guard enabled(), protectedDataAvailable() else {
            return nil
        }

        // attempt the protected operation
        do {
            _ = try vault.reconcileInstallation()
            var nonce = try vault.beginEnrollmentBootstrap()
            // release protected state
            defer {
                // wipe the bootstrap nonce buffer
                nonce.resetBytes(in: 0..<nonce.count)
                nonce.removeAll(keepingCapacity: false)
            }
            return nonce.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        // fail closed on the error
        } catch {
            return nil
        }
    }

    // persist one already authenticated enrollment credential
    func installCredential(_ credential: inout AutomaticEnrollmentCredentialPayload) -> Bool {
        // serialize credential replacement state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.installCredential(&credential) }
        }
        // require enabled unlocked installation access
        guard enabled(), protectedDataAvailable() else {
            return false
        }

        // attempt the protected operation
        do {
            _ = try vault.reconcileInstallation()
            // require the compiled endpoint set
            guard AutomaticProductionNativeEndpointPolicy.validates(
                credential.urls.endpointUrls()
            ) else {
                return false
            }
            var installationNonce = try vault.consumeEnrollmentBootstrapNonce()
            // release protected state
            defer {
                // wipe the consumed bootstrap binding
                installationNonce.resetBytes(in: 0..<installationNonce.count)
                installationNonce.removeAll(keepingCapacity: false)
            }
            var boundCredential = credential.bound(to: installationNonce)
            // release protected state
            defer {
                // wipe the internally bound credential copy
                boundCredential.wipe()
            }
            // invalidate old enrollment work first
            guard coordinator.replaceEnrollment(
                serverPolicyGeneration: boundCredential.serverPolicyGeneration
            ) else {
                return false
            }
            currentConfig = nil
            pendingRuntimeCommit = nil
            try vault.storeCredential(boundCredential)
            // reload into one reference-owned lease
            guard let credentialLease = try vault.loadCredentialLease() else {
                return false
            }
            // reject an incomplete decoded lease
            guard let metadata = credentialLease.expiryMetadata() else {
                credentialLease.wipe()
                return false
            }
            configureUploader()
            // retry deletion-only cleanup after enrollment replacement
            uploader?.wake(localWorkGeneration: coordinator.generation()) {}
            restoreProtectedRuntimeIfPossible()

            // reject an already expired installed lifecycle
            if let trustedNowMs = trustedClock.trustedNowMs(),
               metadata.expiresAtMs <= trustedNowMs {
                credentialLease.wipe()
                currentConfig = nil
                pendingRuntimeCommit = nil
                coordinator.stop(trigger: .enrollmentExpired)
                return false
            }
            reconcileStatusThenConfig(credentialLease: credentialLease)
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }

    // bind one transient auth subject to the installed credential
    func bindIdentity(_ subject: String) -> Bool {
        // serialize identity proof state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.bindIdentity(subject) }
        }
        // require enabled after-first-unlock storage
        guard enabled(), protectedDataAvailable() else {
            return false
        }
        // persist only the keyed device-owner digest
        do {
            return try vault.bindSubject(subject)
        // fail closed on the error
        } catch {
            return false
        }
    }

    // check one transient auth subject without exposing its digest
    func checkIdentity(_ subject: String) -> AutomaticSubjectBindingCheck {
        // serialize identity proof reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.checkIdentity(subject) }
        }
        // require enabled after-first-unlock storage
        guard enabled(), protectedDataAvailable() else {
            return AutomaticSubjectBindingCheck(bound: false, matches: false)
        }
        // fail closed on unreadable or corrupt proof material
        do {
            return try vault.checkSubject(subject)
        } catch {
            return AutomaticSubjectBindingCheck(bound: true, matches: false)
        }
    }

    // stage one subject-bound cleanup obligation before identity purge
    func stageEnrollmentCleanup(_ subject: String) -> Bool {
        // serialize cleanup proof state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.stageEnrollmentCleanup(subject) }
        }
        // require enabled after-first-unlock storage
        guard enabled(), protectedDataAvailable() else {
            return false
        }
        // persist only the keyed device-owner proof
        do {
            return try vault.stageCleanupPending(subject)
        // fail closed on the error
        } catch {
            return false
        }
    }

    // check one cleanup obligation without exposing its proof
    func checkEnrollmentCleanup(_ subject: String) -> AutomaticCleanupPendingCheck {
        // serialize cleanup proof reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.checkEnrollmentCleanup(subject) }
        }
        // require enabled after-first-unlock storage
        guard enabled(), protectedDataAvailable() else {
            return AutomaticCleanupPendingCheck(matches: false, pending: false, valid: true)
        }
        // distinguish unreadable cleanup state from a clean installation
        do {
            return try vault.checkCleanupPending(subject)
        } catch {
            return AutomaticCleanupPendingCheck(matches: false, pending: true, valid: false)
        }
    }

    // clear only one exactly matched cleanup obligation
    func clearEnrollmentCleanup(_ subject: String) -> Bool {
        // serialize cleanup proof state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.clearEnrollmentCleanup(subject) }
        }
        // require enabled after-first-unlock storage
        guard enabled(), protectedDataAvailable() else {
            return false
        }
        // remove only the exact keyed cleanup proof
        do {
            return try vault.clearCleanupPending(subject)
        // fail closed on the error
        } catch {
            return false
        }
    }

    // stop new work while background refresh is unavailable
    func applicationDidEnterBackground() {
        // serialize lifecycle state on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.applicationDidEnterBackground() }
            return
        }
        // avoid constructing background work while disabled
        guard enabled() else {
            return
        }
        regionManager.reconcilePlatformState()

        // cancel callbacks and network while bar is unavailable
        if regionManager.health == .backgroundRefreshOff {
            coordinator.holdForBackgroundRefresh()
        }
    }

    // reconcile queue, policy, time, and regions after manual open
    func applicationWillEnterForeground() {
        // serialize lifecycle state on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.applicationWillEnterForeground() }
            return
        }
        configureIfEnabled()
    }

    // reconcile after first unlock without plaintext fallback
    func protectedDataDidBecomeAvailable() {
        // serialize protected data state on main
        if !Thread.isMainThread {
            // run the bounded callback
            DispatchQueue.main.sync { self.protectedDataDidBecomeAvailable() }
            return
        }
        configureIfEnabled()
    }

    // stop and purge synchronously before controllable auth teardown
    func stopFromBridge(_ trigger: AutomaticRuntimeStopTrigger) -> Bool {
        // serialize bridge teardown state on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.stopFromBridge(trigger) }
        }
        let revocationLease: AutomaticCredentialLease?

        // retain one isolated server-revocation lease
        if trigger.requestsServerRevoke {
            revocationLease = try? vault.loadCredentialLease()
        // branch on the current state
        } else {
            revocationLease = nil
        }
        currentConfig = nil
        pendingRuntimeCommit = nil
        let purged = coordinator.stop(trigger: trigger)

        // revoke best-effort only after synchronous local purge
        if let revocationLease,
           let endpointUrls = revocationLease.endpointUrls(),
           AutomaticProductionNativeEndpointPolicy.validates(endpointUrls) {
            transport.revokeEnrollment(credentialLease: revocationLease) {}
        // branch on the current state
        } else {
            revocationLease?.wipe()
        }
        return purged
    }

    // expose only fixed aggregate bridge status
    func bridgeStatus() -> [String: Any] {
        // serialize aggregate runtime reads on main
        if !Thread.isMainThread {
            // run the bounded callback
            return DispatchQueue.main.sync { self.bridgeStatus() }
        }
        let policy = coordinator.bridgePolicyState()
        return AutomaticBridgeStatusContract.project(
            configGeneration: regionManager.configGeneration(),
            credentialExpiryBucket: credentialExpiryBucket(),
            lastOutcome: policy.lastOutcome,
            monitorHealth: regionManager.monitorHealth(lastOutcome: policy.lastOutcome),
            pendingCandidateCount: queue.pendingCount(),
            permissionHealth: regionManager.permissionHealth(),
            serverPolicyGeneration: policy.serverPolicyGeneration
        )
    }

    // bucket credential expiry without exposing exact time
    private func credentialExpiryBucket() -> String {
        // require unlocked reference-owned credential access
        guard protectedDataAvailable(),
              let credentialLease = try? vault.loadCredentialLease() else {
            return "unavailable"
        }
        // release protected state
        defer {
            // wipe the aggregate-status credential lease
            credentialLease.wipe()
        }
        // require only aggregate expiry inputs
        guard let metadata = credentialLease.expiryMetadata(),
              let trustedNowMs = trustedClock.trustedNowMs() else {
            return "unavailable"
        }
        let remainingMs = metadata.expiresAtMs - trustedNowMs

        // classify one fixed credential window
        if remainingMs <= 0 {
            return "expired"
        }
        // classify the one-day window
        if remainingMs < 86_400_000 {
            return "less_than_1_day"
        }
        // classify the seven-day window
        if remainingMs < 604_800_000 {
            return "less_than_7_days"
        }
        return "seven_days_or_more"
    }

    // commit cache and config only after exact platform confirmation
    func regionManager(
        _: AutomaticIOSRegionManager,
        shouldCommit config: AutomaticNativeRuntimeConfig,
        localWorkGeneration: LocalWorkGeneration
    ) -> Bool {
        // preserve one previously committed rollback generation
        if currentConfig?.generation == config.generation,
           coordinator.isCurrent(localWorkGeneration) {
            pendingRuntimeCommit = nil
            return true
        }

        // require the exact staged cache and callback generation
        guard coordinator.isCurrent(localWorkGeneration),
              let pendingRuntimeCommit,
              pendingRuntimeCommit.config.generation == config.generation,
              runtimeCache.store(
                  configData: pendingRuntimeCommit.data,
                  anchor: pendingRuntimeCommit.anchor
              ) else {
            self.pendingRuntimeCommit = nil
            coordinator.recordOutcome("cleanup_required")
            return false
        }
        currentConfig = config
        self.pendingRuntimeCommit = nil
        return true
    }

    // run deletion-only cleanup without candidate or location detail
    func regionManagerNeedsCleanupWake(
        _: AutomaticIOSRegionManager,
        localWorkGeneration: LocalWorkGeneration
    ) {
        coordinator.recordOutcome("cleanup_required")
        uploader?.wake(localWorkGeneration: localWorkGeneration) {}
    }

    // enqueue one native-only candidate and issue a zero-data wake
    func regionManager(
        _: AutomaticIOSRegionManager,
        created candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration
    ) {
        // require current enabled candidate configuration
        guard enabled(), let currentConfig else {
            return
        }
        var mutationError: AutomaticSecureRuntimeError?
        var shouldWake = false
        // run the bounded callback
        let admitted = coordinator.mutateIfCurrent(localWorkGeneration) {
            // persist and authorize scheduling under the generation lock
            do {
                _ = try queue.enqueue(
                    candidate,
                    localWorkGeneration: localWorkGeneration,
                    maximumCount: currentConfig.parameters.maxPendingCandidates
                )
                shouldWake = true
            // fail closed on the error
            } catch let error as AutomaticSecureRuntimeError {
                mutationError = error
            // fail closed on the error
            } catch {
                mutationError = .queueStorageFailed
            }
        }

        // authorize a zero-data upload or deletion-only cleanup wake
        shouldWake = admitted && AutomaticIOSCandidateWakePolicy.shouldWake(
            candidateStored: shouldWake,
            mutationError: mutationError
        )

        // ignore one documented overflow rejection
        if admitted && mutationError != nil && mutationError != .queueOverflowRejected {
            coordinator.recordOutcome("cleanup_required")
        }

        // execute only an already authorized zero-data wake
        if admitted && shouldWake {
            uploader?.wake(localWorkGeneration: localWorkGeneration) {}
        }
    }

    // apply one known platform stop immediately
    func regionManager(
        _: AutomaticIOSRegionManager,
        stoppedFor trigger: AutomaticRuntimeStopTrigger
    ) {
        // discard stale configuration before a known platform stop
        currentConfig = nil
        pendingRuntimeCommit = nil
        coordinator.stop(trigger: trigger)
    }

    // bind an uploader only to a validated credential origin
    private func configureUploader() {
        uploader = AutomaticCheckinUploader(
            queue: queue,
            transport: transport,
            endpointValidator: AutomaticNativeEndpointValidator(
                expectedOrigin: AutomaticProductionNativeEndpointPolicy.expectedOrigin
            ),
            trustedClock: trustedClock,
            // run the bounded callback
            credentialProvider: { [weak self] in try self?.vault.loadCredentialLease() },
            policy: coordinator,
            effects: effects
        )
    }

    // restore same-boot public config before an asynchronous refresh
    private func restoreProtectedRuntimeIfPossible() {
        // require one complete validated public cache record
        guard let (configData, anchor) = runtimeCache.load(),
              let config = AutomaticNativeRuntimeContractParser.parseConfig(
                configData,
                expectedOrigin: AutomaticProductionNativeEndpointPolicy.expectedOrigin
              ),
              config.terminalEnabled else {
            return
        }

        // preserve only non-regressing immutable config generations
        if !AutomaticConfigCommitPolicy.permits(
            candidate: config.generation,
            current: pendingRuntimeCommit?.config.generation ?? currentConfig?.generation
        ) {
            return
        }

        // commit time only after cached config validation
        guard trustedClock.restoreAnchor(anchor),
              coordinator.observePolicyGeneration(
                config.generation.serverPolicyGeneration.value
              ) else {
            return
        }

        pendingRuntimeCommit = (config, configData, anchor)

        // stage before exposing the protected cache as active
        if !regionManager.activate(config) {
            pendingRuntimeCommit = nil
        }
    }

    // fetch status before configuration authority
    private func reconcileStatusThenConfig(credentialLease: AutomaticCredentialLease) {
        let generation = coordinator.generation()
        // run the bounded callback
        transport.fetch(kind: .status, credentialLease: credentialLease) { [weak self] result in
            // commit all runtime state on the main executor
            DispatchQueue.main.async {
                self?.applyStatusResponse(
                    result,
                    credentialLease: credentialLease,
                    localGeneration: generation
                )
            }
        }
    }

    // apply one serialized authoritative status response
    private func applyStatusResponse(
        _ result: Result<AutomaticCandidateTransportResponse, Error>,
        credentialLease: AutomaticCredentialLease,
        localGeneration: LocalWorkGeneration
    ) {
        // require one received status response
        guard case let .success(response) = result else {
            credentialLease.wipe()
            return
        }
        // release protected state
        defer {
            // wipe every status response path
            response.wipe()
        }
        var statusData = response.data
        // release protected state
        defer {
            // wipe the status parser snapshot
            statusData.resetBytes(in: 0..<statusData.count)
            statusData.removeAll(keepingCapacity: false)
        }
        // require current strict status authority
        guard coordinator.isCurrent(localGeneration),
              let statusURL = credentialLease.endpointURL(.status),
              response.statusCode == 200,
              AutomaticNativeEndpointValidator(
                expectedOrigin: AutomaticProductionNativeEndpointPolicy.expectedOrigin
              ).acceptsResponse(
                kind: .status,
                requestedURL: statusURL,
                resolvedURL: response.resolvedURL,
                wasRedirected: response.wasRedirected
              ),
              let status = AutomaticNativeRuntimeContractParser.parseStatus(statusData) else {
            credentialLease.wipe()
            return
        }
        let credentialExpired = status.credentialExpiryBucket == "expired"

        // wipe bearer ownership before any authoritative stop effect
        if !status.automaticEnabled || credentialExpired {
            credentialLease.wipe()
            coordinator.reconcileStatus(
                serverPolicyGeneration: status.serverPolicyGeneration,
                automaticEnabled: status.automaticEnabled,
                credentialExpired: credentialExpired
            )
            return
        }
        coordinator.reconcileStatus(
            serverPolicyGeneration: status.serverPolicyGeneration,
            automaticEnabled: true,
            credentialExpired: false
        )
        // continue only under current enabled policy
        guard coordinator.isCurrent(localGeneration), status.automaticEnabled else {
            credentialLease.wipe()
            return
        }
        reconcileConfig(credentialLease: credentialLease, localGeneration: localGeneration)
    }

    // fetch and activate one authoritative complete configuration
    private func reconcileConfig(
        credentialLease: AutomaticCredentialLease,
        localGeneration: LocalWorkGeneration
    ) {
        // require the still-owned config endpoint
        guard credentialLease.endpointURL(.config) != nil else {
            credentialLease.wipe()
            return
        }
        // run the bounded callback
        transport.fetch(kind: .config, credentialLease: credentialLease) { [weak self] result in
            // commit all core location state on the main executor
            DispatchQueue.main.async {
                self?.applyConfigResponse(
                    result,
                    credentialLease: credentialLease,
                    localGeneration: localGeneration
                )
            }
        }
    }

    // apply one serialized complete config response
    private func applyConfigResponse(
        _ result: Result<AutomaticCandidateTransportResponse, Error>,
        credentialLease: AutomaticCredentialLease,
        localGeneration: LocalWorkGeneration
    ) {
        // release protected state
        defer {
            // wipe the status-config credential chain
            credentialLease.wipe()
        }
        // require one received config response
        guard case let .success(response) = result else {
            return
        }
        // release protected state
        defer {
            // wipe every config response path
            response.wipe()
        }
        var configData = response.data
        // release protected state
        defer {
            // wipe the config parser snapshot
            configData.resetBytes(in: 0..<configData.count)
            configData.removeAll(keepingCapacity: false)
        }
        // require current strict config authority
        guard coordinator.isCurrent(localGeneration),
              let configURL = credentialLease.endpointURL(.config),
              response.statusCode == 200,
              AutomaticNativeEndpointValidator(
                expectedOrigin: AutomaticProductionNativeEndpointPolicy.expectedOrigin
              ).acceptsResponse(
                kind: .config,
                requestedURL: configURL,
                resolvedURL: response.resolvedURL,
                wasRedirected: response.wasRedirected
              ),
              let config = AutomaticNativeRuntimeContractParser.parseConfig(
                configData,
                expectedOrigin: AutomaticProductionNativeEndpointPolicy.expectedOrigin
              ) else {
            return
        }
        // release bearer ownership before config or policy effects
        credentialLease.wipe()

        // reject config rollback or immutable generation mutation
        if !AutomaticConfigCommitPolicy.permits(
            candidate: config.generation,
            current: pendingRuntimeCommit?.config.generation ?? currentConfig?.generation
        ) {
            return
        }

        // commit policy and time only for an admissible config
        guard coordinator.observePolicyGeneration(
                config.generation.serverPolicyGeneration.value
              ),
              coordinator.refreshTrustedServerTime(config.serverTimeMs) else {
            return
        }

        // stop immediately on an authoritative detector denial
        if !config.terminalEnabled {
            coordinator.stop(trigger: .detectorDenied)
            return
        }

        // stage regions before atomically committing cache and runtime identity
        guard let anchor = trustedClock.currentAnchor() else {
            return
        }
        pendingRuntimeCommit = (config, configData, anchor)
        // branch on the current state
        guard regionManager.activate(config) else {
            pendingRuntimeCommit = nil
            // degrade only when no prior complete registration survived
            if regionManager.configGeneration() == nil {
                coordinator.recordOutcome("cleanup_required")
            }
            return
        }
        uploader?.wake(localWorkGeneration: localGeneration) {}
    }

}
