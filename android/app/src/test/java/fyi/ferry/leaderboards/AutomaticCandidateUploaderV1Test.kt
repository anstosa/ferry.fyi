package fyi.ferry.leaderboards

import androidx.work.ListenableWorker
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticCandidateUploaderV1Test {
    // select one canonical accepted status for a fixed outcome
    private fun expectedStatus(outcome: String): Int = when (outcome) {
        "authentication_failed",
        "enrollment_expired",
        "enrollment_revoked",
        -> 401
        "malformed_payload" -> 400
        "payload_too_large" -> 413
        "unsupported_encoding",
        "unsupported_media_type",
        -> 415
        "invalid_candidate" -> 422
        "rate_limited" -> 429
        "temporarily_unavailable" -> 503
        "candidate_conflict" -> 409
        "credited" -> 201
        // branch on the current state
        else -> 200
    }

    // define the native contract
    private class FakeTransport(
        responses: List<() -> AutomaticNativeHttpResponseV1?>,
    ) : AutomaticNativeHttpTransportV1 {
        private val pending = ArrayDeque(responses)
        var calls = 0
        val requestBodies = mutableListOf<String>()

        // return the next deterministic response
        override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1? {
            calls += 1
            requestBodies += request.body?.toString(Charsets.UTF_8).orEmpty()
            return pending.pollFirst()?.invoke()
        }

        // expose successful deterministic cancellation
        override fun cancelAll(): Boolean = true
    }

    // define the native contract
    private class Signal : AutomaticCreditedSignalV1 {
        var count = 0

        // count only generic credited signals
        override fun credited() {
            count += 1
        }
    }

    // define the native contract
    private class SimulatedCrash : RuntimeException()

    // build one strict response envelope
    private fun response(
        disposition: String,
        outcome: String,
        credited: Boolean = false,
        generation: Long? = 0L,
        statusCode: Int = if (credited) 201 else 200,
        retryAfterSeconds: Long? = null,
    ): AutomaticNativeHttpResponseV1 {
        // run the bounded callback
        val retry = retryAfterSeconds?.let { value -> ",\"retryAfterSeconds\":$value" }.orEmpty()
        val generationJson = generation?.toString() ?: "null"
        val body = (
            "{\"credited\":$credited,\"disposition\":\"$disposition\"," +
                "\"outcome\":\"$outcome\"$retry,\"schemaVersion\":1," +
                "\"serverPolicyGeneration\":$generationJson}"
            ).toByteArray()
        return AutomaticNativeHttpResponseV1(
            statusCode = statusCode,
            requestedUrl = "https://ferry.fyi/api/leaderboards/native/candidates",
            resolvedUrl = "https://ferry.fyi/api/leaderboards/native/candidates",
            wasRedirected = false,
            body = body,
        )
    }

    // create one fully wired deterministic uploader
    private fun uploader(
        runtime: TestSecureRuntimeV1,
        transport: AutomaticNativeHttpTransportV1,
        signal: Signal,
        crashProbe: AutomaticUploaderCrashProbeV1 = AutomaticNoopUploaderCrashProbeV1,
    ): AutomaticCandidateUploaderV1 {
        assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
        return AutomaticCandidateUploaderV1(
            queue = runtime.queue,
            credentialStore = runtime.credentialStore,
            // run the bounded callback
            trustedNowMs = { 2_000L },
            transport = transport,
            coordinator = runtime.coordinator,
            creditedSignal = signal,
            crashProbe = crashProbe,
        )
    }

    // verify and wipe one stored credential copy
    private fun assertCredentialPresent(runtime: TestSecureRuntimeV1) {
        val credential = runtime.credentialStore.read()
        assertTrue(credential != null)
        credential?.wipe()
    }

    // delete a credited final before one generic signal
    @Test
    fun creditedFinalDeletesBeforeSignal() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val transport = FakeTransport(listOf({ response("final", "credited", credited = true) }))
            val signal = Signal()

            val result = uploader(runtime, transport, signal).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
            assertEquals(1, result.finalizedCount)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1, signal.count)
            assertFalse(transport.requestBodies.single().contains("localWorkGeneration"))
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // treat authenticated 409 conflict as final deletion
    @Test
    fun conflictFinalDeletesWithoutNotification() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val transport = FakeTransport(
                listOf({ response("final", "candidate_conflict", statusCode = 409) }),
            )
            val signal = Signal()

            val result = uploader(runtime, transport, signal).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(0, signal.count)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retain response loss and retryable outcomes before expiry
    @Test
    fun ambiguousAndRetryableResponsesRetainCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val lost = FakeTransport(listOf({ null }))
            val signal = Signal()
            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, uploader(runtime, lost, signal).runOnce().outcome)
            assertEquals(1, runtime.queue.pendingCount())

            val retry = FakeTransport(
                listOf({ response("retryable", "history_warming", retryAfterSeconds = 60L) }),
            )
            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, uploader(runtime, retry, signal).runOnce().outcome)
            assertEquals(1, runtime.queue.pendingCount())
            assertEquals(0, signal.count)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // let another entity progress while one terminal head retries
    @Test
    fun retryableTerminalDoesNotBlockIndependentEntity() {
        val runtime = testSecureRuntime({ 4_000L })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L, terminalId = "7")
            val other = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 2_000L,
                terminalId = "8",
            )
            val newerSame = testTerminalCandidate(
                candidateId = "_____________________w",
                capturedAtMs = 3_000L,
                terminalId = "7",
            )
            // enqueue each independent record
            for (candidate in listOf(first, other, newerSame)) {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(0)))
            }
            val transport = FakeTransport(
                listOf(
                    { response("retryable", "temporarily_unavailable") },
                    { response("final", "outside_terminal") },
                ),
            )

            val result = uploader(runtime, transport, Signal()).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(1, result.finalizedCount)
            assertEquals(1, result.retryableCount)
            val remaining = (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records
                // run the bounded callback
                .map { record -> record.queued.candidate }
            assertEquals(listOf(first, newerSame), remaining)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retry the owned wake until a same-terminal successor reaches the server
    @Test
    fun finalizedHeadKeepsWorkAliveForSameTerminalSuccessor() {
        val runtime = testSecureRuntime({ 4_000L })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L, terminalId = "7")
            val successor = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 2_000L,
                terminalId = "7",
            )
            // enqueue the complete ordered terminal lane
            for (candidate in listOf(first, successor)) {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(0)))
            }
            val transport = FakeTransport(
                listOf(
                    { response("final", "outside_terminal") },
                    { response("final", "outside_terminal") },
                ),
            )
            val subject = uploader(runtime, transport, Signal())

            val firstWake = subject.runOnce()
            val secondWake = subject.runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, firstWake.outcome)
            assertEquals(1, firstWake.finalizedCount)
            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, secondWake.outcome)
            assertEquals(1, secondWake.finalizedCount)
            assertEquals(2, transport.calls)
            assertEquals(0, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // crash before delete leaves the exact ciphertext for replay
    @Test
    fun crashBeforeDeleteRetainsCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val signal = Signal()
            val crash = object : AutomaticUploaderCrashProbeV1 {
                // crash at the pre-delete boundary
                override fun reached(phase: AutomaticUploaderCrashPhaseV1) {
                    // stop only before deletion
                    if (phase == AutomaticUploaderCrashPhaseV1.AFTER_FINAL_RESPONSE_BEFORE_DELETE) {
                        throw SimulatedCrash()
                    }
                }
            }
            // attempt the protected operation
            try {
                uploader(runtime, FakeTransport(listOf({ response("final", "credited", true) })), signal, crash)
                    .runOnce()
            // fail closed on the error
            } catch (_: SimulatedCrash) {
                Unit
            }
            assertEquals(1, runtime.queue.pendingCount())
            assertEquals(0, signal.count)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // crash after delete leaves no record and no duplicate ui
    @Test
    fun crashAfterDeleteLeavesNoCiphertextOrSignal() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val signal = Signal()
            val crash = object : AutomaticUploaderCrashProbeV1 {
                // crash only after atomic deletion
                override fun reached(phase: AutomaticUploaderCrashPhaseV1) {
                    // stop at the post-delete boundary
                    if (phase == AutomaticUploaderCrashPhaseV1.AFTER_DELETE_BEFORE_EXPOSURE) {
                        throw SimulatedCrash()
                    }
                }
            }
            // attempt the protected operation
            try {
                uploader(runtime, FakeTransport(listOf({ response("final", "credited", true) })), signal, crash)
                    .runOnce()
            // fail closed on the error
            } catch (_: SimulatedCrash) {
                Unit
            }
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(0, signal.count)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // ignore an in-flight final after a local generation stop
    @Test
    fun invalidatedInFlightResponseCannotNotify() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val staleResponse = response("final", "credited", credited = true)
            val transport = object : AutomaticNativeHttpTransportV1 {
                // stop work while the request is beyond cancellation
                override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1 {
                    runtime.coordinator.knownStop(AutomaticStopTriggerV1.LOCAL_DISABLE)
                    return staleResponse
                }

                // expose successful cancellation
                override fun cancelAll(): Boolean = true
            }
            val signal = Signal()

            val result = uploader(runtime, transport, signal).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(0, signal.count)
            assertEquals(0, runtime.queue.pendingCount())
            // run the bounded callback
            assertTrue(staleResponse.body.all { byte -> byte == 0.toByte() })
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // wipe rejected redirect bodies before retaining ciphertext
    @Test
    fun redirectResponseBodyIsAlwaysWiped() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val redirected = response("final", "stale_event").copy(
                resolvedUrl = "https://attacker.invalid/candidates",
                wasRedirected = true,
            )

            val result = uploader(runtime, FakeTransport(listOf({ redirected })), Signal()).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(1, runtime.queue.pendingCount())
            // run the bounded callback
            assertTrue(redirected.body.all { byte -> byte == 0.toByte() })
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // suppress stale final effects at both deletion boundaries
    @Test
    fun stopsAtFinalizationBoundariesCannotRecordOrNotify() {
        // exercise both explicit finalization seams
        for (expectedPhase in AutomaticUploaderCrashPhaseV1.entries) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
                val signal = Signal()
                val stopProbe = object : AutomaticUploaderCrashProbeV1 {
                    // invalidate at one deterministic response boundary
                    override fun reached(phase: AutomaticUploaderCrashPhaseV1) {
                        // stop only at the selected boundary
                        if (phase == expectedPhase) {
                            runtime.coordinator.knownStop(AutomaticStopTriggerV1.LOCAL_DISABLE)
                        }
                    }
                }

                uploader(
                    runtime,
                    FakeTransport(listOf({ response("final", "credited", credited = true) })),
                    signal,
                    stopProbe,
                ).runOnce()

                assertEquals(expectedPhase.name, 0, signal.count)
                assertEquals(expectedPhase.name, null, runtime.coordinator.status().lastOutcome)
                assertEquals(expectedPhase.name, 0, runtime.queue.pendingCount())
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // authoritative policy denial invalidates and purges every queued entity
    @Test
    fun candidatePolicyDenialPurgesWholeGeneration() {
        val runtime = testSecureRuntime({ 3_000L })
        // attempt the protected operation
        try {
            val candidates = listOf(
                testTerminalCandidate(),
                testTerminalCandidate(
                    candidateId = "EBESExQVFhcYGRobHB0eHw",
                    capturedAtMs = 2_000L,
                    terminalId = "8",
                ),
            )
            // enqueue both candidate identities
            for (candidate in candidates) {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(0)))
            }
            val transport = FakeTransport(listOf({ response("final", "policy_disabled", generation = 4L) }))

            uploader(runtime, transport, Signal()).runOnce()

            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(4L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertFalse(runtime.coordinator.status().configurationUsable)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retain valid bodies delivered under unreviewed http classes
    @Test
    fun mismatchedStatusCannotDeleteOrPurgeCiphertext() {
        // exercise prior policy-denial and server-error bypasses
        for (statusCode in listOf(403, 500)) {
            val runtime = testSecureRuntime({ 3_000L })
            // attempt the protected operation
            try {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
                val result = uploader(
                    runtime,
                    FakeTransport(
                        listOf({ response("final", "policy_disabled", generation = 4L, statusCode = statusCode) }),
                    ),
                    Signal(),
                ).runOnce()

                assertEquals(statusCode.toString(), AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
                assertEquals(statusCode.toString(), 1, runtime.queue.pendingCount())
                assertEquals(statusCode.toString(), 0L, runtime.coordinator.localWorkGeneration().value)
                assertEquals(statusCode.toString(), null, runtime.coordinator.status().serverPolicyGeneration)
                assertEquals(statusCode.toString(), null, runtime.coordinator.status().lastOutcome)
                assertCredentialPresent(runtime)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // retry durable cleanup until the queue reaches zero
    @Test
    fun deleteFailureSchedulesZeroDataCleanupRetryAndConverges() {
        val fileOps = TestAtomicFileOpsV1()
        val runtime = testSecureRuntime({ 2_000L }, fileOps = fileOps)
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val signal = Signal()
            val transport = FakeTransport(listOf({ response("final", "credited", credited = true) }))
            val subject = uploader(runtime, transport, signal)
            fileOps.failDelete = true

            val failedDelete = subject.runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, failedDelete.outcome)
            assertEquals(ListenableWorker.Result.retry()::class, AutomaticCandidateWorkResultPolicyV1.resultFor(failedDelete.outcome)::class)
            assertEquals(1, runtime.queue.pendingCount())
            assertTrue(runtime.queue.cleanupRequired())
            assertEquals(0, signal.count)
            fileOps.failDelete = false

            val cleanup = subject.runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, cleanup.outcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertFalse(runtime.queue.cleanupRequired())
            assertEquals(0, signal.count)
            assertEquals(1, transport.calls)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // preserve stop authority through delete failure and process replacement
    @Test
    fun stopFinalDeleteFailureReplaysAuthorityWithoutNetwork() {
        val fileOps = TestAtomicFileOpsV1()
        val runtime = testSecureRuntime({ 2_000L }, fileOps = fileOps)
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val firstTransport = FakeTransport(
                listOf({ response("final", "policy_disabled", generation = 4L) }),
            )
            val firstUploader = uploader(runtime, firstTransport, Signal())
            fileOps.failDelete = true

            val failedDelete = firstUploader.runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, failedDelete.outcome)
            assertEquals("policy_disabled", runtime.coordinator.status().lastOutcome)
            assertTrue(!runtime.coordinator.status().configurationUsable)
            assertTrue(runtime.queue.hasPendingStopAuthority())
            val stoppedGeneration = runtime.coordinator.localWorkGeneration()
            fileOps.failDelete = false
            val replacementActivator = AutomaticTerminalConfigActivator(
                TestRegionStagerV1(),
                20,
                stoppedGeneration,
            )
            val replacementCoordinator = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = replacementActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = TestStopPortV1(),
            )
            val replacementTransport = FakeTransport(emptyList())
            val replacement = AutomaticCandidateUploaderV1(
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                // run the bounded callback
                trustedNowMs = { 2_000L },
                transport = replacementTransport,
                coordinator = replacementCoordinator,
                creditedSignal = Signal(),
            )

            val cleanup = replacement.runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, cleanup.outcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertTrue(!runtime.queue.hasPendingStopAuthority())
            assertEquals(stoppedGeneration, replacementCoordinator.localWorkGeneration())
            assertEquals("policy_disabled", replacementCoordinator.status().lastOutcome)
            assertEquals(0, replacementTransport.calls)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // never apply a staged authority after a newer enrollment generation wins
    @Test
    fun staleStagedStopAuthorityCannotKillReplacementEnrollmentAfterRestart() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val replacementGeneration = ServerPolicyGeneration(5L)
            val probe = object : AutomaticUploaderCrashProbeV1 {
                // replace enrollment after authority staging but before deletion
                override fun reached(phase: AutomaticUploaderCrashPhaseV1) {
                    // invalidate only at the staged pre-delete boundary
                    if (phase == AutomaticUploaderCrashPhaseV1.AFTER_FINAL_RESPONSE_BEFORE_DELETE) {
                        assertTrue(runtime.coordinator.replaceEnrollment(replacementGeneration))
                    }
                }
            }

            uploader(
                runtime,
                FakeTransport(listOf({ response("final", "policy_disabled", generation = 4L) })),
                Signal(),
                probe,
            ).runOnce()

            assertFalse(runtime.queue.hasPendingStopAuthority())
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(5L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertEquals(null, runtime.coordinator.status().lastOutcome)
            val replacement = AutomaticCandidateUploaderV1(
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                // run the bounded callback
                trustedNowMs = { 2_000L },
                transport = FakeTransport(emptyList()),
                coordinator = runtime.coordinator,
                creditedSignal = Signal(),
            )
            replacement.runOnce()
            assertEquals(null, runtime.coordinator.status().lastOutcome)
            assertEquals(5L, runtime.coordinator.status().serverPolicyGeneration?.value)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // preserve ciphertext replay when stop-authority persistence itself fails
    @Test
    fun stopAuthorityWriteFailureDoesNotLatchCiphertextCleanupBeforeExposure() {
        val fileOps = TestAtomicFileOpsV1()
        val runtime = testSecureRuntime({ 2_000L }, fileOps = fileOps)
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            fileOps.failReplaceName = "pending-stop-authority-v1.bin"
            val crash = object : AutomaticUploaderCrashProbeV1 {
                // no crash probe is reached when staging fails
                override fun reached(phase: AutomaticUploaderCrashPhaseV1) = Unit
            }

            val result = uploader(
                runtime,
                FakeTransport(listOf({ response("final", "policy_disabled", generation = 4L) })),
                Signal(),
                crash,
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, result.outcome)
            assertEquals("policy_disabled", runtime.coordinator.status().lastOutcome)
            assertEquals(0, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // wipe every credential request candidate and response buffer before credited exposure
    @Test
    fun creditedSignalObservesOnlyWipedSensitiveBuffers() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            lateinit var token: ByteArray
            lateinit var requestBody: ByteArray
            var preparedCandidateWiped = false
            val serverResponse = response("final", "credited", credited = true)
            val transport = object : AutomaticNativeHttpTransportV1 {
                // retain test canaries without copying their sensitive arrays
                override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1 {
                    token = request.bearerToken
                    requestBody = request.body!!
                    return serverResponse
                }

                // expose successful deterministic cancellation
                override fun cancelAll(): Boolean = true
            }
            var observed = false
            val signal = object : AutomaticCreditedSignalV1 {
                // assert all sensitive canaries are wiped before aggregate exposure
                override fun credited() {
                    // run the bounded callback
                    assertTrue(token.all { byte -> byte == 0.toByte() })
                    // run the bounded callback
                    assertTrue(requestBody.all { byte -> byte == 0.toByte() })
                    // run the bounded callback
                    assertTrue(serverResponse.body.all { byte -> byte == 0.toByte() })
                    assertTrue(preparedCandidateWiped)
                    observed = true
                }
            }
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            val subject = AutomaticCandidateUploaderV1(
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                // run the bounded callback
                trustedNowMs = { 2_000L },
                transport = transport,
                coordinator = runtime.coordinator,
                creditedSignal = signal,
                // run the bounded callback
                didWipePreparedCandidate = { prepared ->
                    assertTrue(prepared.isWiped())
                    preparedCandidateWiped = true
                },
            )

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, subject.runOnce().outcome)
            assertTrue(observed)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // keep permanent blocks terminal to workmanager
    @Test
    fun workerResultPolicyRetriesOnlyTransientAndCleanupStates() {
        assertEquals(
            ListenableWorker.Result.retry()::class,
            AutomaticCandidateWorkResultPolicyV1.resultFor(AutomaticUploadRunOutcomeV1.RETRY)::class,
        )
        assertEquals(
            ListenableWorker.Result.retry()::class,
            AutomaticCandidateWorkResultPolicyV1.resultFor(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY)::class,
        )
        assertEquals(
            ListenableWorker.Result.failure()::class,
            AutomaticCandidateWorkResultPolicyV1.resultFor(AutomaticUploadRunOutcomeV1.BLOCKED)::class,
        )
        assertEquals(
            ListenableWorker.Result.success()::class,
            AutomaticCandidateWorkResultPolicyV1.resultFor(AutomaticUploadRunOutcomeV1.SUCCESS)::class,
        )
    }

    // delete every fixed final outcome before any later effect
    @Test
    fun everyFinalOutcomeDeletesCiphertext() {
        // run the bounded callback
        val finalOutcomes = AUTOMATIC_CANDIDATE_OUTCOMES_V1.filterNot { outcome ->
            outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1
        }
        // isolate every final state-machine case
        for (outcome in finalOutcomes) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
                val signal = Signal()
                val statusCode = expectedStatus(outcome)
                val generation = if (outcome in AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1) null else 4L
                val result = uploader(
                    runtime,
                    FakeTransport(listOf({ response("final", outcome, outcome == "credited", generation, statusCode) })),
                    signal,
                ).runOnce()

                assertEquals(outcome, AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
                assertEquals(outcome, 1, result.finalizedCount)
                assertEquals(outcome, 0, runtime.queue.pendingCount())
                assertEquals(outcome, if (outcome == "credited") 1 else 0, signal.count)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // delete valid redacted pre-auth finals without policy inference
    @Test
    fun nullGenerationPreAuthFinalsDeleteCiphertext() {
        // run the bounded callback
        val finalPreAuthOutcomes = AUTOMATIC_PRE_AUTH_CANDIDATE_OUTCOMES_V1.filterNot { outcome ->
            outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1 || outcome == "authentication_failed"
        }
        // isolate every non-identity pre-auth final
        for (outcome in finalPreAuthOutcomes) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
                val result = uploader(
                    runtime,
                    FakeTransport(
                        listOf({ response("final", outcome, generation = null, statusCode = expectedStatus(outcome)) }),
                    ),
                    Signal(),
                ).runOnce()

                assertEquals(outcome, AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
                assertEquals(outcome, 0, runtime.queue.pendingCount())
                assertEquals(outcome, null, runtime.coordinator.status().serverPolicyGeneration)
                assertCredentialPresent(runtime)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // delete first then purge identity on redacted authentication failure
    @Test
    fun nullGenerationAuthenticationFinalPurgesIdentityAndRemainingQueue() {
        val runtime = testSecureRuntime({ 3_000L })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L)
            val second = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 2_000L,
                terminalId = "8",
            )
            // enqueue one selected record and one identity-linked remainder
            for (candidate in listOf(first, second)) {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(0)))
            }
            val result = uploader(
                runtime,
                FakeTransport(
                    listOf({ response("final", "authentication_failed", generation = null, statusCode = 401) }),
                ),
                Signal(),
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
            assertEquals(1, result.finalizedCount)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(null, runtime.credentialStore.read())
            assertEquals(null, runtime.bindingStore.read())
            assertTrue(runtime.credentialAead.deleteCount > 0)
            assertTrue(runtime.queueAead.deleteCount > 0)
            assertEquals("authentication_failed", runtime.coordinator.status().lastOutcome)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // purge identity for a locked post-auth removal race
    @Test
    fun disclosedGenerationAuthenticationFinalPurgesIdentityAndRemainingQueue() {
        val runtime = testSecureRuntime({ 3_000L })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L)
            val second = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 2_000L,
                terminalId = "8",
            )
            // enqueue one selected record and one identity-linked remainder
            for (candidate in listOf(first, second)) {
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(0)))
            }
            val result = uploader(
                runtime,
                FakeTransport(
                    listOf({ response("final", "authentication_failed", generation = 7L, statusCode = 401) }),
                ),
                Signal(),
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.SUCCESS, result.outcome)
            assertEquals(1, result.finalizedCount)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(null, runtime.credentialStore.read())
            assertEquals(null, runtime.bindingStore.read())
            assertEquals(ServerPolicyGeneration(7L), runtime.coordinator.status().serverPolicyGeneration)
            assertEquals("authentication_failed", runtime.coordinator.status().lastOutcome)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retain the sole redacted retryable outcome
    @Test
    fun nullGenerationRateLimitRetainsCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val result = uploader(
                runtime,
                FakeTransport(
                    listOf({ response("retryable", "rate_limited", generation = null, statusCode = 429) }),
                ),
                Signal(),
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(1, runtime.queue.pendingCount())
            assertEquals(null, runtime.coordinator.status().serverPolicyGeneration)
            assertCredentialPresent(runtime)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retain credentials and ciphertext on pre-auth service ambiguity
    @Test
    fun nullGenerationUnavailableRetainsCiphertextAndCredential() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val result = uploader(
                runtime,
                FakeTransport(
                    listOf({ response("retryable", "temporarily_unavailable", generation = null, statusCode = 503) }),
                ),
                Signal(),
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(1, runtime.queue.pendingCount())
            assertEquals(null, runtime.coordinator.status().serverPolicyGeneration)
            assertCredentialPresent(runtime)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retain semantically impossible redacted envelopes
    @Test
    fun invalidNullGenerationFinalRetainsCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val result = uploader(
                runtime,
                FakeTransport(listOf({ response("final", "stale_event", generation = null) })),
                Signal(),
            ).runOnce()

            assertEquals(AutomaticUploadRunOutcomeV1.RETRY, result.outcome)
            assertEquals(1, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // serialize concurrent wakes across selection transport and deletion
    @Test
    fun concurrentRunsUploadOneRecordExactlyOnce() {
        val runtime = testSecureRuntime({ 2_000L })
        val executor = Executors.newFixedThreadPool(2)
        val release = CountDownLatch(1)
        // attempt the protected operation
        try {
            runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)))
            val entered = CountDownLatch(1)
            val active = AtomicInteger(0)
            val maximumActive = AtomicInteger(0)
            val calls = AtomicInteger(0)
            val transport = object : AutomaticNativeHttpTransportV1 {
                // block the first request while a second wake competes
                override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1 {
                    val current = active.incrementAndGet()
                    maximumActive.updateAndGet { observed -> maxOf(observed, current) }
                    calls.incrementAndGet()
                    entered.countDown()
                    assertTrue(release.await(5, TimeUnit.SECONDS))
                    active.decrementAndGet()
                    return response("final", "credited", credited = true)
                }

                // expose successful deterministic cancellation
                override fun cancelAll(): Boolean = true
            }
            val signal = Signal()
            val subject = uploader(runtime, transport, signal)
            val first = executor.submit<AutomaticUploadRunResultV1> { subject.runOnce() }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val second = executor.submit<AutomaticUploadRunResultV1> { subject.runOnce() }
            Thread.sleep(100L)

            assertEquals(1, calls.get())
            assertEquals(1, maximumActive.get())
            release.countDown()
            val results = listOf(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS))
            assertEquals(1, results.sumOf { result -> result.finalizedCount })
            assertEquals(1, calls.get())
            assertEquals(1, maximumActive.get())
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1, signal.count)
        // release protected state
        } finally {
            release.countDown()
            executor.shutdownNow()
            runtime.root.deleteRecursively()
        }
    }
}
