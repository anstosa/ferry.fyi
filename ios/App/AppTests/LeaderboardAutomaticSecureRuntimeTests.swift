import CoreLocation
import CryptoKit
import Dispatch
import Security
import XCTest
@testable import Ferry_FYI

// define the native contract
final class AutomaticCredentialVaultTests: XCTestCase {
    // define the native contract
    private final class SecureStore: AutomaticSecureValueStoring {
        var values: [String: Data] = [:]
        var removeAllCount = 0

        // read one fake secure value
        func read(account: String) throws -> Data? {
            values[account]
        }

        // write one fake secure value
        func write(_ data: Data, account: String) throws {
            values[account] = data
        }

        // remove one fake secure value
        func remove(account: String) throws {
            values.removeValue(forKey: account)
        }

        // remove every fake secure value
        func removeAll() throws {
            removeAllCount += 1
            values.removeAll()
        }
    }

    // define the native contract
    private final class SentinelStore: AutomaticInstallationSentinelStoring {
        var value: Data?

        // load one fake sentinel
        func load() throws -> Data? {
            return value
        }

        // write one fake sentinel
        func store(_ nonce: Data) throws {
            value = nonce
        }
    }

    // define the native contract
    private final class FirstUnlockStore: AutomaticSecureValueStoring {
        var accessible = false
        var value: Data?

        // read only after the simulated first unlock
        func read(account _: String) throws -> Data? {
            // branch on the current state
            guard accessible else {
                throw AutomaticSecureRuntimeError.blockedBeforeFirstUnlock
            }
            return value
        }

        // write only after the simulated first unlock
        func write(_ data: Data, account _: String) throws {
            // branch on the current state
            guard accessible else {
                throw AutomaticSecureRuntimeError.blockedBeforeFirstUnlock
            }
            value = data
        }

        // remove the simulated probe
        func remove(account _: String) throws {
            value = nil
        }

        // remove the complete simulated probe service
        func removeAll() throws {
            value = nil
        }
    }

    // create one scoped credential
    private func credential(nonce: Data) -> AutomaticNativeCredential {
        AutomaticNativeCredential(
            bearerToken: Data("secret-token".utf8),
            enrollmentId: "enrollment-1",
            expiresAtMs: 20_000,
            installationNonce: nonce,
            rotateAfterMs: 10_000,
            serverPolicyGeneration: 7,
            urls: AutomaticNativeCredentialUrls(
                candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
                config: "https://ferry.fyi/api/leaderboards/native/config",
                enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment",
                status: "https://ferry.fyi/api/leaderboards/native/status"
            )
        )
    }

    // prove the concrete keychain policy is device-only after first unlock
    func testKeychainPolicyIsAfterFirstUnlockThisDeviceOnlyAndNotSynchronizing() {
        XCTAssertEqual(
            AutomaticIOSKeychainStore.accessibility as String,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
        )
        XCTAssertFalse(AutomaticIOSKeychainStore.synchronizes)
    }

    // distinguish boot pre-unlock from an ordinary relock
    func testFirstUnlockProbeRemainsAvailableAfterRelock() {
        let store = FirstUnlockStore()
        let probe = AutomaticFirstUnlockProbe(secureStore: store)

        XCTAssertFalse(probe.isAvailable())
        store.accessible = true
        XCTAssertTrue(probe.isAvailable())
        store.accessible = false
        XCTAssertTrue(probe.isAvailable())

        // a relaunched probe succeeds while after-first-unlock storage is readable
        store.accessible = true
        XCTAssertTrue(AutomaticFirstUnlockProbe(secureStore: store).isAvailable())
    }

    // delete surviving keychain data when the no-backup sentinel is absent
    func testMissingSentinelDeletesOldKeychainServiceBeforeReplacement() throws {
        let secure = SecureStore()
        secure.values["old"] = Data("old".utf8)
        let sentinel = SentinelStore()
        var purgeCount = 0
        let replacement = Data(repeating: 4, count: 32)
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: {
                purgeCount += 1
                return true
            },
            // run the bounded callback
            randomBytes: { _ in replacement }
        )

        XCTAssertEqual(try vault.reconcileInstallation(), .reset)
        XCTAssertEqual(secure.removeAllCount, 1)
        XCTAssertEqual(purgeCount, 1)
        XCTAssertEqual(sentinel.value, replacement)
        XCTAssertTrue(secure.values.isEmpty)
    }

    // delete a credential whose embedded nonce mismatches this installation
    func testMismatchedSentinelDeletesSurvivingCredentialAndQueue() throws {
        let secure = SecureStore()
        let sentinel = SentinelStore()
        sentinel.value = Data(repeating: 1, count: 32)
        var purgeCount = 0
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: {
                purgeCount += 1
                return true
            },
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 9, count: 32) }
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        secure.values["credential"] = try encoder.encode(
            credential(nonce: Data(repeating: 2, count: 32))
        )

        XCTAssertEqual(try vault.reconcileInstallation(), .reset)
        XCTAssertEqual(secure.removeAllCount, 1)
        XCTAssertEqual(purgeCount, 1)
        XCTAssertEqual(sentinel.value, Data(repeating: 9, count: 32))
    }

    // preserve a valid sentinel-bound credential across ordinary relaunch
    func testMatchingSentinelPreservesCredential() throws {
        let secure = SecureStore()
        let sentinel = SentinelStore()
        let nonce = Data(repeating: 3, count: 32)
        sentinel.value = nonce
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true },
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 8, count: 32) }
        )
        try vault.storeCredential(credential(nonce: nonce))

        XCTAssertEqual(try vault.reconcileInstallation(), .existing)
        XCTAssertEqual(try vault.loadCredential(), credential(nonce: nonce))
        XCTAssertEqual(secure.removeAllCount, 0)
    }

    // preserve only the same subject and credential across process replacement
    func testSubjectBindingIsDeviceOnlyAndCredentialSpecific() throws {
        let secure = SecureStore()
        let sentinel = SentinelStore()
        let nonce = Data(repeating: 3, count: 32)
        sentinel.value = nonce
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        try vault.storeCredential(credential(nonce: nonce))
        let subject = "auth0|private-rider"

        XCTAssertTrue(try vault.bindSubject(subject))
        XCTAssertEqual(
            try vault.checkSubject(subject),
            AutomaticSubjectBindingCheck(bound: true, matches: true)
        )
        XCTAssertEqual(
            try vault.checkSubject("auth0|other-rider"),
            AutomaticSubjectBindingCheck(bound: true, matches: false)
        )
        // inspect only test-owned secure values
        XCTAssertFalse(
            secure.values.values.contains { value in
                String(data: value, encoding: .utf8)?.contains(subject) == true
            }
        )

        let replacement = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        XCTAssertEqual(
            try replacement.checkSubject(subject),
            AutomaticSubjectBindingCheck(bound: true, matches: true)
        )
    }

    // preserve exact cleanup ownership across process replacement and identity purge
    func testCleanupPendingProofIsDeviceOnlyAndSeparatelyDurable() throws {
        let secure = SecureStore()
        let cleanup = SecureStore()
        let sentinel = SentinelStore()
        sentinel.value = Data(repeating: 3, count: 32)
        let subject = "auth0|private-rider"
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true },
            cleanupStore: cleanup,
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 7, count: 32) }
        )

        XCTAssertTrue(try vault.stageCleanupPending(subject))
        let stagedValues = cleanup.values
        XCTAssertTrue(try vault.stageCleanupPending(subject))
        XCTAssertEqual(cleanup.values, stagedValues)
        XCTAssertFalse(try vault.stageCleanupPending("auth0|other-rider"))
        XCTAssertEqual(cleanup.values, stagedValues)
        XCTAssertEqual(
            try vault.checkCleanupPending(subject),
            AutomaticCleanupPendingCheck(matches: true, pending: true, valid: true)
        )
        XCTAssertEqual(
            try vault.checkCleanupPending("auth0|other-rider"),
            AutomaticCleanupPendingCheck(matches: false, pending: true, valid: true)
        )
        // inspect only test-owned secure values
        XCTAssertFalse(
            cleanup.values.values.contains { value in
                String(data: value, encoding: .utf8)?.contains(subject) == true
            }
        )

        try vault.removeIdentitySecrets()
        let replacement = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true },
            cleanupStore: cleanup
        )
        XCTAssertTrue(try replacement.checkCleanupPending(subject).matches)
        XCTAssertFalse(try replacement.clearCleanupPending("auth0|other-rider"))
        XCTAssertTrue(try replacement.checkCleanupPending(subject).pending)
        XCTAssertTrue(try replacement.clearCleanupPending(subject))
        XCTAssertEqual(
            try replacement.checkCleanupPending(subject),
            AutomaticCleanupPendingCheck(matches: false, pending: false, valid: true)
        )
    }

    // allow only one concurrent direct caller to own the pending marker
    func testConcurrentCleanupSubjectsCannotReplaceTheFirstOwner() {
        let cleanup = SecureStore()
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { true },
            cleanupStore: cleanup,
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 7, count: 32) }
        )
        let subjects = ["auth0|first", "auth0|second"]
        var results = [false, false]
        let resultLock = NSLock()

        // race two direct native stage calls
        DispatchQueue.concurrentPerform(iterations: subjects.count) { index in
            let staged = (try? vault.stageCleanupPending(subjects[index])) == true
            resultLock.lock()
            results[index] = staged
            resultLock.unlock()
        }

        XCTAssertNotEqual(results[0], results[1])
        // identify the exact persisted winner
        let winner = results[0] ? subjects[0] : subjects[1]
        // identify the rejected competing subject
        let loser = results[0] ? subjects[1] : subjects[0]
        XCTAssertTrue((try? vault.checkCleanupPending(winner).matches) == true)
        XCTAssertFalse((try? vault.checkCleanupPending(loser).matches) == true)
        XCTAssertFalse((try? vault.stageCleanupPending(loser)) == true)
    }

    // fail closed for partial or corrupt cleanup proof state
    func testCleanupPendingCorruptionRemainsUnverifiable() throws {
        let cleanup = SecureStore()
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { true },
            cleanupStore: cleanup,
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 7, count: 32) }
        )
        XCTAssertTrue(try vault.stageCleanupPending("auth0|private-rider"))
        cleanup.values["cleanup-proof"] = Data([1, 2, 3])
        let corruptValues = cleanup.values

        XCTAssertEqual(
            try vault.checkCleanupPending("auth0|private-rider"),
            AutomaticCleanupPendingCheck(matches: false, pending: true, valid: false)
        )
        XCTAssertFalse(try vault.clearCleanupPending("auth0|private-rider"))
        XCTAssertFalse(try vault.stageCleanupPending("auth0|private-rider"))
        XCTAssertEqual(cleanup.values, corruptValues)

        let keyLossStore = SecureStore()
        let keyLossVault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { true },
            cleanupStore: keyLossStore,
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 8, count: 32) }
        )
        XCTAssertTrue(try keyLossVault.stageCleanupPending("auth0|private-rider"))
        keyLossStore.values.removeValue(forKey: "cleanup-key")
        let keyLossValues = keyLossStore.values
        XCTAssertFalse(try keyLossVault.stageCleanupPending("auth0|private-rider"))
        XCTAssertEqual(keyLossStore.values, keyLossValues)
    }

    // invalidate corrupt ownership and every new enrollment transaction
    func testCorruptSubjectBindingFailsClosedAndBootstrapClearsIt() throws {
        let secure = SecureStore()
        let sentinel = SentinelStore()
        let nonce = Data(repeating: 3, count: 32)
        sentinel.value = nonce
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        try vault.storeCredential(credential(nonce: nonce))
        secure.values["subject-binding"] = Data([1, 2, 3])

        XCTAssertEqual(
            try vault.checkSubject("auth0|private-rider"),
            AutomaticSubjectBindingCheck(bound: true, matches: false)
        )
        _ = try vault.beginEnrollmentBootstrap()
        XCTAssertEqual(
            try vault.checkSubject("auth0|private-rider"),
            AutomaticSubjectBindingCheck(bound: false, matches: false)
        )
    }

    // scope every decoded bearer to one wipeable reference lease
    func testCredentialLeaseRemovesAllAccessAfterWipe() throws {
        let secure = SecureStore()
        let sentinel = SentinelStore()
        let nonce = Data(repeating: 3, count: 32)
        sentinel.value = nonce
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        try vault.storeCredential(credential(nonce: nonce))
        var wiped = false
        // run the bounded callback
        let lease = try XCTUnwrap(vault.loadCredentialLease { wiped = true })

        XCTAssertNotNil(lease.endpointURL(.candidates))
        XCTAssertNotNil(lease.expiryMetadata())
        lease.wipe()
        XCTAssertTrue(wiped)
        XCTAssertNil(lease.endpointUrls())
        XCTAssertNil(lease.expiryMetadata())
        // run the bounded callback
        XCTAssertNil(lease.withBearerBytes { $0.count })
    }

    // reject credential installation without a prior bootstrap
    func testMissingBootstrapCannotSupplyCredentialBinding() {
        let sentinel = SentinelStore()
        sentinel.value = Data(repeating: 3, count: 32)
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )

        // run the bounded callback
        XCTAssertThrowsError(try vault.consumeEnrollmentBootstrapNonce()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .credentialUnavailable)
        }
    }

    // reject bootstrap creation without an installation sentinel
    func testMissingSentinelCannotBeginBootstrap() {
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { true }
        )

        // run the bounded callback
        XCTAssertThrowsError(try vault.beginEnrollmentBootstrap()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .credentialUnavailable)
        }
    }

    // reject a bootstrap marker from another installation
    func testMismatchedBootstrapSentinelCannotBindCredential() throws {
        let sentinel = SentinelStore()
        sentinel.value = Data(repeating: 3, count: 32)
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        var bootstrap = try vault.beginEnrollmentBootstrap()
        // release protected state
        defer {
            // wipe the test bootstrap copy
            bootstrap.resetBytes(in: 0..<bootstrap.count)
            bootstrap.removeAll(keepingCapacity: false)
        }
        sentinel.value = Data(repeating: 4, count: 32)

        // run the bounded callback
        XCTAssertThrowsError(try vault.consumeEnrollmentBootstrapNonce()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .credentialUnavailable)
        }
    }

    // consume one matching bootstrap exactly once
    func testMatchingBootstrapBindsOnlyItsCurrentSentinel() throws {
        let nonce = Data(repeating: 3, count: 32)
        let sentinel = SentinelStore()
        sentinel.value = nonce
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: sentinel,
            // run the bounded callback
            purgeQueue: { true }
        )
        var bootstrap = try vault.beginEnrollmentBootstrap()
        // release protected state
        defer {
            // wipe the test bootstrap copy
            bootstrap.resetBytes(in: 0..<bootstrap.count)
            bootstrap.removeAll(keepingCapacity: false)
        }

        XCTAssertEqual(bootstrap, nonce)
        var consumed = try vault.consumeEnrollmentBootstrapNonce()
        // release protected state
        defer {
            // wipe the consumed test bootstrap
            consumed.resetBytes(in: 0..<consumed.count)
            consumed.removeAll(keepingCapacity: false)
        }
        XCTAssertEqual(consumed, nonce)
        XCTAssertThrowsError(try vault.consumeEnrollmentBootstrapNonce())
    }

    // block replacement when old ciphertext cannot be purged
    func testReinstallResetFailsClosedOnQueueCleanupFailure() {
        let vault = AutomaticCredentialVault(
            secureStore: SecureStore(),
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { false },
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 8, count: 32) }
        )

        // run the bounded callback
        XCTAssertThrowsError(try vault.reconcileInstallation()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
    }
}

// define the native contract
final class AutomaticEncryptedCandidateQueueTests: XCTestCase {
    // define the native contract
    private enum Failure: Error {
        case injectedMoveFailure
        case injectedEnumerationFailure
        case injectedDeleteFailure
    }

    // define the native contract
    private final class CleanupFailureLatchStore: AutomaticCleanupFailureLatchStoring {
        var latched = false

        // report the shared test latch
        func isLatched() -> Bool {
            latched
        }

        // persist the shared test latch
        func latch() -> Bool {
            latched = true
            return true
        }

        // clear the shared test latch
        func clear() -> Bool {
            latched = false
            return true
        }
    }

    private var directoryURL: URL!
    private let key = SymmetricKey(data: Data(repeating: 0x5a, count: 32))
    private var recordCounter = 0
    private var cleanupFailureLatchStore: CleanupFailureLatchStore!

    // isolate one temporary protected queue
    override func setUpWithError() throws {
        directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(
            "automatic-queue-tests-\(UUID().uuidString)",
            isDirectory: true
        )
        recordCounter = 0
        cleanupFailureLatchStore = CleanupFailureLatchStore()
    }

    // remove only this test queue
    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directoryURL)
    }

    // create one actual CryptoKit queue
    private func queue(
        movePendingToCleanup: ((URL, URL) throws -> Void)? = nil,
        writeCleanupFailureMarker: ((String) -> Bool)? = nil,
        listRecordURLs: (() throws -> [URL])? = nil,
        removeRecordFile: ((URL) throws -> Void)? = nil
    ) -> AutomaticEncryptedCandidateQueue {
        AutomaticEncryptedCandidateQueue(
            directoryURL: directoryURL,
            // run the bounded callback
            keyProvider: { self.key },
            // run the bounded callback
            randomRecordKey: {
                self.recordCounter += 1
                return String(format: "00000000-0000-0000-0000-%012d", self.recordCounter)
            },
            movePendingToCleanup: movePendingToCleanup,
            cleanupFailureLatchStore: cleanupFailureLatchStore,
            writeCleanupFailureMarker: writeCleanupFailureMarker,
            listRecordURLs: listRecordURLs,
            removeRecordFile: removeRecordFile
        )
    }

    // create one valid terminal candidate
    private func candidate(
        id: String = "AAAAAAAAAAAAAAAAAAAAAA",
        capturedAtMs: UInt64 = 1_000,
        terminalId: String = "7"
    ) -> AutomaticCheckinCandidateV1 {
        .terminal(
            common: .init(
                accuracyMillimeters: 1_000,
                candidateId: id,
                capturedAtMs: capturedAtMs,
                latitudeE7: 475_000_000,
                longitudeE7: -1_225_000_000
            ),
            terminalId: terminalId,
            configGeneration: 3
        )
    }

    // prove random-nonce ciphertext never contains plaintext fields
    func testAEADQueueUsesUniqueCiphertextWithoutPlaintext() throws {
        let queue = queue()
        _ = try queue.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 5
        )
        _ = try queue.enqueue(
            candidate(id: "AAECAwQFBgcICQoLDA0ODw"),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 5
        )
        let files = try FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: [.isExcludedFromBackupKey],
            options: []
        // run the bounded callback
        ).filter { $0.pathExtension == "pending" }
        XCTAssertEqual(files.count, 2)
        let first = try Data(contentsOf: files[0])
        let second = try Data(contentsOf: files[1])
        XCTAssertNotEqual(first, second)
        XCTAssertNil(first.range(of: Data("terminalId".utf8)))
        XCTAssertNil(first.range(of: Data("AAAAAAAAAAAAAAAAAAAAAA".utf8)))

        // require no-backup on every final record
        for file in files {
            XCTAssertEqual(try file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        }
    }

    // reject and remove authenticated ciphertext tampering
    func testTamperRejectConvergesToNoPendingCiphertext() throws {
        let queue = queue()
        _ = try queue.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 5
        )
        let file = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: nil
            // run the bounded callback
            ).first { $0.pathExtension == "pending" }
        )
        var bytes = try Data(contentsOf: file)
        bytes[bytes.index(before: bytes.endIndex)] ^= 0xff
        try bytes.write(to: file)

        // run the bounded callback
        XCTAssertThrowsError(try queue.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .queueAuthenticationFailed)
        }
        XCTAssertEqual(queue.pendingCount(), 0)
    }

    // delete oldest-expiring ciphertext first on overflow
    func testCapacityOverflowDeletesOldestExpiringFirst() throws {
        let queue = queue()
        _ = try queue.enqueue(
            candidate(capturedAtMs: 1_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        _ = try queue.enqueue(
            candidate(id: "AAECAwQFBgcICQoLDA0ODw", capturedAtMs: 2_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        _ = try queue.enqueue(
            candidate(id: "EBESExQVFhcYGRobHB0eHw", capturedAtMs: 3_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        let records = try queue.loadPending()
        // release protected state
        defer {
            // wipe every decrypted test record
            for record in records {
                record.wipe()
            }
        }
        // run the bounded callback
        let times = records.compactMap { record -> UInt64? in
            // require one decrypted test candidate
            guard let candidate = record.candidate else {
                return nil
            }

            // project terminal capture time
            switch candidate {
            case let .terminal(common, _, _), let .vessel(common, _, _):
                return common.capturedAtMs
            }
        }.sorted()
        XCTAssertEqual(times, [2_000, 3_000])
    }

    // reject an older incoming overflow like android
    func testCapacityOverflowRejectsOlderIncomingWithoutEviction() throws {
        let queue = queue()
        _ = try queue.enqueue(
            candidate(capturedAtMs: 2_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        _ = try queue.enqueue(
            candidate(id: "AAECAwQFBgcICQoLDA0ODw", capturedAtMs: 3_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )

        XCTAssertThrowsError(
            try queue.enqueue(
                candidate(id: "EBESExQVFhcYGRobHB0eHw", capturedAtMs: 500),
                localWorkGeneration: LocalWorkGeneration(value: 1),
                maximumCount: 2
            )
        // run the bounded callback
        ) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .queueOverflowRejected)
        }
        let records = try queue.loadPending()
        // release protected state
        defer {
            // wipe every retained overflow record
            for record in records {
                record.wipe()
            }
        }
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(queue.pendingCount(), 2)
    }

    // tombstone overflow eviction before any fallible deletion
    func testOverflowDeleteFailureConvergesDeletionOnlyAfterProcessReplacement() throws {
        var deletionFails = false
        // run the bounded callback
        let first = queue(removeRecordFile: { url in
            // fail only the finalized overflow deletion
            if deletionFails && url.pathExtension == AutomaticQueueRecordState.cleanupRequired.rawValue {
                throw Failure.injectedDeleteFailure
            }
            try FileManager.default.removeItem(at: url)
        })
        _ = try first.enqueue(
            candidate(capturedAtMs: 1_000),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 1
        )
        deletionFails = true

        XCTAssertThrowsError(
            try first.enqueue(
                candidate(id: "AAECAwQFBgcICQoLDA0ODw", capturedAtMs: 2_000),
                localWorkGeneration: LocalWorkGeneration(value: 1),
                maximumCount: 1
            )
        // run the bounded callback
        ) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(first.hasCleanupRequired())
        XCTAssertEqual(first.pendingCount(), 0)
        // run the bounded callback
        XCTAssertThrowsError(try first.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }

        // expose no uploadable record before replacement cleanup
        let replacement = queue()
        XCTAssertTrue(replacement.hasCleanupRequired())
        // run the bounded callback
        XCTAssertThrowsError(try replacement.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(replacement.retryCleanup())
        XCTAssertFalse(replacement.hasCleanupRequired())
        XCTAssertEqual(replacement.pendingCount(), 0)
        XCTAssertTrue(try replacement.loadPending().isEmpty)
    }

    // refuse new plaintext work while cleanup-only state exists
    func testCleanupRequiredBlocksCaptureUntilDeletionConverges() throws {
        let queue = queue()
        let recordKey = try queue.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        XCTAssertTrue(queue.markCleanupRequired(recordKey: recordKey))
        XCTAssertTrue(queue.hasCleanupRequired())
        XCTAssertThrowsError(
            try queue.enqueue(
                candidate(id: "AAECAwQFBgcICQoLDA0ODw"),
                localWorkGeneration: LocalWorkGeneration(value: 1),
                maximumCount: 2
            )
        // run the bounded callback
        ) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(queue.retryCleanup())
        XCTAssertFalse(queue.hasCleanupRequired())
        XCTAssertEqual(queue.pendingCount(), 0)
    }

    // preserve a final deletion tombstone across process replacement
    func testCleanupTombstoneBlocksRelaunchUploadAndConvergesDeletionOnly() throws {
        let first = queue()
        let recordKey = try first.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        XCTAssertTrue(first.markCleanupRequired(recordKey: recordKey))
        let cleanupFile = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: nil
            // run the bounded callback
            ).first { $0.pathExtension == "cleanup" }
        )
        XCTAssertGreaterThan(try Data(contentsOf: cleanupFile).count, 1)
        let replacement = queue()

        XCTAssertTrue(replacement.hasCleanupRequired())
        // run the bounded callback
        XCTAssertThrowsError(try replacement.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(replacement.retryCleanup())
        XCTAssertFalse(replacement.hasCleanupRequired())
        XCTAssertEqual(replacement.pendingCount(), 0)
    }

    // persist a fail-closed latch when the atomic rename fails
    func testCleanupRenameFailureBlocksRelaunchAndRetriesDeletionOnly() throws {
        // run the bounded callback
        let first = queue { _, _ in
            throw Failure.injectedMoveFailure
        }
        let recordKey = try first.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )

        XCTAssertFalse(first.delete(recordKey: recordKey))
        XCTAssertTrue(first.hasCleanupRequired())
        let replacement = queue()
        XCTAssertTrue(replacement.hasCleanupRequired())
        // run the bounded callback
        XCTAssertThrowsError(try replacement.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(replacement.retryCleanup())
        XCTAssertEqual(replacement.pendingCount(), 0)
        XCTAssertFalse(replacement.hasCleanupRequired())
    }

    // preserve a keychain latch when both file operations fail
    func testCleanupRenameAndMarkerFailureUsesGlobalRelaunchLatch() throws {
        let first = queue(
            // run the bounded callback
            movePendingToCleanup: { _, _ in
                throw Failure.injectedMoveFailure
            },
            // run the bounded callback
            writeCleanupFailureMarker: { _ in false }
        )
        let recordKey = try first.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )

        XCTAssertFalse(first.delete(recordKey: recordKey))
        XCTAssertTrue(cleanupFailureLatchStore.latched)
        let replacement = queue()
        XCTAssertTrue(replacement.hasCleanupRequired())
        // run the bounded callback
        XCTAssertThrowsError(try replacement.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(replacement.retryCleanup())
        XCTAssertEqual(replacement.pendingCount(), 0)
        XCTAssertFalse(replacement.hasCleanupRequired())
        XCTAssertFalse(cleanupFailureLatchStore.latched)
    }

    // fail closed when ciphertext enumeration becomes unreadable
    func testEnumerationFailureLatchesCleanupAcrossProcessReplacement() throws {
        var enumerationFails = false
        // run the bounded callback
        let first = queue(listRecordURLs: {
            // inject one directory-read failure after persistence
            if enumerationFails {
                throw Failure.injectedEnumerationFailure
            }
            return try FileManager.default.contentsOfDirectory(
                at: self.directoryURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
        })
        _ = try first.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )
        enumerationFails = true

        XCTAssertTrue(first.hasCleanupRequired())
        XCTAssertFalse(first.retryCleanup())
        XCTAssertTrue(cleanupFailureLatchStore.latched)

        // require readable zero-file convergence after relaunch
        let replacement = queue()
        XCTAssertTrue(replacement.hasCleanupRequired())
        // run the bounded callback
        XCTAssertThrowsError(try replacement.loadPending()) { error in
            XCTAssertEqual(error as? AutomaticSecureRuntimeError, .cleanupRequired)
        }
        XCTAssertTrue(replacement.retryCleanup())
        XCTAssertEqual(replacement.pendingCount(), 0)
        XCTAssertFalse(replacement.hasCleanupRequired())
        XCTAssertFalse(cleanupFailureLatchStore.latched)
    }

    // preserve queued ciphertext while invalidating bar-off callbacks
    func testBackgroundHoldRebindsCiphertextToNewGeneration() throws {
        let first = queue()
        _ = try first.enqueue(
            candidate(),
            localWorkGeneration: LocalWorkGeneration(value: 1),
            maximumCount: 2
        )

        XCTAssertTrue(first.adoptPendingGeneration(LocalWorkGeneration(value: 2)))
        let replacement = queue()
        let records = try replacement.loadPending()
        // release protected state
        defer {
            // wipe every rebound test record
            for record in records {
                record.wipe()
            }
        }
        XCTAssertEqual(records.map(\.localWorkGeneration), [LocalWorkGeneration(value: 2)])
    }

    // create no plaintext or ciphertext when first-unlock key access fails
    func testFirstUnlockKeyFailureCreatesNoQueueRecord() {
        let blockedQueue = AutomaticEncryptedCandidateQueue(
            directoryURL: directoryURL,
            // run the bounded callback
            keyProvider: {
                throw AutomaticSecureRuntimeError.blockedBeforeFirstUnlock
            },
            cleanupFailureLatchStore: cleanupFailureLatchStore
        )

        XCTAssertThrowsError(
            try blockedQueue.enqueue(
                candidate(),
                localWorkGeneration: LocalWorkGeneration(value: 1),
                maximumCount: 5
            )
        )
        XCTAssertEqual(blockedQueue.pendingCount(), 0)
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil
        )) ?? []
        XCTAssertTrue(files.isEmpty)
    }
}

// define the native contract
final class AutomaticCheckinUploaderTests: XCTestCase {
    // define the native contract
    private final class Queue: AutomaticCandidateQueueing {
        var candidates: [(String, AutomaticCheckinCandidateV1, LocalWorkGeneration)] = []
        var deleteSucceeds = true
        var cleanupRequired = false
        var purgeCount = 0
        var decryptedWipeCount = 0

        // append one fake candidate
        func enqueue(
            _ candidate: AutomaticCheckinCandidateV1,
            localWorkGeneration: LocalWorkGeneration,
            maximumCount _: Int
        ) throws -> String {
            let key = "record-\(candidates.count)"
            candidates.append((key, candidate, localWorkGeneration))
            return key
        }

        // expose fresh decrypted fake records
        func loadPending() throws -> [AutomaticDecryptedCandidate] {
            // run the bounded callback
            candidates.map { key, candidate, generation in
                AutomaticDecryptedCandidate(
                    recordKey: key,
                    candidate: candidate,
                    localWorkGeneration: generation,
                    plaintext: Data("plaintext".utf8),
                    // run the bounded callback
                    didWipe: { self.decryptedWipeCount += 1 }
                )
            }
        }

        // delete one fake final record
        func delete(recordKey: String) -> Bool {
            // preserve one injected delete failure
            guard deleteSucceeds else {
                cleanupRequired = true
                return false
            }
            // run the bounded callback
            candidates.removeAll { $0.0 == recordKey }
            return true
        }

        // latch one fake cleanup record
        func markCleanupRequired(recordKey _: String) -> Bool {
            cleanupRequired = true
            return true
        }

        // converge fake cleanup deletion
        func retryCleanup() -> Bool {
            // branch on the current state
            guard cleanupRequired else {
                return true
            }
            // preserve one injected cleanup failure
            guard deleteSucceeds else {
                return false
            }
            cleanupRequired = false
            candidates.removeAll()
            return true
        }

        // rebind fake retained work to one generation
        func adoptPendingGeneration(_ generation: LocalWorkGeneration) -> Bool {
            // run the bounded callback
            candidates = candidates.map { key, candidate, _ in
                (key, candidate, generation)
            }
            return true
        }

        // purge every fake record
        func purge() -> Bool {
            purgeCount += 1
            candidates.removeAll()
            cleanupRequired = false
            return true
        }

        // count fake pending work
        func pendingCount() -> Int {
            candidates.count
        }

        // report fake cleanup state
        func hasCleanupRequired() -> Bool {
            cleanupRequired
        }
    }

    // define the native contract
    private final class Transport: AutomaticCandidateTransporting {
        var results: [Result<AutomaticCandidateTransportResponse, Error>] = []
        var bodies: [Data] = []
        var cancelCount = 0
        var delayResponses = false
        var delayedCompletions: [() -> Void] = []
        var onUpload: (() -> Void)?
        var sensitiveOwnershipActive = false
        var deliverAfterReturn = false
        var retainBodySnapshots = true

        // return one queued deterministic response
        func upload(
            body: Data,
            credentialLease _: AutomaticCredentialLease,
            localWorkGeneration _: LocalWorkGeneration,
            completion: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
        ) {
            sensitiveOwnershipActive = true

            // retain bodies only for explicit request-shape tests
            if retainBodySnapshots {
                bodies.append(body)
            }
            let result = results.removeFirst()
            onUpload?()

            // hold one response behind a deterministic barrier
            if delayResponses {
                delayedCompletions.append {
                    self.sensitiveOwnershipActive = false
                    completion(result)
                }
                return
            }
            sensitiveOwnershipActive = false

            // model production handoff after transport scope release
            if deliverAfterReturn {
                // run the bounded callback
                DispatchQueue.main.async {
                    completion(result)
                }
                return
            }
            completion(result)
        }

        // release one deterministic transport response
        func completeNext() {
            delayedCompletions.removeFirst()()
        }

        // record fake cancellation
        func cancelAll() {
            cancelCount += 1
        }
    }

    // define the native contract
    private final class Policy: AutomaticUploaderPolicyReconciling {
        var generation = LocalWorkGeneration(value: 1)
        var responses: [AutomaticCheckinUploadResponse] = []
        var outcomes: [String] = []
        var onObserve: (() -> Void)?
        private let lock = NSRecursiveLock()

        // compare one fake callback generation
        func isCurrent(_ generation: LocalWorkGeneration) -> Bool {
            lock.lock()
            // release protected state
            defer { lock.unlock() }
            return generation == self.generation
        }

        // serialize one fake generation-bound mutation
        func mutateIfCurrent(
            _ generation: LocalWorkGeneration,
            mutation: () -> Void
        ) -> Bool {
            lock.lock()
            // release protected state
            defer { lock.unlock() }
            // reject one stale fake generation
            guard generation == self.generation else {
                return false
            }
            mutation()
            return true
        }

        // record one current fake policy observation
        func observeCandidateResponse(
            _ response: AutomaticCheckinUploadResponse,
            ifCurrent generation: LocalWorkGeneration
        ) -> Bool {
            // reject one stale fake response
            guard isCurrent(generation) else {
                return false
            }
            onObserve?()
            responses.append(response)
            outcomes.append(response.outcome)
            return true
        }

        // record one fake aggregate outcome
        func recordOutcome(_ outcome: String) {
            outcomes.append(outcome)
        }
    }

    // define the native contract
    private final class Effects: AutomaticCreditedEffectEmitting {
        var count = 0
        var onEmit: (() -> Void)?

        // record one generic credited effect
        func emitCredited() {
            onEmit?()
            count += 1
        }
    }

    // define the native contract
    private enum Failure: Error {
        case disconnected
    }

    private var monotonicMs: Int64 = 1_000
    private var wallMs: Int64 = 10_000
    private var credentialExpiresAtMs: Int64 = 2_000_000_000_000
    private var boot = "boot-a"
    private var queue: Queue!
    private var transport: Transport!
    private var policy: Policy!
    private var effects: Effects!
    private var clock: AutomaticTrustedClock!
    private var uploader: AutomaticCheckinUploader!

    // assemble one deterministic uploader
    override func setUp() {
        queue = Queue()
        transport = Transport()
        policy = Policy()
        effects = Effects()
        clock = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { self.wallMs },
            // run the bounded callback
            monotonicClockMs: { self.monotonicMs },
            // run the bounded callback
            bootIdentity: { self.boot }
        )
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000))
        uploader = AutomaticCheckinUploader(
            queue: queue,
            transport: transport,
            endpointValidator: AutomaticNativeEndpointValidator(expectedOrigin: "https://ferry.fyi"),
            trustedClock: clock,
            // run the bounded callback
            credentialProvider: { AutomaticCredentialLease(self.credential()) },
            policy: policy,
            effects: effects
        )
    }

    // create one valid credential
    private func credential() -> AutomaticNativeCredential {
        AutomaticNativeCredential(
            bearerToken: Data("token".utf8),
            enrollmentId: "enrollment",
            expiresAtMs: credentialExpiresAtMs,
            installationNonce: Data(repeating: 1, count: 32),
            rotateAfterMs: max(1, credentialExpiresAtMs - 1),
            serverPolicyGeneration: 1,
            urls: AutomaticNativeCredentialUrls(
                candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
                config: "https://ferry.fyi/api/leaderboards/native/config",
                enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment",
                status: "https://ferry.fyi/api/leaderboards/native/status"
            )
        )
    }

    // create one terminal lane candidate
    private func candidate(
        id: String = "AAAAAAAAAAAAAAAAAAAAAA",
        terminalId: String = "7",
        capturedAtMs: UInt64 = 1_720_000_000_000
    ) -> AutomaticCheckinCandidateV1 {
        .terminal(
            common: .init(
                accuracyMillimeters: 1_000,
                candidateId: id,
                capturedAtMs: capturedAtMs,
                latitudeE7: 475_000_000,
                longitudeE7: -1_225_000_000
            ),
            terminalId: terminalId,
            configGeneration: 1
        )
    }

    // create one fixed strict response
    private func response(
        outcome: String,
        disposition: String,
        credited: Bool = false,
        generation: Int? = 2,
        statusCode: Int? = nil,
        resolvedURL: String = "https://ferry.fyi/api/leaderboards/native/candidates",
        wasRedirected: Bool = false,
        didWipe: (() -> Void)? = nil
    ) -> Result<AutomaticCandidateTransportResponse, Error> {
        let policyValue: Any

        // encode value versus explicit null
        if let generation {
            policyValue = generation
        // branch on the current state
        } else {
            policyValue = NSNull()
        }
        var value: [String: Any] = [
            "credited": credited,
            "disposition": disposition,
            "outcome": outcome,
            "schemaVersion": 1,
            "serverPolicyGeneration": policyValue,
        ]

        // encode explicit null policy generation
        if generation == nil {
            value["serverPolicyGeneration"] = NSNull()
        }

        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        let resolvedStatusCode = statusCode ?? (credited ? 201 : 200)
        return .success(AutomaticCandidateTransportResponse(
            data: data,
            requestedURL: "https://ferry.fyi/api/leaderboards/native/candidates",
            resolvedURL: resolvedURL,
            statusCode: resolvedStatusCode,
            wasRedirected: wasRedirected,
            didWipe: didWipe
        ))
    }

    // wait for one synchronous fake wake
    private func wake() {
        let expectation = expectation(description: "wake")
        uploader.wake(localWorkGeneration: policy.generation) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)
    }

    // delete credited ciphertext before the sole generic effect
    func testFinalCreditedDeletesBeforeSingleEffect() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [response(outcome: "credited", disposition: "final", credited: true)]

        wake()

        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(effects.count, 1)
        XCTAssertEqual(policy.outcomes, ["credited"])
    }

    // wipe and release sensitive owners before aggregate and ui exposure
    func testFinalCreditedWipesSensitiveWorkBeforeOutcomeAndEffect() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        var responseWiped = false
        var credentialWiped = false
        var requestWiped = false
        var candidateWipedBeforeTransport = false
        var opaqueEntityKey: String?
        var outcomeObserved = false
        var effectObserved = false
        transport.results = [
            response(
                outcome: "credited",
                disposition: "final",
                credited: true,
                // run the bounded callback
                didWipe: { responseWiped = true }
            ),
        ]
        uploader = AutomaticCheckinUploader(
            queue: queue,
            transport: transport,
            endpointValidator: AutomaticNativeEndpointValidator(expectedOrigin: "https://ferry.fyi"),
            trustedClock: clock,
            // run the bounded callback
            credentialProvider: {
                AutomaticCredentialLease(self.credential()) {
                    credentialWiped = true
                }
            },
            policy: policy,
            effects: effects,
            // run the bounded callback
            didWipeRequest: { requestWiped = true },
            // run the bounded callback
            didDeriveEntityKey: { opaqueEntityKey = $0 }
        )
        transport.deliverAfterReturn = true
        transport.retainBodySnapshots = false
        // run the bounded callback
        transport.onUpload = {
            XCTAssertGreaterThan(self.queue.decryptedWipeCount, 0)
            candidateWipedBeforeTransport = true
        }

        // assert the aggregate boundary is post-wipe and post-transport
        policy.onObserve = {
            XCTAssertTrue(responseWiped)
            XCTAssertTrue(credentialWiped)
            XCTAssertTrue(requestWiped)
            XCTAssertGreaterThan(self.queue.decryptedWipeCount, 0)
            XCTAssertFalse(self.transport.sensitiveOwnershipActive)
            XCTAssertTrue(self.transport.bodies.isEmpty)
            XCTAssertTrue(candidateWipedBeforeTransport)
            XCTAssertEqual(opaqueEntityKey?.count, 43)
            XCTAssertFalse(opaqueEntityKey?.contains(":") == true)
            XCTAssertNotEqual(opaqueEntityKey, "terminal:7")
            outcomeObserved = true
        }
        // assert the generic effect is post-outcome and post-wipe
        effects.onEmit = {
            XCTAssertTrue(responseWiped)
            XCTAssertTrue(credentialWiped)
            XCTAssertTrue(requestWiped)
            XCTAssertGreaterThan(self.queue.decryptedWipeCount, 0)
            XCTAssertFalse(self.transport.sensitiveOwnershipActive)
            XCTAssertTrue(outcomeObserved)
            XCTAssertEqual(opaqueEntityKey?.count, 43)
            XCTAssertFalse(opaqueEntityKey?.contains(":") == true)
            effectObserved = true
        }

        wake()

        XCTAssertTrue(outcomeObserved)
        XCTAssertTrue(effectObserved)
        XCTAssertEqual(queue.pendingCount(), 0)
    }

    // delete every final denial including a valid 409 conflict
    func testFinal409ConflictDeletesWithoutCreditEffect() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [
            response(
                outcome: "candidate_conflict",
                disposition: "final",
                statusCode: 409
            ),
        ]

        wake()

        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(effects.count, 0)
        XCTAssertEqual(policy.outcomes, ["candidate_conflict"])
    }

    // accept one exact null-generation authentication final
    func testAuthenticationFinalDeletesBeforeIdentityPolicyPurge() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [
            response(
                outcome: "authentication_failed",
                disposition: "final",
                generation: nil,
                statusCode: 401
            ),
        ]

        wake()

        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(policy.responses.map(\.outcome), ["authentication_failed"])
        XCTAssertEqual(policy.outcomes, ["authentication_failed"])
        XCTAssertEqual(effects.count, 0)
    }

    // purge identity for a locked post-auth removal race
    func testDisclosedAuthenticationFinalDeletesBeforeIdentityPolicyPurge() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [
            response(
                outcome: "authentication_failed",
                disposition: "final",
                generation: 7,
                statusCode: 401
            ),
        ]

        wake()

        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(policy.responses.map(\.outcome), ["authentication_failed"])
        XCTAssertEqual(policy.responses.first?.serverPolicyGeneration, 7)
        XCTAssertEqual(policy.outcomes, ["authentication_failed"])
        XCTAssertEqual(effects.count, 0)
    }

    // retain exact ciphertext on response loss before atomic deletion
    func testResponseLossRetainsCandidateForPayloadBoundReplay() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [.failure(Failure.disconnected)]

        wake()

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertTrue(policy.outcomes.isEmpty)
    }

    // retain ciphertext and identity on pre-auth service ambiguity
    func testNullGenerationServiceOutageRetainsCandidateAndIdentity() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [
            response(
                outcome: "temporarily_unavailable",
                disposition: "retryable",
                generation: nil,
                statusCode: 503
            ),
        ]

        wake()

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertEqual(policy.responses.map(\.outcome), ["temporarily_unavailable"])
        XCTAssertNil(policy.responses.first?.serverPolicyGeneration)
        XCTAssertEqual(policy.outcomes, ["temporarily_unavailable"])
    }

    // reject redirected responses without deleting authenticated ciphertext
    func testRedirectResponseIsRejectedAndCandidateRetained() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [
            response(
                outcome: "credited",
                disposition: "final",
                credited: true,
                resolvedURL: "https://evil.example/api/leaderboards/native/candidates",
                wasRedirected: true
            ),
        ]

        wake()

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertTrue(policy.outcomes.isEmpty)
    }

    // wipe response buffers even when validation rejects them
    func testRejectedResponseBufferIsAlwaysWiped() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        var wiped = false
        transport.results = [
            response(
                outcome: "credited",
                disposition: "final",
                credited: true,
                resolvedURL: "https://evil.example/api/leaderboards/native/candidates",
                wasRedirected: true,
                // run the bounded callback
                didWipe: { wiped = true }
            ),
        ]

        wake()

        XCTAssertTrue(wiped)
        XCTAssertEqual(queue.pendingCount(), 1)
    }

    // wipe the loaded bearer after a transport failure
    func testUploaderAlwaysReleasesCredentialLease() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        var credentialWiped = false
        uploader = AutomaticCheckinUploader(
            queue: queue,
            transport: transport,
            endpointValidator: AutomaticNativeEndpointValidator(expectedOrigin: "https://ferry.fyi"),
            trustedClock: clock,
            // run the bounded callback
            credentialProvider: {
                AutomaticCredentialLease(self.credential()) {
                    credentialWiped = true
                }
            },
            policy: policy,
            effects: effects
        )
        transport.results = [.failure(Failure.disconnected)]

        wake()

        XCTAssertTrue(credentialWiped)
        XCTAssertEqual(queue.pendingCount(), 1)
    }

    // latch cleanup when a final delete fails and emit no duplicate credit ui
    func testDeleteFailureEntersCleanupRequiredWithoutEffect() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        queue.deleteSucceeds = false
        transport.results = [response(outcome: "credited", disposition: "final", credited: true)]

        wake()

        XCTAssertTrue(queue.cleanupRequired)
        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertEqual(policy.outcomes, ["cleanup_required"])

        queue.deleteSucceeds = true
        wake()
        XCTAssertFalse(queue.cleanupRequired)
        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(effects.count, 0)
    }

    // let a retryable terminal head block only its own entity lane
    func testRetryableHeadDoesNotBlockIndependentTerminalProgress() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        _ = try queue.enqueue(
            candidate(id: "AAECAwQFBgcICQoLDA0ODw", terminalId: "8"),
            localWorkGeneration: policy.generation,
            maximumCount: 5
        )
        transport.results = [
            response(outcome: "history_warming", disposition: "retryable"),
            response(outcome: "outside_terminal", disposition: "final"),
        ]

        wake()

        XCTAssertEqual(transport.bodies.count, 2)
        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(policy.outcomes, ["history_warming", "outside_terminal"])
    }

    // stop a wake globally after one fixed rate-limit envelope
    func testRateLimitedResponseDoesNotIssueMoreRequests() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        _ = try queue.enqueue(
            candidate(id: "AAECAwQFBgcICQoLDA0ODw", terminalId: "8"),
            localWorkGeneration: policy.generation,
            maximumCount: 5
        )
        transport.results = [
            response(
                outcome: "rate_limited",
                disposition: "retryable",
                generation: nil,
                statusCode: 429
            ),
        ]

        wake()

        XCTAssertEqual(transport.bodies.count, 1)
        XCTAssertEqual(queue.pendingCount(), 2)
        XCTAssertEqual(policy.outcomes, ["rate_limited"])
    }

    // delete locally expired ciphertext without transport
    func testExactExpiryDeletesWithoutUpload() throws {
        _ = try queue.enqueue(
            candidate(capturedAtMs: 1_720_000_000_000),
            localWorkGeneration: policy.generation,
            maximumCount: 5
        )
        monotonicMs += automaticCandidateRetentionMs
        wallMs += automaticCandidateRetentionMs

        wake()

        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertTrue(transport.bodies.isEmpty)
    }

    // block selection when local discard deletion fails
    func testLocalDiscardDeleteFailureRequiresCleanupBeforeMoreWork() throws {
        let scenarios: [(name: String, staleGeneration: Bool)] = [
            (name: "obsolete-generation", staleGeneration: true),
            (name: "exact-expiry", staleGeneration: false),
        ]

        // verify both local discard paths
        for scenario in scenarios {
            let scenarioQueue = Queue()
            let scenarioTransport = Transport()
            let scenarioPolicy = Policy()
            let scenarioEffects = Effects()
            var scenarioMonotonicMs: Int64 = 1_000
            var scenarioWallMs: Int64 = 10_000
            let scenarioClock = AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { scenarioWallMs },
                // run the bounded callback
                monotonicClockMs: { scenarioMonotonicMs },
                // run the bounded callback
                bootIdentity: { "boot-a" }
            )
            XCTAssertTrue(
                scenarioClock.refreshAnchor(serverTimeMs: 1_720_000_000_000),
                scenario.name
            )
            let discardedGeneration = scenario.staleGeneration
                ? LocalWorkGeneration(value: 0)
                : scenarioPolicy.generation
            _ = try scenarioQueue.enqueue(
                candidate(),
                localWorkGeneration: discardedGeneration,
                maximumCount: 5
            )

            // keep one current record behind the stale deletion
            if scenario.staleGeneration {
                _ = try scenarioQueue.enqueue(
                    candidate(id: "AAECAwQFBgcICQoLDA0ODw", terminalId: "8"),
                    localWorkGeneration: scenarioPolicy.generation,
                    maximumCount: 5
                )
            // branch on the current state
            } else {
                scenarioMonotonicMs += automaticCandidateRetentionMs
                scenarioWallMs += automaticCandidateRetentionMs
            }
            scenarioQueue.deleteSucceeds = false
            let scenarioUploader = AutomaticCheckinUploader(
                queue: scenarioQueue,
                transport: scenarioTransport,
                endpointValidator: AutomaticNativeEndpointValidator(
                    expectedOrigin: "https://ferry.fyi"
                ),
                trustedClock: scenarioClock,
                // run the bounded callback
                credentialProvider: { AutomaticCredentialLease(self.credential()) },
                policy: scenarioPolicy,
                effects: scenarioEffects
            )
            let firstWake = expectation(description: "\(scenario.name)-blocked")
            scenarioUploader.wake(localWorkGeneration: scenarioPolicy.generation) {
                firstWake.fulfill()
            }
            wait(for: [firstWake], timeout: 1)

            XCTAssertTrue(scenarioTransport.bodies.isEmpty, scenario.name)
            XCTAssertTrue(scenarioQueue.cleanupRequired, scenario.name)
            XCTAssertEqual(scenarioPolicy.outcomes, ["cleanup_required"], scenario.name)

            // converge deletion-only without later network work
            scenarioQueue.deleteSucceeds = true
            let cleanupWake = expectation(description: "\(scenario.name)-cleanup")
            scenarioUploader.wake(localWorkGeneration: scenarioPolicy.generation) {
                cleanupWake.fulfill()
            }
            wait(for: [cleanupWake], timeout: 1)
            XCTAssertEqual(scenarioQueue.pendingCount(), 0, scenario.name)
            XCTAssertTrue(scenarioTransport.bodies.isEmpty, scenario.name)
            XCTAssertFalse(scenarioQueue.cleanupRequired, scenario.name)
        }
    }

    // stop and purge at the exact trusted credential expiry boundary
    func testCredentialExpiryStopsWithoutAnyUpload() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        credentialExpiresAtMs = 1_720_000_000_000
        var credentialWiped = false
        uploader = AutomaticCheckinUploader(
            queue: queue,
            transport: transport,
            endpointValidator: AutomaticNativeEndpointValidator(expectedOrigin: "https://ferry.fyi"),
            trustedClock: clock,
            // run the bounded callback
            credentialProvider: {
                AutomaticCredentialLease(self.credential()) {
                    credentialWiped = true
                }
            },
            policy: policy,
            effects: effects
        )

        wake()

        XCTAssertTrue(transport.bodies.isEmpty)
        XCTAssertEqual(policy.responses.map(\.outcome), ["enrollment_expired"])
        XCTAssertEqual(policy.outcomes, ["enrollment_expired"])
        XCTAssertTrue(credentialWiped)
    }

    // block all upload after reboot until a fresh server anchor
    func testRebootBlocksUploadWithoutSameBootAnchor() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        boot = "boot-b"
        monotonicMs = 1

        wake()

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertTrue(transport.bodies.isEmpty)
    }

    // ignore an in-flight response from an invalidated generation
    func testOldGenerationResponseCannotDeleteOrNotify() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [response(outcome: "credited", disposition: "final", credited: true)]
        policy.generation = LocalWorkGeneration(value: 2)

        let expectation = expectation(description: "old wake")
        uploader.wake(localWorkGeneration: LocalWorkGeneration(value: 1)) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertTrue(transport.bodies.isEmpty)
    }

    // reject a stop that wins after upload but before final mutation
    func testStopAfterUploadBeforeFinalMutationRetainsNoStaleEffect() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [response(outcome: "credited", disposition: "final", credited: true)]
        transport.delayResponses = true
        let uploaded = expectation(description: "uploaded")
        // run the bounded callback
        transport.onUpload = { uploaded.fulfill() }
        let completed = expectation(description: "completed")

        uploader.wake(localWorkGeneration: policy.generation) {
            completed.fulfill()
        }
        wait(for: [uploaded], timeout: 1)
        policy.generation = LocalWorkGeneration(value: 2)
        transport.completeNext()
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(queue.pendingCount(), 1)
        XCTAssertEqual(effects.count, 0)
        XCTAssertTrue(policy.outcomes.isEmpty)
    }

    // serialize overlapping wakes around one durable final transition
    func testConcurrentWakesUploadDeleteAndNotifyExactlyOnce() throws {
        _ = try queue.enqueue(candidate(), localWorkGeneration: policy.generation, maximumCount: 5)
        transport.results = [response(outcome: "credited", disposition: "final", credited: true)]
        transport.delayResponses = true
        let uploaded = expectation(description: "uploaded")
        // run the bounded callback
        transport.onUpload = { uploaded.fulfill() }
        let completed = expectation(description: "completed")
        completed.expectedFulfillmentCount = 2

        // race two zero-data wakes
        DispatchQueue.concurrentPerform(iterations: 2) { _ in
            uploader.wake(localWorkGeneration: policy.generation) {
                completed.fulfill()
            }
        }
        wait(for: [uploaded], timeout: 1)
        XCTAssertEqual(transport.bodies.count, 1)
        transport.completeNext()
        wait(for: [completed], timeout: 1)

        XCTAssertEqual(transport.bodies.count, 1)
        XCTAssertEqual(queue.pendingCount(), 0)
        XCTAssertEqual(effects.count, 1)
    }
}

// define the native contract
final class AutomaticSecureRuntimeCoordinatorTests: XCTestCase {
    // define the native contract
    private final class GenerationStore: AutomaticLocalGenerationStoring {
        var value: Int64?
        var failReads = false
        var failWrites = false

        // load one fake protected generation
        func load() throws -> Int64? {
            // inject one protected-data read failure
            if failReads {
                throw AutomaticSecureRuntimeError.blockedBeforeFirstUnlock
            }
            value
        }

        // persist or fail one fake protected generation
        func store(_ value: Int64) throws {
            // inject one persistence failure
            if failWrites {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }
            self.value = value
        }
    }

    // define the native contract
    private final class Queue: AutomaticCandidateQueueing {
        var purgeCount = 0
        var purgeSucceeds = true

        // reject unused fake capture
        func enqueue(
            _: AutomaticCheckinCandidateV1,
            localWorkGeneration _: LocalWorkGeneration,
            maximumCount _: Int
        ) throws -> String {
            "unused"
        }

        // expose no fake candidates
        func loadPending() throws -> [AutomaticDecryptedCandidate] {
            []
        }

        // accept fake delete
        func delete(recordKey _: String) -> Bool {
            true
        }

        // accept fake cleanup latch
        func markCleanupRequired(recordKey _: String) -> Bool {
            true
        }

        // accept fake cleanup recovery
        func retryCleanup() -> Bool {
            true
        }

        // accept fake retained generation replacement
        func adoptPendingGeneration(_: LocalWorkGeneration) -> Bool {
            true
        }

        // record one full purge
        func purge() -> Bool {
            purgeCount += 1
            return purgeSucceeds
        }

        // report zero pending
        func pendingCount() -> Int {
            0
        }

        // report no cleanup latch
        func hasCleanupRequired() -> Bool {
            false
        }
    }

    // define the native contract
    private final class StopAuthorityStore: AutomaticPendingStopAuthorityStoring {
        var authority: AutomaticPendingStopAuthority?
        var failRemoval = false

        // load one fake pending stop
        func load() throws -> AutomaticPendingStopAuthority? {
            authority
        }

        // persist one fake pending stop
        func store(_ authority: AutomaticPendingStopAuthority) throws {
            self.authority = authority
        }

        // remove one fake pending stop
        func remove() throws {
            // inject one durable cleanup failure
            if failRemoval {
                throw AutomaticSecureRuntimeError.cleanupRequired
            }
            authority = nil
        }
    }

    // define the native contract
    private final class SecureStore: AutomaticSecureValueStoring {
        var removeAllCount = 0

        // return no fake value
        func read(account _: String) throws -> Data? {
            nil
        }

        // accept fake write
        func write(_: Data, account _: String) throws {}

        // accept fake remove
        func remove(account _: String) throws {}

        // record identity secret deletion
        func removeAll() throws {
            removeAllCount += 1
        }
    }

    // define the native contract
    private final class SentinelStore: AutomaticInstallationSentinelStoring {
        // return one stable sentinel
        func load() throws -> Data? {
            Data(repeating: 1, count: 32)
        }

        // accept fake replacement
        func store(_: Data) throws {}
    }

    // define the native contract
    private final class Transport: AutomaticCandidateTransporting {
        var cancelCount = 0

        // reject unused fake upload
        func upload(
            body _: Data,
            credentialLease _: AutomaticCredentialLease,
            localWorkGeneration _: LocalWorkGeneration,
            completion _: @escaping (Result<AutomaticCandidateTransportResponse, Error>) -> Void
        ) {}

        // record request cancellation
        func cancelAll() {
            cancelCount += 1
        }
    }

    // define the native contract
    private final class Regions: AutomaticRegionRuntimeControlling {
        var stopCount = 0
        var invalidateCount = 0
        var onStop: (() -> Void)?

        // record region teardown
        func stopAll() {
            stopCount += 1
            onStop?()
        }

        // record config invalidation
        func invalidateConfiguration() {
            invalidateCount += 1
        }
    }

    private var queue: Queue!
    private var secure: SecureStore!
    private var transport: Transport!
    private var regions: Regions!
    private var coordinator: AutomaticSecureRuntimeCoordinator!

    // assemble one deterministic stop coordinator
    override func setUp() {
        queue = Queue()
        secure = SecureStore()
        transport = Transport()
        regions = Regions()
        let vault = AutomaticCredentialVault(
            secureStore: secure,
            sentinelStore: SentinelStore(),
            // run the bounded callback
            purgeQueue: { true },
            // run the bounded callback
            randomBytes: { _ in Data(repeating: 2, count: 32) }
        )
        coordinator = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: vault,
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions
        )
    }

    // every known trigger invalidates callbacks, regions, requests, config, and queue
    func testEveryStopTriggerAdvancesOnlyLocalGenerationAndPurges() {
        var expectedGeneration = Int64(0)

        // exercise the exhaustive approved trigger set
        for trigger in AutomaticRuntimeStopTrigger.allCases {
            expectedGeneration += 1
            coordinator.stop(trigger: trigger)
            XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: expectedGeneration))
            XCTAssertEqual(queue.purgeCount, Int(expectedGeneration))
            XCTAssertEqual(transport.cancelCount, Int(expectedGeneration))
            XCTAssertEqual(regions.stopCount, Int(expectedGeneration))
            XCTAssertEqual(regions.invalidateCount, Int(expectedGeneration))
            XCTAssertEqual(
                coordinator.bridgePolicyState().lastOutcome,
                trigger.aggregateOutcome
            )
        }

        XCTAssertEqual(
            secure.removeAllCount,
            AutomaticRuntimeStopTrigger.allCases.filter(\.removesIdentity).count
        )
    }

    // mirror the reviewed controllable server-revocation set
    func testOnlyControllableIdentityStopsRequestServerRevoke() {
        let expected: Set<AutomaticRuntimeStopTrigger> = [
            .accountDeletion, .enrollmentRevoked, .identityLost,
            .localDisable, .profileOptOut,
        ]

        XCTAssertEqual(
            Set(AutomaticRuntimeStopTrigger.allCases.filter(\.requestsServerRevoke)),
            expected
        )
    }

    // reject policy rollback without changing local work generation
    func testServerPolicyGenerationCannotRollbackOrAdvanceLocalGeneration() {
        XCTAssertTrue(coordinator.observePolicyGeneration(8))
        XCTAssertFalse(coordinator.observePolicyGeneration(7))
        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 0))
        XCTAssertEqual(queue.purgeCount, 0)
    }

    // replace enrollment only after advancing the protected local generation
    func testEnrollmentReplacementInvalidatesOldCallbacksBeforeInstall() {
        let oldGeneration = coordinator.generation()

        XCTAssertTrue(coordinator.replaceEnrollment(serverPolicyGeneration: 8))

        XCTAssertFalse(coordinator.isCurrent(oldGeneration))
        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 1))
        XCTAssertEqual(queue.purgeCount, 1)
        XCTAssertEqual(secure.removeAllCount, 1)
        XCTAssertNil(coordinator.lastOutcome)
        XCTAssertFalse(coordinator.replaceEnrollment(serverPolicyGeneration: 7))
        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 1))
    }

    // do not infer remote kill from an offline wake
    func testOfflineWakeDoesNotPurgeOrAdvanceGeneration() {
        coordinator.noteOfflineWake()

        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 0))
        XCTAssertEqual(queue.purgeCount, 0)
        XCTAssertEqual(coordinator.lastOutcome, "temporarily_unavailable")
    }

    // stop exactly once when authoritative status learns a kill
    func testAuthoritativeStatusKillPurgesAndInvalidates() {
        coordinator.reconcileStatus(
            serverPolicyGeneration: 9,
            automaticEnabled: false,
            credentialExpired: false
        )

        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 1))
        XCTAssertEqual(queue.purgeCount, 1)
        XCTAssertEqual(coordinator.lastOutcome, "policy_disabled")
    }

    // reject contradictory policy at one immutable generation
    func testSamePolicyGenerationCannotMutateEnabledState() {
        coordinator.reconcileStatus(
            serverPolicyGeneration: 9,
            automaticEnabled: true,
            credentialExpired: false
        )
        coordinator.reconcileStatus(
            serverPolicyGeneration: 9,
            automaticEnabled: false,
            credentialExpired: false
        )
        XCTAssertEqual(queue.purgeCount, 0)

        coordinator.reconcileStatus(
            serverPolicyGeneration: 10,
            automaticEnabled: false,
            credentialExpired: false
        )
        XCTAssertEqual(queue.purgeCount, 1)
    }

    // stop on authenticated final candidate denial but not retryable response
    func testCandidateDenialIsAuthoritativeOnlyWhenFinal() {
        coordinator.observeCandidateResponse(AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .retryable,
            outcome: "temporarily_unavailable",
            retryAfterSeconds: 1,
            serverPolicyGeneration: 10
        ))
        XCTAssertEqual(queue.purgeCount, 0)

        coordinator.observeCandidateResponse(AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .final,
            outcome: "enrollment_revoked",
            retryAfterSeconds: nil,
            serverPolicyGeneration: 11
        ))
        XCTAssertEqual(queue.purgeCount, 1)
        XCTAssertEqual(secure.removeAllCount, 1)
    }

    // purge all identity state after an unknown bearer denial
    func testAuthenticationFailureFinalPurgesCredentialAndRemainingQueue() {
        coordinator.observeCandidateResponse(AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .final,
            outcome: "authentication_failed",
            retryAfterSeconds: nil,
            serverPolicyGeneration: nil
        ))

        XCTAssertEqual(queue.purgeCount, 1)
        XCTAssertEqual(secure.removeAllCount, 1)
        XCTAssertEqual(coordinator.lastOutcome, "authentication_failed")
    }

    // retain stop authority across final deletion and stop-effect failure
    func testStopBearingFinalReplaysAfterDeleteFailureAndProcessReplacement() {
        let generationStore = GenerationStore()
        let authorityStore = StopAuthorityStore()
        queue.purgeSucceeds = false
        let first = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            generationStore: generationStore,
            stopAuthorityStore: authorityStore
        )
        let generation = first.generation()
        let response = AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .final,
            outcome: "enrollment_revoked",
            retryAfterSeconds: nil,
            serverPolicyGeneration: 11
        )

        XCTAssertFalse(first.commitFinalCandidateResponse(
            response,
            ifCurrent: generation,
            // run the bounded callback
            deleteCiphertext: { false }
        ))
        XCTAssertNotNil(authorityStore.authority)
        XCTAssertEqual(first.lastOutcome, "cleanup_required")

        queue.purgeSucceeds = true
        let replacement = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            generationStore: generationStore,
            stopAuthorityStore: authorityStore
        )

        XCTAssertTrue(replacement.recoverPendingStop())
        XCTAssertNil(authorityStore.authority)
        XCTAssertEqual(replacement.lastOutcome, "enrollment_revoked")
        XCTAssertGreaterThanOrEqual(secure.removeAllCount, 2)
    }

    // hide a stop final until its exact candidate deletion converges
    func testStopBearingFinalDeleteFailureCannotExposeOutcomeAfterBroadPurge() {
        let authorityStore = StopAuthorityStore()
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            stopAuthorityStore: authorityStore
        )
        let response = AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .final,
            outcome: "enrollment_revoked",
            retryAfterSeconds: nil,
            serverPolicyGeneration: 11
        )

        XCTAssertFalse(runtime.commitFinalCandidateResponse(
            response,
            ifCurrent: runtime.generation(),
            // run the bounded callback
            deleteCiphertext: { false }
        ))
        XCTAssertEqual(runtime.lastOutcome, "cleanup_required")
        XCTAssertNotNil(authorityStore.authority)
        XCTAssertEqual(queue.purgeCount, 1)

        // expose the fixed final only after deletion-only replay
        XCTAssertTrue(runtime.recoverPendingStop())
        XCTAssertEqual(runtime.lastOutcome, "enrollment_revoked")
        XCTAssertNil(authorityStore.authority)
    }

    // retain cleanup state while authority removal is unavailable
    func testStopEffectsStayCleanupRequiredUntilAuthorityRemovalSucceeds() {
        let authorityStore = StopAuthorityStore()
        authorityStore.failRemoval = true
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            stopAuthorityStore: authorityStore
        )

        XCTAssertFalse(runtime.stop(trigger: .parentPolicyKilled))
        XCTAssertEqual(runtime.lastOutcome, "cleanup_required")
        XCTAssertNotNil(authorityStore.authority)
        authorityStore.failRemoval = false
        XCTAssertTrue(runtime.recoverPendingStop())
        XCTAssertEqual(runtime.lastOutcome, "policy_disabled")
    }

    // retain stop authority when protected cache invalidation fails
    func testCacheInvalidationFailureKeepsCleanupRequiredAcrossRetry() {
        let authorityStore = StopAuthorityStore()
        var cacheInvalidates = false
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            stopAuthorityStore: authorityStore,
            // run the bounded callback
            invalidateProtectedCache: { cacheInvalidates }
        )

        XCTAssertFalse(runtime.stop(trigger: .detectorDenied))
        XCTAssertNotNil(authorityStore.authority)
        XCTAssertEqual(runtime.lastOutcome, "cleanup_required")
        cacheInvalidates = true
        XCTAssertTrue(runtime.recoverPendingStop())
        XCTAssertNil(authorityStore.authority)
        XCTAssertEqual(runtime.lastOutcome, "detector_disabled")
    }

    // release generation lock before main-thread region teardown
    func testCandidateStopCannotInvertBackgroundAndMainLocks() {
        let oldGeneration = coordinator.generation()
        let mainReached = expectation(description: "main reached")
        let completed = expectation(description: "completed")
        // run the bounded callback
        regions.onStop = {
            // run the bounded callback
            DispatchQueue.main.sync {
                XCTAssertFalse(self.coordinator.isCurrent(oldGeneration))
                mainReached.fulfill()
            }
        }

        // deliver one final denial from a urlsession-like callback
        DispatchQueue.global().async {
            _ = self.coordinator.observeCandidateResponse(
                AutomaticCheckinUploadResponse(
                    credited: false,
                    disposition: .final,
                    outcome: "authentication_failed",
                    retryAfterSeconds: nil,
                    serverPolicyGeneration: nil
                ),
                ifCurrent: oldGeneration
            )
            completed.fulfill()
        }
        wait(for: [mainReached, completed], timeout: 1)
    }

    // hold callbacks and network without purging queued ciphertext
    func testBackgroundRefreshHoldCancelsAndPreservesQueueUntilResume() {
        let generation = coordinator.generation()

        coordinator.holdForBackgroundRefresh()

        XCTAssertFalse(coordinator.isCurrent(generation))
        XCTAssertEqual(coordinator.generation(), LocalWorkGeneration(value: 1))
        XCTAssertEqual(transport.cancelCount, 1)
        XCTAssertEqual(queue.purgeCount, 0)
        coordinator.resumeAfterBackgroundRefresh()
        XCTAssertFalse(coordinator.isCurrent(generation))
        XCTAssertTrue(coordinator.isCurrent(LocalWorkGeneration(value: 1)))
    }

    // preserve monotonic generation across coordinator process replacement
    func testPersistedGenerationNeverAliasesOldCallbackAfterRelaunch() {
        let generationStore = GenerationStore()
        let first = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            generationStore: generationStore
        )
        let oldGeneration = first.generation()
        first.stop(trigger: .localDisable)
        let persistedGeneration = first.generation()
        let replacement = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            generationStore: generationStore
        )

        XCTAssertEqual(replacement.generation(), persistedGeneration)
        XCTAssertFalse(replacement.isCurrent(oldGeneration))
        XCTAssertTrue(replacement.isCurrent(persistedGeneration))
    }

    // fail closed when generation cannot persist before stop
    func testGenerationPersistenceFailureRejectsEveryCallback() {
        let generationStore = GenerationStore()
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            generationStore: generationStore
        )
        let before = runtime.generation()
        generationStore.failWrites = true

        runtime.stop(trigger: .profileOptOut)

        XCTAssertFalse(runtime.isCurrent(before))
        XCTAssertFalse(runtime.isCurrent(runtime.generation()))
        XCTAssertEqual(queue.purgeCount, 1)
    }

    // keep an exhausted local generation permanently fail closed
    func testGenerationExhaustionPurgesAndRejectsAllCallbacks() {
        let generationStore = GenerationStore()
        generationStore.value = Int64.max - 1
        let authorityStore = StopAuthorityStore()
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            regions: regions,
            generationStore: generationStore,
            stopAuthorityStore: authorityStore
        )

        XCTAssertFalse(runtime.stop(trigger: .localDisable))
        XCTAssertEqual(runtime.generation(), LocalWorkGeneration(value: Int64.max))
        XCTAssertFalse(runtime.isCurrent(LocalWorkGeneration(value: Int64.max)))
        XCTAssertEqual(queue.purgeCount, 1)
        XCTAssertNotNil(authorityStore.authority)
    }

    // recover a protected generation only after first unlock
    func testFirstUnlockRecoversInitializationReadWithoutGenerationAlias() {
        let generationStore = GenerationStore()
        generationStore.value = 9
        generationStore.failReads = true
        let runtime = AutomaticSecureRuntimeCoordinator(
            queue: queue,
            vault: AutomaticCredentialVault(
                secureStore: secure,
                sentinelStore: SentinelStore(),
                // run the bounded callback
                purgeQueue: { true }
            ),
            trustedClock: AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs: { 1_000 },
                // run the bounded callback
                monotonicClockMs: { 1_000 },
                // run the bounded callback
                bootIdentity: { "boot" }
            ),
            transport: transport,
            generationStore: generationStore
        )
        let blockedGeneration = runtime.generation()
        XCTAssertFalse(runtime.isCurrent(blockedGeneration))
        generationStore.failReads = false

        XCTAssertTrue(runtime.recoverGenerationPersistence())
        XCTAssertEqual(runtime.generation(), LocalWorkGeneration(value: 9))
        XCTAssertTrue(runtime.isCurrent(LocalWorkGeneration(value: 9)))
        XCTAssertFalse(runtime.isCurrent(blockedGeneration))
    }
}

// define the native contract
final class AutomaticIOSRegionRuntimeTests: XCTestCase {
    // define the native contract
    private final class LocationManager: AutomaticIOSLocationManaging {
        var delegate: CLLocationManagerDelegate?
        var authorizationStatus: CLAuthorizationStatus = .authorizedAlways
        var accuracyAuthorization: CLAccuracyAuthorization = .fullAccuracy
        var maximumRegionMonitoringDistance: CLLocationDistance = 1_000
        var monitoredRegions = Set<CLRegion>()
        var started: [CLRegion] = []
        var stopped: [CLRegion] = []
        var requestCount = 0

        // record one attempted registration
        func startMonitoring(for region: CLRegion) {
            started.append(region)
        }

        // record one exact unregistration
        func stopMonitoring(for region: CLRegion) {
            stopped.append(region)
            monitoredRegions.remove(region)
        }

        // record one bounded location request
        func requestLocation() {
            requestCount += 1
        }

        // accept one location cancellation
        func stopUpdatingLocation() {}
    }

    // define the native contract
    private final class Delegate: AutomaticIOSRegionManagerDelegate {
        var accepted = true
        var committed: [(AutomaticNativeRuntimeConfig, LocalWorkGeneration)] = []
        var candidates: [(AutomaticCheckinCandidateV1, LocalWorkGeneration)] = []
        var stops: [AutomaticRuntimeStopTrigger] = []
        var cleanupWakeCount = 0

        // accept or reject one exact atomic config commit
        func regionManager(
            _: AutomaticIOSRegionManager,
            shouldCommit config: AutomaticNativeRuntimeConfig,
            localWorkGeneration: LocalWorkGeneration
        ) -> Bool {
            committed.append((config, localWorkGeneration))
            return accepted
        }

        // record one deletion-only cleanup wake
        func regionManagerNeedsCleanupWake(
            _: AutomaticIOSRegionManager,
            localWorkGeneration _: LocalWorkGeneration
        ) {
            cleanupWakeCount += 1
        }

        // record one created candidate
        func regionManager(
            _: AutomaticIOSRegionManager,
            created candidate: AutomaticCheckinCandidateV1,
            localWorkGeneration: LocalWorkGeneration
        ) {
            candidates.append((candidate, localWorkGeneration))
        }

        // record one known stop
        func regionManager(
            _: AutomaticIOSRegionManager,
            stoppedFor trigger: AutomaticRuntimeStopTrigger
        ) {
            stops.append(trigger)
        }
    }

    private var localGeneration = LocalWorkGeneration(value: 3)
    private var protectedDataAvailable = true
    private var backgroundRefreshAvailable = true
    private var captureAvailable = true
    private var location: LocationManager!
    private var delegate: Delegate!
    private var manager: AutomaticIOSRegionManager!

    // assemble one deterministic production region wrapper
    override func setUp() {
        location = LocationManager()
        delegate = Delegate()
        let clock = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { 10_000 },
            // run the bounded callback
            monotonicClockMs: { 1_000 },
            // run the bounded callback
            bootIdentity: { "boot" }
        )
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000))
        manager = AutomaticIOSRegionManager(
            locationManager: location,
            // run the bounded callback
            protectedDataAvailable: { self.protectedDataAvailable },
            // run the bounded callback
            backgroundRefreshAvailable: { self.backgroundRefreshAvailable },
            trustedClock: clock,
            // run the bounded callback
            localGeneration: { self.localGeneration },
            // run the bounded callback
            captureAvailable: { self.captureAvailable },
            // run the bounded callback
            monitoringAvailable: { true },
            // run the bounded callback
            randomCandidateId: { "AAAAAAAAAAAAAAAAAAAAAA" }
        )
        manager.delegate = delegate
    }

    // create one immutable production config
    private func config(_ generation: Int64) -> AutomaticNativeRuntimeConfig {
        let configGeneration = ConfigGeneration(value: generation)
        let regions = [AutomaticTerminalRegion(
            terminalId: "7",
            latitudeE7: 475_000_000,
            longitudeE7: -1_225_000_000,
            radiusMillimeters: 100_000,
            configGeneration: configGeneration
        )]
        return AutomaticNativeRuntimeConfig(
            generation: AutomaticTerminalConfigGeneration(
                schemaVersion: 1,
                configGeneration: configGeneration,
                serverPolicyGeneration: ServerPolicyGeneration(value: generation),
                contentHashHex: AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions)
                ),
                regions: regions
            ),
            serverTimeMs: 1_720_000_000_000 + generation,
            generatedAtMs: 1_720_000_000_000,
            terminalEnabled: true,
            vesselEnabled: false,
            parameters: AutomaticNativeRuntimeParameters(
                candidateRetentionMs: automaticCandidateRetentionMs,
                fleetContextMaxAgeMs: 120_000,
                futureToleranceMs: 30_000,
                maxLocationAccuracyMillimeters: 50_000,
                maxPendingCandidates: 32
            ),
            urls: AutomaticNativeEndpointUrls(
                config: "https://ferry.fyi/api/leaderboards/native/config",
                status: "https://ferry.fyi/api/leaderboards/native/status",
                candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
                enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment"
            )
        )
    }

    // confirm the latest complete attempted registration
    private func confirmLatest() throws -> CLRegion {
        let region = try XCTUnwrap(location.started.last)
        location.monitoredRegions.insert(region)
        manager.locationManager(CLLocationManager(), didStartMonitoringFor: region)
        return region
    }

    // bind region identifiers and callbacks to local generation
    func testRegionIdentifierRejectsLateCallbackAfterSameConfigReactivation() throws {
        let config = config(7)
        XCTAssertTrue(manager.activate(config))
        let oldRegion = try confirmLatest()
        XCTAssertTrue(oldRegion.identifier.contains(":3:7:"))
        XCTAssertEqual(manager.health, .healthy)

        manager.stopAll()
        manager.invalidateConfiguration()
        localGeneration = LocalWorkGeneration(value: 4)
        XCTAssertTrue(manager.activate(config))
        let currentRegion = try confirmLatest()
        XCTAssertTrue(currentRegion.identifier.contains(":4:7:"))

        manager.locationManager(CLLocationManager(), didEnterRegion: oldRegion)
        XCTAssertEqual(location.requestCount, 0)
        manager.locationManager(CLLocationManager(), didEnterRegion: currentRegion)
        XCTAssertEqual(location.requestCount, 1)
    }

    // restore the exact prior config and local generation after async failure
    func testFailedReplacementRestoresPriorGenerationAtomically() throws {
        XCTAssertTrue(manager.activate(config(7)))
        let oldRegion = try confirmLatest()
        localGeneration = LocalWorkGeneration(value: 4)
        XCTAssertTrue(manager.activate(config(8)))
        let failed = try XCTUnwrap(location.started.last)

        manager.locationManager(
            CLLocationManager(),
            monitoringDidFailFor: failed,
            withError: AutomaticSecureRuntimeError.invalidConfiguration
        )
        let restored = try XCTUnwrap(location.started.last)
        XCTAssertEqual(restored.identifier, oldRegion.identifier)
        _ = try confirmLatest()
        XCTAssertEqual(manager.configGeneration(), 7)
        XCTAssertEqual(delegate.committed.last?.1, LocalWorkGeneration(value: 3))
    }

    // roll back regions when protected cache commit rejects the new generation
    func testCacheCommitFailureCannotExposeNewRegionsAsHealthy() throws {
        XCTAssertTrue(manager.activate(config(7)))
        let oldRegion = try confirmLatest()
        localGeneration = LocalWorkGeneration(value: 4)
        delegate.accepted = false
        XCTAssertTrue(manager.activate(config(8)))
        _ = try confirmLatest()
        XCTAssertNotEqual(manager.health, .healthy)
        let restored = try XCTUnwrap(location.started.last)
        XCTAssertEqual(restored.identifier, oldRegion.identifier)

        delegate.accepted = true
        _ = try confirmLatest()
        XCTAssertEqual(manager.health, .healthy)
        XCTAssertEqual(manager.configGeneration(), 7)
    }

    // stop an abandoned owned late start without touching unrelated regions
    func testLateStartAfterRollbackStopsOnlyExactOwnedRegion() throws {
        XCTAssertTrue(manager.activate(config(7)))
        _ = try confirmLatest()
        localGeneration = LocalWorkGeneration(value: 4)
        XCTAssertTrue(manager.activate(config(8)))
        let failed = try XCTUnwrap(location.started.last)
        manager.locationManager(
            CLLocationManager(),
            monitoringDidFailFor: failed,
            withError: AutomaticSecureRuntimeError.invalidConfiguration
        )

        manager.locationManager(CLLocationManager(), didStartMonitoringFor: failed)
        XCTAssertTrue(location.stopped.contains { $0.identifier == failed.identifier })
    }

    // reject health when the platform owns an extra abandoned region
    func testExactMonitoredSetIsRequiredBeforeHealthyCommit() throws {
        XCTAssertTrue(manager.activate(config(7)))
        let attempted = try XCTUnwrap(location.started.last)
        let extra = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 47.6, longitude: -122.6),
            radius: 100,
            identifier: "ferry-fyi-auto:1:1:ZXh0cmE"
        )
        location.monitoredRegions.insert(attempted)
        location.monitoredRegions.insert(extra)

        manager.locationManager(CLLocationManager(), didStartMonitoringFor: attempted)

        XCTAssertEqual(manager.health, .registrationFailed)
        XCTAssertEqual(delegate.stops, [.geofenceUnavailable])
        XCTAssertTrue(location.stopped.contains { $0.identifier == extra.identifier })
    }

    // recover every transient platform gate into needs-config state
    func testRecoveredPlatformGatesDoNotStaySticky() {
        backgroundRefreshAvailable = false
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .backgroundRefreshOff)
        backgroundRefreshAvailable = true
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .needsConfig)

        protectedDataAvailable = false
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .firstUnlockRequired)
        protectedDataAvailable = true
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .needsConfig)

        location.authorizationStatus = .denied
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .permissionDenied)
        location.authorizationStatus = .authorizedAlways
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .needsConfig)

        location.accuracyAuthorization = .reducedAccuracy
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .reducedAccuracy)
        location.accuracyAuthorization = .fullAccuracy
        manager.reconcilePlatformState()
        XCTAssertEqual(manager.health, .needsConfig)
    }

    // issue cleanup-only wake before requesting a location fix
    func testCleanupLatchSkipsLocationAndCandidateCapture() throws {
        XCTAssertTrue(manager.activate(config(7)))
        let region = try confirmLatest()
        captureAvailable = false

        manager.locationManager(CLLocationManager(), didEnterRegion: region)

        XCTAssertEqual(location.requestCount, 0)
        XCTAssertEqual(delegate.cleanupWakeCount, 1)
        XCTAssertTrue(delegate.candidates.isEmpty)
    }
}

// define the native contract
final class AutomaticProtectedRuntimeCacheStoreTests: XCTestCase {
    // define the native contract
    private enum Failure: Error {
        case injectedRemovalFailure
    }

    private var directoryURL: URL!

    // isolate one protected runtime cache directory
    override func setUp() {
        directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(
            "automatic-ios-runtime-cache-\(UUID().uuidString)",
            isDirectory: true
        )
    }

    // remove only this protected cache fixture
    override func tearDown() {
        try? FileManager.default.removeItem(at: directoryURL)
    }

    // prevent stale cache restoration after durable invalidation
    func testInvalidationMarkerBlocksStaleRestoreUntilFreshAtomicStore() throws {
        let fileURL = directoryURL.appendingPathComponent("runtime-cache.v1")
        let store = AutomaticProtectedRuntimeCacheStore(fileURL: fileURL)
        let first = Data("first-config".utf8)
        let second = Data("second-config".utf8)
        let anchor = TrustedTimeAnchor(
            bootIdentity: "boot",
            monotonicTimeMs: 1_000,
            serverTimeMs: 1_720_000_000_000,
            wallTimeMs: 1_800_000_000_000
        )

        XCTAssertTrue(store.store(configData: first, anchor: anchor))
        XCTAssertEqual(store.load()?.0, first)
        XCTAssertTrue(store.invalidate())
        XCTAssertNil(store.load())
        XCTAssertTrue(store.store(configData: second, anchor: anchor))
        XCTAssertEqual(store.load()?.0, second)
    }

    // fail closed on corrupt protected cache bytes
    func testCorruptProtectedCacheNeverRestores() throws {
        let fileURL = directoryURL.appendingPathComponent("runtime-cache.v1")
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
        try Data("corrupt".utf8).write(to: fileURL)

        XCTAssertNil(AutomaticProtectedRuntimeCacheStore(fileURL: fileURL).load())
    }

    // keep stale bytes hidden when physical removal needs a later retry
    func testInvalidationRemovalFailureStillBlocksRestore() throws {
        let fileURL = directoryURL.appendingPathComponent("runtime-cache.v1")
        let anchor = TrustedTimeAnchor(
            bootIdentity: "boot",
            monotonicTimeMs: 1_000,
            serverTimeMs: 1_720_000_000_000,
            wallTimeMs: 1_800_000_000_000
        )
        let initial = AutomaticProtectedRuntimeCacheStore(fileURL: fileURL)
        XCTAssertTrue(initial.store(configData: Data("stale".utf8), anchor: anchor))
        let failing = AutomaticProtectedRuntimeCacheStore(
            fileURL: fileURL,
            // run the bounded callback
            removeItem: { url in
                // fail only stale cache removal
                if url == fileURL {
                    throw Failure.injectedRemovalFailure
                }
                try FileManager.default.removeItem(at: url)
            }
        )

        XCTAssertFalse(failing.invalidate())
        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))
        XCTAssertNil(failing.load())
    }
}

// define the native contract
final class AutomaticNativeIOSContractTests: XCTestCase {
    // build one exact bridge credential input
    private func bridgeCredential(origin: String = "https://ferry.fyi") -> [String: Any] {
        return [
            "bearerToken": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
            "enrollmentId": "00000000-0000-4000-8000-000000000001",
            "expiresAtMs": 1_800_000_000_000,
            "rotateAfterMs": 1_790_000_000_000,
            "schemaVersion": 1,
            "scopes": [
                "automatic-checkins:config:read",
                "automatic-checkins:status:read",
                "automatic-checkins:candidates:write",
                "automatic-checkins:enrollment:revoke",
            ],
            "serverPolicyGeneration": 10,
            "urls": [
                "candidates": "\(origin)/api/leaderboards/native/candidates",
                "config": "\(origin)/api/leaderboards/native/config",
                "enrollment": "\(origin)/api/leaderboards/native/enrollment",
                "status": "\(origin)/api/leaderboards/native/status",
            ],
        ]
    }

    // build one complete config json
    private func configData(
        terminalEnabled: Bool = true,
        generation: Int = 7,
        policyGeneration: Int = 11
    ) throws -> Data {
        let regions = [
            AutomaticTerminalRegion(
                terminalId: "12",
                latitudeE7: 471_000_000,
                longitudeE7: -1_221_000_000,
                radiusMillimeters: 304_800,
                configGeneration: ConfigGeneration(value: Int64(generation))
            ),
            AutomaticTerminalRegion(
                terminalId: "7",
                latitudeE7: 470_000_000,
                longitudeE7: -1_220_000_000,
                radiusMillimeters: 304_800,
                configGeneration: ConfigGeneration(value: Int64(generation))
            ),
        ]
        // run the bounded callback
        let ordered = regions.sorted { left, right in
            Data(left.terminalId.utf8).lexicographicallyPrecedes(Data(right.terminalId.utf8))
        }
        let value: [String: Any] = [
            "configGeneration": generation,
            "contentHash": AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(ordered)
            ),
            "detectors": ["terminalEnabled": terminalEnabled, "vesselEnabled": false],
            "generatedAtMs": 1_720_000_000_000,
            "parameters": [
                "candidateRetentionMs": automaticCandidateRetentionMs,
                "fleetContextMaxAgeMs": 120_000,
                "futureToleranceMs": 30_000,
                "maxLocationAccuracyMillimeters": 50_000,
                "maxPendingCandidates": 32,
            ],
            // run the bounded callback
            "regions": ordered.map { region in
                [
                    "configGeneration": generation,
                    "latitudeE7": region.latitudeE7,
                    "longitudeE7": region.longitudeE7,
                    "radiusMillimeters": region.radiusMillimeters,
                    "terminalId": region.terminalId,
                ]
            },
            "schemaVersion": 1,
            "serverPolicyGeneration": policyGeneration,
            "serverTimeMs": 1_720_000_001_000,
            "urls": [
                "candidates": "https://ferry.fyi/api/leaderboards/native/candidates",
                "config": "https://ferry.fyi/api/leaderboards/native/config",
                "enrollment": "https://ferry.fyi/api/leaderboards/native/enrollment",
                "status": "https://ferry.fyi/api/leaderboards/native/status",
            ],
        ]
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    // parse a complete hash-bound config and trusted server time
    func testParsesCompleteTrustedConfiguration() throws {
        let config = try XCTUnwrap(
            AutomaticNativeRuntimeContractParser.parseConfig(
                try configData(),
                expectedOrigin: "https://ferry.fyi"
            )
        )

        XCTAssertEqual(config.generation.configGeneration, ConfigGeneration(value: 7))
        XCTAssertEqual(config.generation.serverPolicyGeneration, ServerPolicyGeneration(value: 11))
        XCTAssertEqual(config.serverTimeMs, 1_720_000_001_000)
        XCTAssertEqual(config.generation.regions.map(\.terminalId), ["12", "7"])
        XCTAssertTrue(config.terminalEnabled)
    }

    // restore a same-boot anchor across ordinary process replacement only
    func testProtectedAnchorRestoresSameBootAndRejectsReboot() throws {
        var monotonic = Int64(1_000)
        var wall = Int64(10_000)
        var boot = "boot-a"
        let first = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { wall },
            // run the bounded callback
            monotonicClockMs: { monotonic },
            // run the bounded callback
            bootIdentity: { boot }
        )
        XCTAssertTrue(first.refreshAnchor(serverTimeMs: 1_720_000_000_000))
        let anchor = try XCTUnwrap(first.currentAnchor())
        monotonic += 5_000
        wall += 5_000
        let replacement = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { wall },
            // run the bounded callback
            monotonicClockMs: { monotonic },
            // run the bounded callback
            bootIdentity: { boot }
        )

        XCTAssertTrue(replacement.restoreAnchor(anchor))
        XCTAssertEqual(replacement.capturedAtMs(), 1_720_000_005_000)
        boot = "boot-b"
        monotonic = 10
        let rebooted = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { wall },
            // run the bounded callback
            monotonicClockMs: { monotonic },
            // run the bounded callback
            bootIdentity: { boot }
        )
        XCTAssertFalse(rebooted.restoreAnchor(anchor))
        XCTAssertNil(rebooted.capturedAtMs())
    }

    // reject an out-of-order older config after a newer serialized commit
    func testConfigCommitPolicyCannotRegressAcrossOverlappingResponses() throws {
        let generation2 = try XCTUnwrap(
            AutomaticNativeRuntimeContractParser.parseConfig(
                configData(generation: 2, policyGeneration: 12),
                expectedOrigin: "https://ferry.fyi"
            )
        )
        let generation3 = try XCTUnwrap(
            AutomaticNativeRuntimeContractParser.parseConfig(
                configData(generation: 3, policyGeneration: 13),
                expectedOrigin: "https://ferry.fyi"
            )
        )

        XCTAssertTrue(AutomaticConfigCommitPolicy.permits(
            candidate: generation3.generation,
            current: generation2.generation
        ))
        XCTAssertFalse(AutomaticConfigCommitPolicy.permits(
            candidate: generation2.generation,
            current: generation3.generation
        ))
    }

    // reject configuration origin substitution or hash mutation
    func testRejectsUntrustedOriginAndContentMutation() throws {
        let data = try configData()
        XCTAssertNil(
            AutomaticNativeRuntimeContractParser.parseConfig(
                data,
                expectedOrigin: "https://evil.example"
            )
        )
        var value = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        value["contentHash"] = String(repeating: "0", count: 64)
        XCTAssertNil(
            AutomaticNativeRuntimeContractParser.parseConfig(
                try JSONSerialization.data(withJSONObject: value),
                expectedOrigin: "https://ferry.fyi"
            )
        )
    }

    // parse exact status and reject extra detail
    func testStatusContractIsDetailFreeAndExact() throws {
        var value: [String: Any] = [
            "automaticEnabled": true,
            "credentialExpiryBucket": "seven_days_or_more",
            "rotateRecommended": false,
            "schemaVersion": 1,
            "serverPolicyGeneration": 12,
        ]
        let parsed = AutomaticNativeRuntimeContractParser.parseStatus(
            try JSONSerialization.data(withJSONObject: value)
        )
        XCTAssertEqual(parsed?.serverPolicyGeneration, 12)

        value["terminalId"] = "7"
        XCTAssertNil(
            AutomaticNativeRuntimeContractParser.parseStatus(
                try JSONSerialization.data(withJSONObject: value)
            )
        )
    }

    // mirror the exact shared aggregate status outcome vector
    func testBridgeStatusOutcomesAndKeysMatchSharedGoldenVector() {
        let expectedOutcomes: Set<String> = [
            "authentication_failed", "candidate_conflict", "cleanup_required", "credited",
            "detector_disabled", "enrollment_expired", "enrollment_revoked", "expired",
            "fleet_context_invalid", "future_timestamp", "history_unavailable", "history_warming",
            "invalid_candidate", "location_accuracy_too_low", "malformed_payload", "outside_terminal",
            "payload_too_large", "policy_disabled", "rate_limited", "sailing_already_credited",
            "stale_event", "temporarily_unavailable", "terminal_config_unavailable",
            "terminal_not_found", "too_close_to_shore", "unsupported_encoding",
            "unsupported_media_type", "unsupported_os", "vessel_not_found",
        ]
        XCTAssertEqual(AutomaticBridgeStatusContract.aggregateOutcomes, expectedOutcomes)
        let status = AutomaticBridgeStatusContract.project(
            configGeneration: 7,
            credentialExpiryBucket: "less_than_7_days",
            lastOutcome: "credited",
            monitorHealth: "healthy",
            pendingCandidateCount: 3,
            permissionHealth: "authorized",
            serverPolicyGeneration: 11
        )

        XCTAssertEqual(Set(status.keys), AutomaticBridgeStatusContract.exactKeys)
        XCTAssertEqual(status["configGeneration"] as? Int64, 7)
        XCTAssertEqual(status["credentialExpiryBucket"] as? String, "less_than_7_days")
        XCTAssertEqual(status["lastOutcome"] as? String, "credited")
        XCTAssertNil(
            AutomaticBridgeStatusContract.project(
                configGeneration: nil,
                credentialExpiryBucket: "unavailable",
                lastOutcome: "localDisable",
                monitorHealth: "stopped",
                pendingCandidateCount: 0,
                permissionHealth: "not_determined",
                serverPolicyGeneration: 0
            )["lastOutcome"] as? String
        )
    }

    // enforce the exact null-generation server response table
    func testEveryResponseOutcomeUsesTheReviewedGenerationRule() throws {
        // exercise every fixed response outcome
        for outcome in AutomaticCheckinResponseParser.outcomes {
            let retryable = AutomaticCheckinResponseParser.retryableOutcomes.contains(outcome)
            let nullOnly = AutomaticCheckinResponseParser.nullGenerationOutcomes.contains(outcome)
            let value: [String: Any] = [
                "credited": outcome == "credited",
                "disposition": retryable ? "retryable" : "final",
                "outcome": outcome,
                "schemaVersion": 1,
                "serverPolicyGeneration": nullOnly ? NSNull() : 4,
            ]
            XCTAssertNotNil(
                AutomaticCheckinResponseParser.parse(
                    try JSONSerialization.data(withJSONObject: value)
                ),
                outcome
            )
            var wrong = value

            // invert the required generation disclosure
            if outcome != "authentication_failed" && outcome != "rate_limited" &&
                outcome != "temporarily_unavailable" {
                wrong["serverPolicyGeneration"] = nullOnly ? 4 : NSNull()
                XCTAssertNil(
                    AutomaticCheckinResponseParser.parse(
                        try JSONSerialization.data(withJSONObject: wrong)
                    ),
                    outcome
                )
            }
        }

        // accept authentication failure on either side of locked recognition
        for generation: Any in [NSNull(), 4] {
            let authentication: [String: Any] = [
                "credited": false,
                "disposition": "final",
                "outcome": "authentication_failed",
                "schemaVersion": 1,
                "serverPolicyGeneration": generation,
            ]
            XCTAssertNotNil(
                AutomaticCheckinResponseParser.parse(
                    try JSONSerialization.data(withJSONObject: authentication)
                )
            )
        }

        // accept service ambiguity before or after authentication
        for generation: Any in [NSNull(), 4] {
            let unavailable: [String: Any] = [
                "credited": false,
                "disposition": "retryable",
                "outcome": "temporarily_unavailable",
                "schemaVersion": 1,
                "serverPolicyGeneration": generation,
            ]
            XCTAssertNotNil(
                AutomaticCheckinResponseParser.parse(
                    try JSONSerialization.data(withJSONObject: unavailable)
                )
            )
        }
    }

    // bind security envelopes to exact reviewed http classes
    func testCandidateHTTPStatusPolicyRejectsMismatchedClasses() {
        let authentication = AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .final,
            outcome: "authentication_failed",
            retryAfterSeconds: nil,
            serverPolicyGeneration: nil
        )
        let credited = AutomaticCheckinUploadResponse(
            credited: true,
            disposition: .final,
            outcome: "credited",
            retryAfterSeconds: nil,
            serverPolicyGeneration: 4
        )
        let unavailable = AutomaticCheckinUploadResponse(
            credited: false,
            disposition: .retryable,
            outcome: "temporarily_unavailable",
            retryAfterSeconds: nil,
            serverPolicyGeneration: 4
        )

        XCTAssertTrue(AutomaticCandidateHTTPStatusPolicy.accepts(
            statusCode: 401,
            response: authentication
        ))
        XCTAssertFalse(AutomaticCandidateHTTPStatusPolicy.accepts(
            statusCode: 200,
            response: authentication
        ))
        XCTAssertTrue(AutomaticCandidateHTTPStatusPolicy.accepts(
            statusCode: 201,
            response: credited
        ))
        XCTAssertFalse(AutomaticCandidateHTTPStatusPolicy.accepts(
            statusCode: 400,
            response: credited
        ))
        XCTAssertTrue(AutomaticCandidateHTTPStatusPolicy.accepts(
            statusCode: 503,
            response: unavailable
        ))
    }

    // accept only the compiled production origin at the bridge boundary
    func testBridgeCredentialRejectsAttackerOriginAndWrongEndpoint() throws {
        var accepted = try XCTUnwrap(
            AutomaticBridgeCredentialParser.parse(bridgeCredential())
        )
        // release protected state
        defer {
            // wipe the accepted bridge fixture
            accepted.wipe()
        }
        XCTAssertNil(
            AutomaticBridgeCredentialParser.parse(
                bridgeCredential(origin: "https://evil.example")
            )
        )
        var wrongEndpoint = bridgeCredential()
        var urls = try XCTUnwrap(wrongEndpoint["urls"] as? [String: Any])
        urls["candidates"] = "https://ferry.fyi/api/leaderboards/native/status"
        wrongEndpoint["urls"] = urls
        XCTAssertNil(AutomaticBridgeCredentialParser.parse(wrongEndpoint))
    }

    // consume the exact real server credential response shape
    func testBridgeCredentialMatchesRealServerResponseFixture() throws {
        let fixture = Data(#"{"bearerToken":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","enrollmentId":"00000000-0000-4000-8000-000000000001","expiresAtMs":1800000000000,"rotateAfterMs":1790000000000,"schemaVersion":1,"scopes":["automatic-checkins:config:read","automatic-checkins:status:read","automatic-checkins:candidates:write","automatic-checkins:enrollment:revoke"],"serverPolicyGeneration":10,"urls":{"candidates":"https://ferry.fyi/api/leaderboards/native/candidates","config":"https://ferry.fyi/api/leaderboards/native/config","enrollment":"https://ferry.fyi/api/leaderboards/native/enrollment","status":"https://ferry.fyi/api/leaderboards/native/status"}}"#.utf8)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixture) as? [String: Any]
        )
        XCTAssertEqual(Set(object.keys), [
            "bearerToken", "enrollmentId", "expiresAtMs", "rotateAfterMs", "schemaVersion",
            "scopes", "serverPolicyGeneration", "urls",
        ])
        var parsed = try XCTUnwrap(AutomaticBridgeCredentialParser.parse(object))
        // release protected state
        defer {
            // wipe the parsed real response bearer
            parsed.wipe()
        }

        XCTAssertEqual(parsed.enrollmentId, "00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(parsed.expiresAtMs, 1_800_000_000_000)
        XCTAssertEqual(parsed.rotateAfterMs, 1_790_000_000_000)
        XCTAssertEqual(parsed.serverPolicyGeneration, 10)
        XCTAssertEqual(
            parsed.bearerToken,
            Data("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc".utf8)
        )
        XCTAssertTrue(AutomaticProductionNativeEndpointPolicy.validates(
            parsed.urls.endpointUrls()
        ))
    }

    // reject extra, missing, and wrong-scope server response fields
    func testBridgeCredentialRejectsContractDriftAndWrongScope() {
        var extra = bridgeCredential()
        extra["installationNonce"] = String(repeating: "a", count: 43)
        XCTAssertNil(AutomaticBridgeCredentialParser.parse(extra))

        var missing = bridgeCredential()
        missing.removeValue(forKey: "rotateAfterMs")
        XCTAssertNil(AutomaticBridgeCredentialParser.parse(missing))

        var wrongScope = bridgeCredential()
        wrongScope["scopes"] = [
            "automatic-checkins:config:read",
            "automatic-checkins:status:read",
            "automatic-checkins:candidates:write",
            "automatic-checkins:candidates:read",
        ]
        XCTAssertNil(AutomaticBridgeCredentialParser.parse(wrongScope))

        var noncanonicalToken = bridgeCredential()
        noncanonicalToken["bearerToken"] = String(repeating: "a", count: 43)
        XCTAssertNil(AutomaticBridgeCredentialParser.parse(noncanonicalToken))
    }

    // never accept javascript or user origin configuration
    func testProductionEndpointPolicyRejectsInternallyConsistentAttackerUrls() {
        let attacker = AutomaticNativeEndpointUrls(
            config: "https://evil.example/api/leaderboards/native/config",
            status: "https://evil.example/api/leaderboards/native/status",
            candidates: "https://evil.example/api/leaderboards/native/candidates",
            enrollment: "https://evil.example/api/leaderboards/native/enrollment"
        )

        XCTAssertFalse(AutomaticProductionNativeEndpointPolicy.validates(attacker))
    }

    // enforce first-unlock, bar, permission, accuracy, and force-quit rules
    func testIOSLifecyclePolicyFailsClosed() {
        XCTAssertEqual(
            AutomaticIOSLifecyclePolicy.platformHealth(
                protectedDataAvailable: false,
                backgroundRefreshAvailable: true,
                authorizationStatus: .authorizedAlways,
                accuracyAuthorization: .fullAccuracy
            ),
            .firstUnlockRequired
        )
        XCTAssertEqual(
            AutomaticIOSLifecyclePolicy.platformHealth(
                protectedDataAvailable: true,
                backgroundRefreshAvailable: false,
                authorizationStatus: .authorizedAlways,
                accuracyAuthorization: .fullAccuracy
            ),
            .backgroundRefreshOff
        )
        XCTAssertEqual(
            AutomaticIOSLifecyclePolicy.platformHealth(
                protectedDataAvailable: true,
                backgroundRefreshAvailable: true,
                authorizationStatus: .authorizedWhenInUse,
                accuracyAuthorization: .fullAccuracy
            ),
            .permissionDenied
        )
        XCTAssertEqual(
            AutomaticIOSLifecyclePolicy.platformHealth(
                protectedDataAvailable: true,
                backgroundRefreshAvailable: true,
                authorizationStatus: .authorizedAlways,
                accuracyAuthorization: .reducedAccuracy
            ),
            .reducedAccuracy
        )
        XCTAssertNil(
            AutomaticIOSLifecyclePolicy.platformHealth(
                protectedDataAvailable: true,
                backgroundRefreshAvailable: true,
                authorizationStatus: .authorizedAlways,
                accuracyAuthorization: .fullAccuracy
            )
        )
        XCTAssertFalse(
            AutomaticIOSLifecyclePolicy.permitsPassiveReconciliation(
                forceQuitObserved: true,
                manualOpen: false
            )
        )
        XCTAssertTrue(
            AutomaticIOSLifecyclePolicy.permitsPassiveReconciliation(
                forceQuitObserved: true,
                manualOpen: true
            )
        )
    }

    // require definitive transition-consistent accuracy circles
    func testTerminalSpatialClassifierRejectsBoundaryAndOppositeState() {
        XCTAssertEqual(
            AutomaticTerminalSpatialClassifier.classify(
                distanceMillimeters: 50_000,
                accuracyMillimeters: 10_000,
                radiusMillimeters: 100_000
            ),
            .inside
        )
        XCTAssertEqual(
            AutomaticTerminalSpatialClassifier.classify(
                distanceMillimeters: 120_001,
                accuracyMillimeters: 20_000,
                radiusMillimeters: 100_000
            ),
            .outside
        )
        XCTAssertEqual(
            AutomaticTerminalSpatialClassifier.classify(
                distanceMillimeters: 90_000,
                accuracyMillimeters: 20_000,
                radiusMillimeters: 100_000
            ),
            .uncertain
        )
        XCTAssertEqual(
            AutomaticTerminalSpatialClassifier.classify(
                distanceMillimeters: 80_000,
                accuracyMillimeters: 20_000,
                radiusMillimeters: 100_000
            ),
            .uncertain
        )
        XCTAssertTrue(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .enter,
                decision: .inside
            )
        )
        XCTAssertTrue(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .exit,
                decision: .outside
            )
        )
        XCTAssertFalse(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .enter,
                decision: .outside
            )
        )
        XCTAssertFalse(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .exit,
                decision: .inside
            )
        )
        XCTAssertFalse(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .enter,
                decision: .uncertain
            )
        )
        XCTAssertFalse(
            AutomaticTerminalSpatialClassifier.permitsCandidate(
                transition: .exit,
                decision: .uncertain
            )
        )
    }

    // keep generic effect strings free of entity identity
    func testCreditedEffectsAreGenericAndBridgeEventHasNoDetailContract() {
        XCTAssertEqual(
            AutomaticCreditedEffectEmitter.notificationBody,
            "A leaderboard check-in was verified."
        )
        XCTAssertEqual(
            AutomaticCreditedEffectEmitter.notificationThread,
            "leaderboard-checkins"
        )
        XCTAssertEqual(
            AutomaticBridgeEventContract.name,
            "leaderboard-checkins-changed"
        )
        XCTAssertNil(AutomaticBridgeEventContract.detail)
        XCTAssertFalse(AutomaticCreditedEffectEmitter.notificationBody.contains("terminal"))
        XCTAssertFalse(AutomaticCreditedEffectEmitter.notificationBody.contains("vessel"))
        XCTAssertFalse(AutomaticCreditedEffectEmitter.notificationBody.contains("candidate"))
    }

    // schedule deletion-only recovery without capturing another candidate
    func testCleanupRequiredIssuesZeroDataWake() {
        XCTAssertTrue(AutomaticIOSCandidateWakePolicy.shouldWake(
            candidateStored: false,
            mutationError: .cleanupRequired
        ))
        XCTAssertTrue(AutomaticIOSCandidateWakePolicy.shouldWake(
            candidateStored: true,
            mutationError: nil
        ))
        XCTAssertFalse(AutomaticIOSCandidateWakePolicy.shouldWake(
            candidateStored: false,
            mutationError: .queueOverflowRejected
        ))
    }

    // align the exact capacitor surface across android and ios
    func testPluginUsesPlatformNeutralNameAndMethods() {
        let plugin = AutomaticLeaderboardCheckinsPlugin()

        XCTAssertEqual(plugin.jsName, "AutomaticLeaderboardCheckins")
        XCTAssertEqual(
            plugin.pluginMethods.compactMap(\.name),
            AutomaticLeaderboardCheckinsPlugin.exactMethodNames
        )
        XCTAssertEqual(AutomaticLeaderboardCheckinsPlugin.exactMethodNames, [
            "getCapability", "getEnrollmentBootstrap", "installCredential", "bindIdentity", "checkIdentity",
            "stageEnrollmentCleanup", "checkEnrollmentCleanup", "clearEnrollmentCleanup", "reconcile",
            "disableAndPurge", "getStatus", "openAutomaticCheckinSettings", "requestForegroundLocationPermission",
            "requestBackgroundLocationPermission",
        ])
    }

    // prove the explicit shared n1 debug scheme enables the test host
    func testAutomaticN1SchemeEnablesOnlyItsDebugTestHost() throws {
        // skip ordinary default-off scheme executions
        guard ProcessInfo.processInfo.environment[
            AutomaticLeaderboardIOSRuntime.debugOptInEnvironmentKey
        ] == "1" else {
            throw XCTSkip("requires Ferry FYI Automatic N1 scheme")
        }
        XCTAssertTrue(AutomaticLeaderboardIOSRuntime.isBuildEnabled)
        XCTAssertEqual(
            AutomaticLeaderboardIOSRuntime.debugOptInEnvironmentKey,
            "FERRY_FYI_AUTOMATIC_N1"
        )
    }

    // wipe the owned loaded bearer and installation binding
    func testCredentialLeaseWipesOnEveryReleasePath() throws {
        var wiped = false
        var payload = try XCTUnwrap(
            AutomaticBridgeCredentialParser.parse(bridgeCredential())
        )
        var credential = payload.bound(to: Data(repeating: 1, count: 32))
        // release protected state
        defer {
            // wipe the test-owned decoded credential
            payload.wipe()
            credential.wipe()
        }
        let lease = AutomaticCredentialLease(credential) {
            wiped = true
        }

        XCTAssertNotNil(lease.endpointUrls())
        // run the bounded callback
        XCTAssertNotNil(lease.withBearerBytes { $0.count })
        lease.wipe()
        XCTAssertNil(lease.endpointUrls())
        // run the bounded callback
        XCTAssertNil(lease.withBearerBytes { $0.count })
        XCTAssertTrue(wiped)
    }
}
