import CryptoKit
import CoreFoundation
import Foundation
import Security

let automaticNativeCapabilityVersion = 1
let automaticNativeMaximumBodyBytes = 4_096

// define the native contract
enum AutomaticSecureRuntimeError: Error, Equatable {
    case blockedBeforeFirstUnlock
    case cleanupRequired
    case credentialUnavailable
    case invalidCandidate
    case invalidConfiguration
    case invalidResponse
    case queueAuthenticationFailed
    case queueCapacityInvalid
    case queueOverflowRejected
    case queueStorageFailed
    case trustedTimeUnavailable
}

// define the native contract
struct AutomaticEnrollmentCredentialPayload {
    var bearerToken: Data
    let enrollmentId: String
    let expiresAtMs: Int64
    let rotateAfterMs: Int64
    let serverPolicyGeneration: Int64
    let urls: AutomaticNativeCredentialUrls

    // bind one server response to native bootstrap state
    func bound(to installationNonce: Data) -> AutomaticNativeCredential {
        AutomaticNativeCredential(
            bearerToken: bearerToken,
            enrollmentId: enrollmentId,
            expiresAtMs: expiresAtMs,
            installationNonce: installationNonce,
            rotateAfterMs: rotateAfterMs,
            serverPolicyGeneration: serverPolicyGeneration,
            urls: urls
        )
    }

    // wipe the one-time bearer response
    mutating func wipe() {
        bearerToken.resetBytes(in: 0..<bearerToken.count)
        bearerToken.removeAll(keepingCapacity: false)
    }
}

// define the native contract
struct AutomaticNativeCredential: Codable, Equatable {
    var bearerToken: Data
    let enrollmentId: String
    let expiresAtMs: Int64
    var installationNonce: Data
    let rotateAfterMs: Int64
    let serverPolicyGeneration: Int64
    let urls: AutomaticNativeCredentialUrls

    // wipe mutable credential binding bytes
    mutating func wipe() {
        bearerToken.resetBytes(in: 0..<bearerToken.count)
        bearerToken.removeAll(keepingCapacity: false)
        installationNonce.resetBytes(in: 0..<installationNonce.count)
        installationNonce.removeAll(keepingCapacity: false)
    }
}

// define the native contract
struct AutomaticNativeCredentialUrls: Codable, Equatable {
    let candidates: String
    let config: String
    let enrollment: String
    let status: String

    // project the existing endpoint contract
    func endpointUrls() -> AutomaticNativeEndpointUrls {
        AutomaticNativeEndpointUrls(
            config: config,
            status: status,
            candidates: candidates,
            enrollment: enrollment
        )
    }
}

// define the native contract
protocol AutomaticSecureValueStoring: AnyObject {
    // read one device-only value
    func read(account: String) throws -> Data?

    // replace one device-only value
    func write(_ data: Data, account: String) throws

    // remove one device-only value
    func remove(account: String) throws

    // remove the complete scoped service
    func removeAll() throws
}

// define the native contract
final class AutomaticIOSKeychainStore: AutomaticSecureValueStoring {
    static let service = "fyi.ferry.leaderboard-automatic.v1"
    static let accessibility = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    static let synchronizes = false
    private let service: String

    // isolate one keychain service
    init(service: String = AutomaticIOSKeychainStore.service) {
        self.service = service
    }

    // read one non-synchronizing item
    func read(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        // map an absent item to nil
        if status == errSecItemNotFound {
            return nil
        }

        // require keychain success
        if status != errSecSuccess {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }

        return result as? Data
    }

    // replace one after-first-unlock device-only item
    func write(_ data: Data, account: String) throws {
        let query = baseQuery(account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: Self.accessibility,
            kSecAttrSynchronizable as String: Self.synchronizes,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        // insert only when no prior item exists
        if updateStatus == errSecItemNotFound {
            var insert = query
            // append every immutable keychain attribute
            for (key, value) in attributes {
                insert[key] = value
            }
            let insertStatus = SecItemAdd(insert as CFDictionary, nil)

            // require keychain insertion
            if insertStatus != errSecSuccess {
                throw AutomaticSecureRuntimeError.credentialUnavailable
            }
            return
        }

        // require keychain replacement
        if updateStatus != errSecSuccess {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
    }

    // remove one scoped item
    func remove(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)

        // accept an already absent item
        if status != errSecSuccess && status != errSecItemNotFound {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
    }

    // remove every old installation item
    func removeAll() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        let status = SecItemDelete(query as CFDictionary)

        // accept an already empty service
        if status != errSecSuccess && status != errSecItemNotFound {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
    }

    // build one non-synchronizing query
    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: Self.synchronizes,
        ]
    }
}

// define the native contract
final class AutomaticFirstUnlockProbe {
    static let shared = AutomaticFirstUnlockProbe()
    private static let account = "first-unlock-probe"
    private let secureStore: AutomaticSecureValueStoring
    private let lock = NSLock()
    private var available = false

    // isolate one after-first-unlock availability probe
    init(
        secureStore: AutomaticSecureValueStoring = AutomaticIOSKeychainStore(
            service: "fyi.ferry.leaderboard-automatic-first-unlock.v1"
        )
    ) {
        self.secureStore = secureStore
    }

    // latch availability after the first successful protected-store access
    func isAvailable() -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        // preserve availability across ordinary relock
        if available {
            return true
        }

        // attempt the protected operation
        do {
            // probe the actual after-first-unlock storage class
            if try secureStore.read(account: Self.account) == nil {
                try secureStore.write(Data([1]), account: Self.account)
            }
            available = true
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }
}

// define the native contract
protocol AutomaticInstallationSentinelStoring: AnyObject {
    // load one no-backup installation nonce
    func load() throws -> Data?

    // atomically replace one no-backup installation nonce
    func store(_ nonce: Data) throws
}

// define the native contract
final class AutomaticInstallationSentinelStore: AutomaticInstallationSentinelStoring {
    private let fileManager: FileManager
    private let fileURL: URL

    // isolate one no-backup sentinel path
    init(fileManager: FileManager = .default, fileURL: URL? = nil) {
        self.fileManager = fileManager
        self.fileURL = fileURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("leaderboard-automatic-installation.v1", isDirectory: false)
    }

    // load only a fixed-size installation nonce
    func load() throws -> Data? {
        // map an absent sentinel to nil
        if !fileManager.fileExists(atPath: fileURL.path) {
            return nil
        }

        let data = try Data(contentsOf: fileURL)
        return data.count == 32 ? data : nil
    }

    // atomically protect and exclude one sentinel
    func store(_ nonce: Data) throws {
        // require one full installation nonce
        if nonce.count != 32 {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }

        try AutomaticProtectedFile.applyDirectoryPolicy(
            fileURL.deletingLastPathComponent(),
            fileManager: fileManager
        )
        let temporaryURL = fileURL.deletingLastPathComponent()
            .appendingPathComponent(".installation-\(UUID().uuidString).tmp", isDirectory: false)
        try nonce.write(to: temporaryURL, options: .withoutOverwriting)
        try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
        try AutomaticProtectedFile.atomicReplace(
            temporaryURL: temporaryURL,
            destinationURL: fileURL,
            fileManager: fileManager
        )
        try AutomaticProtectedFile.applyFilePolicy(fileURL, fileManager: fileManager)
    }
}

// define the native contract
enum AutomaticInstallationReconciliation: Equatable {
    case existing
    case reset
}

// define the native contract
struct AutomaticSubjectBindingCheck: Equatable {
    let bound: Bool
    let matches: Bool
}

// define the native contract
struct AutomaticCleanupPendingCheck: Equatable {
    let matches: Bool
    let pending: Bool
    let valid: Bool
}

// define the native contract
final class AutomaticCredentialVault {
    private static let bootstrapAccount = "enrollment-bootstrap-binding"
    private static let credentialAccount = "credential"
    private static let queueKeyAccount = "candidate-queue-key"
    private static let subjectBindingAccount = "subject-binding"
    private static let cleanupKeyAccount = "cleanup-key"
    private static let cleanupProofAccount = "cleanup-proof"
    private let secureStore: AutomaticSecureValueStoring
    private let cleanupStore: AutomaticSecureValueStoring
    private let sentinelStore: AutomaticInstallationSentinelStoring
    private let randomBytes: (Int) throws -> Data
    private let purgeQueue: () -> Bool
    private let lock = NSRecursiveLock()

    // inject device-only storage and purge ownership
    init(
        secureStore: AutomaticSecureValueStoring,
        sentinelStore: AutomaticInstallationSentinelStoring,
        purgeQueue: @escaping () -> Bool,
        cleanupStore: AutomaticSecureValueStoring = AutomaticIOSKeychainStore(
            service: "fyi.ferry.leaderboard-automatic-cleanup.v1"
        ),
        randomBytes: @escaping (Int) throws -> Data = AutomaticRandom.bytes
    ) {
        self.secureStore = secureStore
        self.cleanupStore = cleanupStore
        self.sentinelStore = sentinelStore
        self.purgeQueue = purgeQueue
        self.randomBytes = randomBytes
    }

    // reconcile a missing or mismatched reinstall sentinel
    func reconcileInstallation() throws -> AutomaticInstallationReconciliation {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let sentinel = try sentinelStore.load()
        var credential = try loadCredentialWithoutReconciliation()
        // release protected state
        defer {
            // wipe the reconciliation-only credential copy
            credential?.wipe()
        }

        // reset surviving keychain state after reinstall or mismatch
        if sentinel == nil || credential.map({ $0.installationNonce != sentinel }) == true {
            try secureStore.removeAll()

            // require complete ciphertext purge before replacement
            if !purgeQueue() {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }

            let replacement = try randomBytes(32)
            try sentinelStore.store(replacement)
            return .reset
        }

        return .existing
    }

    // load one sentinel-bound credential
    func loadCredential() throws -> AutomaticNativeCredential? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let sentinel = try sentinelStore.load()

        // fail closed without installation binding
        guard let sentinel else {
            try secureStore.removeAll()
            return nil
        }

        // require a stored credential
        guard var credential = try loadCredentialWithoutReconciliation() else {
            return nil
        }

        // remove a surviving mismatched credential
        if credential.installationNonce != sentinel {
            credential.wipe()
            try secureStore.removeAll()
            return nil
        }

        return credential
    }

    // load one reference-owned transient credential lease
    func loadCredentialLease(didWipe: (() -> Void)? = nil) throws -> AutomaticCredentialLease? {
        // require one sentinel-bound decoded credential
        guard var credential = try loadCredential() else {
            return nil
        }
        // release protected state
        defer {
            // wipe the decoded transfer value
            credential.wipe()
        }
        return AutomaticCredentialLease(credential, didWipe: didWipe)
    }

    // bind one outgoing bootstrap to this installation
    func beginEnrollmentBootstrap() throws -> Data {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one complete no-backup sentinel
        guard var nonce = try sentinelStore.load(), nonce.count == 32 else {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
        // release protected state
        defer {
            // wipe the keychain bootstrap source
            nonce.resetBytes(in: 0..<nonce.count)
            nonce.removeAll(keepingCapacity: false)
        }
        // invalidate prior ownership before exposing a new transaction nonce
        try secureStore.remove(account: Self.subjectBindingAccount)
        try secureStore.write(nonce, account: Self.bootstrapAccount)
        return nonce
    }

    // consume only a matching prior bootstrap binding
    func consumeEnrollmentBootstrapNonce() throws -> Data {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require both persisted installation bindings
        guard var pending = try secureStore.read(account: Self.bootstrapAccount),
              var sentinel = try sentinelStore.load() else {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
        // release protected state
        defer {
            // wipe both bootstrap binding copies
            pending.resetBytes(in: 0..<pending.count)
            pending.removeAll(keepingCapacity: false)
            sentinel.resetBytes(in: 0..<sentinel.count)
            sentinel.removeAll(keepingCapacity: false)
        }
        // require one exact current installation binding
        guard pending.count == 32,
              sentinel.count == 32,
              pending == sentinel else {
            try? secureStore.remove(account: Self.bootstrapAccount)
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }
        try secureStore.remove(account: Self.bootstrapAccount)
        return sentinel
    }

    // persist one exact scoped credential
    func storeCredential(_ credential: AutomaticNativeCredential) throws {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one sentinel-bound credential
        guard let sentinel = try sentinelStore.load(),
              sentinel == credential.installationNonce,
              credential.installationNonce.count == 32,
              credential.bearerToken.count > 0,
              credential.bearerToken.count <= 4_096 else {
            throw AutomaticSecureRuntimeError.credentialUnavailable
        }

        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        var encoded = try encoder.encode(credential)
        // release protected state
        defer {
            // wipe encoded bearer material after keychain copy
            encoded.resetBytes(in: 0..<encoded.count)
            encoded.removeAll(keepingCapacity: false)
        }
        try secureStore.write(encoded, account: Self.credentialAccount)
    }

    // remove enrollment identity only
    func removeCredential() throws {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        try secureStore.remove(account: Self.credentialAccount)
    }

    // bind one transient subject to the current credential and installation
    func bindSubject(_ subject: String) throws -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        guard var credential = try loadCredentialWithoutReconciliation() else {
            return false
        }
        // release protected state
        defer { credential.wipe() }
        guard var sentinel = try sentinelStore.load() else {
            return false
        }
        // release protected state
        defer {
            sentinel.resetBytes(in: 0..<sentinel.count)
            sentinel.removeAll(keepingCapacity: false)
        }
        guard credential.installationNonce == sentinel,
              var material = subjectBindingMaterial(
                  subject: subject,
                  enrollmentId: credential.enrollmentId
              ) else {
            return false
        }
        // release protected state
        defer {
            material.resetBytes(in: 0..<material.count)
            material.removeAll(keepingCapacity: false)
        }
        var code = Data(HMAC<SHA256>.authenticationCode(
            for: material,
            using: SymmetricKey(data: sentinel)
        ))
        // release protected state
        defer {
            code.resetBytes(in: 0..<code.count)
            code.removeAll(keepingCapacity: false)
        }
        try secureStore.write(code, account: Self.subjectBindingAccount)
        return true
    }

    // check one transient subject without returning raw or derived identity
    func checkSubject(_ subject: String) throws -> AutomaticSubjectBindingCheck {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        guard var stored = try secureStore.read(account: Self.subjectBindingAccount) else {
            return AutomaticSubjectBindingCheck(bound: false, matches: false)
        }
        // release protected state
        defer {
            stored.resetBytes(in: 0..<stored.count)
            stored.removeAll(keepingCapacity: false)
        }
        guard stored.count == 32,
              var credential = try loadCredentialWithoutReconciliation() else {
            return AutomaticSubjectBindingCheck(bound: true, matches: false)
        }
        // release protected state
        defer { credential.wipe() }
        guard var sentinel = try sentinelStore.load() else {
            return AutomaticSubjectBindingCheck(bound: true, matches: false)
        }
        // release protected state
        defer {
            sentinel.resetBytes(in: 0..<sentinel.count)
            sentinel.removeAll(keepingCapacity: false)
        }
        guard credential.installationNonce == sentinel,
              var material = subjectBindingMaterial(
                  subject: subject,
                  enrollmentId: credential.enrollmentId
              ) else {
            return AutomaticSubjectBindingCheck(bound: true, matches: false)
        }
        // release protected state
        defer {
            material.resetBytes(in: 0..<material.count)
            material.removeAll(keepingCapacity: false)
        }
        let matches = HMAC<SHA256>.isValidAuthenticationCode(
            stored,
            authenticating: material,
            using: SymmetricKey(data: sentinel)
        )
        return AutomaticSubjectBindingCheck(bound: true, matches: matches)
    }

    // remove only the current subject-owner proof
    func removeSubjectBinding() throws {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        try secureStore.remove(account: Self.subjectBindingAccount)
    }

    // stage one opaque subject-bound cleanup obligation
    func stageCleanupPending(_ subject: String) throws -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let existing = try checkCleanupPending(subject)
        // preserve the first unresolved cleanup owner byte-for-byte
        if existing.pending {
            return existing.valid && existing.matches
        }
        guard var material = cleanupSubjectMaterial(subject) else {
            return false
        }
        // release protected state
        defer {
            material.resetBytes(in: 0..<material.count)
            material.removeAll(keepingCapacity: false)
        }
        var key = try cleanupStore.read(account: Self.cleanupKeyAccount) ?? randomBytes(32)
        // release protected state
        defer {
            key.resetBytes(in: 0..<key.count)
            key.removeAll(keepingCapacity: false)
        }
        // require one device-only full key
        guard key.count == 32 else {
            return false
        }
        var proof = Data(HMAC<SHA256>.authenticationCode(
            for: material,
            using: SymmetricKey(data: key)
        ))
        // release protected state
        defer {
            proof.resetBytes(in: 0..<proof.count)
            proof.removeAll(keepingCapacity: false)
        }
        // store the key before proof so partial writes fail closed as pending
        try cleanupStore.write(key, account: Self.cleanupKeyAccount)
        try cleanupStore.write(proof, account: Self.cleanupProofAccount)
        return true
    }

    // check one cleanup obligation without exposing its proof
    func checkCleanupPending(_ subject: String) throws -> AutomaticCleanupPendingCheck {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        var key = try cleanupStore.read(account: Self.cleanupKeyAccount)
        var proof = try cleanupStore.read(account: Self.cleanupProofAccount)
        // release protected state
        defer {
            let keyCount = key?.count ?? 0
            key?.resetBytes(in: 0..<keyCount)
            key?.removeAll(keepingCapacity: false)
            let proofCount = proof?.count ?? 0
            proof?.resetBytes(in: 0..<proofCount)
            proof?.removeAll(keepingCapacity: false)
        }
        // distinguish a clean installation from partial cleanup state
        if key == nil && proof == nil {
            return AutomaticCleanupPendingCheck(matches: false, pending: false, valid: true)
        }
        guard let keyValue = key,
              let proofValue = proof,
              keyValue.count == 32,
              proofValue.count == 32,
              var material = cleanupSubjectMaterial(subject) else {
            return AutomaticCleanupPendingCheck(matches: false, pending: true, valid: false)
        }
        // release protected state
        defer {
            material.resetBytes(in: 0..<material.count)
            material.removeAll(keepingCapacity: false)
        }
        let matches = HMAC<SHA256>.isValidAuthenticationCode(
            proofValue,
            authenticating: material,
            using: SymmetricKey(data: keyValue)
        )
        return AutomaticCleanupPendingCheck(matches: matches, pending: true, valid: true)
    }

    // clear only one exactly matched cleanup obligation
    func clearCleanupPending(_ subject: String) throws -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        let checked = try checkCleanupPending(subject)
        // accept an already empty cleanup marker
        if !checked.pending {
            return true
        }
        // preserve corrupt or different-subject cleanup state
        guard checked.valid, checked.matches else {
            return false
        }
        try cleanupStore.remove(account: Self.cleanupProofAccount)
        try cleanupStore.remove(account: Self.cleanupKeyAccount)
        return true
    }

    // load or create one installation-only queue key
    func queueKey() throws -> SymmetricKey {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // return an existing 256-bit key
        if var stored = try secureStore.read(account: Self.queueKeyAccount) {
            // release protected state
            defer {
                // wipe the keychain return buffer
                stored.resetBytes(in: 0..<stored.count)
                stored.removeAll(keepingCapacity: false)
            }
            // require one full queue key
            guard stored.count == 32 else {
                throw AutomaticSecureRuntimeError.credentialUnavailable
            }
            return SymmetricKey(data: stored)
        }

        var generated = try randomBytes(32)
        // release protected state
        defer {
            // wipe generated key bytes after secure copies
            generated.resetBytes(in: 0..<generated.count)
            generated.removeAll(keepingCapacity: false)
        }
        try secureStore.write(generated, account: Self.queueKeyAccount)
        return SymmetricKey(data: generated)
    }

    // remove all identity-ending secrets
    func removeIdentitySecrets() throws {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        try secureStore.removeAll()
    }

    // decode one internal credential record
    private func loadCredentialWithoutReconciliation() throws -> AutomaticNativeCredential? {
        // branch on the current state
        guard var data = try secureStore.read(account: Self.credentialAccount) else {
            return nil
        }
        // release protected state
        defer {
            // wipe the keychain credential envelope after decode
            data.resetBytes(in: 0..<data.count)
            data.removeAll(keepingCapacity: false)
        }

        return try? PropertyListDecoder().decode(AutomaticNativeCredential.self, from: data)
    }

    // build one bounded transient hmac message
    private func subjectBindingMaterial(subject: String, enrollmentId: String) -> Data? {
        var subjectData = Data(subject.utf8)
        var enrollmentData = Data(enrollmentId.utf8)
        // release protected state
        defer {
            subjectData.resetBytes(in: 0..<subjectData.count)
            subjectData.removeAll(keepingCapacity: false)
            enrollmentData.resetBytes(in: 0..<enrollmentData.count)
            enrollmentData.removeAll(keepingCapacity: false)
        }
        // reject empty or unbounded transient identity input
        guard !subjectData.isEmpty,
              subjectData.count <= 512,
              !enrollmentData.isEmpty else {
            return nil
        }
        var material = Data("ferry-fyi:automatic:subject:v1:".utf8)
        material.append(subjectData)
        material.append(0)
        material.append(enrollmentData)
        return material
    }

    // build one bounded transient cleanup hmac message
    private func cleanupSubjectMaterial(_ subject: String) -> Data? {
        var subjectData = Data(subject.utf8)
        // release protected state
        defer {
            subjectData.resetBytes(in: 0..<subjectData.count)
            subjectData.removeAll(keepingCapacity: false)
        }
        // reject empty or unbounded transient identity input
        guard !subjectData.isEmpty, subjectData.count <= 512 else {
            return nil
        }
        var material = Data("ferry-fyi:automatic:cleanup-subject:v1:".utf8)
        material.append(subjectData)
        return material
    }
}

// define the native contract
enum AutomaticRandom {
    // generate cryptographic bytes without identifiers
    static func bytes(count: Int) throws -> Data {
        // require one positive bounded allocation
        if count <= 0 || count > 4_096 {
            throw AutomaticSecureRuntimeError.queueStorageFailed
        }

        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)

        // require system random success
        if status != errSecSuccess {
            throw AutomaticSecureRuntimeError.queueStorageFailed
        }

        return Data(bytes)
    }
}

// define the native contract
enum AutomaticProtectedFile {
    // apply first-unlock and no-backup directory policy
    static func applyDirectoryPolicy(_ url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        try excludeFromBackup(url)
    }

    // apply first-unlock and no-backup file policy
    static func applyFilePolicy(_ url: URL, fileManager: FileManager) throws {
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        try excludeFromBackup(url)
    }

    // atomically move or replace protected ciphertext
    static func atomicReplace(
        temporaryURL: URL,
        destinationURL: URL,
        fileManager: FileManager
    ) throws {
        // replace one existing record atomically
        if fileManager.fileExists(atPath: destinationURL.path) {
            _ = try fileManager.replaceItemAt(destinationURL, withItemAt: temporaryURL)
        // branch on the current state
        } else {
            try fileManager.moveItem(at: temporaryURL, to: destinationURL)
        }
    }

    // exclude one resource from backup and transfer
    private static func excludeFromBackup(_ url: URL) throws {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = url
        try mutableURL.setResourceValues(values)
    }
}

// define the native contract
enum AutomaticQueueRecordState: String, Equatable {
    case pending
    case cleanupRequired = "cleanup"
    case cleanupTransitionFailed = "cleanup-failed"
}

// define the native contract
protocol AutomaticCleanupFailureLatchStoring: AnyObject {
    // report one installation-wide cleanup failure
    func isLatched() -> Bool

    // persist one installation-wide cleanup failure
    func latch() -> Bool

    // clear one converged cleanup failure
    func clear() -> Bool
}

// define the native contract
final class AutomaticKeychainCleanupFailureLatchStore: AutomaticCleanupFailureLatchStoring {
    private static let account = "cleanup-transition-failed"
    private let secureStore: AutomaticSecureValueStoring

    // isolate cleanup authority from identity deletion
    init(
        secureStore: AutomaticSecureValueStoring = AutomaticIOSKeychainStore(
            service: "fyi.ferry.leaderboard-automatic-cleanup.v1"
        )
    ) {
        self.secureStore = secureStore
    }

    // fail closed on an unreadable latch
    func isLatched() -> Bool {
        // attempt the protected operation
        do {
            return try secureStore.read(account: Self.account) != nil
        // fail closed on the error
        } catch {
            return true
        }
    }

    // persist one device-only failure byte
    func latch() -> Bool {
        // attempt the protected operation
        do {
            try secureStore.write(Data([1]), account: Self.account)
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }

    // clear only this cleanup latch
    func clear() -> Bool {
        // attempt the protected operation
        do {
            try secureStore.remove(account: Self.account)
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }
}

// define the native contract
final class AutomaticDecryptedCandidate {
    let recordKey: String
    let localWorkGeneration: LocalWorkGeneration
    private(set) var candidate: AutomaticCheckinCandidateV1?
    private var plaintext: Data
    private let didWipe: (() -> Void)?
    private var wiped = false

    // retain mutable plaintext only for one bounded operation
    init(
        recordKey: String,
        candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration,
        plaintext: Data,
        didWipe: (() -> Void)? = nil
    ) {
        self.recordKey = recordKey
        self.candidate = candidate
        self.localWorkGeneration = localWorkGeneration
        self.plaintext = plaintext
        self.didWipe = didWipe
    }

    // wipe every mutable candidate representation
    func wipe() {
        // preserve one observable wipe transition
        guard !wiped else {
            return
        }
        plaintext.resetBytes(in: 0..<plaintext.count)
        plaintext.removeAll(keepingCapacity: false)
        candidate = nil
        wiped = true
        didWipe?()
    }

    // wipe on object release
    deinit {
        // wipe on every release path
        wipe()
    }
}

// define the native contract
protocol AutomaticCandidateQueueing: AnyObject {
    // append one encrypted candidate
    func enqueue(
        _ candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration,
        maximumCount: Int
    ) throws -> String

    // decrypt pending work for selection
    func loadPending() throws -> [AutomaticDecryptedCandidate]

    // delete one final ciphertext
    func delete(recordKey: String) -> Bool

    // mark one final ciphertext for deletion-only recovery
    func markCleanupRequired(recordKey: String) -> Bool

    // converge deletion-only recovery before upload
    func retryCleanup() -> Bool

    // rebind retained background ciphertext to a new callback generation
    func adoptPendingGeneration(_ generation: LocalWorkGeneration) -> Bool

    // purge every ciphertext record
    func purge() -> Bool

    // count opaque pending records
    func pendingCount() -> Int

    // report a deletion-only latch
    func hasCleanupRequired() -> Bool
}

// define the native contract
private struct AutomaticQueuedCandidateEnvelope: Codable {
    let candidate: AutomaticCandidateWireV1
    let localWorkGeneration: Int64
}

// define the native contract
private struct AutomaticCandidateWireV1: Codable {
    let accuracyMillimeters: UInt32
    let candidateId: String
    let capturedAtMs: UInt64
    let configGeneration: UInt64?
    let kind: String
    let latitudeE7: Int32
    let longitudeE7: Int32
    let sailingId: String?
    let terminalId: String?
    let vesselId: String?

    // encode one discriminated candidate
    init(candidate: AutomaticCheckinCandidateV1) {
        // project the exact union case
        switch candidate {
        case let .terminal(common, terminalId, configGeneration):
            accuracyMillimeters = common.accuracyMillimeters
            candidateId = common.candidateId
            capturedAtMs = common.capturedAtMs
            self.configGeneration = configGeneration
            kind = "terminal"
            latitudeE7 = common.latitudeE7
            longitudeE7 = common.longitudeE7
            sailingId = nil
            self.terminalId = terminalId
            vesselId = nil
        case let .vessel(common, vesselId, sailingId):
            accuracyMillimeters = common.accuracyMillimeters
            candidateId = common.candidateId
            capturedAtMs = common.capturedAtMs
            configGeneration = nil
            kind = "vessel"
            latitudeE7 = common.latitudeE7
            longitudeE7 = common.longitudeE7
            self.sailingId = sailingId
            terminalId = nil
            self.vesselId = vesselId
        }
    }

    // restore one strict candidate union
    func candidate() throws -> AutomaticCheckinCandidateV1 {
        let common = AutomaticCheckinCandidateV1.Common(
            accuracyMillimeters: accuracyMillimeters,
            candidateId: candidateId,
            capturedAtMs: capturedAtMs,
            latitudeE7: latitudeE7,
            longitudeE7: longitudeE7
        )
        let result: AutomaticCheckinCandidateV1

        // require exact terminal or vessel suffixes
        switch kind {
        case "terminal":
            // require one exact terminal suffix
            guard let terminalId,
                  let configGeneration,
                  sailingId == nil,
                  vesselId == nil else {
                throw AutomaticSecureRuntimeError.invalidCandidate
            }
            result = .terminal(
                common: common,
                terminalId: terminalId,
                configGeneration: configGeneration
            )
        case "vessel":
            // require one exact vessel suffix
            guard let vesselId,
                  let sailingId,
                  configGeneration == nil,
                  terminalId == nil else {
                throw AutomaticSecureRuntimeError.invalidCandidate
            }
            result = .vessel(common: common, vesselId: vesselId, sailingId: sailingId)
        default:
            throw AutomaticSecureRuntimeError.invalidCandidate
        }

        _ = try AutomaticPayloadDigestV1.canonicalBytes(result)
        return result
    }
}

// define the native contract
final class AutomaticEncryptedCandidateQueue: AutomaticCandidateQueueing {
    private static let schemaByte: UInt8 = 1
    private static let filePrefix = "candidate-"
    private let fileManager: FileManager
    private let directoryURL: URL
    private let keyProvider: () throws -> SymmetricKey
    private let randomRecordKey: () -> String
    private let movePendingToCleanup: (URL, URL) throws -> Void
    private let cleanupFailureLatchStore: AutomaticCleanupFailureLatchStoring
    private let writeCleanupFailureMarker: ((String) -> Bool)?
    private let listRecordURLs: () throws -> [URL]
    private let removeRecordFile: (URL) throws -> Void
    private let lock = NSLock()

    // inject protected storage and a device-only key
    init(
        fileManager: FileManager = .default,
        directoryURL: URL? = nil,
        keyProvider: @escaping () throws -> SymmetricKey,
        // run the bounded callback
        randomRecordKey: @escaping () -> String = { UUID().uuidString.lowercased() },
        movePendingToCleanup: ((URL, URL) throws -> Void)? = nil,
        cleanupFailureLatchStore: AutomaticCleanupFailureLatchStoring =
            AutomaticKeychainCleanupFailureLatchStore(),
        writeCleanupFailureMarker: ((String) -> Bool)? = nil,
        listRecordURLs: (() throws -> [URL])? = nil,
        removeRecordFile: ((URL) throws -> Void)? = nil
    ) {
        let resolvedDirectoryURL = directoryURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("leaderboard-automatic-queue.v1", isDirectory: true)
        self.fileManager = fileManager
        self.directoryURL = resolvedDirectoryURL
        self.keyProvider = keyProvider
        self.randomRecordKey = randomRecordKey
        // run the bounded callback
        self.movePendingToCleanup = movePendingToCleanup ?? { source, destination in
            try fileManager.moveItem(at: source, to: destination)
        }
        self.cleanupFailureLatchStore = cleanupFailureLatchStore
        self.writeCleanupFailureMarker = writeCleanupFailureMarker
        self.listRecordURLs = listRecordURLs ?? {
            try fileManager.contentsOfDirectory(
                at: resolvedDirectoryURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
        }
        // run the bounded callback
        self.removeRecordFile = removeRecordFile ?? { url in
            try fileManager.removeItem(at: url)
        }
    }

    // encrypt and atomically append one candidate
    func enqueue(
        _ candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration,
        maximumCount: Int
    ) throws -> String {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        // reject invalid capacity or a deletion-only latch
        if maximumCount <= 0 || hasCleanupRequiredUnlocked() {
            throw maximumCount <= 0
                ? AutomaticSecureRuntimeError.queueCapacityInvalid
                : AutomaticSecureRuntimeError.cleanupRequired
        }

        _ = try AutomaticPayloadDigestV1.canonicalBytes(candidate)
        try AutomaticProtectedFile.applyDirectoryPolicy(directoryURL, fileManager: fileManager)
        var existing = try loadPendingUnlocked()
        // release protected state
        defer {
            // wipe every capacity-inspection record
            for record in existing {
                record.wipe()
            }
        }

        // remove oldest-expiring work without expanding retention
        while existing.count >= maximumCount {
            let incomingCommon = Self.common(candidate)
            // run the bounded callback
            let oldestExisting = existing.min { left, right in
                Self.precedesForOverflow(left, right)
            }
            // require one removable oldest record
            guard let oldest = oldestExisting,
                  let oldestCandidate = oldest.candidate else {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }
            let oldestCommon = Self.common(oldestCandidate)

            // reject an older incoming event without touching newer work
            if incomingCommon.capturedAtMs < oldestCommon.capturedAtMs ||
                (incomingCommon.capturedAtMs == oldestCommon.capturedAtMs &&
                    incomingCommon.candidateId <= oldestCommon.candidateId) {
                throw AutomaticSecureRuntimeError.queueOverflowRejected
            }
            // require one atomic oldest-record removal
            guard markCleanupRequiredUnlocked(recordKey: oldest.recordKey),
                  removeUnlocked(
                      recordKey: oldest.recordKey,
                      state: .cleanupRequired
                  ) else {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }
            // run the bounded callback
            existing.removeAll { record in
                record.recordKey == oldest.recordKey
            }
            oldest.wipe()
        }

        let recordKey = randomRecordKey()
        // require one opaque storage key
        guard Self.isOpaqueRecordKey(recordKey) else {
            throw AutomaticSecureRuntimeError.queueStorageFailed
        }

        let envelope = AutomaticQueuedCandidateEnvelope(
            candidate: AutomaticCandidateWireV1(candidate: candidate),
            localWorkGeneration: localWorkGeneration.value
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        var plaintext = try encoder.encode(envelope)
        // release protected state
        defer {
            // wipe encoded candidate bytes
            plaintext.resetBytes(in: 0..<plaintext.count)
            plaintext.removeAll(keepingCapacity: false)
        }
        let key = try keyProvider()
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(
            plaintext,
            using: key,
            nonce: nonce,
            authenticating: Data(recordKey.utf8)
        )
        // require one combined aead envelope
        guard let combined = sealed.combined else {
            throw AutomaticSecureRuntimeError.queueStorageFailed
        }

        var ciphertext = Data([Self.schemaByte])
        ciphertext.append(combined)
        let destinationURL = url(recordKey: recordKey, state: .pending)
        let temporaryURL = directoryURL.appendingPathComponent(
            ".candidate-\(recordKey)-\(UUID().uuidString).tmp",
            isDirectory: false
        )

        // persist ciphertext only
        do {
            try ciphertext.write(to: temporaryURL, options: .withoutOverwriting)
            try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
            try AutomaticProtectedFile.atomicReplace(
                temporaryURL: temporaryURL,
                destinationURL: destinationURL,
                fileManager: fileManager
            )
            try AutomaticProtectedFile.applyFilePolicy(destinationURL, fileManager: fileManager)
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            throw AutomaticSecureRuntimeError.queueStorageFailed
        }

        return recordKey
    }

    // authenticate every pending record
    func loadPending() throws -> [AutomaticDecryptedCandidate] {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return try loadPendingUnlocked()
    }

    // atomically transition then delete one finalized ciphertext
    func delete(recordKey: String) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require the ciphertext-bound cleanup transition first
        guard markCleanupRequiredUnlocked(recordKey: recordKey) else {
            return false
        }
        return removeUnlocked(recordKey: recordKey, state: .cleanupRequired)
    }

    // persist one final deletion-only tombstone
    func markCleanupRequired(recordKey: String) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return markCleanupRequiredUnlocked(recordKey: recordKey)
    }

    // retry only cleanup deletions before upload
    func retryCleanup() -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        var succeeded = true
        let pendingKeys: [String]
        let failedKeys: [String]

        // latch any unreadable queue enumeration
        do {
            pendingKeys = try recordKeys(state: .pending)
            failedKeys = try recordKeys(state: .cleanupTransitionFailed)
            _ = try recordKeys(state: .cleanupRequired)
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }

        // delete every pending record when the binding was lost
        if cleanupFailureLatchStore.isLatched() {
            // transition every possibly final ciphertext
            for recordKey in pendingKeys {
                succeeded = markCleanupRequiredUnlocked(recordKey: recordKey) && succeeded
            }
        }

        // retry every previously failed binding transition first
        for recordKey in failedKeys {
            let transitioned = markCleanupRequiredUnlocked(recordKey: recordKey)
            let failureLatchRemoved = transitioned && removeUnlocked(
                recordKey: recordKey,
                state: .cleanupTransitionFailed
            )
            succeeded = failureLatchRemoved && succeeded
        }

        let cleanupKeys: [String]

        // include tombstones created during this retry
        do {
            cleanupKeys = try recordKeys(state: .cleanupRequired)
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }

        // remove every cleanup latch
        for recordKey in cleanupKeys {
            let tombstoneRemoved = removeUnlocked(
                recordKey: recordKey,
                state: .cleanupRequired
            )
            succeeded = tombstoneRemoved && succeeded
        }

        let fileCleanupConverged: Bool

        // require a readable zero-file proof before clearing the latch
        do {
            let pendingEmpty = try recordKeys(state: .pending).isEmpty
            let cleanupEmpty = try recordKeys(state: .cleanupRequired).isEmpty
            let transitionEmpty = try recordKeys(state: .cleanupTransitionFailed).isEmpty
            fileCleanupConverged = pendingEmpty && cleanupEmpty && transitionEmpty
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }
        let globalCleanupConverged = fileCleanupConverged && cleanupFailureLatchStore.clear()
        return succeeded && globalCleanupConverged && !hasCleanupRequiredUnlocked()
    }

    // re-encrypt retained background records under the current generation
    func adoptPendingGeneration(_ generation: LocalWorkGeneration) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // block rebinding behind cleanup
        guard !hasCleanupRequiredUnlocked(),
              let records = try? loadPendingUnlocked() else {
            return false
        }
        // release protected state
        defer {
            // wipe every generation-rebinding record
            for record in records {
                record.wipe()
            }
        }

        // atomically rewrite each old-generation envelope
        for record in records where record.localWorkGeneration != generation {
            // branch on the current state
            guard let candidate = record.candidate,
                  replaceRecordUnlocked(
                    recordKey: record.recordKey,
                    candidate: candidate,
                    localWorkGeneration: generation
                  ) else {
                return false
            }
        }
        return true
    }

    // purge pending and cleanup ciphertext
    func purge() -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        var succeeded = true
        let pendingKeys: [String]
        let failedKeys: [String]

        // latch any unreadable queue enumeration
        do {
            pendingKeys = try recordKeys(state: .pending)
            failedKeys = try recordKeys(state: .cleanupTransitionFailed)
            _ = try recordKeys(state: .cleanupRequired)
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }

        // tombstone every pending record before destructive purge
        for recordKey in pendingKeys {
            succeeded = markCleanupRequiredUnlocked(recordKey: recordKey) && succeeded
        }

        // retry every failed transition during full purge
        for recordKey in failedKeys {
            let transitioned = markCleanupRequiredUnlocked(recordKey: recordKey)
            let failureLatchRemoved = transitioned && removeUnlocked(
                recordKey: recordKey,
                state: .cleanupTransitionFailed
            )
            succeeded = failureLatchRemoved && succeeded
        }

        let cleanupKeys: [String]

        // include tombstones created during this purge
        do {
            cleanupKeys = try recordKeys(state: .cleanupRequired)
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }

        // converge every deletion-only tombstone
        for recordKey in cleanupKeys {
            let tombstoneRemoved = removeUnlocked(
                recordKey: recordKey,
                state: .cleanupRequired
            )
            succeeded = tombstoneRemoved && succeeded
        }

        let fileCleanupConverged: Bool

        // require a readable zero-file proof before clearing the latch
        do {
            let pendingEmpty = try recordKeys(state: .pending).isEmpty
            let cleanupEmpty = try recordKeys(state: .cleanupRequired).isEmpty
            let transitionEmpty = try recordKeys(state: .cleanupTransitionFailed).isEmpty
            fileCleanupConverged = pendingEmpty && cleanupEmpty && transitionEmpty
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return false
        }
        let globalCleanupConverged = fileCleanupConverged && cleanupFailureLatchStore.clear()
        return succeeded && globalCleanupConverged && !hasCleanupRequiredUnlocked()
    }

    // count only pending ciphertext
    func pendingCount() -> Int {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // report no actionable work while enumeration is unreadable
        guard let count = try? recordKeys(state: .pending).count else {
            _ = cleanupFailureLatchStore.latch()
            return 0
        }
        return count
    }

    // report a durable cleanup latch
    func hasCleanupRequired() -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return hasCleanupRequiredUnlocked()
    }

    // decrypt pending files under one queue lock
    private func loadPendingUnlocked() throws -> [AutomaticDecryptedCandidate] {
        // block all reads until deletion-only recovery completes
        if hasCleanupRequiredUnlocked() {
            throw AutomaticSecureRuntimeError.cleanupRequired
        }

        let key = try keyProvider()
        var records: [AutomaticDecryptedCandidate] = []

        // authenticate each opaque ciphertext record
        for recordKey in try recordKeys(state: .pending) {
            let recordURL = url(recordKey: recordKey, state: .pending)
            // attempt the protected operation
            do {
                let stored = try Data(contentsOf: recordURL)
                // require one exact ciphertext schema
                guard stored.first == Self.schemaByte,
                      stored.count > 1 else {
                    throw AutomaticSecureRuntimeError.queueAuthenticationFailed
                }
                let sealed = try AES.GCM.SealedBox(combined: stored.dropFirst())
                var plaintext = try AES.GCM.open(
                    sealed,
                    using: key,
                    authenticating: Data(recordKey.utf8)
                )
                let envelope = try PropertyListDecoder().decode(
                    AutomaticQueuedCandidateEnvelope.self,
                    from: plaintext
                )
                let candidate = try envelope.candidate.candidate()
                records.append(AutomaticDecryptedCandidate(
                    recordKey: recordKey,
                    candidate: candidate,
                    localWorkGeneration: LocalWorkGeneration(value: envelope.localWorkGeneration),
                    plaintext: plaintext
                ))
                plaintext.removeAll(keepingCapacity: false)
            // fail closed on the error
            } catch {
                // bind tampered ciphertext to deletion-only recovery
                _ = markCleanupRequiredUnlocked(recordKey: recordKey)
                throw AutomaticSecureRuntimeError.queueAuthenticationFailed
            }
        }

        return records
    }

    // atomically rename ciphertext into deletion-only state
    private func markCleanupRequiredUnlocked(recordKey: String) -> Bool {
        let pendingURL = url(recordKey: recordKey, state: .pending)
        let cleanupURL = url(recordKey: recordKey, state: .cleanupRequired)

        // preserve an existing cleanup record
        if fileManager.fileExists(atPath: cleanupURL.path) {
            return true
        }

        // accept an already absent idempotent record
        if !fileManager.fileExists(atPath: pendingURL.path) {
            return true
        }

        // preserve the authenticated bytes as the durable cleanup latch
        do {
            try movePendingToCleanup(pendingURL, cleanupURL)
            try AutomaticProtectedFile.applyFilePolicy(cleanupURL, fileManager: fileManager)
            return true
        // fail closed on the error
        } catch {
            let markerPersisted = persistCleanupTransitionFailureUnlocked(recordKey: recordKey)
            let globalLatchPersisted = cleanupFailureLatchStore.latch()

            // require at least one durable replay barrier
            if !markerPersisted && !globalLatchPersisted {
                return false
            }
            return false
        }
    }

    // persist one opaque failed-transition latch
    private func persistCleanupTransitionFailureUnlocked(recordKey: String) -> Bool {
        // use one deterministic marker failure seam
        if let writeCleanupFailureMarker {
            return writeCleanupFailureMarker(recordKey)
        }
        let latchURL = url(recordKey: recordKey, state: .cleanupTransitionFailed)

        // preserve an existing failure latch
        if fileManager.fileExists(atPath: latchURL.path) {
            return true
        }
        let temporaryURL = directoryURL.appendingPathComponent(
            ".cleanup-failed-\(recordKey)-\(UUID().uuidString).tmp",
            isDirectory: false
        )

        // atomically preserve only the opaque record key binding
        do {
            try Data().write(to: temporaryURL, options: .withoutOverwriting)
            try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
            try AutomaticProtectedFile.atomicReplace(
                temporaryURL: temporaryURL,
                destinationURL: latchURL,
                fileManager: fileManager
            )
            try AutomaticProtectedFile.applyFilePolicy(latchURL, fileManager: fileManager)
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
    }

    // delete one opaque state file
    private func removeUnlocked(recordKey: String, state: AutomaticQueueRecordState) -> Bool {
        let recordURL = url(recordKey: recordKey, state: state)

        // preserve idempotent deletion
        if !fileManager.fileExists(atPath: recordURL.path) {
            return true
        }

        // attempt the protected operation
        do {
            try removeRecordFile(recordURL)
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }

    // atomically replace one encrypted generation envelope
    private func replaceRecordUnlocked(
        recordKey: String,
        candidate: AutomaticCheckinCandidateV1,
        localWorkGeneration: LocalWorkGeneration
    ) -> Bool {
        let envelope = AutomaticQueuedCandidateEnvelope(
            candidate: AutomaticCandidateWireV1(candidate: candidate),
            localWorkGeneration: localWorkGeneration.value
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        // require one complete replacement envelope
        guard var plaintext = try? encoder.encode(envelope),
              let key = try? keyProvider(),
              let sealed = try? AES.GCM.seal(
                plaintext,
                using: key,
                nonce: AES.GCM.Nonce(),
                authenticating: Data(recordKey.utf8)
              ),
              let combined = sealed.combined else {
            return false
        }
        // release protected state
        defer {
            // wipe rewritten plaintext bytes
            plaintext.resetBytes(in: 0..<plaintext.count)
            plaintext.removeAll(keepingCapacity: false)
        }
        var ciphertext = Data([Self.schemaByte])
        ciphertext.append(combined)
        let temporaryURL = directoryURL.appendingPathComponent(
            ".candidate-\(recordKey)-\(UUID().uuidString).tmp",
            isDirectory: false
        )
        let destinationURL = url(recordKey: recordKey, state: .pending)

        // persist only the replacement ciphertext
        do {
            try ciphertext.write(to: temporaryURL, options: .withoutOverwriting)
            try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
            try AutomaticProtectedFile.atomicReplace(
                temporaryURL: temporaryURL,
                destinationURL: destinationURL,
                fileManager: fileManager
            )
            try AutomaticProtectedFile.applyFilePolicy(destinationURL, fileManager: fileManager)
            return true
        // fail closed on the error
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            return false
        }
    }

    // enumerate only canonical opaque filenames
    private func recordKeys(state: AutomaticQueueRecordState) throws -> [String] {
        let urls: [URL]

        // treat a never-created queue as empty
        if !fileManager.fileExists(atPath: directoryURL.path) {
            return []
        }
        urls = try listRecordURLs()
        let suffix = ".\(state.rawValue)"
        // run the bounded callback
        return urls.compactMap { fileURL in
            let name = fileURL.lastPathComponent
            // admit only canonical record names
            guard name.hasPrefix(Self.filePrefix),
                  name.hasSuffix(suffix) else {
                return nil
            }
            let start = name.index(name.startIndex, offsetBy: Self.filePrefix.count)
            let end = name.index(name.endIndex, offsetBy: -suffix.count)
            let recordKey = String(name[start..<end])
            return Self.isOpaqueRecordKey(recordKey) ? recordKey : nil
        }.sorted()
    }

    // report one cleanup file under the queue lock
    private func hasCleanupRequiredUnlocked() -> Bool {
        // preserve an existing durable cleanup barrier
        if cleanupFailureLatchStore.isLatched() {
            return true
        }

        // fail closed on unreadable queue state
        do {
            let cleanupKeys = try recordKeys(state: .cleanupRequired)
            let transitionKeys = try recordKeys(state: .cleanupTransitionFailed)
            return !cleanupKeys.isEmpty || !transitionKeys.isEmpty
        // fail closed on the error
        } catch {
            _ = cleanupFailureLatchStore.latch()
            return true
        }
    }

    // map one opaque record to its coarse-state file
    private func url(recordKey: String, state: AutomaticQueueRecordState) -> URL {
        directoryURL.appendingPathComponent(
            "\(Self.filePrefix)\(recordKey).\(state.rawValue)",
            isDirectory: false
        )
    }

    // validate a generated opaque key
    private static func isOpaqueRecordKey(_ value: String) -> Bool {
        value.range(
            of: "^[a-z0-9][a-z0-9-]{15,63}$",
            options: .regularExpression
        ) != nil
    }

    // project ordering fields
    private static func common(_ candidate: AutomaticCheckinCandidateV1) -> AutomaticCheckinCandidateV1.Common {
        // project either union case
        switch candidate {
        case let .terminal(common, _, _), let .vessel(common, _, _):
            return common
        }
    }

    // order existing overflow records like android
    private static func precedesForOverflow(
        _ left: AutomaticDecryptedCandidate,
        _ right: AutomaticDecryptedCandidate
    ) -> Bool {
        // sort undecodable records deterministically
        guard let leftCandidate = left.candidate,
              let rightCandidate = right.candidate else {
            return left.recordKey < right.recordKey
        }
        let leftCommon = common(leftCandidate)
        let rightCommon = common(rightCandidate)

        // order equal expiry by candidate id like android
        if leftCommon.capturedAtMs == rightCommon.capturedAtMs {
            return leftCommon.candidateId < rightCommon.candidateId
        }
        return leftCommon.capturedAtMs < rightCommon.capturedAtMs
    }
}

// define the native contract
enum AutomaticCheckinDisposition: String, Equatable {
    case final
    case retryable
}

// define the native contract
struct AutomaticCheckinUploadResponse: Equatable {
    let credited: Bool
    let disposition: AutomaticCheckinDisposition
    let outcome: String
    let retryAfterSeconds: UInt32?
    let serverPolicyGeneration: Int64?
}

// define the native contract
enum AutomaticCandidateHTTPStatusPolicy {
    // bind each fixed envelope to its reviewed http class
    static func accepts(
        statusCode: Int,
        response: AutomaticCheckinUploadResponse
    ) -> Bool {
        // map pre-auth and transport outcomes exactly
        switch response.outcome {
        case "authentication_failed", "enrollment_expired", "enrollment_revoked":
            return statusCode == 401
        case "malformed_payload":
            return statusCode == 400
        case "payload_too_large":
            return statusCode == 413
        case "unsupported_encoding", "unsupported_media_type":
            return statusCode == 415
        case "invalid_candidate":
            return statusCode == 422
        case "rate_limited":
            return statusCode == 429
        case "temporarily_unavailable":
            return statusCode == 200 || statusCode == 503
        case "candidate_conflict":
            return statusCode == 200 || statusCode == 409
        case "credited":
            return statusCode == 201
        default:
            return statusCode == 200
        }
    }
}

// define the native contract
enum AutomaticCheckinResponseParser {
    static let outcomes: Set<String> = [
        "authentication_failed", "candidate_conflict", "credited", "detector_disabled",
        "enrollment_expired", "enrollment_revoked", "expired", "future_timestamp",
        "history_unavailable", "history_warming", "invalid_candidate",
        "location_accuracy_too_low", "malformed_payload", "outside_terminal",
        "payload_too_large", "policy_disabled", "rate_limited", "sailing_already_credited",
        "stale_event", "temporarily_unavailable", "terminal_config_unavailable",
        "terminal_not_found", "too_close_to_shore", "unsupported_encoding",
        "unsupported_media_type", "vessel_not_found",
    ]
    static let retryableOutcomes: Set<String> = [
        "history_warming", "rate_limited", "temporarily_unavailable",
    ]
    static let nullGenerationOutcomes: Set<String> = [
        "invalid_candidate", "malformed_payload", "payload_too_large",
        "unsupported_encoding", "unsupported_media_type",
    ]

    // parse one strict detail-free candidate response
    static func parse(_ data: Data) -> AutomaticCheckinUploadResponse? {
        // branch on the current state
        guard data.count <= automaticNativeMaximumBodyBytes,
              StrictJSONDuplicateKeyValidator.validate(data),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let value = raw as? [String: Any] else {
            return nil
        }
        let required: Set<String> = [
            "credited", "disposition", "outcome", "schemaVersion", "serverPolicyGeneration",
        ]
        let allowed = required.union(["retryAfterSeconds"])
        // require the strict response shape
        guard required.isSubset(of: Set(value.keys)),
              Set(value.keys).isSubset(of: allowed),
              strictInt64(value["schemaVersion"]) == 1,
              let credited = value["credited"] as? Bool,
              let dispositionValue = value["disposition"] as? String,
              let disposition = AutomaticCheckinDisposition(rawValue: dispositionValue),
              let outcome = value["outcome"] as? String,
              outcomes.contains(outcome) else {
            return nil
        }
        let generation: Int64?

        // parse null versus non-negative policy generation
        if value["serverPolicyGeneration"] is NSNull {
            generation = nil
        // branch on the current state
        } else {
            // require one safe disclosed generation
            guard let parsed = strictInt64(value["serverPolicyGeneration"]), parsed >= 0 else {
                return nil
            }
            generation = parsed
        }

        let retryable = retryableOutcomes.contains(outcome)

        // bind fixed semantic fields
        if (disposition == .retryable) != retryable || credited != (outcome == "credited") {
            return nil
        }

        // bind policy disclosure to the server boundary table
        if nullGenerationOutcomes.contains(outcome) != (generation == nil) &&
            outcome != "authentication_failed" && outcome != "rate_limited" &&
            outcome != "temporarily_unavailable" {
            return nil
        }

        var retryAfterSeconds: UInt32?

        // validate an optional retry hint
        if value.keys.contains("retryAfterSeconds") {
            // branch on the current state
            guard retryable,
                  let retry = strictInt64(value["retryAfterSeconds"]),
                  retry > 0,
                  retry <= Int64(UInt32.max) else {
                return nil
            }
            retryAfterSeconds = UInt32(retry)
        }

        return AutomaticCheckinUploadResponse(
            credited: credited,
            disposition: disposition,
            outcome: outcome,
            retryAfterSeconds: retryAfterSeconds,
            serverPolicyGeneration: generation
        )
    }

    // parse one exact safe integer
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

// define the native contract
final class AutomaticSensitiveDataBuffer {
    private let lock = NSLock()
    private var storage: Data
    private let didWipe: (() -> Void)?
    private(set) var isWiped = false

    // retain one mutable sensitive response buffer
    init(_ data: Data, didWipe: (() -> Void)? = nil) {
        storage = data
        self.didWipe = didWipe
    }

    // expose one bounded parser snapshot
    func snapshot() -> Data {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return storage
    }

    // wipe the owned response bytes exactly once
    func wipe() {
        lock.lock()

        // avoid duplicate wipe callbacks
        if isWiped {
            lock.unlock()
            return
        }
        storage.resetBytes(in: 0..<storage.count)
        storage.removeAll(keepingCapacity: false)
        isWiped = true
        lock.unlock()
        didWipe?()
    }

    // wipe on buffer release
    deinit {
        // wipe any abandoned response path
        wipe()
    }
}

// define the native contract
struct AutomaticCandidateTransportResponse {
    let sensitiveData: AutomaticSensitiveDataBuffer
    let requestedURL: String
    let resolvedURL: String
    let statusCode: Int
    let wasRedirected: Bool

    // wrap one transport response in an owned mutable buffer
    init(
        data: Data,
        requestedURL: String,
        resolvedURL: String,
        statusCode: Int,
        wasRedirected: Bool,
        didWipe: (() -> Void)? = nil
    ) {
        sensitiveData = AutomaticSensitiveDataBuffer(data, didWipe: didWipe)
        self.requestedURL = requestedURL
        self.resolvedURL = resolvedURL
        self.statusCode = statusCode
        self.wasRedirected = wasRedirected
    }

    // expose one transient parser snapshot
    var data: Data {
        sensitiveData.snapshot()
    }

    // wipe the owned response bytes
    func wipe() {
        sensitiveData.wipe()
    }
}

// define the native contract
protocol AutomaticCandidateTransporting: AnyObject {
    // upload one candidate under one generation
    func upload(
        body: Data,
        credentialLease: AutomaticCredentialLease,
        localWorkGeneration: LocalWorkGeneration,
        completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
    )

    // cancel every controllable request
    func cancelAll()
}

// define the native contract
protocol AutomaticCreditedEffectEmitting: AnyObject {
    // emit only a generic notification and detail-free event
    func emitCredited()
}

// define the native contract
protocol AutomaticUploaderPolicyReconciling: AnyObject {
    // compare one callback generation
    func isCurrent(_ generation: LocalWorkGeneration) -> Bool

    // serialize one generation-bound mutation against stops
    func mutateIfCurrent(
        _ generation: LocalWorkGeneration,
        mutation: () -> Void
    ) -> Bool

    // apply one authenticated observation only while current
    func observeCandidateResponse(
        _ response: AutomaticCheckinUploadResponse,
        ifCurrent generation: LocalWorkGeneration
    ) -> Bool

    // atomically bind final cleanup to stop authority
    func commitFinalCandidateResponse(
        _ response: AutomaticCheckinUploadResponse,
        ifCurrent generation: LocalWorkGeneration,
        deleteCiphertext: () -> Bool
    ) -> Bool

    // replay durable stop effects before any upload
    func recoverPendingStop() -> Bool

    // record only one fixed aggregate outcome
    func recordOutcome(_ outcome: String)
}

// define the native contract
extension AutomaticUploaderPolicyReconciling {
    // provide a deterministic non-durable test policy transition
    func commitFinalCandidateResponse(
        _ response: AutomaticCheckinUploadResponse,
        ifCurrent generation: LocalWorkGeneration,
        deleteCiphertext: () -> Bool
    ) -> Bool {
        var deleted = false
        // run the bounded callback
        let admitted = mutateIfCurrent(generation) {
            deleted = deleteCiphertext()
        }
        // branch on the current state
        guard admitted, deleted else {
            recordOutcome("cleanup_required")
            return false
        }
        return observeCandidateResponse(response, ifCurrent: generation)
    }

    // default fake policies have no durable stop authority
    func recoverPendingStop() -> Bool {
        true
    }
}

// define the native contract
final class AutomaticCredentialLease {
    private let lock = NSRecursiveLock()
    private var credential: AutomaticNativeCredential?
    private let didWipe: (() -> Void)?

    // retain one loaded credential for a serialized upload pass
    init(_ credential: AutomaticNativeCredential, didWipe: (() -> Void)? = nil) {
        self.credential = credential
        self.didWipe = didWipe
    }

    // expose only non-secret endpoint metadata
    func endpointUrls() -> AutomaticNativeEndpointUrls? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return credential?.urls.endpointUrls()
    }

    // expose one fixed endpoint without bearer material
    func endpointURL(_ kind: AutomaticNativeEndpointKind) -> String? {
        endpointUrls()?.url(for: kind)
    }

    // expose only aggregate expiry metadata
    func expiryMetadata() -> (expiresAtMs: Int64, serverPolicyGeneration: Int64)? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one live leased credential
        guard let credential else {
            return nil
        }
        return (credential.expiresAtMs, credential.serverPolicyGeneration)
    }

    // consume bearer bytes only inside one mutable scope
    func withBearerBytes<T>(_ body: (inout Data) -> T) -> T? {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // require one live bearer owner
        guard credential != nil else {
            return nil
        }
        return body(&credential!.bearerToken)
    }

    // wipe loaded bearer and binding bytes
    func wipe() {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // preserve idempotent credential wiping
        guard credential != nil else {
            return
        }
        credential?.wipe()
        self.credential = nil
        didWipe?()
    }

    // wipe on lease release
    deinit {
        // wipe every abandoned credential path
        wipe()
    }
}

// define the native contract
final class AutomaticCheckinUploader {
    // define the native contract
    private struct WakeRequest {
        let localWorkGeneration: LocalWorkGeneration
        let completion: () -> Void
    }

    // define the native contract
    private final class PreparedUpload {
        private(set) var body: Data
        let entityKey: String
        let recordKey: String

        // retain one mutable serialized request owner
        init(body: Data, entityKey: String, recordKey: String) {
            self.body = body
            self.entityKey = entityKey
            self.recordKey = recordKey
        }

        // wipe the uploader-owned serialized request
        func wipe() {
            body.resetBytes(in: 0..<body.count)
            body.removeAll(keepingCapacity: false)
        }

        // wipe any abandoned prepared request
        deinit {
            wipe()
        }
    }

    // define the native contract
    private enum CandidatePreparation {
        case complete
        case retrySelection
        case upload(PreparedUpload)
    }

    private let queue: AutomaticCandidateQueueing
    private let transport: AutomaticCandidateTransporting
    private let endpointValidator: AutomaticNativeEndpointValidator
    private let trustedClock: AutomaticTrustedClock
    private let credentialProvider: () throws -> AutomaticCredentialLease?
    private weak var policy: AutomaticUploaderPolicyReconciling?
    private weak var effects: AutomaticCreditedEffectEmitting?
    private let didWipeRequest: (() -> Void)?
    private let didDeriveEntityKey: ((String) -> Void)?
    private let entityLaneKey = SymmetricKey(size: .bits256)
    private let wakeLock = NSLock()
    private var wakeRequests: [WakeRequest] = []
    private var wakeRunning = false

    // inject queue, transport, time, policy, and fixed effects
    init(
        queue: AutomaticCandidateQueueing,
        transport: AutomaticCandidateTransporting,
        endpointValidator: AutomaticNativeEndpointValidator,
        trustedClock: AutomaticTrustedClock,
        credentialProvider: @escaping () throws -> AutomaticCredentialLease?,
        policy: AutomaticUploaderPolicyReconciling,
        effects: AutomaticCreditedEffectEmitting,
        didWipeRequest: (() -> Void)? = nil,
        didDeriveEntityKey: ((String) -> Void)? = nil
    ) {
        self.queue = queue
        self.transport = transport
        self.endpointValidator = endpointValidator
        self.trustedClock = trustedClock
        self.credentialProvider = credentialProvider
        self.policy = policy
        self.effects = effects
        self.didWipeRequest = didWipeRequest
        self.didDeriveEntityKey = didDeriveEntityKey
    }

    // process one zero-data native wake
    func wake(localWorkGeneration: LocalWorkGeneration, completion: @escaping () -> Void) {
        wakeLock.lock()
        wakeRequests.append(WakeRequest(
            localWorkGeneration: localWorkGeneration,
            completion: completion
        ))

        // coalesce every overlapping wake behind one owner
        if wakeRunning {
            wakeLock.unlock()
            return
        }
        wakeRunning = true
        let request = wakeRequests.removeFirst()
        wakeLock.unlock()
        runWake(request)
    }

    // execute one serialized wake request
    private func runWake(_ request: WakeRequest) {
        // replay authoritative stop before queue cleanup or upload
        if policy?.recoverPendingStop() != true {
            policy?.recordOutcome("cleanup_required")
            finishWake(request)
            return
        }

        // finish cleanup before any new upload
        if !queue.retryCleanup() {
            policy?.recordOutcome("cleanup_required")
            finishWake(request)
            return
        }

        processNextWithFreshCredential(
            localWorkGeneration: request.localWorkGeneration,
            blockedEntityKeys: [],
            // run the bounded callback
            completion: { [weak self] in
                self?.finishWake(request)
            }
        )
    }

    // advance the serialized wake queue
    private func finishWake(_ request: WakeRequest) {
        request.completion()
        wakeLock.lock()

        // release the owner only after all queued wakes drain
        guard !wakeRequests.isEmpty else {
            wakeRunning = false
            wakeLock.unlock()
            return
        }
        let next = wakeRequests.removeFirst()
        wakeLock.unlock()
        runWake(next)
    }

    // load one request-scoped credential before selection
    private func processNextWithFreshCredential(
        localWorkGeneration: LocalWorkGeneration,
        blockedEntityKeys: Set<String>,
        completion: @escaping () -> Void
    ) {
        // require current trusted upload authority
        guard policy?.isCurrent(localWorkGeneration) == true,
              let trustedNowMs = trustedClock.trustedNowMs() else {
            completion()
            return
        }
        let credentialLease: AutomaticCredentialLease

        // load one reference-owned request lease
        do {
            // branch on the current state
            guard let loaded = try credentialProvider() else {
                completion()
                return
            }
            credentialLease = loaded
        // fail closed on the error
        } catch {
            completion()
            return
        }
        // require one complete aggregate credential view
        guard let metadata = credentialLease.expiryMetadata() else {
            credentialLease.wipe()
            completion()
            return
        }

        // purge locally expired credential work after token wipe
        if metadata.expiresAtMs <= trustedNowMs {
            let expired = AutomaticCheckinUploadResponse(
                credited: false,
                disposition: .final,
                outcome: "enrollment_expired",
                retryAfterSeconds: nil,
                serverPolicyGeneration: metadata.serverPolicyGeneration
            )
            credentialLease.wipe()
            _ = policy?.observeCandidateResponse(
                expired,
                ifCurrent: localWorkGeneration
            )
            completion()
            return
        }

        processNext(
            credentialLease: credentialLease,
            localWorkGeneration: localWorkGeneration,
            blockedEntityKeys: blockedEntityKeys,
            completion: completion
        )
    }

    // serialize one selected head at a time
    private func processNext(
        credentialLease: AutomaticCredentialLease,
        localWorkGeneration: LocalWorkGeneration,
        blockedEntityKeys: Set<String>,
        completion: @escaping () -> Void
    ) {
        let preparation = prepareCandidate(
            localWorkGeneration: localWorkGeneration,
            blockedEntityKeys: blockedEntityKeys
        )
        let preparedUpload: PreparedUpload
        let selectedEntityKey: String
        let selectedRecordKey: String

        // end candidate scope before transport ownership begins
        switch preparation {
        case .complete:
            credentialLease.wipe()
            completion()
            return
        case .retrySelection:
            processNext(
                credentialLease: credentialLease,
                localWorkGeneration: localWorkGeneration,
                blockedEntityKeys: blockedEntityKeys,
                completion: completion
            )
            return
        case let .upload(prepared):
            preparedUpload = prepared
            selectedEntityKey = prepared.entityKey
            selectedRecordKey = prepared.recordKey
        }
        // require one still-owned fixed candidate endpoint
        guard let requestedURL = credentialLease.endpointURL(.candidates) else {
            preparedUpload.wipe()
            didWipeRequest?()
            credentialLease.wipe()
            completion()
            return
        }
        transport.upload(
            body: preparedUpload.body,
            credentialLease: credentialLease,
            localWorkGeneration: localWorkGeneration
        // run the bounded callback
        ) { [weak self] result in
            var requestWipeReported = false

            // wipe the serialized request exactly once
            func wipeRequest() {
                preparedUpload.wipe()

                // report only the first explicit wipe
                guard !requestWipeReported else {
                    return
                }
                requestWipeReported = true
                self?.didWipeRequest?()
            }

            // release protected state
            defer {
                // wipe request and credential fields on every response path
                wipeRequest()
                credentialLease.wipe()
            }

            // retain ciphertext on transport ambiguity
            guard case let .success(transportResponse) = result else {
                completion()
                return
            }
            // release protected state
            defer {
                // wipe every received response path
                transportResponse.wipe()
            }
            // reject invalidated callback work
            guard let self,
                  self.policy?.isCurrent(localWorkGeneration) == true else {
                completion()
                return
            }

            // retain ciphertext on response ambiguity
            var responseData = transportResponse.data
            // release protected state
            defer {
                // wipe the parser-owned response snapshot
                responseData.resetBytes(in: 0..<responseData.count)
                responseData.removeAll(keepingCapacity: false)
            }
            var sensitiveWorkWiped = false

            // wipe all request ownership before any aggregate effect
            func wipeSensitiveWork() {
                // preserve one idempotent wipe boundary
                guard !sensitiveWorkWiped else {
                    return
                }
                sensitiveWorkWiped = true
                responseData.resetBytes(in: 0..<responseData.count)
                responseData.removeAll(keepingCapacity: false)
                transportResponse.wipe()
                wipeRequest()
                credentialLease.wipe()
            }
            // require one bounded endpoint-bound protocol response
            guard responseData.count <= automaticNativeMaximumBodyBytes,
                  self.endpointValidator.acceptsResponse(
                    kind: .candidates,
                    requestedURL: requestedURL,
                    resolvedURL: transportResponse.resolvedURL,
                    wasRedirected: transportResponse.wasRedirected
                  ),
                  let response = AutomaticCheckinResponseParser.parse(responseData),
                  AutomaticCandidateHTTPStatusPolicy.accepts(
                    statusCode: transportResponse.statusCode,
                    response: response
                  ) else {
                completion()
                return
            }

            // retain only retryable authenticated ciphertext
            if response.disposition == .retryable {
                wipeSensitiveWork()
                let retryAdmitted = self.policy?.observeCandidateResponse(
                    response,
                    ifCurrent: localWorkGeneration
                ) == true

                // ignore stop-raced retry observations
                guard retryAdmitted else {
                    completion()
                    return
                }

                // stop this wake on global retryable outcomes
                if response.outcome == "rate_limited" ||
                    response.outcome == "temporarily_unavailable" {
                    completion()
                    return
                }
                var blocked = blockedEntityKeys
                blocked.insert(selectedEntityKey)
                self.processNextWithFreshCredential(
                    localWorkGeneration: localWorkGeneration,
                    blockedEntityKeys: blocked,
                    completion: completion
                )
                return
            }

            wipeSensitiveWork()

            // stage stop authority and cleanup under one generation lock
            guard self.policy?.commitFinalCandidateResponse(
                response,
                ifCurrent: localWorkGeneration,
                // run the bounded callback
                deleteCiphertext: {
                    self.queue.delete(recordKey: selectedRecordKey)
                }
            ) == true else {
                completion()
                return
            }
            // run the bounded callback
            let continueProcessing: () -> Void = { [weak self] in
                _ = self?.processNextWithFreshCredential(
                    localWorkGeneration: localWorkGeneration,
                    blockedEntityKeys: blockedEntityKeys,
                    completion: completion
                )
            }

            // emit credited ui only through the main-safe generation gate
            if response.credited {
                self.emitCreditedIfCurrent(
                    localWorkGeneration,
                    completion: continueProcessing
                )
                return
            }
            continueProcessing()
        }
    }

    // narrow decrypted candidate ownership to one preparation scope
    private func prepareCandidate(
        localWorkGeneration: LocalWorkGeneration,
        blockedEntityKeys: Set<String>
    ) -> CandidatePreparation {
        // require current work and authenticated queue access
        guard policy?.isCurrent(localWorkGeneration) == true,
              let records = try? queue.loadPending() else {
            return .complete
        }
        // release protected state
        defer {
            // wipe every decrypted queue record before returning
            for record in records {
                record.wipe()
            }
        }

        // run the bounded callback
        let currentRecords = records.filter { record in
            // admit only current complete records
            guard record.localWorkGeneration == localWorkGeneration,
                  let candidate = record.candidate else {
                return false
            }
            return !blockedEntityKeys.contains(entityKey(candidate))
        }

        // purge obsolete local generation records
        for record in records where record.localWorkGeneration != localWorkGeneration {
            // stop selection behind any stale-record deletion latch
            guard queue.delete(recordKey: record.recordKey) else {
                policy?.recordOutcome("cleanup_required")
                return .complete
            }
        }

        let candidates = currentRecords.compactMap(\.candidate)
        let heads = AutomaticCandidateUploadSchedulerV1.selectHeads(candidates)
        // require one selected entity head
        guard let head = heads.first,
              // run the bounded callback
              let selected = currentRecords.first(where: { $0.candidate == head }) else {
            return .complete
        }

        // delete trusted-expired work without upload
        switch trustedClock.evaluateExpiry(capturedAtMs: Int64(Self.common(head).capturedAtMs)) {
        case .blockedWithoutSameBootAnchor:
            return .complete
        case let .available(expired, _):
            // select again after deleting exact-boundary expiry
            if expired {
                // stop selection behind any expiry deletion latch
                guard queue.delete(recordKey: selected.recordKey) else {
                    policy?.recordOutcome("cleanup_required")
                    return .complete
                }
                return .retrySelection
            }
        }

        // serialize only the selected candidate
        guard let body = try? Self.requestBody(head) else {
            return .complete
        }
        let opaqueEntityKey = entityKey(head)
        didDeriveEntityKey?(opaqueEntityKey)
        return .upload(PreparedUpload(
            body: body,
            entityKey: opaqueEntityKey,
            recordKey: selected.recordKey
        ))
    }

    // emit one credited effect without main-queue lock inversion
    private func emitCreditedIfCurrent(
        _ generation: LocalWorkGeneration,
        completion: @escaping () -> Void
    ) {
        // run the bounded callback
        let emit = { [weak self] in
            // branch on the current state
            guard let self else {
                completion()
                return
            }
            // run the bounded callback
            _ = self.policy?.mutateIfCurrent(generation) {
                // emit only while main owns current generation authority
                self.effects?.emitCredited()
            }
            completion()
        }

        // end the sensitive callback scope before every ui effect
        DispatchQueue.main.async(execute: emit)
    }

    // render one strict JSON request body
    private static func requestBody(_ candidate: AutomaticCheckinCandidateV1) throws -> Data {
        let common = common(candidate)
        var value: [String: Any] = [
            "accuracyMillimeters": common.accuracyMillimeters,
            "candidateId": common.candidateId,
            "capturedAtMs": common.capturedAtMs,
            "latitudeE7": common.latitudeE7,
            "longitudeE7": common.longitudeE7,
            "schemaVersion": 1,
        ]

        // append one exact discriminated suffix
        switch candidate {
        case let .terminal(_, terminalId, configGeneration):
            value["kind"] = "terminal"
            value["terminalId"] = terminalId
            value["configGeneration"] = configGeneration
        case let .vessel(_, vesselId, sailingId):
            value["kind"] = "vessel"
            value["vesselId"] = vesselId
            value["sailingId"] = sailingId
        }

        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])

        // enforce the native endpoint bound before transport
        if data.count > automaticNativeMaximumBodyBytes {
            throw AutomaticSecureRuntimeError.invalidCandidate
        }

        return data
    }

    // project common candidate fields
    private static func common(_ candidate: AutomaticCheckinCandidateV1) -> AutomaticCheckinCandidateV1.Common {
        // project either union case
        switch candidate {
        case let .terminal(common, _, _), let .vessel(common, _, _):
            return common
        }
    }

    // derive one opaque process-local retry lane
    private func entityKey(_ candidate: AutomaticCheckinCandidateV1) -> String {
        var material = Data()

        // bind the lane kind and reviewed entity source
        switch candidate {
        case let .terminal(_, terminalId, _):
            material.append(1)
            material.append(contentsOf: terminalId.utf8)
        case let .vessel(common, _, _):
            material.append(2)
            material.append(contentsOf: common.candidateId.utf8)
        }
        // release protected state
        defer {
            // wipe the transient raw entity bytes
            material.resetBytes(in: 0..<material.count)
            material.removeAll(keepingCapacity: false)
        }
        var digest = Data(HMAC<SHA256>.authenticationCode(for: material, using: entityLaneKey))
        // release protected state
        defer {
            // wipe the transient keyed digest bytes
            digest.resetBytes(in: 0..<digest.count)
            digest.removeAll(keepingCapacity: false)
        }
        return digest.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// define the native contract
enum AutomaticRuntimeStopTrigger: String, CaseIterable {
    case accountDeletion
    case accuracyDowngrade
    case automaticDisabled
    case backgroundPermissionRevoked
    case detectorDenied
    case enrollmentExpired
    case enrollmentRevoked
    case geofenceUnavailable
    case identityLost
    case localDisable
    case parentPolicyKilled
    case profileOptOut

    // identify enrollment-ending stops
    var removesIdentity: Bool {
        // preserve credentials only for recoverable capability conditions
        switch self {
        case .accuracyDowngrade, .backgroundPermissionRevoked, .detectorDenied,
             .geofenceUnavailable, .parentPolicyKilled:
            return false
        case .accountDeletion, .automaticDisabled, .enrollmentExpired, .enrollmentRevoked,
             .identityLost, .localDisable, .profileOptOut:
            return true
        }
    }

    // map only approved shared aggregate outcomes
    var aggregateOutcome: String? {
        // disclose server-known policy endings only
        switch self {
        case .detectorDenied:
            return "detector_disabled"
        case .enrollmentExpired:
            return "enrollment_expired"
        case .enrollmentRevoked:
            return "enrollment_revoked"
        case .parentPolicyKilled:
            return "policy_disabled"
        case .accountDeletion, .accuracyDowngrade, .automaticDisabled,
             .backgroundPermissionRevoked, .geofenceUnavailable, .identityLost,
             .localDisable, .profileOptOut:
            return nil
        }
    }

    // identify controllable server-revocation paths
    var requestsServerRevoke: Bool {
        // revoke only explicit identity teardown actions
        switch self {
        case .accountDeletion, .enrollmentRevoked, .identityLost,
             .localDisable, .profileOptOut:
            return true
        case .accuracyDowngrade, .automaticDisabled, .backgroundPermissionRevoked,
             .detectorDenied, .enrollmentExpired, .geofenceUnavailable,
             .parentPolicyKilled:
            return false
        }
    }
}

// define the native contract
protocol AutomaticRegionRuntimeControlling: AnyObject {
    // stop every owned production region
    func stopAll()

    // invalidate the active immutable config
    func invalidateConfiguration()
}

// define the native contract
protocol AutomaticLocalGenerationStoring: AnyObject {
    // load one protected monotonic local generation
    func load() throws -> Int64?

    // atomically replace one protected monotonic local generation
    func store(_ value: Int64) throws
}

// define the native contract
final class AutomaticInMemoryLocalGenerationStore: AutomaticLocalGenerationStoring {
    private var value: Int64?

    // seed one deterministic generation store
    init(value: Int64? = nil) {
        self.value = value
    }

    // load one in-memory generation
    func load() throws -> Int64? {
        value
    }

    // replace one in-memory generation
    func store(_ value: Int64) throws {
        self.value = value
    }
}

// define the native contract
final class AutomaticProtectedLocalGenerationStore: AutomaticLocalGenerationStoring {
    private let fileManager: FileManager
    private let fileURL: URL

    // isolate one protected aggregate counter
    init(fileManager: FileManager = .default, fileURL: URL? = nil) {
        self.fileManager = fileManager
        self.fileURL = fileURL ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("leaderboard-automatic-local-generation.v1", isDirectory: false)
    }

    // load one exact non-negative counter
    func load() throws -> Int64? {
        // map first install to no stored generation
        if !fileManager.fileExists(atPath: fileURL.path) {
            return nil
        }

        let data = try Data(contentsOf: fileURL)
        // require one exact persisted counter
        guard data.count == MemoryLayout<Int64>.size else {
            throw AutomaticSecureRuntimeError.cleanupRequired
        }
        // run the bounded callback
        let value = data.reduce(Int64(0)) { partial, byte in
            (partial << 8) | Int64(byte)
        }
        // reject invalid local generations
        guard value >= 0 else {
            throw AutomaticSecureRuntimeError.cleanupRequired
        }

        return value
    }

    // atomically persist before invalidation side effects
    func store(_ value: Int64) throws {
        // branch on the current state
        guard value >= 0 else {
            throw AutomaticSecureRuntimeError.cleanupRequired
        }
        var bigEndian = value.bigEndian
        // run the bounded callback
        let data = withUnsafeBytes(of: &bigEndian) { Data($0) }
        let directoryURL = fileURL.deletingLastPathComponent()
        let temporaryURL = directoryURL.appendingPathComponent(
            ".local-generation-\(UUID().uuidString).tmp",
            isDirectory: false
        )
        try AutomaticProtectedFile.applyDirectoryPolicy(directoryURL, fileManager: fileManager)
        try data.write(to: temporaryURL, options: .withoutOverwriting)
        try AutomaticProtectedFile.applyFilePolicy(temporaryURL, fileManager: fileManager)
        try AutomaticProtectedFile.atomicReplace(
            temporaryURL: temporaryURL,
            destinationURL: fileURL,
            fileManager: fileManager
        )
        try AutomaticProtectedFile.applyFilePolicy(fileURL, fileManager: fileManager)
    }
}

// define the native contract
struct AutomaticPendingStopAuthority: Codable, Equatable {
    let generation: Int64
    let outcome: String?
    let trigger: String

    // resolve only one reviewed stop trigger
    var resolvedTrigger: AutomaticRuntimeStopTrigger? {
        AutomaticRuntimeStopTrigger(rawValue: trigger)
    }
}

// define the native contract
protocol AutomaticPendingStopAuthorityStoring: AnyObject {
    // load one device-only pending stop
    func load() throws -> AutomaticPendingStopAuthority?

    // replace one device-only pending stop
    func store(_ authority: AutomaticPendingStopAuthority) throws

    // remove one converged pending stop
    func remove() throws
}

// define the native contract
final class AutomaticInMemoryPendingStopAuthorityStore: AutomaticPendingStopAuthorityStoring {
    private var authority: AutomaticPendingStopAuthority?

    // load one deterministic pending stop
    func load() throws -> AutomaticPendingStopAuthority? {
        authority
    }

    // replace one deterministic pending stop
    func store(_ authority: AutomaticPendingStopAuthority) throws {
        self.authority = authority
    }

    // remove one deterministic pending stop
    func remove() throws {
        authority = nil
    }
}

// define the native contract
final class AutomaticKeychainPendingStopAuthorityStore: AutomaticPendingStopAuthorityStoring {
    private static let account = "pending-stop-authority"
    private let secureStore: AutomaticSecureValueStoring

    // isolate stop authority from enrollment identity deletion
    init(
        secureStore: AutomaticSecureValueStoring = AutomaticIOSKeychainStore(
            service: "fyi.ferry.leaderboard-automatic-stop.v1"
        )
    ) {
        self.secureStore = secureStore
    }

    // decode one exact fixed stop record
    func load() throws -> AutomaticPendingStopAuthority? {
        // branch on the current state
        guard let data = try secureStore.read(account: Self.account) else {
            return nil
        }
        // branch on the current state
        guard let authority = try? PropertyListDecoder().decode(
            AutomaticPendingStopAuthority.self,
            from: data
        ),
        authority.generation >= 0,
        authority.resolvedTrigger != nil else {
            throw AutomaticSecureRuntimeError.cleanupRequired
        }
        return authority
    }

    // persist one bounded fixed stop record
    func store(_ authority: AutomaticPendingStopAuthority) throws {
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        let data = try encoder.encode(authority)
        try secureStore.write(data, account: Self.account)
    }

    // remove one fully converged stop record
    func remove() throws {
        try secureStore.remove(account: Self.account)
    }
}

// define the native contract
final class AutomaticSecureRuntimeCoordinator: AutomaticUploaderPolicyReconciling {
    private let queue: AutomaticCandidateQueueing
    private let vault: AutomaticCredentialVault
    private let trustedClock: AutomaticTrustedClock
    private let transport: AutomaticCandidateTransporting
    private weak var regions: AutomaticRegionRuntimeControlling?
    private let invalidateProtectedCache: () -> Bool
    private let generationStore: AutomaticLocalGenerationStoring
    private let stopAuthorityStore: AutomaticPendingStopAuthorityStoring
    private let lock = NSRecursiveLock()
    private var localWorkGeneration: LocalWorkGeneration
    private var generationPersistenceHealthy: Bool
    private var generationRecoveryAllowed: Bool
    private var backgroundWorkHeld = false
    private var serverPolicyGeneration: ServerPolicyGeneration?
    private var serverPolicyEnabled: Bool?
    private(set) var lastOutcome: String?

    // inject the complete stop and purge boundary
    init(
        queue: AutomaticCandidateQueueing,
        vault: AutomaticCredentialVault,
        trustedClock: AutomaticTrustedClock,
        transport: AutomaticCandidateTransporting,
        regions: AutomaticRegionRuntimeControlling? = nil,
        generationStore: AutomaticLocalGenerationStoring = AutomaticInMemoryLocalGenerationStore(),
        stopAuthorityStore: AutomaticPendingStopAuthorityStoring =
            AutomaticInMemoryPendingStopAuthorityStore(),
        // run the bounded callback
        invalidateProtectedCache: @escaping () -> Bool = { true }
    ) {
        self.queue = queue
        self.vault = vault
        self.trustedClock = trustedClock
        self.transport = transport
        self.regions = regions
        self.invalidateProtectedCache = invalidateProtectedCache
        self.generationStore = generationStore
        self.stopAuthorityStore = stopAuthorityStore

        // restore or initialize the protected counter
        do {
            let restored = try generationStore.load() ?? 0
            // require one nonnegative restored counter
            guard restored >= 0 else {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }
            try generationStore.store(restored)
            localWorkGeneration = LocalWorkGeneration(value: restored)
            generationPersistenceHealthy = true
            generationRecoveryAllowed = false
        // fail closed on the error
        } catch {
            localWorkGeneration = LocalWorkGeneration(value: Int64.max)
            generationPersistenceHealthy = false
            generationRecoveryAllowed = true
        }
    }

    // attach the production region owner after assembly
    func attachRegions(_ regions: AutomaticRegionRuntimeControlling) {
        self.regions = regions
    }

    // return the active local callback generation
    func generation() -> LocalWorkGeneration {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return localWorkGeneration
    }

    // expose only fixed aggregate policy state
    func bridgePolicyState() -> (serverPolicyGeneration: Int64, lastOutcome: String?) {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return (serverPolicyGeneration?.value ?? 0, lastOutcome)
    }

    // recover only an initialization-time first-unlock read failure
    func recoverGenerationPersistence() -> Bool {
        lock.lock()

        // preserve an already healthy counter
        if generationPersistenceHealthy {
            lock.unlock()
            return true
        }
        let mayRecover = generationRecoveryAllowed
        lock.unlock()
        // reject unsafe write-failure recovery
        guard mayRecover else {
            return false
        }

        // attempt the protected operation
        do {
            let restored = try generationStore.load() ?? 0
            // require one safe persisted counter
            guard restored >= 0 else {
                return false
            }
            try generationStore.store(restored)
            lock.lock()
            localWorkGeneration = LocalWorkGeneration(value: restored)
            generationPersistenceHealthy = true
            generationRecoveryAllowed = false
            lock.unlock()
            return true
        // fail closed on the error
        } catch {
            return false
        }
    }

    // compare one callback generation
    func isCurrent(_ generation: LocalWorkGeneration) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        return generationPersistenceHealthy && !backgroundWorkHeld && generation == localWorkGeneration
    }

    // serialize one generation-bound mutation against every stop
    func mutateIfCurrent(
        _ generation: LocalWorkGeneration,
        mutation: () -> Void
    ) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }
        // reject stale or background-held mutations
        guard generationPersistenceHealthy,
              !backgroundWorkHeld,
              generation == localWorkGeneration else {
            return false
        }
        mutation()
        return true
    }

    // cancel in-flight work while preserving queued ciphertext
    @discardableResult
    func holdForBackgroundRefresh() -> Bool {
        lock.lock()
        backgroundWorkHeld = true
        let current = localWorkGeneration.value
        var generationAdvanced = false

        // persist a new callback generation before cancellation
        if generationPersistenceHealthy && current < Int64.max {
            let next = current + 1

            // fail closed when the callback generation cannot persist
            do {
                try generationStore.store(next)
                localWorkGeneration = LocalWorkGeneration(value: next)
                // reserve exhaustion as a permanently stopped sentinel
                if next == Int64.max {
                    generationPersistenceHealthy = false
                    generationRecoveryAllowed = false
                }
                generationAdvanced = true
            // fail closed on the error
            } catch {
                generationPersistenceHealthy = false
                generationRecoveryAllowed = false
            }
        // branch on the current state
        } else {
            generationPersistenceHealthy = false
        }
        let generation = localWorkGeneration
        lock.unlock()
        transport.cancelAll()
        let queueRebound = generationAdvanced && queue.adoptPendingGeneration(generation)
        return queueRebound
    }

    // allow foreground authoritative reconciliation again
    @discardableResult
    func resumeAfterBackgroundRefresh() -> Bool {
        let generation = self.generation()
        let cleanupConverged = !queue.hasCleanupRequired() || queue.retryCleanup()
        let queueRebound = cleanupConverged && queue.adoptPendingGeneration(generation)
        lock.lock()
        backgroundWorkHeld = !queueRebound
        lock.unlock()
        return queueRebound
    }

    // refresh one HTTPS server-time anchor
    func refreshTrustedServerTime(_ serverTimeMs: Int64) -> Bool {
        trustedClock.refreshAnchor(serverTimeMs: serverTimeMs)
    }

    // accept monotonic authoritative policy only
    @discardableResult
    func observePolicyGeneration(_ generation: Int64) -> Bool {
        lock.lock()
        // release protected state
        defer { lock.unlock() }

        // reject rollback or unsafe generations
        if generation < 0 ||
            generation > 9_007_199_254_740_991 ||
            // run the bounded callback
            serverPolicyGeneration.map({ generation < $0.value }) == true {
            return false
        }

        // clear status semantics only when policy advances
        if serverPolicyGeneration?.value != generation {
            serverPolicyEnabled = nil
        }
        serverPolicyGeneration = ServerPolicyGeneration(value: generation)
        return true
    }

    // invalidate all old enrollment work before credential replacement
    func replaceEnrollment(serverPolicyGeneration: Int64) -> Bool {
        // reject policy rollback before replacement
        guard observePolicyGeneration(serverPolicyGeneration) else {
            return false
        }
        return stop(trigger: .automaticDisabled)
    }

    // reconcile one authoritative status response
    func reconcileStatus(
        serverPolicyGeneration: Int64,
        automaticEnabled: Bool,
        credentialExpired: Bool
    ) {
        lock.lock()
        let currentGeneration = self.serverPolicyGeneration?.value
        let duplicateDisabled = currentGeneration == serverPolicyGeneration &&
            serverPolicyEnabled == false && !automaticEnabled

        // reject rollback or same-generation policy mutation
        if serverPolicyGeneration < 0 ||
            serverPolicyGeneration > 9_007_199_254_740_991 ||
            // run the bounded callback
            currentGeneration.map({ serverPolicyGeneration < $0 }) == true ||
            (currentGeneration == serverPolicyGeneration &&
                // run the bounded callback
                serverPolicyEnabled.map({ $0 != automaticEnabled }) == true) {
            lock.unlock()
            return
        }
        self.serverPolicyGeneration = ServerPolicyGeneration(value: serverPolicyGeneration)
        serverPolicyEnabled = automaticEnabled
        var preparedStop: (trigger: AutomaticRuntimeStopTrigger, persisted: Bool)?

        // stop on learned policy or expiry only
        if !automaticEnabled {
            // avoid repeated invalidation for one learned kill
            if !duplicateDisabled {
                let trigger = AutomaticRuntimeStopTrigger.parentPolicyKilled
                // prepare only while the response generation remains current
                if let persisted = prepareStopLocked(
                    trigger: trigger,
                    expectedGeneration: localWorkGeneration,
                    outcome: trigger.aggregateOutcome
                ) {
                    preparedStop = (trigger, persisted)
                }
            }
        // branch on the current state
        } else if credentialExpired {
            let trigger = AutomaticRuntimeStopTrigger.enrollmentExpired
            // prepare only while the response generation remains current
            if let persisted = prepareStopLocked(
                trigger: trigger,
                expectedGeneration: localWorkGeneration,
                outcome: trigger.aggregateOutcome
            ) {
                preparedStop = (trigger, persisted)
            }
        }
        lock.unlock()

        // perform learned stop effects without the generation lock
        if let preparedStop {
            _ = performStopEffects(
                trigger: preparedStop.trigger,
                generationPersisted: preparedStop.persisted,
                outcome: preparedStop.trigger.aggregateOutcome
            )
        }
    }

    // apply one generation-bound candidate observation
    func observeCandidateResponse(
        _ response: AutomaticCheckinUploadResponse,
        ifCurrent generation: LocalWorkGeneration
    ) -> Bool {
        // route every final through the durable cleanup transition
        if response.disposition == .final {
            return commitFinalCandidateResponse(
                response,
                ifCurrent: generation,
                // run the bounded callback
                deleteCiphertext: { true }
            )
        }
        lock.lock()
        // reject stale response authority
        guard generationPersistenceHealthy,
              !backgroundWorkHeld,
              generation == localWorkGeneration else {
            lock.unlock()
            return false
        }

        // apply only monotonic disclosed policy generations
        if let responseGeneration = response.serverPolicyGeneration {
            // branch on the current state
            guard responseGeneration >= 0,
                  responseGeneration <= 9_007_199_254_740_991,
                  // run the bounded callback
                  serverPolicyGeneration.map({ responseGeneration < $0.value }) != true else {
                lock.unlock()
                return false
            }

            // clear stale status semantics when policy advances
            if serverPolicyGeneration?.value != responseGeneration {
                serverPolicyEnabled = nil
            }
            serverPolicyGeneration = ServerPolicyGeneration(value: responseGeneration)
        }
        lastOutcome = response.outcome
        lock.unlock()
        return true
    }

    // atomically bind a final deletion to durable stop authority
    func commitFinalCandidateResponse(
        _ response: AutomaticCheckinUploadResponse,
        ifCurrent generation: LocalWorkGeneration,
        deleteCiphertext: () -> Bool
    ) -> Bool {
        lock.lock()
        // reject stale final response authority
        guard generationPersistenceHealthy,
              !backgroundWorkHeld,
              generation == localWorkGeneration else {
            lock.unlock()
            return false
        }

        // accept only monotonic disclosed policy generations
        if let responseGeneration = response.serverPolicyGeneration {
            // branch on the current state
            guard responseGeneration >= 0,
                  responseGeneration <= 9_007_199_254_740_991,
                  // run the bounded callback
                  serverPolicyGeneration.map({ responseGeneration < $0.value }) != true else {
                lock.unlock()
                return false
            }
            serverPolicyGeneration = ServerPolicyGeneration(value: responseGeneration)
        }

        // delete ordinary finals without stop authority
        guard let trigger = Self.stopTrigger(response) else {
            let deleted = deleteCiphertext()
            lastOutcome = deleted ? response.outcome : "cleanup_required"
            lock.unlock()
            return deleted
        }

        // persist stop authority before any ciphertext transition
        guard let generationPersisted = prepareStopLocked(
            trigger: trigger,
            expectedGeneration: generation,
            outcome: response.outcome
        ) else {
            lock.unlock()
            return false
        }
        let candidateDeleted = deleteCiphertext()
        lock.unlock()
        let stopped = performStopEffects(
            trigger: trigger,
            generationPersisted: generationPersisted,
            outcome: response.outcome,
            candidateDeleted: candidateDeleted
        )
        return candidateDeleted && stopped
    }

    // replay one durable stop before any lifecycle or upload work
    func recoverPendingStop() -> Bool {
        let authority: AutomaticPendingStopAuthority

        // attempt the protected operation
        do {
            // finish immediately when no stop is pending
            guard let loaded = try stopAuthorityStore.load() else {
                return true
            }
            authority = loaded
        // fail closed on the error
        } catch {
            // quarantine unreadable authority as identity loss
            return stop(trigger: .identityLost)
        }
        // branch on the current state
        guard let trigger = authority.resolvedTrigger else {
            return stop(trigger: .identityLost)
        }

        lock.lock()
        var generationPersisted = generationPersistenceHealthy

        // keep exhausted callback generations permanently fail closed
        if authority.generation == Int64.max {
            localWorkGeneration = LocalWorkGeneration(value: Int64.max)
            generationPersistenceHealthy = false
            generationRecoveryAllowed = false
            generationPersisted = false
        }

        // converge the protected generation to at least the staged stop
        if authority.generation < Int64.max &&
            (!generationPersistenceHealthy ||
            localWorkGeneration.value < authority.generation) {
            // attempt the protected operation
            do {
                try generationStore.store(authority.generation)
                localWorkGeneration = LocalWorkGeneration(value: authority.generation)
                generationPersistenceHealthy = true
                generationRecoveryAllowed = false
                generationPersisted = true
            // fail closed on the error
            } catch {
                localWorkGeneration = LocalWorkGeneration(value: Int64.max)
                generationPersistenceHealthy = false
                generationRecoveryAllowed = false
                generationPersisted = false
            }
        }
        backgroundWorkHeld = false
        lastOutcome = "cleanup_required"
        lock.unlock()
        return performStopEffects(
            trigger: trigger,
            generationPersisted: generationPersisted,
            outcome: authority.outcome
        )
    }

    // apply one test or direct current candidate observation
    func observeCandidateResponse(_ response: AutomaticCheckinUploadResponse) {
        _ = observeCandidateResponse(response, ifCurrent: generation())
    }

    // record one fixed aggregate result
    func recordOutcome(_ outcome: String) {
        lock.lock()
        lastOutcome = outcome
        lock.unlock()
    }

    // invalidate every old callback and purge known local work
    @discardableResult
    func stop(trigger: AutomaticRuntimeStopTrigger) -> Bool {
        lock.lock()
        let generationPersisted = prepareStopLocked(
            trigger: trigger,
            expectedGeneration: nil,
            outcome: trigger.aggregateOutcome
        ) ?? false
        lock.unlock()
        return performStopEffects(
            trigger: trigger,
            generationPersisted: generationPersisted,
            outcome: trigger.aggregateOutcome
        )
    }

    // commit one stop without invoking external owners
    private func prepareStopLocked(
        trigger: AutomaticRuntimeStopTrigger,
        expectedGeneration: LocalWorkGeneration?,
        outcome: String?
    ) -> Bool? {
        // reject a response stop that already lost authority
        if let expectedGeneration,
           (!generationPersistenceHealthy ||
            backgroundWorkHeld ||
            expectedGeneration != localWorkGeneration) {
            return nil
        }
        backgroundWorkHeld = false
        let current = localWorkGeneration.value
        let next = current < Int64.max ? current + 1 : Int64.max
        let authority = AutomaticPendingStopAuthority(
            generation: next,
            outcome: outcome,
            trigger: trigger.rawValue
        )
        var authorityPersisted = false

        // persist restart authority before generation mutation
        do {
            try stopAuthorityStore.store(authority)
            authorityPersisted = true
        // fail closed on the error
        } catch {
            authorityPersisted = false
        }

        // persist the next generation before stop side effects
        if current < Int64.max {
            // fail closed when monotonic persistence fails
            do {
                try generationStore.store(next)
                localWorkGeneration = LocalWorkGeneration(value: next)
            // fail closed on the error
            } catch {
                localWorkGeneration = LocalWorkGeneration(value: Int64.max)
                generationPersistenceHealthy = false
                generationRecoveryAllowed = false
            }
        // branch on the current state
        } else {
            generationPersistenceHealthy = false
            generationRecoveryAllowed = false
        }
        lastOutcome = "cleanup_required"
        return generationPersistenceHealthy && authorityPersisted
    }

    // finish stop side effects without the generation lock
    private func performStopEffects(
        trigger: AutomaticRuntimeStopTrigger,
        generationPersisted: Bool,
        outcome: String?,
        candidateDeleted: Bool = true
    ) -> Bool {
        regions?.stopAll()
        regions?.invalidateConfiguration()
        transport.cancelAll()
        let queuePurged = queue.purge()
        let cacheInvalidated = invalidateProtectedCache()
        var identityPurged = true

        // remove identity-ending secrets after local purge
        if trigger.removesIdentity {
            // attempt the protected operation
            do {
                try vault.removeIdentitySecrets()
            // fail closed on the error
            } catch {
                identityPurged = false
            }
        }
        let effectsSucceeded = generationPersisted && candidateDeleted && queuePurged &&
            cacheInvalidated && identityPurged
        var authorityRemoved = false

        // remove authority only after every stop effect converges
        if effectsSucceeded {
            // attempt the protected operation
            do {
                try stopAuthorityStore.remove()
                authorityRemoved = true
            // fail closed on the error
            } catch {
                authorityRemoved = false
            }
        }
        lock.lock()
        lastOutcome = effectsSucceeded && authorityRemoved
            ? outcome
            : "cleanup_required"
        lock.unlock()
        return effectsSucceeded && authorityRemoved
    }

    // map one final response to its reviewed stop trigger
    private static func stopTrigger(
        _ response: AutomaticCheckinUploadResponse
    ) -> AutomaticRuntimeStopTrigger? {
        // ignore retryable and ordinary application finals
        guard response.disposition == .final else {
            return nil
        }

        // select only authoritative lifecycle endings
        switch response.outcome {
        case "authentication_failed":
            return .identityLost
        case "detector_disabled":
            return .detectorDenied
        case "enrollment_expired":
            return .enrollmentExpired
        case "enrollment_revoked":
            return .enrollmentRevoked
        case "policy_disabled":
            return .parentPolicyKilled
        default:
            return nil
        }
    }

    // preserve stale offline policy until authoritative contact
    func noteOfflineWake() {
        recordOutcome("temporarily_unavailable")
    }
}
