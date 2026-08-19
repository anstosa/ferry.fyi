package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticOwnedRegionRegistrationV1Test {
    // define the native contract
    private class Platform : AutomaticOwnedRegionPlatformV1 {
        var registeredGeneration: ConfigGeneration? = null
        var registeredLocalGeneration: LocalWorkGeneration? = null
        var registeredCount = 0
        var receiversEnabled = false
        var removeCalls = 0
        var failRemoval = false
        var failAllAdds = false
        var failGeneration: ConfigGeneration? = null

        // replace the current simulated platform registration
        override fun add(config: AutomaticTerminalConfigGeneration): Boolean {
            return add(config, LocalWorkGeneration(0))
        }

        // replace the generation-bound callback namespace
        override fun add(
            config: AutomaticTerminalConfigGeneration,
            localWorkGeneration: LocalWorkGeneration,
        ): Boolean {
            // inject complete platform registration failure
            if (failAllAdds || config.configGeneration == failGeneration) {
                return false
            }
            registeredGeneration = config.configGeneration
            registeredLocalGeneration = localWorkGeneration
            registeredCount = config.regions.size
            return true
        }

        // remove even when this process has no memory state
        override fun removeAll(): Boolean {
            removeCalls += 1
            // preserve registration on injected platform failure
            if (failRemoval) {
                return false
            }
            registeredGeneration = null
            registeredLocalGeneration = null
            registeredCount = 0
            return true
        }

        // expose the two-component aggregate state
        override fun setReceiversEnabled(enabled: Boolean): Boolean {
            receiversEnabled = enabled
            return true
        }
    }

    // build one valid public region generation
    private fun config(generation: Long, count: Int = 2): AutomaticTerminalConfigGeneration {
        // create each simulated public region
        val regions = (1..count).map { index ->
            AutomaticTerminalRegion(
                terminalId = index.toString(),
                latitudeE7 = 476_000_000 + index,
                longitudeE7 = -1_223_000_000 - index,
                radiusMillimeters = 250_000L,
                configGeneration = ConfigGeneration(generation),
            )
        }
        return AutomaticTerminalConfigGeneration(
            schemaVersion = 1,
            configGeneration = ConfigGeneration(generation),
            serverPolicyGeneration = ServerPolicyGeneration(generation),
            contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
            ),
            regions = regions,
        )
    }

    // remove recovered registrations during a replacement-process stop
    @Test
    fun processReplacementStopRemovesByStableOwnershipBoundary() {
        val platform = Platform()
        val firstProcess = AutomaticOwnedRegionRegistrationV1(platform)
        assertTrue(firstProcess.stage(config(1L)))
        assertTrue(firstProcess.commit(ConfigGeneration(1L)))
        assertTrue(platform.receiversEnabled)

        val replacementProcess = AutomaticOwnedRegionRegistrationV1(platform)
        assertTrue(replacementProcess.discardAll())

        assertEquals(null, platform.registeredGeneration)
        assertEquals(0, platform.registeredCount)
        assertFalse(platform.receiversEnabled)
        assertTrue(platform.removeCalls >= 2)
    }

    // remove stale generation and recover the region cap on re-registration
    @Test
    fun processReplacementReregistrationContainsOnlyNewGeneration() {
        val platform = Platform()
        val firstProcess = AutomaticOwnedRegionRegistrationV1(platform)
        assertTrue(firstProcess.stage(config(1L, count = 4)))
        assertTrue(firstProcess.commit(ConfigGeneration(1L)))

        val replacementProcess = AutomaticOwnedRegionRegistrationV1(platform)
        assertTrue(replacementProcess.stage(config(2L, count = 2)))
        assertTrue(replacementProcess.commit(ConfigGeneration(2L)))

        assertEquals(ConfigGeneration(2L), platform.registeredGeneration)
        assertEquals(2, platform.registeredCount)
        assertTrue(platform.receiversEnabled)
        assertEquals(setOf("1", "2"), replacementProcess.stagedTerminalIds(ConfigGeneration(2L)))
    }

    // keep passive callbacks disabled when recovered removal fails
    @Test
    fun failedRecoveredRemovalFailsClosedAndRemainsIdempotent() {
        // run the bounded callback
        val platform = Platform().apply {
            registeredGeneration = ConfigGeneration(1L)
            registeredCount = 2
            receiversEnabled = true
            failRemoval = true
        }
        val replacementProcess = AutomaticOwnedRegionRegistrationV1(platform)

        assertFalse(replacementProcess.stage(config(2L)))
        assertFalse(platform.receiversEnabled)
        assertFalse(replacementProcess.discardAll())
        assertFalse(platform.receiversEnabled)
        assertEquals(ConfigGeneration(1L), platform.registeredGeneration)
    }

    // never claim a phantom prior config after failed replacement and restore
    @Test
    fun failedReplacementAndRestoreDegradesCoordinatorTruthfully() {
        val platform = Platform()
        val registration = AutomaticOwnedRegionRegistrationV1(platform)
        val productionWrapper = AutomaticAndroidRegionStagerV1(registration) { true }
        val runtime = testSecureRuntime({ 2_000L }, stager = productionWrapper)
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            assertEquals(ConfigActivationOutcome.ACTIVATED, runtime.coordinator.activateConfiguration(config(1L)))
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            assertTrue(runtime.coordinator.status().configurationUsable)
            assertTrue(platform.receiversEnabled)
            platform.failAllAdds = true

            val outcome = runtime.coordinator.activateConfiguration(config(2L))

            assertEquals(ConfigActivationOutcome.DISABLED, outcome)
            assertFalse(runtime.coordinator.status().configurationUsable)
            assertEquals(AutomaticMonitorHealthV1.GEOFENCE_UNAVAILABLE, runtime.coordinator.status().monitorHealth)
            assertEquals(1L, runtime.coordinator.localWorkGeneration().value)
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(1, runtime.stopPort.regions)
            assertEquals(1, runtime.stopPort.work)
            assertEquals(1, runtime.stopPort.requests)
            assertFalse(platform.receiversEnabled)
            assertEquals(null, platform.registeredGeneration)
            assertFalse(registration.hasUsableRegistration())
            assertFalse(productionWrapper.hasUsableRegistration())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // restore the exact nonzero callback generation after replacement failure
    @Test
    fun failedReplacementRestoresPriorLocalGeneration() {
        val platform = Platform()
        val registration = AutomaticOwnedRegionRegistrationV1(platform)
        val priorGeneration = LocalWorkGeneration(7L)
        assertTrue(registration.stage(config(1L), priorGeneration))
        assertTrue(registration.commit(ConfigGeneration(1L)))
        platform.failGeneration = ConfigGeneration(2L)

        assertFalse(registration.stage(config(2L), LocalWorkGeneration(8L)))

        assertTrue(registration.hasUsableRegistration())
        assertEquals(ConfigGeneration(1L), platform.registeredGeneration)
        assertEquals(priorGeneration, platform.registeredLocalGeneration)
        assertTrue(platform.receiversEnabled)
    }
}
