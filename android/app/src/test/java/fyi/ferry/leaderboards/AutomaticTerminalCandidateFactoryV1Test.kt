package fyi.ferry.leaderboards

import androidx.work.ExistingWorkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticTerminalCandidateFactoryV1Test {
    private val region = AutomaticTerminalRegion(
        terminalId = "7",
        latitudeE7 = 0,
        longitudeE7 = 0,
        radiusMillimeters = 250_000L,
        configGeneration = ConfigGeneration(2L),
    )

    // create one fixed location fix
    private fun fix(
        latitudeE7: Int,
        accuracyMillimeters: Long,
    ): AutomaticLocationFixV1 = AutomaticLocationFixV1(
        latitudeE7 = latitudeE7,
        longitudeE7 = 0,
        accuracyMillimeters = accuracyMillimeters,
        capturedAtMs = 1_000L,
    )

    // create one transition callback
    private fun callback(transition: AutomaticGeofenceTransitionV1): AutomaticGeofenceCallbackV1 =
        AutomaticGeofenceCallbackV1(
            terminalId = "7",
            configGeneration = ConfigGeneration(2L),
            localWorkGeneration = LocalWorkGeneration(0),
            transition = transition,
        )

    // require a successor-producing workmanager policy for the empty-scan race
    @Test
    fun uploadSchedulingReplacesAnAlreadyRunningEmptyWake() {
        assertEquals(ExistingWorkPolicy.REPLACE, AUTOMATIC_UPLOAD_EXISTING_WORK_POLICY_V1)
    }

    // block reboot callbacks before location or candidate construction
    @Test
    fun sameBootTrustedTimeIsRequiredBeforeLocation() {
        assertTrue(!AutomaticGeofenceTrustedTimeGateV1.canAcquireFix(null))
        assertTrue(AutomaticGeofenceTrustedTimeGateV1.canAcquireFix(2_000L))
    }

    // admit enter only when the full accuracy circle is inside
    @Test
    fun enterRequiresDefinitiveInsideCircle() {
        val inside = fix(latitudeE7 = 0, accuracyMillimeters = 250_000L)
        val uncertain = fix(latitudeE7 = 0, accuracyMillimeters = 250_001L)
        val outside = fix(latitudeE7 = 100_000, accuracyMillimeters = 1_000L)

        assertEquals(AutomaticAccuracyCircleResultV1.INSIDE, AutomaticTerminalAccuracyCircleV1.classify(region, inside))
        assertEquals(AutomaticAccuracyCircleResultV1.UNCERTAIN, AutomaticTerminalAccuracyCircleV1.classify(region, uncertain))
        assertEquals(AutomaticAccuracyCircleResultV1.OUTSIDE, AutomaticTerminalAccuracyCircleV1.classify(region, outside))
        assertNotNull(
            AutomaticTerminalCandidateFactoryV1.create(
                callback(AutomaticGeofenceTransitionV1.ENTER),
                region,
                inside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
        assertNull(
            AutomaticTerminalCandidateFactoryV1.create(
                callback(AutomaticGeofenceTransitionV1.ENTER),
                region,
                uncertain,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
        assertNull(
            AutomaticTerminalCandidateFactoryV1.create(
                callback(AutomaticGeofenceTransitionV1.ENTER),
                region,
                outside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
    }

    // admit exit only when the full accuracy circle is outside
    @Test
    fun exitRequiresDefinitiveOutsideCircle() {
        val inside = fix(latitudeE7 = 0, accuracyMillimeters = 1_000L)
        val outside = fix(latitudeE7 = 100_000, accuracyMillimeters = 1_000L)

        assertNotNull(
            AutomaticTerminalCandidateFactoryV1.create(
                callback(AutomaticGeofenceTransitionV1.EXIT),
                region,
                outside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
        assertNull(
            AutomaticTerminalCandidateFactoryV1.create(
                callback(AutomaticGeofenceTransitionV1.EXIT),
                region,
                inside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
    }

    // fail closed on immutable generation or terminal mismatch
    @Test
    fun mismatchedActivatedGeometryCreatesNoCandidate() {
        val inside = fix(latitudeE7 = 0, accuracyMillimeters = 1_000L)
        val wrongGeneration = callback(AutomaticGeofenceTransitionV1.ENTER).copy(
            configGeneration = ConfigGeneration(3L),
        )
        val wrongTerminal = callback(AutomaticGeofenceTransitionV1.ENTER).copy(terminalId = "8")

        assertNull(
            AutomaticTerminalCandidateFactoryV1.create(
                wrongGeneration,
                region,
                inside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
        assertNull(
            AutomaticTerminalCandidateFactoryV1.create(
                wrongTerminal,
                region,
                inside,
                "AAECAwQFBgcICQoLDA0ODw",
            ),
        )
    }

    // preserve transition outside the opaque request id
    @Test
    fun receiverRequestIdRequiresExplicitTransitionAttachment() {
        val encoded = AutomaticGeofenceRequestIdV1.encode(callback(AutomaticGeofenceTransitionV1.EXIT))
        val parsed = AutomaticGeofenceRequestIdV1.parse(encoded)

        assertEquals("7", parsed?.terminalId)
        assertEquals(2L, parsed?.configGeneration?.value)
        assertEquals(0L, parsed?.localWorkGeneration?.value)
        assertEquals(AutomaticGeofenceTransitionV1.ENTER, parsed?.transition)
        assertEquals(AutomaticGeofenceTransitionV1.EXIT, parsed?.copy(transition = AutomaticGeofenceTransitionV1.EXIT)?.transition)
    }

    // reject an old callback after stop and same-config reactivation
    @Test
    fun stopDuringLocationAcquisitionCannotStoreOrScheduleLaterWork() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                ),
                regions = listOf(region),
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            val callbackGeneration = runtime.coordinator.localWorkGeneration()
            runtime.coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED)
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            var scheduled = 0

            val outcome = AutomaticGeofenceCandidateCommitV1.commit(
                callback = callback(AutomaticGeofenceTransitionV1.ENTER),
                callbackLocalGeneration = callbackGeneration,
                fix = fix(latitudeE7 = 0, accuracyMillimeters = 1_000L),
                candidateId = "AAECAwQFBgcICQoLDA0ODw",
                coordinator = runtime.coordinator,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                // run the bounded callback
                parameters = {
                    AutomaticNativeParametersV1(
                        candidateRetentionMs = AUTOMATIC_CANDIDATE_RETENTION_MS,
                        fleetContextMaxAgeMs = 120_000L,
                        futureToleranceMs = 30_000L,
                        maxLocationAccuracyMillimeters = 100_000L,
                        maxPendingCandidates = 8,
                    )
                },
                // run the bounded callback
                permissionAvailable = { true },
                // run the bounded callback
                scheduleUpload = {
                    scheduled += 1
                    true
                },
            )

            assertEquals(AutomaticQueueMutationOutcome.BLOCKED, outcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(0, scheduled)
            assertTrue(runtime.coordinator.localWorkGeneration().value > callbackGeneration.value)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // restore and capture offline after ordinary process replacement
    @Test
    fun coldProcessCallbackRestoresPersistedGeometryWithoutNetwork() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                ),
                regions = listOf(region),
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            val publicConfigStore = AutomaticPublicTerminalConfigStoreV1(runtime.root, 20)
            assertTrue(publicConfigStore.replace(config))
            val replacementStager = TestRegionStagerV1()
            val replacementActivator = AutomaticTerminalConfigActivator(
                replacementStager,
                maxOwnedRegionCount = 20,
                initialLocalWorkGeneration = runtime.coordinator.localWorkGeneration(),
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
            var reconciliations = 0
            var scheduled = 0
            val callback = callback(AutomaticGeofenceTransitionV1.ENTER)

            val restored = AutomaticGeofenceLifecycleRecoveryV1.currentStatus(
                callback,
                replacementCoordinator,
                replacementActivator,
                // run the bounded callback
                restore = {
                    AutomaticPersistedTerminalConfigRecoveryV1.restore(
                        callback.configGeneration,
                        publicConfigStore,
                        replacementCoordinator,
                    )
                },
                // run the bounded callback
                reconcile = { reconciliations += 1 },
            )

            assertEquals(2L, restored?.configGeneration?.value)
            assertNotNull(replacementActivator.activeRegion("7", ConfigGeneration(2L)))
            assertEquals(0, reconciliations)
            val outcome = AutomaticGeofenceCandidateCommitV1.commit(
                callback = callback,
                callbackLocalGeneration = restored!!.localWorkGeneration,
                fix = fix(latitudeE7 = 0, accuracyMillimeters = 1_000L),
                candidateId = "AAECAwQFBgcICQoLDA0ODw",
                coordinator = replacementCoordinator,
                configActivator = replacementActivator,
                queue = runtime.queue,
                // run the bounded callback
                parameters = {
                    AutomaticNativeParametersV1(
                        candidateRetentionMs = AUTOMATIC_CANDIDATE_RETENTION_MS,
                        fleetContextMaxAgeMs = 120_000L,
                        futureToleranceMs = 30_000L,
                        maxLocationAccuracyMillimeters = 100_000L,
                        maxPendingCandidates = 8,
                    )
                },
                // run the bounded callback
                permissionAvailable = { true },
                // run the bounded callback
                scheduleUpload = {
                    scheduled += 1
                    true
                },
            )
            assertEquals(AutomaticQueueMutationOutcome.STORED, outcome)
            assertEquals(1, runtime.queue.pendingCount())
            assertEquals(1, scheduled)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // fail closed when cold-process reconciliation cannot restore geometry
    @Test
    fun coldProcessCallbackBlocksWithoutTrustedReconciliation() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                ),
                regions = listOf(region),
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            val replacementActivator = AutomaticTerminalConfigActivator(
                TestRegionStagerV1(),
                maxOwnedRegionCount = 20,
                initialLocalWorkGeneration = runtime.coordinator.localWorkGeneration(),
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

            assertNull(
                AutomaticGeofenceLifecycleRecoveryV1.currentStatus(
                    callback(AutomaticGeofenceTransitionV1.ENTER),
                    replacementCoordinator,
                    replacementActivator,
                ) {
                    Unit
                },
            )
            assertEquals(0, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // classify cold permission loss before attempting region restoration
    @Test
    fun coldProcessPermissionFailurePreservesExactCauseBeforeRestore() {
        val cases = listOf(
            Triple(
                "coarse only",
                AutomaticLocationPermissionDecisionV1.evaluate(true, false, false),
                AutomaticPermissionHealthV1.LIMITED_ACCURACY,
            ),
            Triple(
                "background revoked",
                AutomaticLocationPermissionDecisionV1.evaluate(true, true, false),
                AutomaticPermissionHealthV1.DENIED,
            ),
        )
        // isolate each denied cold-start classification
        for ((label, decision, expectedHealth) in cases) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(label, runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(1L)))
                val config = AutomaticTerminalConfigGeneration(
                    schemaVersion = 1,
                    configGeneration = ConfigGeneration(2L),
                    serverPolicyGeneration = ServerPolicyGeneration(1L),
                    contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                        AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                    ),
                    regions = listOf(region),
                )
                assertEquals(label, ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
                assertEquals(
                    label,
                    AutomaticQueueMutationOutcome.STORED,
                    runtime.queue.enqueue(
                        AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                    ),
                )
                val replacementStopPort = TestStopPortV1()
                val replacementActivator = AutomaticTerminalConfigActivator(
                    FailingRegionStagerV1(),
                    20,
                    LocalWorkGeneration(0),
                )
                val replacementCoordinator = AutomaticCheckinPolicyCoordinatorV1(
                    sdkInt = 35,
                    stateStore = runtime.stateStore,
                    configActivator = replacementActivator,
                    queue = runtime.queue,
                    credentialStore = runtime.credentialStore,
                    bindingStore = runtime.bindingStore,
                    stopPort = replacementStopPort,
                )
                var restores = 0
                var reconciliations = 0

                assertNull(
                    label,
                    AutomaticGeofencePermissionRecoveryV1.currentStatus(
                        callback = callback(AutomaticGeofenceTransitionV1.ENTER),
                        permissionDecision = decision,
                        coordinator = replacementCoordinator,
                        configActivator = replacementActivator,
                        // run the bounded callback
                        restore = {
                            restores += 1
                            replacementCoordinator.activateConfiguration(config)
                        },
                        // run the bounded callback
                        reconcile = { reconciliations += 1 },
                    ),
                )

                assertEquals(label, 0, restores)
                assertEquals(label, 0, reconciliations)
                assertEquals(label, expectedHealth, replacementCoordinator.status().permissionHealth)
                assertEquals(label, AutomaticMonitorHealthV1.STOPPED, replacementCoordinator.status().monitorHealth)
                assertEquals(label, 1L, replacementCoordinator.localWorkGeneration().value)
                assertEquals(label, 0, runtime.queue.pendingCount())
                assertEquals(label, 1, replacementStopPort.regions)
                assertEquals(label, 1, replacementStopPort.work)
                assertEquals(label, 1, replacementStopPort.requests)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // purge restored queued work when cold region registration is destructive
    @Test
    fun coldProcessRegistrationFailureInvalidatesRecoveredWork() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                ),
                regions = listOf(region),
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            val publicConfigStore = AutomaticPublicTerminalConfigStoreV1(runtime.root, 20)
            assertTrue(publicConfigStore.replace(config))
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            val replacementStopPort = TestStopPortV1()
            val replacementActivator = AutomaticTerminalConfigActivator(
                FailingRegionStagerV1(),
                maxOwnedRegionCount = 20,
                initialLocalWorkGeneration = runtime.coordinator.localWorkGeneration(),
            )
            val replacementCoordinator = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = replacementActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = replacementStopPort,
            )

            assertFalse(
                AutomaticPersistedTerminalConfigRecoveryV1.restore(
                    ConfigGeneration(2L),
                    publicConfigStore,
                    replacementCoordinator,
                ),
            )

            assertEquals(1L, replacementCoordinator.localWorkGeneration().value)
            assertEquals(
                AutomaticMonitorHealthV1.GEOFENCE_UNAVAILABLE,
                replacementCoordinator.status().monitorHealth,
            )
            assertFalse(replacementCoordinator.status().configurationUsable)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1, replacementStopPort.regions)
            assertEquals(1, replacementStopPort.work)
            assertEquals(1, replacementStopPort.requests)
            assertFalse(AutomaticLifecycleWorkGateV1.canSchedule(replacementCoordinator.status()))
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // recover a failed workmanager enqueue from the durable zero-data latch
    @Test
    fun storedCandidateRetainsScheduleRequirementAcrossProcessReplacement() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(listOf(region)),
                ),
                regions = listOf(region),
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            val latch = AutomaticUploadScheduleLatchV1(runtime.root)
            var firstSchedules = 0

            val outcome = AutomaticGeofenceCandidateCommitV1.commit(
                callback = callback(AutomaticGeofenceTransitionV1.ENTER),
                callbackLocalGeneration = runtime.coordinator.localWorkGeneration(),
                fix = fix(latitudeE7 = 0, accuracyMillimeters = 1_000L),
                candidateId = "AAECAwQFBgcICQoLDA0ODw",
                coordinator = runtime.coordinator,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                // run the bounded callback
                parameters = {
                    AutomaticNativeParametersV1(
                        candidateRetentionMs = AUTOMATIC_CANDIDATE_RETENTION_MS,
                        fleetContextMaxAgeMs = 120_000L,
                        futureToleranceMs = 30_000L,
                        maxLocationAccuracyMillimeters = 100_000L,
                        maxPendingCandidates = 8,
                    )
                },
                // run the bounded callback
                permissionAvailable = { true },
                // run the bounded callback
                scheduleUpload = {
                    firstSchedules += 1
                    false
                },
                markScheduleRequired = latch::markRequired,
            )

            assertEquals(AutomaticQueueMutationOutcome.STORED, outcome)
            assertEquals(1, firstSchedules)
            assertTrue(latch.required())
            val replacementLatch = AutomaticUploadScheduleLatchV1(runtime.root)
            var replacementSchedules = 0
            assertTrue(
                AutomaticDurableUploadScheduleRecoveryV1.reconcile(
                    runtime.queue.pendingCount(),
                    replacementLatch,
                ) {
                    replacementSchedules += 1
                    replacementLatch.clear()
                },
            )
            assertEquals(1, replacementSchedules)
            assertTrue(!replacementLatch.required())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }
}
