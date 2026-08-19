import CoreFoundation
import Foundation

let automaticV0FleetRefreshIntervalMs: Int64 = 55_000
let automaticV0FleetContextMaxAgeMs: Int64 = 120_000

// define the native contract
enum AutomaticV0RegionEvent: Equatable {
    case entry
    case exit
}

// define the native contract
enum AutomaticV0LifecycleContext: String, Equatable {
    case foreground
    case background
    case ordinaryRegionRelaunch
    case manualRelaunchAfterForceQuit
}

// define the native contract
enum AutomaticV0Outcome: String, Equatable {
    case disabled
    case backgroundRefreshUnavailable = "background_refresh_unavailable"
    case protectedDataUnavailable = "protected_data_unavailable"
    case monitoringUnavailable = "monitoring_unavailable"
    case monitoringFailed = "monitoring_failed"
    case wakeAlreadyActive = "wake_already_active"
    case locationRequestFailed = "location_request_failed"
    case fixInvalid = "fix_invalid"
    case terminalFixObserved = "terminal_fix_observed"
    case fleetContextInvalid = "fleet_context_invalid"
    case fleetContextPrefetched = "fleet_context_prefetched"
    case noVesselMatch = "no_vessel_match"
    case ambiguousVesselMatch = "ambiguous_vessel_match"
    case diagnosticCandidateWiped = "diagnostic_candidate_wiped"
}

// define the native contract
enum AutomaticV0DurationBucket: String, Equatable {
    case underFiveSeconds = "under_5_seconds"
    case fiveToFifteenSeconds = "5_to_15_seconds"
    case overFifteenSeconds = "over_15_seconds"
}

// define the native contract
struct AutomaticV0Metric: Equatable {
    let schemaVersion = 1
    let capabilityVersion = "v0"
    let platformCohort = "ios"
    let detectorKind = "vessel"
    let outcome: AutomaticV0Outcome
    let count = 1
    let durationBucket: AutomaticV0DurationBucket
}

// define the native contract
protocol AutomaticV0MetricRecording: AnyObject {
    // record fixed aggregate data
    func record(_ metric: AutomaticV0Metric)
}

// define the native contract
protocol AutomaticV0LocationRequesting: AnyObject {
    // request one location callback
    func requestOneLocation()

    // stop the bounded request
    func stopLocationRequest()
}

// define the native contract
protocol AutomaticV0FleetSnapshotFetching: AnyObject {
    // fetch the named snapshot once
    func fetchOnce(completion: @escaping (Result<Data, Error>) -> Void)
}

// define the native contract
protocol AutomaticV0FleetContextCaching: AnyObject {
    // load one verified body cache
    func load() -> AutomaticV0FleetCacheRecord?

    // replace one body cache
    func store(_ record: AutomaticV0FleetCacheRecord) -> Bool
}

// define the native contract
struct AutomaticV0LocationFix: Equatable {
    let latitude: Double
    let longitude: Double
    let horizontalAccuracyMeters: Double
    let timestampMs: Int64
}

// define the native contract
struct AutomaticV0FleetVessel: Equatable {
    let id: String
    let inMaintenance: Bool
    let inService: Bool
    let isAtDock: Bool?
    let latitude: Double?
    let longitude: Double?
}

// define the native contract
struct AutomaticV0FleetContext: Equatable {
    let canonicalBody: Data
    let bodyHashHex: String
    let sourceUpdatedAtSeconds: Double
    let vessels: [AutomaticV0FleetVessel]
}

// define the native contract
struct AutomaticV0FleetCacheRecord: Equatable {
    let context: AutomaticV0FleetContext
    let receivedAtMs: Int64
}

// define the native contract
struct AutomaticV0DiagnosticPolicy: Equatable {
    let maximumFixAgeMs: Int64
    let maximumFixAccuracyMeters: Double
    let maximumVesselMatchDistanceMeters: Double

    static let provisionalV1 = AutomaticV0DiagnosticPolicy(
        maximumFixAgeMs: 30_000,
        maximumFixAccuracyMeters: 100,
        maximumVesselMatchDistanceMeters: 250
    )
}

// define the native contract
enum AutomaticV0FleetFreshness {
    // enforce inclusive source and receive windows
    static func isFresh(
        sourceUpdatedAtSeconds: Double,
        receivedAtMs: Int64,
        trustedNowMs: Int64,
        maximumAgeMs: Int64 = automaticV0FleetContextMaxAgeMs
    ) -> Bool {
        let sourceUpdatedAtMs = sourceUpdatedAtSeconds * 1_000
        let sourceAgeMs = Double(trustedNowMs) - sourceUpdatedAtMs
        let receivedAgeMs = trustedNowMs >= receivedAtMs ? trustedNowMs - receivedAtMs : -1

        return sourceUpdatedAtMs.isFinite &&
            maximumAgeMs >= 0 &&
            sourceAgeMs >= 0 &&
            sourceAgeMs <= Double(maximumAgeMs) &&
            receivedAgeMs >= 0 &&
            receivedAgeMs <= maximumAgeMs
    }
}

// define the native contract
enum AutomaticV0FleetEnvelopeParser {
    private static let outerKeys: Set<String> = ["wsfStatus", "body"]
    private static let statusKeys: Set<String> = ["offline", "coreReady", "warming"]
    private static let bodyKeys: Set<String> = ["sourceUpdatedAt", "vessels"]
    private static let requiredVesselKeys: Set<String> = [
        "abbreviation", "beam", "classId", "hasCarDeckRestroom", "hasElevator", "hasGalley",
        "hasRestroom", "hasWiFi", "horsepower", "id", "inMaintenance", "inService", "info",
        "isAdaAccessible", "maxClearance", "name", "passengerCapacity", "speed",
        "tallVehicleCapacity", "vesselWatchUrl", "vehicleCapacity", "weight", "yearBuilt",
    ]
    private static let optionalVesselKeys: Set<String> = [
        "arrivingTerminalId", "departingTerminalId", "departedTime", "departureDelta", "gpsDelay",
        "dockedTime", "estimatedArrivalTime", "heading", "isAtDock", "length", "location", "mmsi",
        "yearRebuilt",
    ]

    // parse the strict wrapped response
    static func parse(_ data: Data) -> AutomaticV0FleetContext? {
        // branch on the current state
        guard StrictJSONDuplicateKeyValidator.validate(data),
              let value = try? JSONSerialization.jsonObject(with: data),
              let outer = value as? [String: Any],
              Set(outer.keys) == outerKeys,
              let status = outer["wsfStatus"] as? [String: Any],
              isOperational(status),
              let body = outer["body"] as? [String: Any] else {
            return nil
        }

        return parseBody(body)
    }

    // parse cached body bytes only
    static func parseCanonicalBody(_ data: Data) -> AutomaticV0FleetContext? {
        // branch on the current state
        guard StrictJSONDuplicateKeyValidator.validate(data),
              let value = try? JSONSerialization.jsonObject(with: data),
              let body = value as? [String: Any] else {
            return nil
        }

        return parseBody(body)
    }

    // validate operational status
    private static func isOperational(_ status: [String: Any]) -> Bool {
        // reject unknown or missing status fields
        if !Set(status.keys).isSubset(of: statusKeys) || status["offline"] == nil {
            return false
        }

        // branch on the current state
        guard let offline = strictBoolean(status["offline"]) else {
            return false
        }

        let coreReady = status["coreReady"].flatMap(strictBoolean)
        let warming = status["warming"].flatMap(strictBoolean)

        // reject wrong optional types
        if status["coreReady"] != nil && coreReady == nil ||
            status["warming"] != nil && warming == nil {
            return false
        }

        return !offline && warming != true && coreReady != false
    }

    // validate the complete snapshot body
    private static func parseBody(_ body: [String: Any]) -> AutomaticV0FleetContext? {
        // branch on the current state
        guard Set(body.keys) == bodyKeys,
              let sourceUpdatedAtSeconds = strictFiniteNumber(body["sourceUpdatedAt"]),
              sourceUpdatedAtSeconds >= 0,
              sourceUpdatedAtSeconds * 1_000 <= 9_007_199_254_740_991,
              let vesselObjects = body["vessels"] as? [String: Any] else {
            return nil
        }

        var vessels: [AutomaticV0FleetVessel] = []

        // validate every vessel record
        for key in vesselObjects.keys.sorted() {
            // branch on the current state
            guard let value = vesselObjects[key],
                  let object = value as? [String: Any],
                  let vessel = parseVessel(key: key, object: object) else {
                return nil
            }

            vessels.append(vessel)
        }

        // branch on the current state
        guard let canonicalBody = try? JSONSerialization.data(
            withJSONObject: body,
            options: [.sortedKeys, .withoutEscapingSlashes]
        ) else {
            return nil
        }

        return AutomaticV0FleetContext(
            canonicalBody: canonicalBody,
            bodyHashHex: AutomaticPayloadDigestV1.sha256Hex(canonicalBody),
            sourceUpdatedAtSeconds: sourceUpdatedAtSeconds,
            vessels: vessels
        )
    }

    // validate one complete vessel
    private static func parseVessel(key: String, object: [String: Any]) -> AutomaticV0FleetVessel? {
        let keys = Set(object.keys)

        // require exact known vessel fields
        if !requiredVesselKeys.isSubset(of: keys) ||
            !keys.isSubset(of: requiredVesselKeys.union(optionalVesselKeys)) {
            return nil
        }

        let requiredStrings = ["abbreviation", "beam", "classId", "id", "name", "vesselWatchUrl"]
        let requiredBooleans = [
            "hasCarDeckRestroom", "hasElevator", "hasGalley", "hasRestroom", "hasWiFi",
            "inMaintenance", "inService", "isAdaAccessible",
        ]
        let requiredNumbers = [
            "horsepower", "maxClearance", "passengerCapacity", "speed", "tallVehicleCapacity",
            "vehicleCapacity", "weight", "yearBuilt",
        ]

        // validate required string fields
        for name in requiredStrings {
            // branch on the current state
            guard let value = object[name] as? String, !value.isEmpty else {
                return nil
            }
        }

        // validate required boolean fields
        for name in requiredBooleans {
            // branch on the current state
            guard strictBoolean(object[name]) != nil else {
                return nil
            }
        }

        // validate required number fields
        for name in requiredNumbers {
            // branch on the current state
            guard strictFiniteNumber(object[name]) != nil else {
                return nil
            }
        }

        // branch on the current state
        guard let id = object["id"] as? String,
              id == key,
              let inMaintenance = strictBoolean(object["inMaintenance"]),
              let inService = strictBoolean(object["inService"]),
              validateInfo(object["info"]) else {
            return nil
        }

        let optionalNumbers = [
            "arrivingTerminalId", "departingTerminalId", "departedTime", "departureDelta", "dockedTime",
            "estimatedArrivalTime", "heading", "mmsi", "yearRebuilt",
        ]

        // validate optional number fields
        for name in optionalNumbers {
            // branch on the current state
            if object[name] != nil && strictFiniteNumber(object[name]) == nil {
                return nil
            }
        }

        // validate optional string fields
        if object["length"] != nil && !(object["length"] is String) {
            return nil
        }

        let isAtDock: Bool?

        // validate optional dock state
        if let rawIsAtDock = object["isAtDock"] {
            // branch on the current state
            guard let parsedIsAtDock = strictBoolean(rawIsAtDock) else {
                return nil
            }

            isAtDock = parsedIsAtDock
        // branch on the current state
        } else {
            isAtDock = nil
        }

        let location: (Double, Double)?

        // validate optional location
        if let rawLocation = object["location"] {
            // branch on the current state
            guard let parsedLocation = parseLocation(rawLocation) else {
                return nil
            }

            location = parsedLocation
        // branch on the current state
        } else {
            location = nil
        }

        // validate optional gps detail
        if object["gpsDelay"] != nil && !validateGpsDelay(object["gpsDelay"]) {
            return nil
        }

        return AutomaticV0FleetVessel(
            id: id,
            inMaintenance: inMaintenance,
            inService: inService,
            isAtDock: isAtDock,
            latitude: location?.0,
            longitude: location?.1
        )
    }

    // validate public info fields
    private static func validateInfo(_ value: Any?) -> Bool {
        // branch on the current state
        guard let info = value as? [String: Any],
              Set(info.keys).isSubset(of: ["ada", "crossing"]) else {
            return false
        }

        // validate every optional string
        for value in info.values {
            // branch on the current state
            if !(value is String) {
                return false
            }
        }

        return true
    }

    // validate map coordinates
    private static func parseLocation(_ value: Any) -> (Double, Double)? {
        // branch on the current state
        guard let location = value as? [String: Any],
              Set(location.keys) == ["latitude", "longitude"],
              let latitude = strictFiniteNumber(location["latitude"]),
              let longitude = strictFiniteNumber(location["longitude"]),
              (-90...90).contains(latitude),
              (-180...180).contains(longitude) else {
            return nil
        }

        return (latitude, longitude)
    }

    // validate nested gps delay data
    private static func validateGpsDelay(_ value: Any?) -> Bool {
        // branch on the current state
        guard let delay = value as? [String: Any],
              Set(delay.keys) == ["confidence", "delaySeconds", "explanation", "signals", "source"],
              let confidence = delay["confidence"] as? String,
              ["low", "medium", "high"].contains(confidence),
              strictFiniteNumber(delay["delaySeconds"]) != nil,
              delay["explanation"] is String,
              delay["source"] as? String == "gps",
              let signals = delay["signals"] as? [String: Any],
              Set(signals.keys) == [
                  "dockDelaySeconds", "etaDelaySeconds", "progress", "scheduledArrivalTime",
                  "scheduledDepartureTime",
              ] else {
            return false
        }

        let nullableNumbers = ["dockDelaySeconds", "etaDelaySeconds"]

        // validate nullable signals
        for name in nullableNumbers {
            // branch on the current state
            if !(signals[name] is NSNull) && strictFiniteNumber(signals[name]) == nil {
                return false
            }
        }

        return strictFiniteNumber(signals["progress"]) != nil &&
            strictFiniteNumber(signals["scheduledArrivalTime"]) != nil &&
            strictFiniteNumber(signals["scheduledDepartureTime"]) != nil
    }

    // parse json booleans only
    private static func strictBoolean(_ value: Any?) -> Bool? {
        // branch on the current state
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else {
            return nil
        }

        return number.boolValue
    }

    // parse finite json numbers only
    private static func strictFiniteNumber(_ value: Any?) -> Double? {
        // branch on the current state
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else {
            return nil
        }

        return number.doubleValue
    }
}

// define the native contract
enum StrictJSONDuplicateKeyValidator {
    // reject duplicate object keys before foundation parsing
    static func validate(_ data: Data) -> Bool {
        var parser = Parser(bytes: Array(data))
        return parser.parseDocument()
    }

    // define the native contract
    private struct Parser {
        private let bytes: [UInt8]
        private var index = 0

        // inject raw json bytes
        init(bytes: [UInt8]) {
            self.bytes = bytes
        }

        // require one complete json value
        mutating func parseDocument() -> Bool {
            skipWhitespace()

            // parse the root value
            if !parseValue() {
                return false
            }

            skipWhitespace()
            return index == bytes.count
        }

        // parse one json value
        private mutating func parseValue() -> Bool {
            skipWhitespace()
            // branch on the current state
            guard let byte = currentByte else {
                return false
            }

            // dispatch by json token
            switch byte {
            case 0x7b:
                return parseObject()
            case 0x5b:
                return parseArray()
            case 0x22:
                return parseString() != nil
            case 0x74:
                return consumeLiteral("true")
            case 0x66:
                return consumeLiteral("false")
            case 0x6e:
                return consumeLiteral("null")
            case 0x2d, 0x30...0x39:
                return parseNumber()
            default:
                return false
            }
        }

        // parse one duplicate-free object
        private mutating func parseObject() -> Bool {
            // branch on the current state
            guard consume(0x7b) else {
                return false
            }

            skipWhitespace()

            // accept an empty object
            if consume(0x7d) {
                return true
            }

            var keys = Set<String>()

            // parse every object member
            while true {
                skipWhitespace()
                // branch on the current state
                guard let key = parseString(), keys.insert(key).inserted else {
                    return false
                }

                skipWhitespace()
                // branch on the current state
                guard consume(0x3a), parseValue() else {
                    return false
                }

                skipWhitespace()

                // finish or require another member
                if consume(0x7d) {
                    return true
                }

                // branch on the current state
                guard consume(0x2c) else {
                    return false
                }
            }
        }

        // parse one array
        private mutating func parseArray() -> Bool {
            // branch on the current state
            guard consume(0x5b) else {
                return false
            }

            skipWhitespace()

            // accept an empty array
            if consume(0x5d) {
                return true
            }

            // parse every array value
            while true {
                // branch on the current state
                guard parseValue() else {
                    return false
                }

                skipWhitespace()

                // finish or require another value
                if consume(0x5d) {
                    return true
                }

                // branch on the current state
                guard consume(0x2c) else {
                    return false
                }
            }
        }

        // parse and normalize one string
        private mutating func parseString() -> String? {
            let start = index
            // branch on the current state
            guard consume(0x22) else {
                return nil
            }

            // scan through escaped content
            while let byte = currentByte {
                index += 1

                // decode the complete token
                if byte == 0x22 {
                    let token = Data(bytes[start..<index])
                    return try? JSONDecoder().decode(String.self, from: token)
                }

                // reject raw controls
                if byte < 0x20 {
                    return nil
                }

                // validate one escape
                if byte == 0x5c {
                    // branch on the current state
                    guard let escape = currentByte else {
                        return nil
                    }

                    index += 1

                    // require valid escape syntax
                    if escape == 0x75 {
                        // require four hex digits
                        for _ in 0..<4 {
                            // branch on the current state
                            guard let hex = currentByte,
                                  (0x30...0x39).contains(hex) ||
                                  (0x41...0x46).contains(hex) ||
                                  (0x61...0x66).contains(hex) else {
                                return nil
                            }

                            index += 1
                        }
                    // branch on the current state
                    } else if ![0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74].contains(escape) {
                        return nil
                    }
                }
            }

            return nil
        }

        // parse strict json number grammar
        private mutating func parseNumber() -> Bool {
            _ = consume(0x2d)

            // require integer digits
            if consume(0x30) {
                // reject leading zero digits
                if let byte = currentByte, (0x30...0x39).contains(byte) {
                    return false
                }
            // branch on the current state
            } else if !consumeDigits(firstRange: 0x31...0x39) {
                return false
            }

            // parse optional fraction
            if consume(0x2e) && !consumeDigits(firstRange: 0x30...0x39) {
                return false
            }

            // parse optional exponent
            if let byte = currentByte, byte == 0x65 || byte == 0x45 {
                index += 1
                _ = consume(0x2b) || consume(0x2d)

                // require exponent digits
                if !consumeDigits(firstRange: 0x30...0x39) {
                    return false
                }
            }

            return true
        }

        // consume one or more digits
        private mutating func consumeDigits(firstRange: ClosedRange<UInt8>) -> Bool {
            // branch on the current state
            guard let byte = currentByte, firstRange.contains(byte) else {
                return false
            }

            index += 1

            // consume remaining digits
            while let byte = currentByte, (0x30...0x39).contains(byte) {
                index += 1
            }

            return true
        }

        // consume one literal
        private mutating func consumeLiteral(_ literal: String) -> Bool {
            let literalBytes = Array(literal.utf8)
            // branch on the current state
            guard index + literalBytes.count <= bytes.count,
                  Array(bytes[index..<(index + literalBytes.count)]) == literalBytes else {
                return false
            }

            index += literalBytes.count
            return true
        }

        // consume one expected byte
        private mutating func consume(_ byte: UInt8) -> Bool {
            // branch on the current state
            guard currentByte == byte else {
                return false
            }

            index += 1
            return true
        }

        // skip json whitespace
        private mutating func skipWhitespace() {
            // advance through fixed whitespace bytes
            while let byte = currentByte, [0x20, 0x09, 0x0a, 0x0d].contains(byte) {
                index += 1
            }
        }

        // expose the unconsumed byte
        private var currentByte: UInt8? {
            index < bytes.count ? bytes[index] : nil
        }
    }
}

// define the native contract
final class AutomaticV0FleetFileCache: AutomaticV0FleetContextCaching {
    private static let recordKeys: Set<String> = ["body", "bodyHashHex", "receivedAtMs"]
    private let fileManager: FileManager
    private let cacheURL: URL

    // inject a no-backup cache location
    init(fileManager: FileManager = .default, cacheURL: URL? = nil) {
        self.fileManager = fileManager
        self.cacheURL = cacheURL ?? fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("leaderboard-v0-fleet-context.plist", isDirectory: false)
    }

    // load and revalidate body-only state
    func load() -> AutomaticV0FleetCacheRecord? {
        // branch on the current state
        guard let data = try? Data(contentsOf: cacheURL),
              let value = try? PropertyListSerialization.propertyList(from: data, format: nil),
              let record = value as? [String: Any],
              Set(record.keys) == Self.recordKeys,
              let body = record["body"] as? Data,
              let bodyHashHex = record["bodyHashHex"] as? String,
              let receivedAtMs = Self.strictReceivedAtMs(record["receivedAtMs"]),
              AutomaticPayloadDigestV1.sha256Hex(body) == bodyHashHex,
              let context = AutomaticV0FleetEnvelopeParser.parseCanonicalBody(body),
              context.canonicalBody == body,
              context.bodyHashHex == bodyHashHex else {
            return nil
        }

        return AutomaticV0FleetCacheRecord(context: context, receivedAtMs: receivedAtMs)
    }

    // parse a safe integer timestamp
    private static func strictReceivedAtMs(_ value: Any?) -> Int64? {
        // branch on the current state
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue >= 0,
              number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded() == number.doubleValue else {
            return nil
        }

        return number.int64Value
    }

    // atomically persist body bytes only
    func store(_ record: AutomaticV0FleetCacheRecord) -> Bool {
        let directoryURL = cacheURL.deletingLastPathComponent()

        // create the private cache directory
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        // fail closed on the error
        } catch {
            return false
        }

        let payload: [String: Any] = [
            "body": record.context.canonicalBody,
            "bodyHashHex": record.context.bodyHashHex,
            "receivedAtMs": record.receivedAtMs,
        ]
        // branch on the current state
        guard let data = try? PropertyListSerialization.data(
            fromPropertyList: payload,
            format: .binary,
            options: 0
        ) else {
            return false
        }

        let temporaryURL = directoryURL.appendingPathComponent(".fleet-context-\(UUID().uuidString).tmp")

        // write protected temporary bytes
        do {
            try data.write(to: temporaryURL)
            try protectAndExclude(temporaryURL)

            // replace the body cache atomically
            if fileManager.fileExists(atPath: cacheURL.path) {
                _ = try fileManager.replaceItemAt(cacheURL, withItemAt: temporaryURL)
            // branch on the current state
            } else {
                try fileManager.moveItem(at: temporaryURL, to: cacheURL)
            }

            try protectAndExclude(cacheURL)
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
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

// define the native contract
enum AutomaticV0FleetFetchError: Error {
    case invalidEndpoint
    case invalidResponse
    case transport
}

// define the native contract
final class AutomaticV0FleetSnapshotFetcher: NSObject, AutomaticV0FleetSnapshotFetching {
    static let path = "/api/vessels/snapshot"
    private static let productionOrigin = "https://ferry.fyi"
    private let endpointURL: URL?
    // run the bounded callback
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    // bind one exact production endpoint
    override init() {
        endpointURL = Self.endpoint(origin: Self.productionOrigin)
        super.init()
    }

    // issue one credential-free get
    func fetchOnce(completion: @escaping (Result<Data, Error>) -> Void) {
        // branch on the current state
        guard let endpointURL,
              let request = Self.request(endpointURL: endpointURL) else {
            completion(.failure(AutomaticV0FleetFetchError.invalidEndpoint))
            return
        }

        // run the bounded callback
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            let result: Result<Data, Error>

            // reject transport and substituted responses
            if error != nil {
                result = .failure(AutomaticV0FleetFetchError.transport)
            // branch on the current state
            } else if let self,
                      let http = response as? HTTPURLResponse,
                      http.url == self.endpointURL,
                      http.statusCode == 200,
                      let data {
                result = .success(data)
            // branch on the current state
            } else {
                result = .failure(AutomaticV0FleetFetchError.invalidResponse)
            }

            // return on the delegate-safe main lane
            DispatchQueue.main.async {
                completion(result)
            }
        }
        task.resume()
    }

    // create the sole credential-free request
    static func diagnosticRequest() -> URLRequest? {
        // branch on the current state
        guard let endpointURL = endpoint(origin: productionOrigin) else {
            return nil
        }

        return request(endpointURL: endpointURL)
    }

    // build one bounded get request
    private static func request(endpointURL: URL) -> URLRequest? {
        var request = URLRequest(url: endpointURL)
        request.httpMethod = "GET"
        request.httpBody = nil
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(nil, forHTTPHeaderField: "Authorization")
        return request
    }

    // build one exact https url
    private static func endpoint(origin: String) -> URL? {
        // branch on the current state
        guard let originComponents = URLComponents(string: origin),
              originComponents.scheme?.lowercased() == "https",
              originComponents.user == nil,
              originComponents.password == nil,
              originComponents.query == nil,
              originComponents.fragment == nil,
              originComponents.port == nil || originComponents.port == 443,
              originComponents.percentEncodedPath.isEmpty || originComponents.percentEncodedPath == "/",
              let host = originComponents.host?.lowercased() else {
            return nil
        }

        var endpoint = URLComponents()
        endpoint.scheme = "https"
        endpoint.host = host
        endpoint.port = originComponents.port
        endpoint.percentEncodedPath = path
        return endpoint.url
    }
}

// define the native contract
extension AutomaticV0FleetSnapshotFetcher: URLSessionTaskDelegate {
    // reject every redirect
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    // prevent stored credential use
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        // allow only normal server trust evaluation
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        // branch on the current state
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

// define the native contract
final class AutomaticV0DiagnosticCandidate {
    private(set) var latitudeE7: Int32
    private(set) var longitudeE7: Int32
    private(set) var accuracyMillimeters: UInt32
    private(set) var vesselId: String
    private(set) var isWiped = false

    // hold one transient diagnostic
    init(latitudeE7: Int32, longitudeE7: Int32, accuracyMillimeters: UInt32, vesselId: String) {
        self.latitudeE7 = latitudeE7
        self.longitudeE7 = longitudeE7
        self.accuracyMillimeters = accuracyMillimeters
        self.vesselId = vesselId
    }

    // clear transient diagnostic fields
    func wipe() {
        latitudeE7 = 0
        longitudeE7 = 0
        accuracyMillimeters = 0
        vesselId = ""
        isWiped = true
    }
}

// define the native contract
final class AutomaticV0DiagnosticFlow {
    // define the native contract
    private enum State: Equatable {
        case idle
        case awaitingFix(event: AutomaticV0RegionEvent, lifecycle: AutomaticV0LifecycleContext)
        case evaluatingFleet(lifecycle: AutomaticV0LifecycleContext)
        case prefetchingFleet(lifecycle: AutomaticV0LifecycleContext)
    }

    private let locationRequester: AutomaticV0LocationRequesting
    private let fleetFetcher: AutomaticV0FleetSnapshotFetching
    private let fleetCache: AutomaticV0FleetContextCaching
    private weak var metricRecorder: AutomaticV0MetricRecording?
    private let protectedDataAvailable: () -> Bool
    private let trustedNowMs: () -> Int64?
    private let policy: AutomaticV0DiagnosticPolicy
    private var state: State = .idle
    private var wakeStartedAtMs: Int64?
    private(set) var requestedLocationCount = 0
    private(set) var fetchedFleetCount = 0
    private(set) var createdDiagnosticCandidateCount = 0
    private(set) var wipedDiagnosticCandidateCount = 0

    // inject the bounded diagnostic boundary
    init(
        locationRequester: AutomaticV0LocationRequesting,
        fleetFetcher: AutomaticV0FleetSnapshotFetching,
        fleetCache: AutomaticV0FleetContextCaching,
        metricRecorder: AutomaticV0MetricRecording,
        protectedDataAvailable: @escaping () -> Bool,
        trustedNowMs: @escaping () -> Int64?,
        policy: AutomaticV0DiagnosticPolicy = .provisionalV1
    ) {
        self.locationRequester = locationRequester
        self.fleetFetcher = fleetFetcher
        self.fleetCache = fleetCache
        self.metricRecorder = metricRecorder
        self.protectedDataAvailable = protectedDataAvailable
        self.trustedNowMs = trustedNowMs
        self.policy = policy
    }

    // begin one region-triggered fix
    @discardableResult
    func handleRegionEvent(_ event: AutomaticV0RegionEvent, lifecycle: AutomaticV0LifecycleContext) -> Bool {
        // reject concurrent or repeated wakes
        if state != .idle {
            record(.wakeAlreadyActive, lifecycle: lifecycle)
            return false
        }

        // fail closed before first unlock
        if !protectedDataAvailable() {
            record(.protectedDataUnavailable, lifecycle: lifecycle)
            return false
        }

        state = .awaitingFix(event: event, lifecycle: lifecycle)
        wakeStartedAtMs = trustedNowMs()
        requestedLocationCount += 1
        locationRequester.requestOneLocation()
        return true
    }

    // consume at most one location callback
    func receiveLocation(_ fix: AutomaticV0LocationFix) {
        // branch on the current state
        guard case let .awaitingFix(event, lifecycle) = state else {
            return
        }

        state = .evaluatingFleet(lifecycle: lifecycle)
        locationRequester.stopLocationRequest()

        // branch on the current state
        guard isValidFix(fix) else {
            finish(.fixInvalid, lifecycle: lifecycle)
            return
        }

        // stop entry diagnostics after the one-shot fix
        if event == .entry {
            finish(.terminalFixObserved, lifecycle: lifecycle)
            return
        }

        evaluateFleet(for: fix, lifecycle: lifecycle)
    }

    // stop one failed location request
    func receiveLocationFailure() {
        // branch on the current state
        guard case let .awaitingFix(_, lifecycle) = state else {
            return
        }

        locationRequester.stopLocationRequest()
        finish(.locationRequestFailed, lifecycle: lifecycle)
    }

    // invalidate one in-flight wake without side effects
    func cancel() {
        // stop only active one-shot work
        if state != .idle {
            locationRequester.stopLocationRequest()
        }

        state = .idle
        wakeStartedAtMs = nil
    }

    // prefetch once when receive age reaches cadence
    @discardableResult
    func prefetchFleetIfDue(lifecycle: AutomaticV0LifecycleContext) -> Bool {
        // branch on the current state
        guard state == .idle else {
            return false
        }

        // fail closed before first unlock
        if !protectedDataAvailable() {
            record(.protectedDataUnavailable, lifecycle: lifecycle)
            return false
        }

        // branch on the current state
        guard let nowMs = trustedNowMs() else {
            record(.fleetContextInvalid, lifecycle: lifecycle)
            return false
        }

        // skip a receive-fresh body cache
        if let cached = fleetCache.load(),
           nowMs >= cached.receivedAtMs,
           nowMs - cached.receivedAtMs < automaticV0FleetRefreshIntervalMs {
            return false
        }

        state = .prefetchingFleet(lifecycle: lifecycle)
        wakeStartedAtMs = nowMs
        fetchedFleetCount += 1
        // run the bounded callback
        fleetFetcher.fetchOnce { [weak self] result in
            // branch on the current state
            guard let self,
                  case .prefetchingFleet = self.state else {
                return
            }

            // accept one strict wrapped response
            guard case let .success(data) = result,
                  let context = AutomaticV0FleetEnvelopeParser.parse(data),
                  let receivedAtMs = self.trustedNowMs(),
                  self.fleetCache.store(AutomaticV0FleetCacheRecord(
                      context: context,
                      receivedAtMs: receivedAtMs
                  )) else {
                self.finish(.fleetContextInvalid, lifecycle: lifecycle)
                return
            }

            self.finish(.fleetContextPrefetched, lifecycle: lifecycle)
        }
        return true
    }

    // validate one fresh acceptable fix
    private func isValidFix(_ fix: AutomaticV0LocationFix) -> Bool {
        // branch on the current state
        guard let nowMs = trustedNowMs(),
              fix.latitude.isFinite,
              fix.longitude.isFinite,
              fix.horizontalAccuracyMeters.isFinite,
              (-90...90).contains(fix.latitude),
              (-180...180).contains(fix.longitude),
              fix.horizontalAccuracyMeters >= 0,
              fix.horizontalAccuracyMeters <= policy.maximumFixAccuracyMeters,
              fix.timestampMs >= 0,
              nowMs >= fix.timestampMs else {
            return false
        }

        return nowMs - fix.timestampMs <= policy.maximumFixAgeMs
    }

    // use fresh cache or one fetch
    private func evaluateFleet(for fix: AutomaticV0LocationFix, lifecycle: AutomaticV0LifecycleContext) {
        // branch on the current state
        guard let nowMs = trustedNowMs() else {
            finish(.fleetContextInvalid, lifecycle: lifecycle)
            return
        }

        // reuse only receive-age below refresh cadence
        if let cached = fleetCache.load(),
           nowMs >= cached.receivedAtMs,
           nowMs - cached.receivedAtMs < automaticV0FleetRefreshIntervalMs {
            classify(fix: fix, record: cached, trustedNowMs: nowMs, lifecycle: lifecycle)
            return
        }

        fetchedFleetCount += 1
        // run the bounded callback
        fleetFetcher.fetchOnce { [weak self] result in
            // branch on the current state
            guard let self,
                  case .evaluatingFleet = self.state else {
                return
            }

            // accept one strict wrapped response
            guard case let .success(data) = result,
                  let context = AutomaticV0FleetEnvelopeParser.parse(data),
                  let receivedAtMs = self.trustedNowMs() else {
                self.finish(.fleetContextInvalid, lifecycle: lifecycle)
                return
            }

            let record = AutomaticV0FleetCacheRecord(context: context, receivedAtMs: receivedAtMs)

            // fail closed when body-only cache cannot persist
            guard self.fleetCache.store(record) else {
                self.finish(.fleetContextInvalid, lifecycle: lifecycle)
                return
            }

            self.classify(fix: fix, record: record, trustedNowMs: receivedAtMs, lifecycle: lifecycle)
        }
    }

    // enforce both exact freshness windows
    private func classify(
        fix: AutomaticV0LocationFix,
        record: AutomaticV0FleetCacheRecord,
        trustedNowMs: Int64,
        lifecycle: AutomaticV0LifecycleContext
    ) {
        // reject future, stale, and unit-mutated fleet data
        if !AutomaticV0FleetFreshness.isFresh(
            sourceUpdatedAtSeconds: record.context.sourceUpdatedAtSeconds,
            receivedAtMs: record.receivedAtMs,
            trustedNowMs: trustedNowMs
        ) {
            finish(.fleetContextInvalid, lifecycle: lifecycle)
            return
        }

        // run the bounded callback
        let matches = record.context.vessels.filter { vessel in
            // branch on the current state
            guard vessel.inService,
                  !vessel.inMaintenance,
                  vessel.isAtDock != true,
                  let latitude = vessel.latitude,
                  let longitude = vessel.longitude else {
                return false
            }

            return Self.distanceMeters(
                fromLatitude: fix.latitude,
                longitude: fix.longitude,
                toLatitude: latitude,
                longitude: longitude
            ) + fix.horizontalAccuracyMeters <= policy.maximumVesselMatchDistanceMeters
        }

        // require one plausible vessel only
        if matches.isEmpty {
            finish(.noVesselMatch, lifecycle: lifecycle)
            return
        }

        // reject ambiguous fleet matches
        if matches.count != 1 {
            finish(.ambiguousVesselMatch, lifecycle: lifecycle)
            return
        }

        // branch on the current state
        guard let latitudeE7 = Self.scaledCoordinate(fix.latitude, scale: 10_000_000, type: Int32.self),
              let longitudeE7 = Self.scaledCoordinate(fix.longitude, scale: 10_000_000, type: Int32.self),
              let accuracyMillimeters = Self.scaledAccuracy(fix.horizontalAccuracyMeters) else {
            finish(.fixInvalid, lifecycle: lifecycle)
            return
        }

        var candidate: AutomaticV0DiagnosticCandidate? = AutomaticV0DiagnosticCandidate(
            latitudeE7: latitudeE7,
            longitudeE7: longitudeE7,
            accuracyMillimeters: accuracyMillimeters,
            vesselId: matches[0].id
        )
        createdDiagnosticCandidateCount += 1
        candidate?.wipe()

        // count only completed transient wipes
        if candidate?.isWiped == true {
            wipedDiagnosticCandidateCount += 1
        }

        candidate = nil
        finish(.diagnosticCandidateWiped, lifecycle: lifecycle)
    }

    // scale a signed coordinate
    private static func scaledCoordinate<T: FixedWidthInteger>(
        _ value: Double,
        scale: Double,
        type: T.Type
    ) -> T? {
        let scaled = (value * scale).rounded()

        // require a representable fixed-width value
        if !scaled.isFinite || scaled < Double(T.min) || scaled > Double(T.max) {
            return nil
        }

        return T(scaled)
    }

    // scale unsigned accuracy
    private static func scaledAccuracy(_ meters: Double) -> UInt32? {
        let scaled = (meters * 1_000).rounded()

        // require a representable millimeter value
        if !scaled.isFinite || scaled < 0 || scaled > Double(UInt32.max) {
            return nil
        }

        return UInt32(scaled)
    }

    // calculate bounded great-circle distance
    private static func distanceMeters(
        fromLatitude: Double,
        longitude fromLongitude: Double,
        toLatitude: Double,
        longitude toLongitude: Double
    ) -> Double {
        let radians = Double.pi / 180
        let latitudeDelta = (toLatitude - fromLatitude) * radians
        let longitudeDelta = (toLongitude - fromLongitude) * radians
        let leftLatitude = fromLatitude * radians
        let rightLatitude = toLatitude * radians
        let haversine = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
            cos(leftLatitude) * cos(rightLatitude) *
            sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return 6_371_000 * 2 * atan2(sqrt(haversine), sqrt(max(0, 1 - haversine)))
    }

    // finish one bounded wake
    private func finish(_ outcome: AutomaticV0Outcome, lifecycle: AutomaticV0LifecycleContext) {
        state = .idle
        record(outcome, lifecycle: lifecycle)
        wakeStartedAtMs = nil
    }

    // emit one redacted fixed outcome
    private func record(_ outcome: AutomaticV0Outcome, lifecycle: AutomaticV0LifecycleContext) {
        let elapsedMs: Int64

        // calculate only a bounded duration bucket
        if let wakeStartedAtMs,
           let nowMs = trustedNowMs(),
           nowMs >= wakeStartedAtMs {
            elapsedMs = nowMs - wakeStartedAtMs
        // branch on the current state
        } else {
            elapsedMs = 0
        }

        let durationBucket: AutomaticV0DurationBucket

        // bucket the redacted duration
        if elapsedMs < 5_000 {
            durationBucket = .underFiveSeconds
        // branch on the current state
        } else if elapsedMs <= 15_000 {
            durationBucket = .fiveToFifteenSeconds
        // branch on the current state
        } else {
            durationBucket = .overFifteenSeconds
        }

        metricRecorder?.record(AutomaticV0Metric(
            outcome: outcome,
            durationBucket: durationBucket
        ))

        // keep lifecycle outside runtime metrics
        _ = lifecycle
    }
}
