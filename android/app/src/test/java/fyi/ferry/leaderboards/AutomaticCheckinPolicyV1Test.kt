package fyi.ferry.leaderboards

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticCheckinPolicyV1Test {
    // enforce the android-q automatic floor without changing manual support
    @Test
    fun sdkFloorRejectsTwentySixThroughTwentyEight() {
        // verify every unsupported sdk explicitly
        for (sdkInt in 26..28) {
            assertFalse(AutomaticAndroidEligibilityV1.isSupported(sdkInt))
        }
        assertTrue(AutomaticAndroidEligibilityV1.isSupported(29))
        assertTrue(AutomaticAndroidEligibilityV1.isSupported(36))
    }

    // invalidate queue work regions requests and generations for every stop
    @Test
    fun exhaustiveStopTriggersPurgeAndInvalidate() {
        // test every exhaustive trigger independently
        for (trigger in AutomaticStopTriggerV1.entries) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
                assertEquals(
                    AutomaticQueueMutationOutcome.STORED,
                    runtime.queue.enqueue(
                        AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                    ),
                )

                assertTrue(trigger.name, runtime.coordinator.knownStop(trigger))

                assertEquals(trigger.name, 1L, runtime.coordinator.localWorkGeneration().value)
                assertFalse(trigger.name, runtime.coordinator.status().configurationUsable)
                assertEquals(trigger.name, 0, runtime.queue.pendingCount())
                assertEquals(trigger.name, 1, runtime.stopPort.regions)
                assertEquals(trigger.name, 1, runtime.stopPort.work)
                assertEquals(trigger.name, 1, runtime.stopPort.requests)
                // delete identity secrets only for ending triggers
                if (trigger.identityEnding) {
                    assertNull(trigger.name, runtime.bindingStore.read())
                    assertNull(trigger.name, runtime.credentialStore.read())
                    assertEquals(trigger.name, 1, runtime.queueAead.deleteCount)
                    assertTrue(trigger.name, runtime.credentialAead.deleteCount >= 1)
                // branch on the current state
                } else {
                    assertNotNull(trigger.name, runtime.bindingStore.read())
                    assertNotNull(trigger.name, runtime.credentialStore.read()?.also(AutomaticCredentialV1::wipe))
                    assertEquals(trigger.name, 0, runtime.queueAead.deleteCount)
                }
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // do not infer remote kill from stale offline wakes
    @Test
    fun offlineWakesCollectOnlyUntilAuthoritativeDenial() {
        val runtime = testSecureRuntime({ 4_000L })
        // attempt the protected operation
        try {
            val ids = listOf(
                "AAECAwQFBgcICQoLDA0ODw",
                "EBESExQVFhcYGRobHB0eHw",
                "_____________________w",
            )
            // simulate three disconnected stale-policy region wakes
            for ((index, id) in ids.withIndex()) {
                val candidate = testTerminalCandidate(
                    candidateId = id,
                    capturedAtMs = 1_000L + index,
                    terminalId = (7 + index).toString(),
                )
                assertEquals(
                    AutomaticQueueMutationOutcome.STORED,
                    runtime.queue.enqueue(
                        AutomaticQueuedCandidateV1(candidate, runtime.coordinator.localWorkGeneration()),
                    ),
                )
            }
            assertEquals(3, runtime.queue.pendingCount())
            assertEquals(0L, runtime.coordinator.localWorkGeneration().value)

            assertTrue(
                runtime.coordinator.reconcileAuthoritativePolicy(
                    ServerPolicyGeneration(6L),
                    enabled = false,
                ),
            )

            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(6L, runtime.coordinator.status().serverPolicyGeneration?.value)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject policy rollback without changing local work
    @Test
    fun authoritativePolicyGenerationNeverRollsBack() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.coordinator.reconcileAuthoritativePolicy(ServerPolicyGeneration(9L), enabled = true))
            assertFalse(runtime.coordinator.reconcileAuthoritativePolicy(ServerPolicyGeneration(8L), enabled = false))
            assertEquals(9L, runtime.coordinator.status().serverPolicyGeneration?.value)
            assertEquals(0L, runtime.coordinator.localWorkGeneration().value)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // persist local generation across process restart seams
    @Test
    fun localGenerationPersistsAcrossRestart() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED))
            val restored = runtime.stateStore.read()
            assertNotNull(restored)
            assertEquals(1L, restored!!.localWorkGeneration.value)
            assertFalse(restored.configurationUsable)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // replay independent stop authority after aggregate state write failure
    @Test
    fun pendingStopSurvivesAggregateWriteFailureAndProcessReplacement() {
        val fileOps = TestAtomicFileOpsV1()
        val runtime = testSecureRuntime({ 2_000L }, fileOps = fileOps)
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            fileOps.failReplaceName = "runtime-state-v1.bin"

            assertFalse(runtime.coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED))

            fileOps.failReplaceName = null
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )
            assertEquals(AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
            assertFalse(replacement.status().configurationUsable)
            assertEquals(1L, replacement.localWorkGeneration().value)
            assertNotNull(runtime.credentialStore.read()?.also(AutomaticCredentialV1::wipe))
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // restore stop cleanup without double-advancing the config callback generation
    @Test
    fun pendingStopRestartConvergesActivatorToExactPersistedGeneration() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(1L)))
            val regions = listOf(
                AutomaticTerminalRegion(
                    terminalId = "7",
                    latitudeE7 = 476_000_000,
                    longitudeE7 = -1_223_000_000,
                    radiusMillimeters = 250_000L,
                    configGeneration = ConfigGeneration(1L),
                ),
            )
            val config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(1L),
                serverPolicyGeneration = ServerPolicyGeneration(1L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
                ),
                regions = regions,
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config))
            runtime.stopPort.regionsSucceed = false

            assertFalse(runtime.coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED))
            assertEquals(1L, runtime.stateStore.read()?.localWorkGeneration?.value)
            assertTrue(runtime.stateStore.read()?.stopCleanupRequired == true)

            runtime.stopPort.regionsSucceed = true
            val freshStager = TestRegionStagerV1()
            val freshActivator = AutomaticTerminalConfigActivator(
                freshStager,
                20,
                LocalWorkGeneration(1L),
            )
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = freshActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )

            assertTrue(replacement.retryPendingStopEffects())
            assertEquals(LocalWorkGeneration(1L), freshActivator.state().localWorkGeneration)
            assertTrue(replacement.replaceEnrollment(ServerPolicyGeneration(2L)))
            // bind replacement geometry to its immutable generation
            val replacementRegions = regions.map { region ->
                region.copy(configGeneration = ConfigGeneration(2L))
            }
            val replacementConfig = config.copy(
                configGeneration = ConfigGeneration(2L),
                serverPolicyGeneration = ServerPolicyGeneration(2L),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(replacementRegions),
                ),
                regions = replacementRegions,
            )
            assertEquals(ConfigActivationOutcome.ACTIVATED, replacement.activateConfiguration(replacementConfig))

            assertEquals(replacement.localWorkGeneration(), freshActivator.state().localWorkGeneration)
            assertEquals(
                replacement.localWorkGeneration(),
                freshStager.stagedLocalGenerations[ConfigGeneration(2L)],
            )
            assertTrue(replacement.accepts(freshActivator.state().localWorkGeneration))
            assertEquals(2L, replacement.localWorkGeneration().value)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // quarantine every sensitive store when pending-stop authority is corrupt
    @Test
    fun corruptPendingStopCannotRestorePriorHealthyState() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            assertTrue(
                runtime.stateStore.replace(
                    runtime.coordinator.status().copy(
                        configGeneration = ConfigGeneration(1L),
                        configurationUsable = true,
                        monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                    ),
                ),
            )
            File(runtime.root, "runtime-pending-stop-v1.bin").writeBytes(byteArrayOf(1, 2, 3))

            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )

            assertEquals(AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
            assertFalse(replacement.status().configurationUsable)
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // quarantine healthy aggregate state when identity material cannot be read
    @Test
    fun healthyStateQuarantinesMissingOrCorruptIdentityMaterialAcrossRestart() {
        val corruptions = listOf<Pair<String, (TestSecureRuntimeV1) -> Unit>>(
            "missing sentinel" to { runtime -> File(runtime.root, "installation-v1.bin").delete() },
            // run the bounded callback
            "corrupt credential" to { runtime ->
                File(runtime.root, "credential-v1.bin").writeBytes(byteArrayOf(1, 2, 3))
            },
            "missing credential key" to { runtime -> runtime.credentialAead.deleteKey() },
        )
        // isolate every physical-material inconsistency
        for ((label, corrupt) in corruptions) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(label, runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
                assertTrue(
                    label,
                    runtime.stateStore.replace(
                        runtime.coordinator.status().copy(
                            configGeneration = ConfigGeneration(4L),
                            serverPolicyGeneration = ServerPolicyGeneration(8L),
                            localWorkGeneration = LocalWorkGeneration(6L),
                            configurationUsable = true,
                            monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                        ),
                    ),
                )
                corrupt(runtime)

                val replacement = AutomaticCheckinPolicyCoordinatorV1(
                    sdkInt = 35,
                    stateStore = runtime.stateStore,
                    configActivator = runtime.configActivator,
                    queue = runtime.queue,
                    credentialStore = runtime.credentialStore,
                    bindingStore = runtime.bindingStore,
                    stopPort = runtime.stopPort,
                )

                assertEquals(label, AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
                assertFalse(label, replacement.status().configurationUsable)
                assertEquals(label, 7L, replacement.localWorkGeneration().value)
                assertNull(label, runtime.credentialStore.read())
                assertNull(label, runtime.bindingStore.read())

                val secondReplacement = AutomaticCheckinPolicyCoordinatorV1(
                    sdkInt = 35,
                    stateStore = runtime.stateStore,
                    configActivator = runtime.configActivator,
                    queue = runtime.queue,
                    credentialStore = runtime.credentialStore,
                    bindingStore = runtime.bindingStore,
                    stopPort = runtime.stopPort,
                )
                assertEquals(label, AutomaticMonitorHealthV1.STOPPED, secondReplacement.status().monitorHealth)
                assertEquals(label, 7L, secondReplacement.localWorkGeneration().value)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // stop and purge before callbacks continue under every invalid permission state
    @Test
    fun permissionDowngradesApplyCompleteDurableStopEffects() {
        val cases = listOf(
            Triple("permission denied", false, false),
            Triple("accuracy downgraded", true, false),
            Triple("background revoked", true, true),
        )
        // isolate foreground accuracy and background gates
        for ((label, coarseGranted, fineGranted) in cases) {
            val runtime = testSecureRuntime({ 2_000L })
            // attempt the protected operation
            try {
                assertTrue(label, runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
                assertEquals(
                    label,
                    AutomaticQueueMutationOutcome.STORED,
                    runtime.queue.enqueue(
                        AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                    ),
                )
                val decision = AutomaticLocationPermissionDecisionV1.evaluate(
                    coarseGranted = coarseGranted,
                    fineGranted = fineGranted,
                    backgroundGranted = false,
                )

                assertFalse(label, decision.enforce(runtime.coordinator))
                // preserve the exact coarse-only classification
                val expectedHealth = if (label == "accuracy downgraded") {
                    AutomaticPermissionHealthV1.LIMITED_ACCURACY
                // branch on the current state
                } else {
                    AutomaticPermissionHealthV1.DENIED
                }

                assertEquals(label, 1L, runtime.coordinator.localWorkGeneration().value)
                assertFalse(label, runtime.coordinator.status().configurationUsable)
                assertEquals(label, expectedHealth, runtime.coordinator.status().permissionHealth)
                assertEquals(label, 0, runtime.queue.pendingCount())
                assertEquals(label, 1, runtime.stopPort.regions)
                assertEquals(label, 1, runtime.stopPort.work)
                assertEquals(label, 1, runtime.stopPort.requests)
            // release protected state
            } finally {
                runtime.root.deleteRecursively()
            }
        }
    }

    // classify full permission without mutating active work
    @Test
    fun completeLocationPermissionKeepsWorkActive() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val decision = AutomaticLocationPermissionDecisionV1.evaluate(
                coarseGranted = true,
                fineGranted = true,
                backgroundGranted = true,
            )

            assertTrue(decision.enforce(runtime.coordinator))
            assertEquals(0L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(0, runtime.stopPort.regions)
            assertEquals(0, runtime.stopPort.work)
            assertEquals(0, runtime.stopPort.requests)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // degrade geofence service failures while completing all stop effects
    @Test
    fun geofenceServiceFailureStopsEveryOwnedWorkSurface() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0))),
            )

            assertTrue(runtime.coordinator.knownStop(AutomaticStopTriggerV1.GEOFENCE_UNAVAILABLE))

            assertEquals(AutomaticMonitorHealthV1.GEOFENCE_UNAVAILABLE, runtime.coordinator.status().monitorHealth)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1, runtime.stopPort.regions)
            assertEquals(1, runtime.stopPort.work)
            assertEquals(1, runtime.stopPort.requests)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // replay a valid candidate stop authority before lifecycle work after restart
    @Test
    fun pendingCandidateStopAuthorityPurgesBeforeOfflineLifecycleWork() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(3L)))
            assertTrue(
                runtime.stateStore.replace(
                    runtime.coordinator.status().copy(
                        configGeneration = ConfigGeneration(2L),
                        serverPolicyGeneration = ServerPolicyGeneration(3L),
                        configurationUsable = true,
                        monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                    ),
                ),
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            assertTrue(
                runtime.queue.stageStopAuthority(
                    AutomaticPendingStopAuthorityV1(
                        outcome = "enrollment_revoked",
                        serverPolicyGeneration = ServerPolicyGeneration(3L),
                        localWorkGeneration = LocalWorkGeneration(0),
                    ),
                ),
            )
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )

            assertEquals(
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
                AutomaticPendingCandidateStopRecoveryV1.replay(runtime.queue, replacement),
            )

            assertEquals(1L, replacement.localWorkGeneration().value)
            assertEquals("enrollment_revoked", replacement.status().lastOutcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertFalse(runtime.queue.hasPendingStopAuthority())
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
            assertEquals(1, runtime.stopPort.regions)
            assertEquals(1, runtime.stopPort.work)
            assertEquals(1, runtime.stopPort.requests)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // suppress receiver persistence when final authority already owns the generation
    @Test
    fun pendingCandidateStopAuthorityBlocksReceiverInboxAdmission() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(3L)))
            assertTrue(
                runtime.queue.stageStopAuthority(
                    AutomaticPendingStopAuthorityV1(
                        outcome = "enrollment_revoked",
                        serverPolicyGeneration = ServerPolicyGeneration(3L),
                        localWorkGeneration = LocalWorkGeneration(0),
                    ),
                ),
            )
            val inbox = AutomaticEncryptedGeofenceCallbackInboxV1(
                directory = File(runtime.root, "callbacks"),
                bindingStore = runtime.bindingStore,
                aead = TestAeadV1(),
            )
            val callback = AutomaticGeofenceCallbackV1(
                terminalId = "7",
                configGeneration = ConfigGeneration(2L),
                localWorkGeneration = LocalWorkGeneration(0),
                transition = AutomaticGeofenceTransitionV1.ENTER,
            )

            assertFalse(
                AutomaticGeofenceCallbackAdmissionV1.enqueue(
                    callback,
                    runtime.queue,
                    runtime.coordinator,
                    inbox,
                ),
            )

            assertEquals(0, inbox.pendingCount())
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals("enrollment_revoked", runtime.coordinator.status().lastOutcome)
            assertEquals(0, runtime.queue.pendingCount())
            assertFalse(runtime.queue.hasPendingStopAuthority())
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
            assertEquals(1, runtime.stopPort.regions)
            assertEquals(1, runtime.stopPort.work)
            assertEquals(1, runtime.stopPort.requests)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // quarantine an unreadable candidate authority instead of treating it as absent
    @Test
    fun corruptCandidateStopAuthorityQuarantinesIdentityAcrossRestart() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(3L)))
            assertTrue(
                runtime.stateStore.replace(
                    runtime.coordinator.status().copy(
                        configGeneration = ConfigGeneration(2L),
                        serverPolicyGeneration = ServerPolicyGeneration(3L),
                        configurationUsable = true,
                        monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                    ),
                ),
            )
            File(runtime.root, "candidates/pending-stop-authority-v1.bin").apply {
                parentFile?.mkdirs()
                writeBytes(byteArrayOf(1, 2, 3))
            }
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = runtime.configActivator,
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )

            assertEquals(
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
                AutomaticPendingCandidateStopRecoveryV1.replay(runtime.queue, replacement),
            )

            assertEquals(1L, replacement.localWorkGeneration().value)
            assertEquals(AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
            assertFalse(runtime.queue.hasPendingStopAuthority())
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // quarantine all prior work when the local generation cannot advance
    @Test
    fun generationExhaustionPurgesEverySensitiveWorkSurface() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential(3L)))
            assertTrue(
                runtime.stateStore.replace(
                    runtime.coordinator.status().copy(
                        configGeneration = ConfigGeneration(2L),
                        serverPolicyGeneration = ServerPolicyGeneration(3L),
                        localWorkGeneration = LocalWorkGeneration(Long.MAX_VALUE),
                        configurationUsable = true,
                        monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                    ),
                ),
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(
                        testTerminalCandidate(),
                        LocalWorkGeneration(Long.MAX_VALUE),
                    ),
                ),
            )
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = AutomaticTerminalConfigActivator(
                    TestRegionStagerV1(),
                    20,
                    LocalWorkGeneration(Long.MAX_VALUE),
                ),
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = runtime.stopPort,
            )

            assertFalse(replacement.knownStop(AutomaticStopTriggerV1.LOCAL_DISABLE))

            assertEquals(Long.MAX_VALUE, replacement.localWorkGeneration().value)
            assertEquals(AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
            assertFalse(replacement.status().configurationUsable)
            assertFalse(replacement.accepts(LocalWorkGeneration(Long.MAX_VALUE)))
            assertEquals(0, runtime.queue.pendingCount())
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
            assertEquals(1, runtime.stopPort.regions)
            assertEquals(1, runtime.stopPort.work)
            assertEquals(1, runtime.stopPort.requests)
            assertFalse(AutomaticLifecycleWorkGateV1.canSchedule(replacement.status()))
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }
}
