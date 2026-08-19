package fyi.ferry.leaderboards

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticNativeReconcilerV1Test {
    // define the native contract
    private class FakeTransport(
        private val responseFor: (AutomaticNativeHttpRequestV1) -> AutomaticNativeHttpResponseV1?,
    ) : AutomaticNativeHttpTransportV1 {
        var calls = 0

        // return one url-specific response
        override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1? {
            calls += 1
            return responseFor(request)
        }

        // expose successful deterministic cancellation
        override fun cancelAll(): Boolean = true
    }

    // define the native contract
    private class WipeProbe : AutomaticReconcilerCredentialWipeProbeV1 {
        var observations = 0
        var allBearerBytesWiped = true

        // require zeroed bearer memory before any response-derived effect
        override fun credentialWiped(credential: AutomaticCredentialV1) {
            observations += 1
            // run the bounded callback
            allBearerBytesWiped = allBearerBytesWiped && credential.bearerToken.all { byte -> byte == 0.toByte() }
        }
    }

    // build one complete strict native config
    private fun configBody(
        configGeneration: Long = 2L,
        policyGeneration: Long = 3L,
        terminalEnabled: Boolean = true,
        serverTimeMs: Long = 2_000L,
        maxPendingCandidates: Int = 8,
    ): ByteArray {
        val regions = listOf(
            AutomaticTerminalRegion(
                terminalId = "7",
                latitudeE7 = 476_020_000,
                longitudeE7 = -1_223_390_000,
                radiusMillimeters = 250_000L,
                configGeneration = ConfigGeneration(configGeneration),
            ),
        )
        val hash = AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
        )
        return """
            {"configGeneration":$configGeneration,"contentHash":"$hash",
             "detectors":{"terminalEnabled":$terminalEnabled,"vesselEnabled":false},
             "generatedAtMs":1000,
             "parameters":{"candidateRetentionMs":43200000,"fleetContextMaxAgeMs":120000,
               "futureToleranceMs":30000,"maxLocationAccuracyMillimeters":100000,"maxPendingCandidates":$maxPendingCandidates},
             "regions":[{"configGeneration":$configGeneration,"latitudeE7":476020000,"longitudeE7":-1223390000,
               "radiusMillimeters":250000,"terminalId":"7"}],
             "schemaVersion":1,"serverPolicyGeneration":$policyGeneration,"serverTimeMs":$serverTimeMs,
             "urls":{"candidates":"https://ferry.fyi/api/leaderboards/native/candidates",
               "config":"https://ferry.fyi/api/leaderboards/native/config",
               "enrollment":"https://ferry.fyi/api/leaderboards/native/enrollment",
               "status":"https://ferry.fyi/api/leaderboards/native/status"}}
        """.trimIndent().toByteArray()
    }

    // wrap one direct successful response
    private fun response(
        request: AutomaticNativeHttpRequestV1,
        body: ByteArray,
        statusCode: Int = 200,
    ): AutomaticNativeHttpResponseV1 =
        AutomaticNativeHttpResponseV1(
            statusCode = statusCode,
            requestedUrl = request.url,
            resolvedUrl = request.url,
            wasRedirected = false,
            body = body,
        )

    // purge empty-queue identities on every strict native auth denial
    @Test
    fun nativeAuthenticationDenialsStopAtFirstStatusOrConfigContact() {
        val cases = listOf(
            Triple("authentication_failed", "null", AutomaticNativeEndpointKind.STATUS),
            Triple("enrollment_expired", "7", AutomaticNativeEndpointKind.CONFIG),
            Triple("enrollment_revoked", "8", AutomaticNativeEndpointKind.STATUS),
        )
        // isolate each identity-ending response
        for ((error, generation, endpointKind) in cases) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
                val errorBody = """
                    {"error":"$error","schemaVersion":1,"serverPolicyGeneration":$generation}
                """.trimIndent().toByteArray()
                val transport = FakeTransport { request -> response(request, errorBody.copyOf(), statusCode = 401) }
                val reconciler = AutomaticNativeReconcilerV1(
                    runtime.credentialStore,
                    transport,
                    AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" }),
                    AutomaticNativeParametersStoreV1(runtime.root),
                    runtime.coordinator,
                )

                val outcome = if (endpointKind == AutomaticNativeEndpointKind.STATUS) {
                    reconciler.reconcileStatus()
                // branch on the current state
                } else {
                    reconciler.reconcileConfig()
                }
                assertEquals(error, AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED, outcome)
                assertNull(error, runtime.credentialStore.read())
                assertNull(error, runtime.bindingStore.read())
                assertEquals(error, error, runtime.coordinator.status().lastOutcome)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // wipe decrypted bearer state before status config or stop effects
    @Test
    fun reconcilerWipesCredentialBeforeEveryResponseEffect() {
        val cases = listOf(
            "status policy" to AutomaticNativeEndpointKind.STATUS,
            "config activation" to AutomaticNativeEndpointKind.CONFIG,
            "native stop" to AutomaticNativeEndpointKind.ENROLLMENT,
        )
        // isolate every response-derived effect family
        for ((label, kind) in cases) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(label, runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
                val body = when (kind) {
                    AutomaticNativeEndpointKind.STATUS -> """
                        {"automaticEnabled":true,"credentialExpiryBucket":"seven_days_or_more",
                         "rotateRecommended":false,"schemaVersion":1,"serverPolicyGeneration":3}
                    """.trimIndent().toByteArray()
                    AutomaticNativeEndpointKind.CONFIG -> configBody()
                    // branch on the current state
                    else -> """
                        {"error":"enrollment_revoked","schemaVersion":1,"serverPolicyGeneration":3}
                    """.trimIndent().toByteArray()
                }
                val probe = WipeProbe()
                // run the bounded callback
                val transport = FakeTransport { request ->
                    response(request, body.copyOf(), statusCode = if (kind == AutomaticNativeEndpointKind.ENROLLMENT) 401 else 200)
                }
                val reconciler = AutomaticNativeReconcilerV1(
                    runtime.credentialStore,
                    transport,
                    AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" }),
                    AutomaticNativeParametersStoreV1(runtime.root),
                    runtime.coordinator,
                    credentialWipeProbe = probe,
                )

                // route the stop case through the status endpoint
                if (kind == AutomaticNativeEndpointKind.CONFIG) {
                    reconciler.reconcileConfig()
                // branch on the current state
                } else {
                    reconciler.reconcileStatus()
                }

                assertEquals(label, 1, probe.observations)
                assertTrue(label, probe.allBearerBytesWiped)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // retain identity on a mismatched status class despite a valid-looking body
    @Test
    fun nativeAuthenticationBodyUnderWrongStatusIsRetryable() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            val errorBody = """
                {"error":"enrollment_revoked","schemaVersion":1,"serverPolicyGeneration":7}
            """.trimIndent().toByteArray()
            val transport = FakeTransport { request -> response(request, errorBody, statusCode = 500) }
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" }),
                AutomaticNativeParametersStoreV1(runtime.root),
                runtime.coordinator,
            )

            assertEquals(AutomaticReconciliationOutcomeV1.RETRYABLE, reconciler.reconcileStatus())
            val retained = runtime.credentialStore.read()
            assertNotNull(retained)
            retained?.wipe()
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // apply config policy parameters regions and trusted time together
    @Test
    fun completeConfigReconciliationActivatesGeneration() {
        var wallMs = 5_000L
        var monotonicMs = 100L
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            val clock = AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs = { wallMs },
                // run the bounded callback
                monotonicClockMs = { monotonicMs },
                // run the bounded callback
                bootIdentity = { "boot-a" },
                anchorStore = AutomaticNoBackupTrustedTimeAnchorStoreV1(runtime.root),
            )
            val parameters = AutomaticNativeParametersStoreV1(runtime.root)
            val publicConfigStore = AutomaticPublicTerminalConfigStoreV1(runtime.root, 20)
            val transport = FakeTransport { request -> response(request, configBody()) }
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                clock,
                parameters,
                runtime.coordinator,
                publicConfigStore,
            )

            assertEquals(AutomaticReconciliationOutcomeV1.APPLIED, reconciler.reconcileConfig())
            assertEquals(2L, runtime.coordinator.status().configGeneration?.value)
            assertEquals(3L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertTrue(runtime.coordinator.status().configurationUsable)
            assertEquals(8, parameters.read(ConfigGeneration(2L))?.maxPendingCandidates)
            assertEquals(2L, publicConfigStore.read(ConfigGeneration(2L))?.configGeneration?.value)
            monotonicMs += 50L
            wallMs -= 1_000L
            assertEquals(2_050L, clock.trustedNowMs())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // purge only after authoritative status learns remote kill
    @Test
    fun statusDenialPurgesOnceAtFirstContact() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            runtime.queue.enqueue(
                AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
            )
            val statusBody = """
                {"automaticEnabled":false,"credentialExpiryBucket":"seven_days_or_more",
                 "rotateRecommended":false,"schemaVersion":1,"serverPolicyGeneration":5}
            """.trimIndent().toByteArray()
            val transport = FakeTransport { request -> response(request, statusBody.copyOf()) }
            val clock = AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" })
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                clock,
                AutomaticNativeParametersStoreV1(runtime.root),
                runtime.coordinator,
            )

            assertEquals(
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
                reconciler.reconcileStatus(),
            )
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(5L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertFalse(runtime.coordinator.status().configurationUsable)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject policy rollback before persisting its server time
    @Test
    fun rollbackConfigCannotReplaceClockOrPolicy() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(policyGeneration = 9L)))
            assertTrue(runtime.coordinator.reconcileAuthoritativePolicy(ServerPolicyGeneration(9L), enabled = true))
            val anchorDirectory = Files.createTempDirectory("automatic-reconcile-clock").toFile()
            val anchorStore = AutomaticNoBackupTrustedTimeAnchorStoreV1(anchorDirectory)
            val clock = AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" }, anchorStore)
            val transport = FakeTransport { request -> response(request, configBody(policyGeneration = 8L)) }
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                clock,
                AutomaticNativeParametersStoreV1(runtime.root),
                runtime.coordinator,
            )

            assertEquals(AutomaticReconciliationOutcomeV1.RETRYABLE, reconciler.reconcileConfig())
            assertEquals(9L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertNull(clock.trustedNowMs())
            assertNull(anchorStore.read())
            anchorDirectory.deleteRecursively()
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject detector denial and purge queued work
    @Test
    fun configDetectorDenialPurgesGeneration() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val transport = FakeTransport { request -> response(request, configBody(terminalEnabled = false)) }
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" }),
                AutomaticNativeParametersStoreV1(runtime.root),
                runtime.coordinator,
            )

            assertEquals(
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
                reconciler.reconcileConfig(),
            )
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals("detector_disabled", runtime.coordinator.status().lastOutcome)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject delayed config rollback before time parameters or policy mutate
    @Test
    fun delayedOlderConfigCannotRegressCommittedRuntime() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            var responseIndex = 0
            // run the bounded callback
            val transport = FakeTransport { request ->
                responseIndex += 1
                // return newer config before a delayed older generation
                if (responseIndex == 1) {
                    response(request, configBody(configGeneration = 2L, policyGeneration = 3L, serverTimeMs = 2_000L))
                // branch on the current state
                } else {
                    response(
                        request,
                        configBody(
                            configGeneration = 1L,
                            policyGeneration = 4L,
                            serverTimeMs = 3_000L,
                            maxPendingCandidates = 4,
                        ),
                    )
                }
            }
            val clock = AutomaticTrustedClock({ 0L }, { 0L }, { "boot-a" })
            val parameters = AutomaticNativeParametersStoreV1(runtime.root)
            val reconciler = AutomaticNativeReconcilerV1(
                runtime.credentialStore,
                transport,
                clock,
                parameters,
                runtime.coordinator,
            )

            assertEquals(AutomaticReconciliationOutcomeV1.APPLIED, reconciler.reconcileConfig())
            assertEquals(AutomaticReconciliationOutcomeV1.RETRYABLE, reconciler.reconcileConfig())
            assertEquals(2L, runtime.coordinator.status().configGeneration?.value)
            assertEquals(3L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertEquals(8, parameters.read(ConfigGeneration(2L))?.maxPendingCandidates)
            assertEquals(2_000L, clock.trustedNowMs())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }
}
