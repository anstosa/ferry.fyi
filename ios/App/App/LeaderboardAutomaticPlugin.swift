import Capacitor
import CoreLocation
import CoreFoundation
import Foundation
import UIKit

// define the native contract
enum AutomaticBridgeCredentialParser {
    private static let credentialKeys: Set<String> = [
        "bearerToken", "enrollmentId", "expiresAtMs", "rotateAfterMs", "schemaVersion",
        "scopes", "serverPolicyGeneration", "urls",
    ]
    private static let urlKeys: Set<String> = ["candidates", "config", "enrollment", "status"]
    private static let expectedScopes: Set<String> = [
        "automatic-checkins:candidates:write",
        "automatic-checkins:config:read",
        "automatic-checkins:enrollment:revoke",
        "automatic-checkins:status:read",
    ]

    // parse one one-time credential input without returning it to javascript
    static func parse(_ value: [String: Any]) -> AutomaticEnrollmentCredentialPayload? {
        // branch on the current state
        guard Set(value.keys) == credentialKeys,
              strictInt64(value["schemaVersion"]) == 1,
              let bearerToken = value["bearerToken"] as? String,
              isCanonicalBearerToken(bearerToken),
              let enrollmentId = value["enrollmentId"] as? String,
              enrollmentId.range(
                of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
                options: .regularExpression
              ) != nil,
              let expiresAtMs = strictInt64(value["expiresAtMs"]),
              let rotateAfterMs = strictInt64(value["rotateAfterMs"]),
              rotateAfterMs > 0,
              rotateAfterMs < expiresAtMs,
              let serverPolicyGeneration = strictInt64(value["serverPolicyGeneration"]),
              let scopes = value["scopes"] as? [String],
              scopes.count == expectedScopes.count,
              Set(scopes) == expectedScopes,
              let rawUrls = value["urls"] as? [String: Any],
              Set(rawUrls.keys) == urlKeys,
              let urls = parseUrls(rawUrls),
              AutomaticProductionNativeEndpointPolicy.validates(urls.endpointUrls()) else {
            return nil
        }

        return AutomaticEnrollmentCredentialPayload(
            bearerToken: Data(bearerToken.utf8),
            enrollmentId: enrollmentId,
            expiresAtMs: expiresAtMs,
            rotateAfterMs: rotateAfterMs,
            serverPolicyGeneration: serverPolicyGeneration,
            urls: urls
        )
    }

    // parse exact fixed native urls
    private static func parseUrls(_ value: [String: Any]) -> AutomaticNativeCredentialUrls? {
        // branch on the current state
        guard let candidates = value["candidates"] as? String,
              let config = value["config"] as? String,
              let enrollment = value["enrollment"] as? String,
              let status = value["status"] as? String else {
            return nil
        }

        return AutomaticNativeCredentialUrls(
            candidates: candidates,
            config: config,
            enrollment: enrollment,
            status: status
        )
    }

    // validate one canonical server-issued 256-bit bearer
    private static func isCanonicalBearerToken(_ value: String) -> Bool {
        // require one unpadded base64url token
        guard value.range(
            of: "^[A-Za-z0-9_-]{43}$",
            options: .regularExpression
        ) != nil else {
            return false
        }
        let padded = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + "="
        // require exactly one canonical 32-byte value
        guard var decoded = Data(base64Encoded: padded), decoded.count == 32 else {
            return false
        }
        // release protected state
        defer {
            // wipe the validation-only token bytes
            decoded.resetBytes(in: 0..<decoded.count)
            decoded.removeAll(keepingCapacity: false)
        }
        let canonical = decoded.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return canonical == value
    }

    // parse one exact json-safe integer
    private static func strictInt64(_ value: Any?) -> Int64? {
        // branch on the current state
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
}

@objc(AutomaticLeaderboardCheckinsPlugin)
// define the native contract
public final class AutomaticLeaderboardCheckinsPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    static let exactMethodNames = [
        "getCapability", "getEnrollmentBootstrap", "installCredential", "bindIdentity", "checkIdentity",
        "stageEnrollmentCleanup", "checkEnrollmentCleanup", "clearEnrollmentCleanup", "reconcile",
        "disableAndPurge", "getStatus", "openAutomaticCheckinSettings", "requestForegroundLocationPermission",
        "requestBackgroundLocationPermission",
    ]
    public let identifier = "AutomaticLeaderboardCheckinsPlugin"
    public let jsName = "AutomaticLeaderboardCheckins"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEnrollmentBootstrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bindIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stageEnrollmentCleanup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkEnrollmentCleanup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearEnrollmentCleanup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disableAndPurge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAutomaticCheckinSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestForegroundLocationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBackgroundLocationPermission", returnType: CAPPluginReturnPromise),
    ]
    private var creditedObserver: NSObjectProtocol?
    private var pendingBackgroundPermissionCall: CAPPluginCall?
    private var pendingForegroundPermissionCall: CAPPluginCall?
    private var permissionLocationManager: CLLocationManager?

    // attach one detail-free credited event listener
    public override func load() {
        creditedObserver = NotificationCenter.default.addObserver(
            forName: .automaticLeaderboardCheckinsChanged,
            object: nil,
            queue: .main
        // run the bounded callback
        ) { [weak self] _ in
            self?.notifyListeners(
                AutomaticBridgeEventContract.name,
                data: AutomaticBridgeEventContract.detail
            )
        }
    }

    // request only foreground location after explicit disclosure
    @objc public func requestForegroundLocationPermission(_ call: CAPPluginCall) {
        // reject detail-bearing permission input
        guard call.options.isEmpty else {
            call.reject("automatic foreground permission takes no input", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        guard automaticCapabilityAvailable else {
            call.resolve(permissionResult(manager: nil, requiresAlways: false, settingsOpened: false))
            return
        }
        DispatchQueue.main.async { [weak self] in
            // keep one manager alive through the system prompt
            guard let self else {
                call.reject("automatic permission owner unavailable", "PERMISSION_UNAVAILABLE")
                return
            }
            let manager = self.permissionManager()
            // await the first system authorization decision
            if manager.authorizationStatus == .notDetermined {
                // reject overlapping permission prompts
                guard self.pendingForegroundPermissionCall == nil else {
                    call.reject("automatic permission request already active", "PERMISSION_BUSY")
                    return
                }
                self.pendingForegroundPermissionCall = call
                manager.requestWhenInUseAuthorization()
                return
            }
            // open settings after a prior denial or revocation
            if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                self.openPermissionSettings(call, manager: manager, requiresAlways: false)
                return
            }
            // open settings for reduced-accuracy recovery
            if manager.accuracyAuthorization != .fullAccuracy {
                self.openPermissionSettings(call, manager: manager, requiresAlways: false)
                return
            }
            call.resolve(
                self.permissionResult(
                    manager: manager,
                    requiresAlways: false,
                    settingsOpened: false
                )
            )
        }
    }

    // request ios always authorization after foreground access
    @objc public func requestBackgroundLocationPermission(_ call: CAPPluginCall) {
        // reject detail-bearing permission input
        guard call.options.isEmpty else {
            call.reject("automatic background permission takes no input", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        guard automaticCapabilityAvailable else {
            call.resolve(permissionResult(manager: nil, requiresAlways: true, settingsOpened: false))
            return
        }
        DispatchQueue.main.async { [weak self] in
            // keep one manager alive through the system prompt
            guard let self else {
                call.reject("automatic permission owner unavailable", "PERMISSION_UNAVAILABLE")
                return
            }
            let manager = self.permissionManager()
            // await the always-authorization decision
            if manager.authorizationStatus == .authorizedWhenInUse {
                // reject overlapping permission prompts
                guard self.pendingBackgroundPermissionCall == nil else {
                    call.reject("automatic permission request already active", "PERMISSION_BUSY")
                    return
                }
                self.pendingBackgroundPermissionCall = call
                manager.requestAlwaysAuthorization()
                return
            }
            // open settings after a prior denial or revocation
            if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                self.openPermissionSettings(call, manager: manager, requiresAlways: true)
                return
            }
            call.resolve(
                self.permissionResult(
                    manager: manager,
                    requiresAlways: true,
                    settingsOpened: false
                )
            )
        }
    }

    // resolve pending permission calls from the system delegate boundary
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // complete one foreground request
        if manager.authorizationStatus != .notDetermined,
           let call = pendingForegroundPermissionCall {
            pendingForegroundPermissionCall = nil
            call.resolve(permissionResult(manager: manager, requiresAlways: false, settingsOpened: false))
        }
        // complete one always-authorization request
        if let call = pendingBackgroundPermissionCall {
            pendingBackgroundPermissionCall = nil
            call.resolve(permissionResult(manager: manager, requiresAlways: true, settingsOpened: false))
        }
    }

    // open the reviewed application-settings recovery boundary
    @objc public func openAutomaticCheckinSettings(_ call: CAPPluginCall) {
        // reject detail-bearing settings input
        guard call.options.isEmpty else {
            call.reject("automatic settings takes no input", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        guard automaticCapabilityAvailable,
              let url = URL(string: UIApplication.openSettingsURLString) else {
            call.resolve(["schemaVersion": 1, "settingsOpened": false])
            return
        }
        // return only the settings-open result
        UIApplication.shared.open(url, options: [:]) { opened in
            call.resolve(["schemaVersion": 1, "settingsOpened": opened])
        }
    }

    // remove the process bridge listener
    deinit {
        // detach only an installed observer
        if let creditedObserver {
            NotificationCenter.default.removeObserver(creditedObserver)
        }
    }

    // return inert build and operating-system capability
    @objc public func getCapability(_ call: CAPPluginCall) {
        // reject detail-bearing capability input
        guard call.options.isEmpty else {
            call.reject("automatic capability takes no input", "INVALID_INPUT")
            return
        }
        let supported = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15
        call.resolve([
            "capabilityVersion": automaticNativeCapabilityVersion,
            "enabled": AutomaticLeaderboardIOSRuntime.isBuildEnabled && supported,
            "platform": "ios",
            "schemaVersion": 1,
            "supported": supported,
        ])
    }

    // return the fixed bootstrap contract without candidate data
    @objc public func getEnrollmentBootstrap(_ call: CAPPluginCall) {
        guard call.options.isEmpty else {
            call.reject("automatic enrollment bootstrap takes no input", "INVALID_INPUT")
            return
        }
        let supported = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15
        let enabled = AutomaticLeaderboardIOSRuntime.isBuildEnabled && supported
        var result: [String: Any] = [
            "capabilityVersion": automaticNativeCapabilityVersion,
            "enabled": enabled,
            "manualFallbackAvailable": true,
            "platform": "ios",
            "schemaVersion": 1,
            "supported": supported,
        ]

        // expose a nonce only to an explicitly enabled build
        if enabled,
           let installationNonce = AutomaticLeaderboardIOSRuntime.shared.prepareEnrollment() {
            result["installationNonce"] = installationNonce
        }
        call.resolve(result)
    }

    // install one one-time scoped credential without echoing secrets
    @objc public func installCredential(_ call: CAPPluginCall) {
        guard AutomaticLeaderboardIOSRuntime.isBuildEnabled,
              let options = call.options as? [String: Any],
              var credential = AutomaticBridgeCredentialParser.parse(options) else {
            call.reject("automatic credential rejected", "INVALID_CREDENTIAL")
            return
        }
        // release protected state
        defer {
            // wipe the bridge-owned decoded credential
            credential.wipe()
        }
        // branch on the current state
        guard AutomaticLeaderboardIOSRuntime.shared.installCredential(&credential) else {
            call.reject("automatic credential rejected", "INVALID_CREDENTIAL")
            return
        }

        call.resolve(["installed": true])
    }

    // bind one transient subject without returning its device digest
    @objc public func bindIdentity(_ call: CAPPluginCall) {
        // keep default and unsupported builds inert before reading subject input
        guard automaticCapabilityAvailable else {
            call.resolve(["bound": false, "schemaVersion": 1])
            return
        }
        // require one exact transient subject key
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["subject"],
              let subject = call.getString("subject") else {
            call.reject("automatic identity owner rejected", "INVALID_IDENTITY")
            return
        }
        call.resolve([
            "bound": AutomaticLeaderboardIOSRuntime.shared.bindIdentity(subject),
            "schemaVersion": 1,
        ])
    }

    // check one transient subject without exposing raw or derived identity
    @objc public func checkIdentity(_ call: CAPPluginCall) {
        // keep default and unsupported builds inert before reading subject input
        guard automaticCapabilityAvailable else {
            call.resolve(["bound": false, "matches": false, "schemaVersion": 1])
            return
        }
        // require one exact transient subject key
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["subject"],
              let subject = call.getString("subject") else {
            call.reject("automatic identity owner rejected", "INVALID_IDENTITY")
            return
        }
        let checked = AutomaticLeaderboardIOSRuntime.shared.checkIdentity(subject)
        call.resolve([
            "bound": checked.bound,
            "matches": checked.matches,
            "schemaVersion": 1,
        ])
    }

    // stage one device-only cleanup obligation before local purge
    @objc public func stageEnrollmentCleanup(_ call: CAPPluginCall) {
        // keep default and unsupported builds inert before reading subject input
        guard automaticCapabilityAvailable else {
            call.resolve(["staged": false, "schemaVersion": 1])
            return
        }
        // require one exact transient subject key
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["subject"],
              let subject = call.getString("subject") else {
            call.reject("automatic cleanup owner rejected", "INVALID_IDENTITY")
            return
        }
        call.resolve([
            "staged": AutomaticLeaderboardIOSRuntime.shared.stageEnrollmentCleanup(subject),
            "schemaVersion": 1,
        ])
    }

    // check one cleanup obligation without exposing its owner proof
    @objc public func checkEnrollmentCleanup(_ call: CAPPluginCall) {
        // keep default and unsupported builds inert before reading subject input
        guard automaticCapabilityAvailable else {
            call.resolve(["matches": false, "pending": false, "schemaVersion": 1, "valid": true])
            return
        }
        // require one exact transient subject key
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["subject"],
              let subject = call.getString("subject") else {
            call.reject("automatic cleanup owner rejected", "INVALID_IDENTITY")
            return
        }
        let checked = AutomaticLeaderboardIOSRuntime.shared.checkEnrollmentCleanup(subject)
        call.resolve([
            "matches": checked.matches,
            "pending": checked.pending,
            "schemaVersion": 1,
            "valid": checked.valid,
        ])
    }

    // clear only one exactly matched cleanup obligation
    @objc public func clearEnrollmentCleanup(_ call: CAPPluginCall) {
        // keep default and unsupported builds inert before reading subject input
        guard automaticCapabilityAvailable else {
            call.resolve(["cleared": false, "schemaVersion": 1])
            return
        }
        // require one exact transient subject key
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["subject"],
              let subject = call.getString("subject") else {
            call.reject("automatic cleanup owner rejected", "INVALID_IDENTITY")
            return
        }
        call.resolve([
            "cleared": AutomaticLeaderboardIOSRuntime.shared.clearEnrollmentCleanup(subject),
            "schemaVersion": 1,
        ])
    }

    // start one authoritative status and config reconciliation
    @objc public func reconcile(_ call: CAPPluginCall) {
        // reject detail-bearing reconcile input
        if !call.options.isEmpty {
            call.reject("automatic reconcile takes no input", "INVALID_INPUT")
            return
        }

        // preserve default-off manual fallback without runtime construction
        if !AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            call.resolve(["outcome": "disabled"])
            return
        }

        AutomaticLeaderboardIOSRuntime.shared.configureIfEnabled()
        call.resolve(["outcome": "scheduled"])
    }

    // return fixed aggregate native status only
    @objc public func getStatus(_ call: CAPPluginCall) {
        // reject detail-bearing status input
        if !call.options.isEmpty {
            call.reject("automatic status takes no input", "INVALID_INPUT")
            return
        }

        // return inert strict state without constructing disabled runtime
        if !AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            call.resolve(AutomaticBridgeStatusContract.disabled())
            return
        }
        call.resolve(AutomaticLeaderboardIOSRuntime.shared.bridgeStatus())
    }

    // purge synchronously before controllable auth teardown
    @objc public func disableAndPurge(_ call: CAPPluginCall) {
        // run the bounded callback
        guard Set(call.options.keys.compactMap { $0 as? String }) == ["reason"],
              let reason = call.getString("reason"),
              let trigger = Self.stopTrigger(reason) else {
            call.reject("automatic stop reason rejected", "INVALID_STOP_REASON")
            return
        }

        // keep default-off release builds fully inert
        if !AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            call.resolve(["purged": true])
            return
        }

        let purged = AutomaticLeaderboardIOSRuntime.shared.stopFromBridge(trigger)
        call.resolve(["purged": purged])
    }

    // map only reviewed local lifecycle reasons
    private static func stopTrigger(_ value: String) -> AutomaticRuntimeStopTrigger? {
        // select one exact controllable trigger
        switch value {
        case "account_deleted":
            return .accountDeletion
        case "enrollment_revoked":
            return .enrollmentRevoked
        case "identity_lost":
            return .identityLost
        case "local_disable":
            return .localDisable
        case "profile_opted_out":
            return .profileOptOut
        default:
            return nil
        }
    }

    // reuse one bridge-owned permission manager
    private func permissionManager() -> CLLocationManager {
        // reuse the current prompt owner
        if let permissionLocationManager {
            return permissionLocationManager
        }
        let manager = CLLocationManager()
        manager.delegate = self
        permissionLocationManager = manager
        return manager
    }

    // check the fixed build and operating-system boundary
    private var automaticCapabilityAvailable: Bool {
        AutomaticLeaderboardIOSRuntime.isBuildEnabled &&
            ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15
    }

    // open the reviewed ios app-settings recovery boundary
    private func openPermissionSettings(
        _ call: CAPPluginCall,
        manager: CLLocationManager,
        requiresAlways: Bool
    ) {
        // require one valid system settings url
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.resolve(permissionResult(manager: manager, requiresAlways: requiresAlways, settingsOpened: false))
            return
        }
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            // return only the detail-free post-action projection
            call.resolve(
                self?.permissionResult(
                    manager: manager,
                    requiresAlways: requiresAlways,
                    settingsOpened: opened
                ) ?? [:]
            )
        }
    }

    // project one exact detail-free permission result
    private func permissionResult(
        manager: CLLocationManager?,
        requiresAlways: Bool,
        settingsOpened: Bool
    ) -> [String: Any] {
        let permissionHealth: String
        // keep disabled builds fixed and inert
        guard let manager else {
            return [
                "permissionHealth": "not_determined",
                "schemaVersion": 1,
                "settingsOpened": settingsOpened,
            ]
        }
        // classify exact always and accuracy authority
        switch manager.authorizationStatus {
        case .authorizedAlways:
            permissionHealth = manager.accuracyAuthorization == .fullAccuracy
                ? "authorized"
                : "limited_accuracy"
        case .authorizedWhenInUse:
            permissionHealth = manager.accuracyAuthorization != .fullAccuracy
                ? "limited_accuracy"
                : (requiresAlways ? "denied" : "authorized")
        case .denied:
            permissionHealth = "denied"
        case .notDetermined:
            permissionHealth = "not_determined"
        case .restricted:
            permissionHealth = "restricted"
        @unknown default:
            permissionHealth = "restricted"
        }
        return [
            "permissionHealth": permissionHealth,
            "schemaVersion": 1,
            "settingsOpened": settingsOpened,
        ]
    }
}

@objc(FerryFYIBridgeViewController)
// define the native contract
final class FerryFYIBridgeViewController: CAPBridgeViewController {
    // register the bounded app-local native plugin
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginType(AutomaticLeaderboardCheckinsPlugin.self)
    }
}
