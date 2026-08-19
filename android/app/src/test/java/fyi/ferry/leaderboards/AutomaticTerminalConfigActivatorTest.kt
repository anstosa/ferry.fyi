package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticTerminalConfigActivatorTest {
    // define the native contract
    private class FakeStager : TerminalRegionGenerationStager {
        var stageSucceeds = true
        var commitSucceeds = true
        var stagedOverride: Set<String>? = null
        val discarded = mutableListOf<ConfigGeneration>()
        val committed = mutableListOf<ConfigGeneration>()
        val stageAttempts = mutableListOf<ConfigGeneration>()
        private val staged = mutableMapOf<ConfigGeneration, Set<String>>()

        // stage an isolated generation
        override fun stage(config: AutomaticTerminalConfigGeneration): Boolean {
            stageAttempts += config.configGeneration

            // simulate a failed platform registration
            if (!stageSucceeds) {
                return false
            }

            // run the bounded callback
            staged[config.configGeneration] = stagedOverride ?: config.regions.map { region -> region.terminalId }.toSet()
            return true
        }

        // expose the verified owned set
        override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> =
            staged[configGeneration].orEmpty()

        // commit the verified namespace
        override fun commit(configGeneration: ConfigGeneration): Boolean {
            // simulate an atomic commit failure
            if (!commitSucceeds) {
                return false
            }

            committed += configGeneration
            return true
        }

        // discard only the named namespace
        override fun discard(configGeneration: ConfigGeneration) {
            discarded += configGeneration
            staged.remove(configGeneration)
        }
    }

    // create a complete hashed generation
    private fun config(
        configGeneration: Long,
        serverPolicyGeneration: Long,
        terminalIds: List<String> = listOf("7", "12"),
    ): AutomaticTerminalConfigGeneration {
        // run the bounded callback
        val regions = terminalIds.mapIndexed { index, terminalId ->
            AutomaticTerminalRegion(
                terminalId = terminalId,
                latitudeE7 = 470_000_000 + index,
                longitudeE7 = -1_220_000_000 - index,
                radiusMillimeters = 304_800,
                configGeneration = ConfigGeneration(configGeneration),
            )
        }
        return AutomaticTerminalConfigGeneration(
            schemaVersion = 1,
            configGeneration = ConfigGeneration(configGeneration),
            serverPolicyGeneration = ServerPolicyGeneration(serverPolicyGeneration),
            contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
            ),
            regions = regions,
        )
    }

    // prove partial initial activation stays disabled
    @Test
    fun partialInitialGenerationStaysDisabled() {
        // run the bounded callback
        val stager = FakeStager().apply { stagedOverride = setOf("7") }
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)

        assertEquals(ConfigActivationOutcome.DISABLED, activator.activate(config(1, 10)))
        assertEquals(
            AutomaticNativeGenerationState(null, null, LocalWorkGeneration(0), configurationUsable = false),
            activator.state(),
        )
        assertEquals(listOf(ConfigGeneration(1)), stager.discarded)
    }

    // prove failed replacement preserves the exact prior generation
    @Test
    fun failedReplacementKeepsPriorGeneration() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))

        val priorState = activator.state()
        stager.stagedOverride = setOf("7")

        assertEquals(ConfigActivationOutcome.KEPT_PREVIOUS, activator.activate(config(2, 10)))
        assertEquals(priorState, activator.state())
        assertEquals(listOf(ConfigGeneration(2)), stager.discarded)
    }

    // prove commit failure preserves the exact prior generation
    @Test
    fun failedCommitKeepsPriorGeneration() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))

        val priorState = activator.state()
        stager.commitSucceeds = false

        assertEquals(ConfigActivationOutcome.KEPT_PREVIOUS, activator.activate(config(2, 10)))
        assertEquals(priorState, activator.state())
        assertEquals(listOf(ConfigGeneration(2)), stager.discarded)
    }

    // prove the three generation concepts advance independently
    @Test
    fun generationsAdvanceOnlyForTheirOwnCause() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(
            stager = stager,
            maxOwnedRegionCount = 20,
            initialLocalWorkGeneration = LocalWorkGeneration(7),
        )
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))
        val initial = activator.state()

        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(2, 10, terminalIds = listOf("7", "13"))))
        val contentChanged = activator.state()
        assertEquals(ConfigGeneration(2), contentChanged.configGeneration)
        assertEquals(initial.serverPolicyGeneration, contentChanged.serverPolicyGeneration)
        assertEquals(initial.localWorkGeneration, contentChanged.localWorkGeneration)

        assertTrue(activator.applyServerPolicyGeneration(ServerPolicyGeneration(11)))
        val policyChanged = activator.state()
        assertEquals(contentChanged.configGeneration, policyChanged.configGeneration)
        assertEquals(ServerPolicyGeneration(11), policyChanged.serverPolicyGeneration)
        assertEquals(contentChanged.localWorkGeneration, policyChanged.localWorkGeneration)

        assertTrue(activator.invalidateLocalWork())
        val localWorkChanged = activator.state()
        assertEquals(policyChanged.configGeneration, localWorkChanged.configGeneration)
        assertEquals(policyChanged.serverPolicyGeneration, localWorkChanged.serverPolicyGeneration)
        assertEquals(LocalWorkGeneration(8), localWorkChanged.localWorkGeneration)
        assertFalse(localWorkChanged.configurationUsable)
    }

    // prove immutable generation content cannot mutate
    @Test
    fun sameGenerationWithDifferentContentIsRejected() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))

        val priorState = activator.state()
        assertEquals(
            ConfigActivationOutcome.KEPT_PREVIOUS,
            activator.activate(config(1, 10, terminalIds = listOf("7", "13"))),
        )
        assertEquals(priorState, activator.state())
    }

    // prove hash mismatch fails closed
    @Test
    fun contentHashMismatchIsRejected() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        val valid = config(1, 10)
        val invalid = valid.copy(contentHashHex = "0".repeat(64))

        assertEquals(ConfigActivationOutcome.DISABLED, activator.activate(invalid))
        assertEquals(emptyList<ConfigGeneration>(), stager.committed)
    }

    // prove the supplied platform budget fails closed
    @Test
    fun regionCountAbovePlatformBudgetIsRejected() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 1)

        assertEquals(ConfigActivationOutcome.DISABLED, activator.activate(config(1, 10)))
        assertEquals(emptyList<ConfigGeneration>(), stager.committed)
    }

    // prove policy cannot regress during config activation
    @Test
    fun configActivationCannotRegressServerPolicy() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))
        val priorState = activator.state()

        assertEquals(ConfigActivationOutcome.KEPT_PREVIOUS, activator.activate(config(2, 9)))
        assertEquals(priorState, activator.state())
    }

    // match the shared canonical region json
    @Test
    fun regionCanonicalizationIsSortedAndGenerationIndependent() {
        val generation = config(1, 10, terminalIds = listOf("7", "12"))
        assertEquals(
            "[{\"latitudeE7\":470000001,\"longitudeE7\":-1220000001,\"radiusMillimeters\":304800,\"terminalId\":\"12\"}," +
                "{\"latitudeE7\":470000000,\"longitudeE7\":-1220000000,\"radiusMillimeters\":304800,\"terminalId\":\"7\"}]",
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(generation.regions).toString(Charsets.UTF_8),
        )
    }

    // prove invalidated immutable content fully reactivates
    @Test
    fun invalidatedCurrentGenerationRestagesBeforeBecomingUsable() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))
        assertTrue(activator.invalidateLocalWork())

        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))
        assertEquals(
            AutomaticNativeGenerationState(
                configGeneration = ConfigGeneration(1),
                serverPolicyGeneration = ServerPolicyGeneration(10),
                localWorkGeneration = LocalWorkGeneration(1),
                configurationUsable = true,
            ),
            activator.state(),
        )
        assertEquals(listOf(ConfigGeneration(1), ConfigGeneration(1)), stager.stageAttempts)
        assertEquals(listOf(ConfigGeneration(1), ConfigGeneration(1)), stager.committed)
    }

    // prove failed immutable restage remains disabled
    @Test
    fun failedRestageOfInvalidatedGenerationRemainsDisabled() {
        val stager = FakeStager()
        val activator = AutomaticTerminalConfigActivator(stager, maxOwnedRegionCount = 20)
        assertEquals(ConfigActivationOutcome.ACTIVATED, activator.activate(config(1, 10)))
        assertTrue(activator.invalidateLocalWork())
        val invalidatedState = activator.state()
        stager.stageSucceeds = false

        assertEquals(ConfigActivationOutcome.DISABLED, activator.activate(config(1, 10)))
        assertEquals(invalidatedState, activator.state())
        assertFalse(activator.state().configurationUsable)
        assertEquals(listOf(ConfigGeneration(1), ConfigGeneration(1)), stager.stageAttempts)
        assertEquals(listOf(ConfigGeneration(1)), stager.committed)
    }
}
