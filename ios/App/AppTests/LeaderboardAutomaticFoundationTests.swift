import XCTest
@testable import Ferry_FYI

// define the native contract
final class AutomaticPayloadDigestV1Tests: XCTestCase {
    // define the native contract
    private struct GoldenVector {
        let name: String
        let candidate: AutomaticCheckinCandidateV1
        let canonicalHex: String
        let digestHex: String
    }

    private let vectors = [
        GoldenVector(
            name: "terminal-minimum",
            candidate: .terminal(
                common: .init(
                    accuracyMillimeters: 0,
                    candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
                    capturedAtMs: 0,
                    latitudeE7: -900_000_000,
                    longitudeE7: -1_800_000_000
                ),
                terminalId: "1",
                configGeneration: 1
            ),
            canonicalHex: "01000000087465726d696e616c00000016414141414141414141414141414141414141414141410000000000000000ca5b170094b62e000000000000000001310000000000000001",
            digestHex: "c9373b5cd580e5d6aefcb7a8ab88798dd556289c33f97369a41e9eee394b186a"
        ),
        GoldenVector(
            name: "terminal-maximum-unicode",
            candidate: .terminal(
                common: .init(
                    accuracyMillimeters: 4_294_967_295,
                    candidateId: "_____________________w",
                    capturedAtMs: 9_007_199_254_740_991,
                    latitudeE7: 900_000_000,
                    longitudeE7: 1_800_000_000
                ),
                terminalId: "⛴️-船",
                configGeneration: 9_007_199_254_740_991
            ),
            canonicalHex: "01000000087465726d696e616c000000165f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f77001fffffffffffff35a4e9006b49d200ffffffff0000000ae29bb4efb88f2de888b9001fffffffffffff",
            digestHex: "faa5cf985c15127e82656c20926ab0a60ea68b075a51d5278c8dd8e422fc70ae"
        ),
        GoldenVector(
            name: "vessel-ascii",
            candidate: .vessel(
                common: .init(
                    accuracyMillimeters: 12_500,
                    candidateId: "AAECAwQFBgcICQoLDA0ODw",
                    capturedAtMs: 1_720_000_000_123,
                    latitudeE7: 473_000_001,
                    longitudeE7: -1_225_000_001
                ),
                vesselId: "144",
                sailingId: "144:1720000000"
            ),
            canonicalHex: "010000000676657373656c0000001641414543417751464267634943516f4c4441304f44770000019077fd307b1c316841b6fbfbbf000030d4000000033134340000000e3134343a31373230303030303030",
            digestHex: "4b16cb37a1988b14bfb2acf57df908b316c117d7ee15a935d0db446b05ce1220"
        ),
        GoldenVector(
            name: "vessel-unicode",
            candidate: .vessel(
                common: .init(
                    accuracyMillimeters: 250_000,
                    candidateId: "EBESExQVFhcYGRobHB0eHw",
                    capturedAtMs: 1_720_000_000_999,
                    latitudeE7: 0,
                    longitudeE7: 0
                ),
                vesselId: "船-α",
                sailingId: "航路-β:1720000000"
            ),
            canonicalHex: "010000000676657373656c0000001645424553457851564668635947526f624842306548770000019077fd33e700000000000000000003d09000000006e888b92dceb100000014e888aae8b7af2dceb23a31373230303030303030",
            digestHex: "9ce4966cbfae7b87479607fd458214a9c7d9cf0a2f421847a3e53a3117ed132f"
        ),
        GoldenVector(
            name: "vessel-ascii-accuracy-low-bit",
            candidate: .vessel(
                common: .init(
                    accuracyMillimeters: 12_501,
                    candidateId: "AAECAwQFBgcICQoLDA0ODw",
                    capturedAtMs: 1_720_000_000_123,
                    latitudeE7: 473_000_001,
                    longitudeE7: -1_225_000_001
                ),
                vesselId: "144",
                sailingId: "144:1720000000"
            ),
            canonicalHex: "010000000676657373656c0000001641414543417751464267634943516f4c4441304f44770000019077fd307b1c316841b6fbfbbf000030d5000000033134340000000e3134343a31373230303030303030",
            digestHex: "f64eb34e3f737bf182c34dc6f4979e6e8c845281a7a685e2af1fde0aa0737d91"
        ),
    ]

    // match every shared golden vector
    func testCanonicalBytesAndDigestsMatchSharedFixture() throws {
        // verify the shared fixture order and hashes
        for vector in vectors {
            XCTAssertEqual(
                AutomaticPayloadDigestV1.hex(try AutomaticPayloadDigestV1.canonicalBytes(vector.candidate)),
                vector.canonicalHex,
                vector.name
            )
            XCTAssertEqual(
                try AutomaticPayloadDigestV1.digestHex(vector.candidate),
                vector.digestHex,
                vector.name
            )
        }
    }

    // prove a one-bit semantic mutation changes the digest
    func testOneBitMutationChangesDigest() throws {
        XCTAssertNotEqual(
            try AutomaticPayloadDigestV1.digestHex(vectors[2].candidate),
            try AutomaticPayloadDigestV1.digestHex(vectors[4].candidate)
        )
    }

    // reject values outside the strict shared schema
    func testInvalidCandidateSemanticsAreRejected() {
        let invalidCandidateId = AutomaticCheckinCandidateV1.vessel(
            common: .init(
                accuracyMillimeters: 0,
                candidateId: "not-a-128-bit-id",
                capturedAtMs: 1,
                latitudeE7: 0,
                longitudeE7: 0
            ),
            vesselId: "144",
            sailingId: "144:1"
        )

        XCTAssertThrowsError(try AutomaticPayloadDigestV1.digestHex(invalidCandidateId))
    }
}

// define the native contract
final class AutomaticCandidateUploadSchedulerV1Tests: XCTestCase {
    // create one terminal candidate
    private func terminal(_ candidateId: String, _ capturedAtMs: UInt64, _ terminalId: String) -> AutomaticCheckinCandidateV1 {
        .terminal(
            common: .init(
                accuracyMillimeters: 1_000,
                candidateId: candidateId,
                capturedAtMs: capturedAtMs,
                latitudeE7: 0,
                longitudeE7: 0
            ),
            terminalId: terminalId,
            configGeneration: 1
        )
    }

    // create independent vessel work
    private func vessel(_ candidateId: String, _ capturedAtMs: UInt64) -> AutomaticCheckinCandidateV1 {
        .vessel(
            common: .init(
                accuracyMillimeters: 1_000,
                candidateId: candidateId,
                capturedAtMs: capturedAtMs,
                latitudeE7: 0,
                longitudeE7: 0
            ),
            vesselId: "1",
            sailingId: "1:\(capturedAtMs)"
        )
    }

    // select equal-time terminal work by opaque id
    func testSelectsOldestTerminalHeadByCaptureTimeAndCandidateId() {
        let oldestById = terminal("AAAAAAAAAAAAAAAAAAAAAA", 1_000, "7")
        let laterId = terminal("AAECAwQFBgcICQoLDA0ODw", 1_000, "7")
        let laterTime = terminal("EBESExQVFhcYGRobHB0eHw", 1_001, "7")

        XCTAssertEqual(
            AutomaticCandidateUploadSchedulerV1.selectHeads([laterTime, laterId, oldestById]),
            [oldestById]
        )
    }

    // keep retryable blocking local to one terminal
    func testRetryableHeadDoesNotBlockOtherTerminalOrVesselWork() {
        let retryableHead = terminal("AAAAAAAAAAAAAAAAAAAAAA", 1_000, "7")
        let vessel = vessel("AAECAwQFBgcICQoLDA0ODw", 2_000)
        let otherTerminal = terminal("EBESExQVFhcYGRobHB0eHw", 3_000, "8")
        let newerSameTerminal = terminal("_____________________w", 4_000, "7")
        let queued = [newerSameTerminal, otherTerminal, retryableHead, vessel]
        let afterRetryable = Array(queued)
        // run the bounded callback
        let afterFinal = queued.filter { candidate in
            // remove only the finalized head
            candidate != retryableHead
        }

        XCTAssertEqual(
            AutomaticCandidateUploadSchedulerV1.selectHeads(queued),
            [retryableHead, vessel, otherTerminal]
        )
        XCTAssertEqual(
            AutomaticCandidateUploadSchedulerV1.selectHeads(afterRetryable),
            [retryableHead, vessel, otherTerminal]
        )
        XCTAssertEqual(
            AutomaticCandidateUploadSchedulerV1.selectHeads(afterFinal),
            [vessel, otherTerminal, newerSameTerminal]
        )
    }
}

// define the native contract
final class AutomaticTrustedClockTests: XCTestCase {
    // define the native contract
    private struct TrustedClockVector {
        let name: String
        let bootIdentity: String
        let monotonicTimeMs: Int64
        let wallTimeMs: Int64
        let capturedAtMs: Int64?
        let expiryNowMs: Int64?
    }

    private var wallTimeMs: Int64 = 50_000
    private var monotonicTimeMs: Int64 = 10_000
    private var bootIdentity = "boot-a"

    // build an injected clock
    private func clock() -> AutomaticTrustedClock {
        AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { self.wallTimeMs },
            // run the bounded callback
            monotonicClockMs: { self.monotonicTimeMs },
            // run the bounded callback
            bootIdentity: { self.bootIdentity }
        )
    }

    // match the authoritative shared clock readings
    func testTrustedClockReadingsMatchSharedFixture() {
        let vectors = [
            TrustedClockVector(name: "same-boot-normal", bootIdentity: "boot-a", monotonicTimeMs: 15_000, wallTimeMs: 1_800_000_005_000, capturedAtMs: 1_720_000_005_000, expiryNowMs: 1_720_000_005_000),
            TrustedClockVector(name: "wall-rollback", bootIdentity: "boot-a", monotonicTimeMs: 20_000, wallTimeMs: 1_799_999_940_000, capturedAtMs: 1_720_000_010_000, expiryNowMs: 1_720_000_010_000),
            TrustedClockVector(name: "wall-forward", bootIdentity: "boot-a", monotonicTimeMs: 15_000, wallTimeMs: 1_800_000_600_000, capturedAtMs: 1_720_000_005_000, expiryNowMs: 1_720_000_600_000),
            TrustedClockVector(name: "frozen-wall", bootIdentity: "boot-a", monotonicTimeMs: 130_000, wallTimeMs: 1_800_000_000_000, capturedAtMs: 1_720_000_120_000, expiryNowMs: 1_720_000_120_000),
            TrustedClockVector(name: "reboot-without-anchor", bootIdentity: "boot-b", monotonicTimeMs: 100, wallTimeMs: 1_800_000_001_000, capturedAtMs: nil, expiryNowMs: nil),
        ]

        // evaluate every shared sample from the same anchor
        for vector in vectors {
            bootIdentity = "boot-a"
            monotonicTimeMs = 10_000
            wallTimeMs = 1_800_000_000_000
            let clock = clock()
            XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000), vector.name)

            bootIdentity = vector.bootIdentity
            monotonicTimeMs = vector.monotonicTimeMs
            wallTimeMs = vector.wallTimeMs
            XCTAssertEqual(clock.capturedAtMs(), vector.capturedAtMs, vector.name)
            XCTAssertEqual(clock.trustedNowMs(), vector.expiryNowMs, vector.name)
        }
    }

    // prove capture ignores wall rollback
    func testCaptureUsesServerAnchorAndMonotonicProgress() {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_000_000))

        monotonicTimeMs += 5_000
        wallTimeMs -= 40_000

        XCTAssertEqual(clock.capturedAtMs(), 1_005_000)
        XCTAssertEqual(clock.trustedNowMs(), 1_005_000)
    }

    // reject a changed boot even when its uptime is later
    func testChangedBootIdentityRejectsAnchorWithLaterUptime() throws {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_000_000))
        let anchor = try XCTUnwrap(clock.currentAnchor())

        // model a reboot whose later uptime cannot prove continuity
        bootIdentity = "boot-b"
        monotonicTimeMs += 60_000
        wallTimeMs += 60_000
        XCTAssertNil(clock.capturedAtMs())
        XCTAssertNil(clock.trustedNowMs())
        XCTAssertFalse(clock().restoreAnchor(anchor))
    }

    // keep one kernel identity across wall movement
    func testKernelBootIdentityKeepsSameBootClockStableAcrossWallMovement() {
        let identityProvider = AutomaticIOSBootIdentityProvider(
            // run the bounded callback
            loadBootTime: { (seconds: 1_720_000_000, microseconds: 999_999) }
        )
        let stableIdentity = identityProvider.current()
        let clock = AutomaticTrustedClock(
            // run the bounded callback
            wallClockMs: { self.wallTimeMs },
            // run the bounded callback
            monotonicClockMs: { self.monotonicTimeMs },
            // run the bounded callback
            bootIdentity: { identityProvider.current() }
        )
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_000_000))

        // preserve identity through wall rollback
        monotonicTimeMs += 1
        wallTimeMs -= 600_001
        XCTAssertEqual(identityProvider.current(), stableIdentity)
        XCTAssertEqual(clock.capturedAtMs(), 1_000_001)

        // preserve identity through wall forward and old rounding boundaries
        monotonicTimeMs += 1
        wallTimeMs += 1_200_002
        XCTAssertEqual(identityProvider.current(), stableIdentity)
        XCTAssertEqual(clock.capturedAtMs(), 1_000_002)
    }

    // reject same-boot server-time rollback
    func testTrustedServerAnchorCannotRollback() {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000))
        monotonicTimeMs += 5_000

        XCTAssertFalse(clock.refreshAnchor(serverTimeMs: 1_719_999_999_999))
        XCTAssertEqual(clock.capturedAtMs(), 1_720_000_005_000)
    }

    // reject a stale protected anchor after fresher trusted time
    func testProtectedAnchorCannotRegressExistingSameBootTime() {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_100_000))
        monotonicTimeMs += 5_000
        let stale = TrustedTimeAnchor(
            bootIdentity: bootIdentity,
            monotonicTimeMs: monotonicTimeMs - 5_000,
            serverTimeMs: 1_720_000_000_000,
            wallTimeMs: wallTimeMs
        )

        XCTAssertFalse(clock.restoreAnchor(stale))
        XCTAssertEqual(clock.capturedAtMs(), 1_720_000_105_000)
    }

    // prove frozen wall cannot freeze age
    func testMonotonicProgressAdvancesTrustedTimeWithFrozenWall() {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 2_000_000))

        monotonicTimeMs += 9_000

        XCTAssertEqual(clock.trustedNowMs(), 2_009_000)
    }

    // prove wall jumps expire early but do not change capture
    func testWallForwardJumpOnlyAdvancesExpiryTime() {
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 3_000_000))

        monotonicTimeMs += 123
        wallTimeMs += automaticCandidateRetentionMs

        XCTAssertEqual(clock.capturedAtMs(), 3_000_123)
        XCTAssertEqual(
            clock.evaluateExpiry(capturedAtMs: 3_000_000),
            .available(expired: true, trustedNowMs: 3_000_000 + automaticCandidateRetentionMs)
        )
    }

    // prove the exact twelve-hour boundary
    func testExpiryBoundaryIsExact() {
        monotonicTimeMs = 10_000
        wallTimeMs = 1_800_000_000_000
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000))

        monotonicTimeMs += automaticCandidateRetentionMs - 1
        wallTimeMs += automaticCandidateRetentionMs - 1
        XCTAssertEqual(
            clock.evaluateExpiry(capturedAtMs: 1_720_000_000_000),
            .available(expired: false, trustedNowMs: 1_720_043_199_999)
        )

        monotonicTimeMs += 1
        wallTimeMs += 1
        XCTAssertEqual(
            clock.evaluateExpiry(capturedAtMs: 1_720_000_000_000),
            .available(expired: true, trustedNowMs: 1_720_043_200_000)
        )
    }

    // prove reboot requires a new https anchor
    func testRebootBlocksUntilServerAnchorRefresh() throws {
        monotonicTimeMs = 10_000
        wallTimeMs = 1_800_000_000_000
        let clock = clock()
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: 1_720_000_000_000))
        let capturedAtMs = try XCTUnwrap(clock.capturedAtMs())

        bootIdentity = "boot-b"
        monotonicTimeMs = 100

        XCTAssertNil(clock.capturedAtMs())
        XCTAssertEqual(clock.evaluateExpiry(capturedAtMs: capturedAtMs), .blockedWithoutSameBootAnchor)

        wallTimeMs = 1_800_043_201_000
        XCTAssertTrue(clock.refreshAnchor(serverTimeMs: capturedAtMs + automaticCandidateRetentionMs))
        XCTAssertEqual(
            clock.evaluateExpiry(capturedAtMs: capturedAtMs),
            .available(expired: true, trustedNowMs: capturedAtMs + automaticCandidateRetentionMs)
        )
    }
}

// define the native contract
final class AutomaticTerminalConfigActivatorTests: XCTestCase {
    // define the native contract
    private final class FakeStager: TerminalRegionGenerationStager {
        var stageSucceeds = true
        var commitSucceeds = true
        var stagedOverride: Set<String>?
        var discarded: [ConfigGeneration] = []
        var committed: [ConfigGeneration] = []
        var stageAttempts: [ConfigGeneration] = []
        private var staged: [ConfigGeneration: Set<String>] = [:]

        // stage an isolated generation
        func stage(_ config: AutomaticTerminalConfigGeneration) -> Bool {
            stageAttempts.append(config.configGeneration)

            // simulate a failed platform registration
            if !stageSucceeds {
                return false
            }

            staged[config.configGeneration] = stagedOverride ?? Set(config.regions.map(\.terminalId))
            return true
        }

        // expose the verified owned set
        func stagedTerminalIds(for configGeneration: ConfigGeneration) -> Set<String> {
            staged[configGeneration] ?? []
        }

        // commit the verified namespace
        func commit(_ configGeneration: ConfigGeneration) -> Bool {
            // simulate an atomic commit failure
            if !commitSucceeds {
                return false
            }

            committed.append(configGeneration)
            return true
        }

        // discard only the named namespace
        func discard(_ configGeneration: ConfigGeneration) {
            discarded.append(configGeneration)
            staged.removeValue(forKey: configGeneration)
        }
    }

    // create a complete hashed generation
    private func config(
        configGeneration: Int64,
        serverPolicyGeneration: Int64,
        terminalIds: [String] = ["7", "12"]
    ) -> AutomaticTerminalConfigGeneration {
        // run the bounded callback
        let regions = terminalIds.enumerated().map { index, terminalId in
            AutomaticTerminalRegion(
                terminalId: terminalId,
                latitudeE7: 470_000_000 + Int32(index),
                longitudeE7: -1_220_000_000 - Int32(index),
                radiusMillimeters: 304_800,
                configGeneration: ConfigGeneration(value: configGeneration)
            )
        }
        return AutomaticTerminalConfigGeneration(
            schemaVersion: 1,
            configGeneration: ConfigGeneration(value: configGeneration),
            serverPolicyGeneration: ServerPolicyGeneration(value: serverPolicyGeneration),
            contentHashHex: AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions)
            ),
            regions: regions
        )
    }

    // prove partial initial activation stays disabled
    func testPartialInitialGenerationStaysDisabled() {
        let stager = FakeStager()
        stager.stagedOverride = ["7"]
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)

        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .disabled)
        XCTAssertEqual(
            activator.state(),
            AutomaticNativeGenerationState(
                configGeneration: nil,
                serverPolicyGeneration: nil,
                localWorkGeneration: LocalWorkGeneration(value: 0),
                configurationUsable: false
            )
        )
        XCTAssertEqual(stager.discarded, [ConfigGeneration(value: 1)])
    }

    // prove failed replacement preserves the exact prior generation
    func testFailedReplacementKeepsPriorGeneration() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)

        let priorState = activator.state()
        stager.stagedOverride = ["7"]

        XCTAssertEqual(activator.activate(config(configGeneration: 2, serverPolicyGeneration: 10)), .keptPrevious)
        XCTAssertEqual(activator.state(), priorState)
        XCTAssertEqual(stager.discarded, [ConfigGeneration(value: 2)])
    }

    // prove commit failure preserves the exact prior generation
    func testFailedCommitKeepsPriorGeneration() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)

        let priorState = activator.state()
        stager.commitSucceeds = false

        XCTAssertEqual(activator.activate(config(configGeneration: 2, serverPolicyGeneration: 10)), .keptPrevious)
        XCTAssertEqual(activator.state(), priorState)
        XCTAssertEqual(stager.discarded, [ConfigGeneration(value: 2)])
    }

    // prove the three generation concepts advance independently
    func testGenerationsAdvanceOnlyForTheirOwnCause() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(
            stager: stager,
            maxOwnedRegionCount: 20,
            initialLocalWorkGeneration: LocalWorkGeneration(value: 7)
        )
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)
        let initial = activator.state()

        XCTAssertEqual(
            activator.activate(config(configGeneration: 2, serverPolicyGeneration: 10, terminalIds: ["7", "13"])),
            .activated
        )
        let contentChanged = activator.state()
        XCTAssertEqual(contentChanged.configGeneration, ConfigGeneration(value: 2))
        XCTAssertEqual(contentChanged.serverPolicyGeneration, initial.serverPolicyGeneration)
        XCTAssertEqual(contentChanged.localWorkGeneration, initial.localWorkGeneration)

        XCTAssertTrue(activator.applyServerPolicyGeneration(ServerPolicyGeneration(value: 11)))
        let policyChanged = activator.state()
        XCTAssertEqual(policyChanged.configGeneration, contentChanged.configGeneration)
        XCTAssertEqual(policyChanged.serverPolicyGeneration, ServerPolicyGeneration(value: 11))
        XCTAssertEqual(policyChanged.localWorkGeneration, contentChanged.localWorkGeneration)

        XCTAssertTrue(activator.invalidateLocalWork())
        let localWorkChanged = activator.state()
        XCTAssertEqual(localWorkChanged.configGeneration, policyChanged.configGeneration)
        XCTAssertEqual(localWorkChanged.serverPolicyGeneration, policyChanged.serverPolicyGeneration)
        XCTAssertEqual(localWorkChanged.localWorkGeneration, LocalWorkGeneration(value: 8))
        XCTAssertFalse(localWorkChanged.configurationUsable)
    }

    // prove immutable generation content cannot mutate
    func testSameGenerationWithDifferentContentIsRejected() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)

        let priorState = activator.state()
        XCTAssertEqual(
            activator.activate(
                config(
                    configGeneration: 1,
                    serverPolicyGeneration: 10,
                    terminalIds: ["7", "13"]
                )
            ),
            .keptPrevious
        )
        XCTAssertEqual(activator.state(), priorState)
    }

    // prove hash mismatch fails closed
    func testContentHashMismatchIsRejected() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        let valid = config(configGeneration: 1, serverPolicyGeneration: 10)
        let invalid = AutomaticTerminalConfigGeneration(
            schemaVersion: valid.schemaVersion,
            configGeneration: valid.configGeneration,
            serverPolicyGeneration: valid.serverPolicyGeneration,
            contentHashHex: String(repeating: "0", count: 64),
            regions: valid.regions
        )

        XCTAssertEqual(activator.activate(invalid), .disabled)
        XCTAssertTrue(stager.committed.isEmpty)
    }

    // prove the supplied platform budget fails closed
    func testRegionCountAbovePlatformBudgetIsRejected() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 1)

        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .disabled)
        XCTAssertTrue(stager.committed.isEmpty)
    }

    // prove policy cannot regress during config activation
    func testConfigActivationCannotRegressServerPolicy() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)
        let priorState = activator.state()

        XCTAssertEqual(activator.activate(config(configGeneration: 2, serverPolicyGeneration: 9)), .keptPrevious)
        XCTAssertEqual(activator.state(), priorState)
    }

    // match the shared canonical region json
    func testRegionCanonicalizationIsSortedAndGenerationIndependent() {
        let generation = config(configGeneration: 1, serverPolicyGeneration: 10, terminalIds: ["7", "12"])
        XCTAssertEqual(
            String(data: AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(generation.regions), encoding: .utf8),
            "[{\"latitudeE7\":470000001,\"longitudeE7\":-1220000001,\"radiusMillimeters\":304800,\"terminalId\":\"12\"}," +
                "{\"latitudeE7\":470000000,\"longitudeE7\":-1220000000,\"radiusMillimeters\":304800,\"terminalId\":\"7\"}]"
        )
    }

    // prove invalidated immutable content fully reactivates
    func testInvalidatedCurrentGenerationRestagesBeforeBecomingUsable() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)
        XCTAssertTrue(activator.invalidateLocalWork())

        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)
        XCTAssertEqual(
            activator.state(),
            AutomaticNativeGenerationState(
                configGeneration: ConfigGeneration(value: 1),
                serverPolicyGeneration: ServerPolicyGeneration(value: 10),
                localWorkGeneration: LocalWorkGeneration(value: 1),
                configurationUsable: true
            )
        )
        XCTAssertEqual(stager.stageAttempts, [ConfigGeneration(value: 1), ConfigGeneration(value: 1)])
        XCTAssertEqual(stager.committed, [ConfigGeneration(value: 1), ConfigGeneration(value: 1)])
    }

    // prove failed immutable restage remains disabled
    func testFailedRestageOfInvalidatedGenerationRemainsDisabled() {
        let stager = FakeStager()
        let activator = AutomaticTerminalConfigActivator(stager: stager, maxOwnedRegionCount: 20)
        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .activated)
        XCTAssertTrue(activator.invalidateLocalWork())
        let invalidatedState = activator.state()
        stager.stageSucceeds = false

        XCTAssertEqual(activator.activate(config(configGeneration: 1, serverPolicyGeneration: 10)), .disabled)
        XCTAssertEqual(activator.state(), invalidatedState)
        XCTAssertFalse(activator.state().configurationUsable)
        XCTAssertEqual(stager.stageAttempts, [ConfigGeneration(value: 1), ConfigGeneration(value: 1)])
        XCTAssertEqual(stager.committed, [ConfigGeneration(value: 1)])
    }
}
