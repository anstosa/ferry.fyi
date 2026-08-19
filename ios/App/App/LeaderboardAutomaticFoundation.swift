import CryptoKit
import Foundation

// define the native contract
enum AutomaticCheckinCandidateV1: Equatable {
    // define the native contract
    struct Common: Equatable {
        let accuracyMillimeters: UInt32
        let candidateId: String
        let capturedAtMs: UInt64
        let latitudeE7: Int32
        let longitudeE7: Int32
    }

    case terminal(common: Common, terminalId: String, configGeneration: UInt64)
    case vessel(common: Common, vesselId: String, sailingId: String)
}

// define the native contract
enum AutomaticCandidateUploadSchedulerV1 {
    // select one independent upload head per terminal
    static func selectHeads(_ candidates: [AutomaticCheckinCandidateV1]) -> [AutomaticCheckinCandidateV1] {
        // run the bounded callback
        let ordered = candidates.sorted { left, right in
            let leftCommon = common(left)
            let rightCommon = common(right)

            // order equal timestamps by opaque candidate id
            if leftCommon.capturedAtMs == rightCommon.capturedAtMs {
                return leftCommon.candidateId < rightCommon.candidateId
            }

            return leftCommon.capturedAtMs < rightCommon.capturedAtMs
        }
        var selected: [AutomaticCheckinCandidateV1] = []
        var selectedTerminalIds: Set<String> = []

        // visit oldest work before its same-terminal successors
        for candidate in ordered {
            // select by independent entity lane
            switch candidate {
            case let .terminal(_, terminalId, _):
                // block only newer work for the same terminal
                if selectedTerminalIds.insert(terminalId).inserted {
                    selected.append(candidate)
                }
            case .vessel:
                selected.append(candidate)
            }
        }

        return selected
    }

    // project common ordering fields
    private static func common(_ candidate: AutomaticCheckinCandidateV1) -> AutomaticCheckinCandidateV1.Common {
        // project either discriminated case
        switch candidate {
        case let .terminal(common, _, _), let .vessel(common, _, _):
            return common
        }
    }
}

// define the native contract
enum AutomaticPayloadDigestV1Error: Error, Equatable {
    case invalidCandidateId
    case invalidCandidate
    case invalidIdentifier
    case stringTooLong
}

// define the native contract
enum AutomaticPayloadDigestV1 {
    private static let versionByte: UInt8 = 1
    private static let maxSafeInteger: UInt64 = 9_007_199_254_740_991
    private static let maxIdentifierBytes = 128

    // encode strict parsed semantics
    static func canonicalBytes(_ candidate: AutomaticCheckinCandidateV1) throws -> Data {
        var output = Data([versionByte])

        // encode the discriminated payload
        switch candidate {
        case let .terminal(common, terminalId, configGeneration):
            try validate(common)

            // require the terminal suffix
            if !isIdentifier(terminalId) || configGeneration == 0 || configGeneration > maxSafeInteger {
                throw AutomaticPayloadDigestV1Error.invalidIdentifier
            }

            try appendUTF8("terminal", to: &output)
            try appendUTF8(common.candidateId, to: &output)
            append(common.capturedAtMs, to: &output)
            append(common.latitudeE7, to: &output)
            append(common.longitudeE7, to: &output)
            append(common.accuracyMillimeters, to: &output)
            try appendUTF8(terminalId, to: &output)
            append(configGeneration, to: &output)
        case let .vessel(common, vesselId, sailingId):
            try validate(common)

            // require the vessel suffix
            if !isIdentifier(vesselId) || !isIdentifier(sailingId) {
                throw AutomaticPayloadDigestV1Error.invalidIdentifier
            }

            try appendUTF8("vessel", to: &output)
            try appendUTF8(common.candidateId, to: &output)
            append(common.capturedAtMs, to: &output)
            append(common.latitudeE7, to: &output)
            append(common.longitudeE7, to: &output)
            append(common.accuracyMillimeters, to: &output)
            try appendUTF8(vesselId, to: &output)
            try appendUTF8(sailingId, to: &output)
        }

        return output
    }

    // hash canonical bytes
    static func digestHex(_ candidate: AutomaticCheckinCandidateV1) throws -> String {
        sha256Hex(try canonicalBytes(candidate))
    }

    // hash arbitrary verified bytes
    static func sha256Hex(_ bytes: Data) -> String {
        // run the bounded callback
        SHA256.hash(data: bytes).map { byte in
            String(format: "%02x", byte)
        }.joined()
    }

    // render fixture bytes
    static func hex(_ bytes: Data) -> String {
        // run the bounded callback
        bytes.map { byte in
            String(format: "%02x", byte)
        }.joined()
    }

    // validate common fields
    private static func validate(_ common: AutomaticCheckinCandidateV1.Common) throws {
        // require canonical base64url
        if !isCanonicalCandidateId(common.candidateId) {
            throw AutomaticPayloadDigestV1Error.invalidCandidateId
        }

        // require strict shared ranges
        if common.capturedAtMs > maxSafeInteger ||
            common.latitudeE7 < -900_000_000 ||
            common.latitudeE7 > 900_000_000 ||
            common.longitudeE7 < -1_800_000_000 ||
            common.longitudeE7 > 1_800_000_000 {
            throw AutomaticPayloadDigestV1Error.invalidCandidate
        }
    }

    // validate bounded unicode identifiers
    private static func isIdentifier(_ value: String) -> Bool {
        // reject empty or oversized values
        if value.isEmpty || value.utf8.count > maxIdentifierBytes {
            return false
        }

        // reject control scalars
        return !value.unicodeScalars.contains { scalar in
            scalar.value <= 0x1f || scalar.value == 0x7f
        }
    }

    // require canonical 128-bit base64url
    private static func isCanonicalCandidateId(_ candidateId: String) -> Bool {
        // reject wrong encoded lengths
        if candidateId.utf8.count != 22 {
            return false
        }

        let padded = candidateId
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + "=="

        // require decodable 16-byte data
        guard let decoded = Data(base64Encoded: padded), decoded.count == 16 else {
            return false
        }

        let canonical = decoded.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return canonical == candidateId
    }

    // append length-prefixed utf-8
    private static func appendUTF8(_ value: String, to output: inout Data) throws {
        let bytes = Data(value.utf8)

        // require u32 length
        if bytes.count > Int(UInt32.max) {
            throw AutomaticPayloadDigestV1Error.stringTooLong
        }

        append(UInt32(bytes.count), to: &output)
        output.append(bytes)
    }

    // append big-endian u32
    private static func append(_ value: UInt32, to output: inout Data) {
        var bigEndian = value.bigEndian
        // run the bounded callback
        withUnsafeBytes(of: &bigEndian) { bytes in
            output.append(contentsOf: bytes)
        }
    }

    // append big-endian i32
    private static func append(_ value: Int32, to output: inout Data) {
        var bigEndian = value.bigEndian
        // run the bounded callback
        withUnsafeBytes(of: &bigEndian) { bytes in
            output.append(contentsOf: bytes)
        }
    }

    // append big-endian u64
    private static func append(_ value: UInt64, to output: inout Data) {
        var bigEndian = value.bigEndian
        // run the bounded callback
        withUnsafeBytes(of: &bigEndian) { bytes in
            output.append(contentsOf: bytes)
        }
    }
}

let automaticCandidateRetentionMs: Int64 = 12 * 60 * 60 * 1_000

// define the native contract
struct TrustedTimeAnchor: Equatable {
    let bootIdentity: String
    let monotonicTimeMs: Int64
    let serverTimeMs: Int64
    let wallTimeMs: Int64
}

// define the native contract
enum ExpiryEvaluation: Equatable {
    case blockedWithoutSameBootAnchor
    case available(expired: Bool, trustedNowMs: Int64)
}

// define the native contract
final class AutomaticTrustedClock {
    private static let maxSafeInteger: Int64 = 9_007_199_254_740_991
    private let wallClockMs: () -> Int64
    private let monotonicClockMs: () -> Int64
    private let bootIdentity: () -> String
    private let lock = NSLock()
    private var anchor: TrustedTimeAnchor?

    // inject platform clock adapters
    init(
        wallClockMs: @escaping () -> Int64,
        monotonicClockMs: @escaping () -> Int64,
        bootIdentity: @escaping () -> String
    ) {
        self.wallClockMs = wallClockMs
        self.monotonicClockMs = monotonicClockMs
        self.bootIdentity = bootIdentity
    }

    // replace the https server anchor
    @discardableResult
    func refreshAnchor(serverTimeMs: Int64) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let currentBootIdentity = bootIdentity()
        let currentMonotonicTimeMs = monotonicClockMs()
        let currentWallTimeMs = wallClockMs()

        // reject unusable anchors
        if serverTimeMs < 0 ||
            serverTimeMs > Self.maxSafeInteger ||
            currentBootIdentity.isEmpty ||
            currentMonotonicTimeMs < 0 {
            return false
        }

        // reject server-time rollback on the same boot
        if let currentAnchor = sameBootAnchor(),
           let elapsed = monotonicElapsed(currentAnchor),
           let currentTrustedNow = addWithoutOverflow(
               currentAnchor.serverTimeMs,
               max(
                   elapsed,
                   nonNegativeElapsed(currentWallTimeMs, currentAnchor.wallTimeMs)
               )
           ),
           serverTimeMs < currentTrustedNow {
            return false
        }

        anchor = TrustedTimeAnchor(
            bootIdentity: currentBootIdentity,
            monotonicTimeMs: currentMonotonicTimeMs,
            serverTimeMs: serverTimeMs,
            wallTimeMs: currentWallTimeMs
        )
        return true
    }

    // restore one protected same-boot anchor
    @discardableResult
    func restoreAnchor(_ restored: TrustedTimeAnchor) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let currentMonotonicTimeMs = monotonicClockMs()
        let currentWallTimeMs = wallClockMs()
        // require exact boot identity and safe persisted values
        if restored.bootIdentity.isEmpty ||
            restored.bootIdentity != bootIdentity() ||
            restored.monotonicTimeMs < 0 ||
            restored.serverTimeMs < 0 ||
            restored.serverTimeMs > Self.maxSafeInteger ||
            restored.wallTimeMs < 0 ||
            currentMonotonicTimeMs < restored.monotonicTimeMs {
            return false
        }

        // reject a protected cache that regresses current trusted time
        if let currentAnchor = sameBootAnchor(),
           let currentElapsed = monotonicElapsed(currentAnchor),
           let currentTrustedNow = addWithoutOverflow(
               currentAnchor.serverTimeMs,
               max(
                   currentElapsed,
                   nonNegativeElapsed(currentWallTimeMs, currentAnchor.wallTimeMs)
               )
           ),
           let restoredTrustedNow = addWithoutOverflow(
               restored.serverTimeMs,
               max(
                   currentMonotonicTimeMs - restored.monotonicTimeMs,
                   nonNegativeElapsed(currentWallTimeMs, restored.wallTimeMs)
               )
           ),
           restoredTrustedNow < currentTrustedNow {
            return false
        }

        anchor = restored
        return true
    }

    // expose only the non-location time anchor for protected persistence
    func currentAnchor() -> TrustedTimeAnchor? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return anchor
    }

    // derive capture time from monotonic progress only
    func capturedAtMs() -> Int64? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one current same-boot anchor
        guard let currentAnchor = sameBootAnchor(),
              let monotonicElapsedMs = monotonicElapsed(currentAnchor) else {
            return nil
        }

        return addWithoutOverflow(currentAnchor.serverTimeMs, monotonicElapsedMs)
    }

    // derive conservative trusted time
    func trustedNowMs() -> Int64? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one current same-boot anchor
        guard let currentAnchor = sameBootAnchor(),
              let monotonicElapsedMs = monotonicElapsed(currentAnchor) else {
            return nil
        }

        let wallElapsedMs = nonNegativeElapsed(wallClockMs(), currentAnchor.wallTimeMs)
        return addWithoutOverflow(currentAnchor.serverTimeMs, max(monotonicElapsedMs, wallElapsedMs))
    }

    // enforce the exact retention boundary
    func evaluateExpiry(capturedAtMs: Int64) -> ExpiryEvaluation {
        // branch on the current state
        guard let trustedNowMs = trustedNowMs() else {
            return .blockedWithoutSameBootAnchor
        }

        // reject invalid captured times before subtraction
        if capturedAtMs < 0 {
            return .available(expired: true, trustedNowMs: trustedNowMs)
        }

        let elapsed = trustedNowMs >= capturedAtMs ? trustedNowMs - capturedAtMs : 0
        let expired = elapsed >= automaticCandidateRetentionMs
        return .available(expired: expired, trustedNowMs: trustedNowMs)
    }

    // require exact boot identity and monotonic progress
    private func sameBootAnchor() -> TrustedTimeAnchor? {
        // branch on the current state
        guard let anchor else {
            return nil
        }

        // block changed boot identity or regressed uptime
        if anchor.bootIdentity != bootIdentity() ||
            monotonicClockMs() < anchor.monotonicTimeMs {
            return nil
        }

        return anchor
    }

    // calculate monotonic progress
    private func monotonicElapsed(_ anchor: TrustedTimeAnchor) -> Int64? {
        let currentMonotonicTimeMs = monotonicClockMs()

        // block regressed monotonic clocks
        if currentMonotonicTimeMs < anchor.monotonicTimeMs {
            return nil
        }

        return currentMonotonicTimeMs - anchor.monotonicTimeMs
    }

    // clamp rollback to zero
    private func nonNegativeElapsed(_ currentMs: Int64, _ anchorMs: Int64) -> Int64 {
        // ignore rollback
        if currentMs <= anchorMs {
            return 0
        }

        let (elapsed, overflow) = currentMs.subtractingReportingOverflow(anchorMs)
        return overflow ? Int64.max : elapsed
    }

    // reject overflow
    private func addWithoutOverflow(_ left: Int64, _ right: Int64) -> Int64? {
        // require non-negative clock values
        if left < 0 || right < 0 {
            return nil
        }

        let (result, overflow) = left.addingReportingOverflow(right)
        return overflow || result > Self.maxSafeInteger ? nil : result
    }
}

// define the native contract
struct ConfigGeneration: Equatable, Hashable {
    let value: Int64
}

// define the native contract
struct ServerPolicyGeneration: Equatable {
    let value: Int64
}

// define the native contract
struct LocalWorkGeneration: Equatable {
    let value: Int64
}

// define the native contract
struct AutomaticTerminalRegion: Equatable {
    let terminalId: String
    let latitudeE7: Int32
    let longitudeE7: Int32
    let radiusMillimeters: UInt32
    let configGeneration: ConfigGeneration
}

// define the native contract
struct AutomaticTerminalConfigGeneration: Equatable {
    let schemaVersion: Int
    let configGeneration: ConfigGeneration
    let serverPolicyGeneration: ServerPolicyGeneration
    let contentHashHex: String
    let regions: [AutomaticTerminalRegion]
}

// define the native contract
enum AutomaticTerminalRegionCanonicalizerV1 {
    // serialize generation-independent region content
    static func canonicalBytes(_ regions: [AutomaticTerminalRegion]) -> Data {
        // run the bounded callback
        let canonical = regions.sorted { left, right in
            Data(left.terminalId.utf8).lexicographicallyPrecedes(Data(right.terminalId.utf8))
        // run the bounded callback
        }.map { region in
            "{\"latitudeE7\":\(region.latitudeE7),\"longitudeE7\":\(region.longitudeE7)," +
                "\"radiusMillimeters\":\(region.radiusMillimeters),\"terminalId\":\"\(escapeJSON(region.terminalId))\"}"
        }.joined(separator: ",")
        return Data("[\(canonical)]".utf8)
    }

    // escape json string content
    private static func escapeJSON(_ value: String) -> String {
        var output = ""

        // escape every unicode scalar
        for scalar in value.unicodeScalars {
            // match json.stringify escapes
            switch scalar.value {
            case 0x22:
                output += "\\\""
            case 0x5c:
                output += "\\\\"
            case 0x08:
                output += "\\b"
            case 0x0c:
                output += "\\f"
            case 0x0a:
                output += "\\n"
            case 0x0d:
                output += "\\r"
            case 0x09:
                output += "\\t"
            case 0x00...0x1f:
                output += String(format: "\\u%04x", scalar.value)
            default:
                output.unicodeScalars.append(scalar)
            }
        }

        return output
    }
}

// define the native contract
struct AutomaticNativeGenerationState: Equatable {
    let configGeneration: ConfigGeneration?
    let serverPolicyGeneration: ServerPolicyGeneration?
    let localWorkGeneration: LocalWorkGeneration
    let configurationUsable: Bool
}

// define the native contract
enum ConfigActivationOutcome: Equatable {
    case activated
    case alreadyActive
    case keptPrevious
    case disabled
}

/// staging boundary only; production region monitoring is implemented after t0 approval
protocol TerminalRegionGenerationStager: AnyObject {
    // stage the complete namespaced set
    func stage(_ config: AutomaticTerminalConfigGeneration) -> Bool

    // return the staged terminal ids
    func stagedTerminalIds(for configGeneration: ConfigGeneration) -> Set<String>

    // commit the staged generation
    func commit(_ configGeneration: ConfigGeneration) -> Bool

    // discard only the named generation
    func discard(_ configGeneration: ConfigGeneration)
}

// define the native contract
final class AutomaticTerminalConfigActivator {
    private let stager: TerminalRegionGenerationStager
    private let maxOwnedRegionCount: Int
    private let lock = NSLock()
    private var activeConfig: AutomaticTerminalConfigGeneration?
    private var currentState: AutomaticNativeGenerationState

    // inject the staging boundary
    init(
        stager: TerminalRegionGenerationStager,
        maxOwnedRegionCount: Int,
        initialLocalWorkGeneration: LocalWorkGeneration = LocalWorkGeneration(value: 0)
    ) {
        self.stager = stager
        self.maxOwnedRegionCount = maxOwnedRegionCount
        currentState = AutomaticNativeGenerationState(
            configGeneration: nil,
            serverPolicyGeneration: nil,
            localWorkGeneration: initialLocalWorkGeneration,
            configurationUsable: false
        )
    }

    // return immutable generation state
    func state() -> AutomaticNativeGenerationState {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return currentState
    }

    // activate only a fully verified generation
    func activate(_ config: AutomaticTerminalConfigGeneration) -> ConfigActivationOutcome {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        let previousConfig = activeConfig

        // reject malformed configuration
        if !isValid(config) {
            return failureOutcome(previousConfig)
        }

        // reject policy rollback
        if let currentPolicy = currentState.serverPolicyGeneration,
           config.serverPolicyGeneration.value < currentPolicy.value {
            return failureOutcome(previousConfig)
        }

        // handle immutable generation replay
        if previousConfig?.configGeneration == config.configGeneration {
            // reject generation mutation
            if previousConfig?.contentHashHex != config.contentHashHex {
                return failureOutcome(previousConfig)
            }

            // skip restaging only while still usable
            if currentState.configurationUsable {
                currentState = AutomaticNativeGenerationState(
                    configGeneration: currentState.configGeneration,
                    serverPolicyGeneration: config.serverPolicyGeneration,
                    localWorkGeneration: currentState.localWorkGeneration,
                    configurationUsable: true
                )
                return .alreadyActive
            }
        }

        // reject stale generations
        if let previousConfig,
           config.configGeneration.value < previousConfig.configGeneration.value {
            return .keptPrevious
        }

        // keep the prior generation on staging failure
        if !stager.stage(config) {
            stager.discard(config.configGeneration)
            return failureOutcome(previousConfig)
        }

        let expectedTerminalIds = Set(config.regions.map(\.terminalId))
        let stagedTerminalIds = stager.stagedTerminalIds(for: config.configGeneration)

        // require the complete exact set
        if stagedTerminalIds != expectedTerminalIds || stagedTerminalIds.count != config.regions.count {
            stager.discard(config.configGeneration)
            return failureOutcome(previousConfig)
        }

        // preserve prior state when commit fails
        if !stager.commit(config.configGeneration) {
            stager.discard(config.configGeneration)
            return failureOutcome(previousConfig)
        }

        activeConfig = config
        currentState = AutomaticNativeGenerationState(
            configGeneration: config.configGeneration,
            serverPolicyGeneration: config.serverPolicyGeneration,
            localWorkGeneration: currentState.localWorkGeneration,
            configurationUsable: true
        )

        // discard the superseded namespace after commit
        if let previousConfig,
           previousConfig.configGeneration != config.configGeneration {
            stager.discard(previousConfig.configGeneration)
        }

        return .activated
    }

    // advance server policy independently
    @discardableResult
    func applyServerPolicyGeneration(_ generation: ServerPolicyGeneration) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        // reject policy rollback
        if generation.value < 0 ||
            generation.value > 9_007_199_254_740_991 ||
            // run the bounded callback
            currentState.serverPolicyGeneration.map({ generation.value < $0.value }) == true {
            return false
        }

        currentState = AutomaticNativeGenerationState(
            configGeneration: currentState.configGeneration,
            serverPolicyGeneration: generation,
            localWorkGeneration: currentState.localWorkGeneration,
            configurationUsable: currentState.configurationUsable
        )
        return true
    }

    // invalidate device work independently
    @discardableResult
    func invalidateLocalWork() -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        let currentLocalGeneration = currentState.localWorkGeneration.value

        // fail closed at numeric exhaustion
        if currentLocalGeneration == Int64.max {
            currentState = AutomaticNativeGenerationState(
                configGeneration: currentState.configGeneration,
                serverPolicyGeneration: currentState.serverPolicyGeneration,
                localWorkGeneration: currentState.localWorkGeneration,
                configurationUsable: false
            )
            return false
        }

        currentState = AutomaticNativeGenerationState(
            configGeneration: currentState.configGeneration,
            serverPolicyGeneration: currentState.serverPolicyGeneration,
            localWorkGeneration: LocalWorkGeneration(value: currentLocalGeneration + 1),
            configurationUsable: false
        )

        // unregister the active namespace
        if let activeConfig {
            stager.discard(activeConfig.configGeneration)
        }

        return true
    }

    // validate content and complete regions
    private func isValid(_ config: AutomaticTerminalConfigGeneration) -> Bool {
        // require fixed schema and generations
        if config.schemaVersion != 1 ||
            config.configGeneration.value <= 0 ||
            config.configGeneration.value > 9_007_199_254_740_991 ||
            config.serverPolicyGeneration.value < 0 ||
            config.serverPolicyGeneration.value > 9_007_199_254_740_991 ||
            maxOwnedRegionCount <= 0 ||
            config.regions.isEmpty ||
            config.regions.count > maxOwnedRegionCount {
            return false
        }

        // require canonical content hash
        if config.contentHashHex.range(of: "^[0-9a-f]{64}$", options: .regularExpression) == nil ||
            AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(config.regions)
            ) != config.contentHashHex {
            return false
        }

        var terminalIds = Set<String>()

        // validate every owned region
        for region in config.regions {
            // branch on the current state
            if !isValidTerminalId(region.terminalId) ||
                !terminalIds.insert(region.terminalId).inserted ||
                region.latitudeE7 < -900_000_000 ||
                region.latitudeE7 > 900_000_000 ||
                region.longitudeE7 < -1_800_000_000 ||
                region.longitudeE7 > 1_800_000_000 ||
                region.radiusMillimeters == 0 ||
                region.configGeneration != config.configGeneration {
                return false
            }
        }

        return true
    }

    // validate bounded terminal ids
    private func isValidTerminalId(_ value: String) -> Bool {
        // reject empty, oversized, or control-bearing ids
        if value.isEmpty || value.utf8.count > 128 || value.unicodeScalars.contains(where: { scalar in
            scalar.value <= 0x1f || scalar.value == 0x7f
        }) {
            return false
        }

        return true
    }

    // preserve the prior complete state
    private func failureOutcome(_ previousConfig: AutomaticTerminalConfigGeneration?) -> ConfigActivationOutcome {
        previousConfig == nil || !currentState.configurationUsable ? .disabled : .keptPrevious
    }
}
