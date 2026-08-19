package fyi.ferry.leaderboards

import java.nio.charset.StandardCharsets

@JvmInline
// define the native contract
internal value class ConfigGeneration(val value: Long)

@JvmInline
// define the native contract
internal value class ServerPolicyGeneration(val value: Long)

@JvmInline
// define the native contract
internal value class LocalWorkGeneration(val value: Long)

// define the native contract
internal data class AutomaticTerminalRegion(
    val terminalId: String,
    val latitudeE7: Int,
    val longitudeE7: Int,
    val radiusMillimeters: Long,
    val configGeneration: ConfigGeneration,
)

// define the native contract
internal data class AutomaticTerminalConfigGeneration(
    val schemaVersion: Int,
    val configGeneration: ConfigGeneration,
    val serverPolicyGeneration: ServerPolicyGeneration,
    val contentHashHex: String,
    val regions: List<AutomaticTerminalRegion>,
)

// define the native contract
internal object AutomaticTerminalRegionCanonicalizerV1 {
    // serialize generation-independent region content
    fun canonicalBytes(regions: List<AutomaticTerminalRegion>): ByteArray {
        // run the bounded callback
        val canonical = regions.sortedWith { left, right -> compareUtf8(left.terminalId, right.terminalId) }
            // run the bounded callback
            .joinToString(prefix = "[", postfix = "]", separator = ",") { region ->
                "{\"latitudeE7\":${region.latitudeE7},\"longitudeE7\":${region.longitudeE7}," +
                    "\"radiusMillimeters\":${region.radiusMillimeters},\"terminalId\":\"${escapeJson(region.terminalId)}\"}"
            }
        return canonical.toByteArray(StandardCharsets.UTF_8)
    }

    // compare exact utf-8 bytes
    private fun compareUtf8(left: String, right: String): Int {
        val leftBytes = left.toByteArray(StandardCharsets.UTF_8)
        val rightBytes = right.toByteArray(StandardCharsets.UTF_8)
        val sharedLength = minOf(leftBytes.size, rightBytes.size)

        // compare each unsigned byte
        for (index in 0 until sharedLength) {
            val comparison = (leftBytes[index].toInt() and 0xff) - (rightBytes[index].toInt() and 0xff)

            // return the first difference
            if (comparison != 0) {
                return comparison
            }
        }

        return leftBytes.size - rightBytes.size
    }

    // escape json string content
    private fun escapeJson(value: String): String {
        val output = StringBuilder(value.length)

        // escape each utf-16 code unit
        for (character in value) {
            // match json.stringify escapes
            when (character) {
                '"' -> output.append("\\\"")
                '\\' -> output.append("\\\\")
                '\b' -> output.append("\\b")
                '\u000c' -> output.append("\\f")
                '\n' -> output.append("\\n")
                '\r' -> output.append("\\r")
                '\t' -> output.append("\\t")
                // branch on the current state
                else -> {
                    // escape remaining controls
                    if (character.code <= 0x1f) {
                        output.append("\\u%04x".format(character.code))
                    // branch on the current state
                    } else {
                        output.append(character)
                    }
                }
            }
        }

        return output.toString()
    }
}

// define the native contract
internal data class AutomaticNativeGenerationState(
    val configGeneration: ConfigGeneration?,
    val serverPolicyGeneration: ServerPolicyGeneration?,
    val localWorkGeneration: LocalWorkGeneration,
    val configurationUsable: Boolean,
)

// define the native contract
internal enum class ConfigActivationOutcome {
    ACTIVATED,
    ALREADY_ACTIVE,
    KEPT_PREVIOUS,
    DISABLED,
}

// define the native contract
internal object AutomaticTerminalConfigValidatorV1 {
    // validate one complete immutable public config generation
    fun isValid(config: AutomaticTerminalConfigGeneration, maxOwnedRegionCount: Int): Boolean {
        // require fixed schema and generations
        if (
            config.schemaVersion != 1 ||
            config.configGeneration.value !in 1..9_007_199_254_740_991L ||
            config.serverPolicyGeneration.value !in 0..9_007_199_254_740_991L ||
            maxOwnedRegionCount <= 0 ||
            config.regions.isEmpty() ||
            config.regions.size > maxOwnedRegionCount
        ) {
            return false
        }

        // require canonical content hash
        if (!config.contentHashHex.matches(Regex("[0-9a-f]{64}")) ||
            AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(config.regions),
            ) != config.contentHashHex
        ) {
            return false
        }

        val terminalIds = mutableSetOf<String>()

        // validate every owned region
        for (region in config.regions) {
            // branch on the current state
            if (
                !isValidTerminalId(region.terminalId) ||
                !terminalIds.add(region.terminalId) ||
                region.latitudeE7 !in -900_000_000..900_000_000 ||
                region.longitudeE7 !in -1_800_000_000..1_800_000_000 ||
                region.radiusMillimeters <= 0 ||
                region.radiusMillimeters > 0xffff_ffffL ||
                region.configGeneration != config.configGeneration
            ) {
                return false
            }
        }

        return true
    }

    // validate one bounded terminal id
    private fun isValidTerminalId(value: String): Boolean {
        // reject empty oversized or control-bearing ids
        if (value.isEmpty() || value.toByteArray(StandardCharsets.UTF_8).size > 128 || value.any { character ->
                character.code <= 0x1f || character.code == 0x7f
            }
        ) {
            return false
        }

        return true
    }
}

/**
 * staging boundary only; production region monitoring is implemented after t0 approval
 */
// define the native contract
internal interface TerminalRegionGenerationStager {
    // stage the complete namespaced set
    fun stage(config: AutomaticTerminalConfigGeneration): Boolean

    // return the staged terminal ids
    fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String>

    // commit the staged generation
    fun commit(configGeneration: ConfigGeneration): Boolean

    // discard only the named generation
    fun discard(configGeneration: ConfigGeneration)
}

// define the native contract
internal interface AutomaticLocalGenerationRegionStagerV1 {
    // stage one generation with exact callback work identity
    fun stage(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean
}

// define the native contract
internal interface TerminalRegionRegistrationHealthV1 {
    // report whether a complete platform registration remains usable
    fun hasUsableRegistration(): Boolean
}

// define the native contract
internal class AutomaticTerminalConfigActivator(
    private val stager: TerminalRegionGenerationStager,
    private val maxOwnedRegionCount: Int,
    initialLocalWorkGeneration: LocalWorkGeneration = LocalWorkGeneration(0),
) {
    private var activeConfig: AutomaticTerminalConfigGeneration? = null
    private var currentState = AutomaticNativeGenerationState(
        configGeneration = null,
        serverPolicyGeneration = null,
        localWorkGeneration = initialLocalWorkGeneration,
        configurationUsable = false,
    )

    // return immutable generation state
    @Synchronized
    fun state(): AutomaticNativeGenerationState = currentState

    // return one exact active immutable region
    @Synchronized
    fun activeRegion(terminalId: String, configGeneration: ConfigGeneration): AutomaticTerminalRegion? {
        val config = activeConfig
        // require the currently usable exact generation
        if (
            !currentState.configurationUsable ||
            config == null ||
            config.configGeneration != configGeneration
        ) {
            return null
        }
        // run the bounded callback
        return config.regions.singleOrNull { region -> region.terminalId == terminalId }
    }

    // preflight immutable generation and policy without platform mutation
    @Synchronized
    fun canActivate(config: AutomaticTerminalConfigGeneration): Boolean {
        val previousConfig = activeConfig
        val currentPolicy = currentState.serverPolicyGeneration
        // reject malformed rollback or same-generation mutation
        if (
            !AutomaticTerminalConfigValidatorV1.isValid(config, maxOwnedRegionCount) ||
            currentPolicy != null && config.serverPolicyGeneration.value < currentPolicy.value ||
            previousConfig != null && config.configGeneration.value < previousConfig.configGeneration.value ||
            previousConfig?.configGeneration == config.configGeneration &&
            previousConfig.contentHashHex != config.contentHashHex
        ) {
            return false
        }
        return true
    }

    // activate only a fully verified generation
    @Synchronized
    fun activate(config: AutomaticTerminalConfigGeneration): ConfigActivationOutcome {
        val previousConfig = activeConfig

        // reject malformed rollback or immutable mutation
        if (!canActivate(config)) {
            return failureOutcome(previousConfig)
        }

        // handle immutable generation replay
        if (previousConfig?.configGeneration == config.configGeneration) {
            // skip restaging only while still usable
            if (currentState.configurationUsable) {
                currentState = currentState.copy(serverPolicyGeneration = config.serverPolicyGeneration)
                return ConfigActivationOutcome.ALREADY_ACTIVE
            }
        }

        // keep the prior generation on staging failure
        val staged = (stager as? AutomaticLocalGenerationRegionStagerV1)
            ?.stage(config, currentState.localWorkGeneration)
            ?: stager.stage(config)
        // keep the prior generation on staging failure
        if (!staged) {
            stager.discard(config.configGeneration)
            // invalidate phantom prior state after destructive failure
            if ((stager as? TerminalRegionRegistrationHealthV1)?.hasUsableRegistration() == false) {
                currentState = currentState.copy(configurationUsable = false)
            }
            return failureOutcome(previousConfig)
        }

        // run the bounded callback
        val expectedTerminalIds = config.regions.map { region -> region.terminalId }.toSet()
        val stagedTerminalIds = stager.stagedTerminalIds(config.configGeneration)

        // require the complete exact set
        if (stagedTerminalIds != expectedTerminalIds || stagedTerminalIds.size != config.regions.size) {
            stager.discard(config.configGeneration)
            // invalidate when the platform cannot restore prior registration
            if ((stager as? TerminalRegionRegistrationHealthV1)?.hasUsableRegistration() == false) {
                currentState = currentState.copy(configurationUsable = false)
            }
            return failureOutcome(previousConfig)
        }

        // preserve prior state when commit fails
        if (!stager.commit(config.configGeneration)) {
            stager.discard(config.configGeneration)
            // invalidate when receiver exposure cannot restore prior registration
            if ((stager as? TerminalRegionRegistrationHealthV1)?.hasUsableRegistration() == false) {
                currentState = currentState.copy(configurationUsable = false)
            }
            return failureOutcome(previousConfig)
        }

        activeConfig = config
        currentState = currentState.copy(
            configGeneration = config.configGeneration,
            serverPolicyGeneration = config.serverPolicyGeneration,
            configurationUsable = true,
        )

        // discard the superseded namespace after commit
        if (previousConfig != null && previousConfig.configGeneration != config.configGeneration) {
            stager.discard(previousConfig.configGeneration)
        }

        return ConfigActivationOutcome.ACTIVATED
    }

    // advance server policy independently
    @Synchronized
    fun applyServerPolicyGeneration(generation: ServerPolicyGeneration): Boolean {
        val currentGeneration = currentState.serverPolicyGeneration

        // reject policy rollback
        if (
            generation.value !in 0..9_007_199_254_740_991L ||
            currentGeneration != null && generation.value < currentGeneration.value
        ) {
            return false
        }

        currentState = currentState.copy(serverPolicyGeneration = generation)
        return true
    }

    // invalidate device work independently
    @Synchronized
    fun invalidateLocalWork(): Boolean {
        val currentLocalGeneration = currentState.localWorkGeneration.value

        // fail closed at numeric exhaustion
        if (currentLocalGeneration == Long.MAX_VALUE) {
            currentState = currentState.copy(configurationUsable = false)
            val previousConfig = activeConfig
            // unregister any still-active exhausted namespace
            if (previousConfig != null) {
                stager.discard(previousConfig.configGeneration)
            }
            return false
        }

        return invalidateLocalWork(LocalWorkGeneration(currentLocalGeneration + 1L))
    }

    // converge invalidation to one exact persisted local generation
    @Synchronized
    fun invalidateLocalWork(targetGeneration: LocalWorkGeneration): Boolean {
        val currentLocalGeneration = currentState.localWorkGeneration
        val validTarget =
            targetGeneration.value >= 0L && targetGeneration.value >= currentLocalGeneration.value

        val previousConfig = activeConfig
        currentState = currentState.copy(
            localWorkGeneration = if (validTarget) targetGeneration else currentLocalGeneration,
            configurationUsable = false,
        )

        // unregister the active namespace
        if (previousConfig != null) {
            stager.discard(previousConfig.configGeneration)
        }

        return validTarget
    }

    // preserve the prior complete state
    private fun failureOutcome(previousConfig: AutomaticTerminalConfigGeneration?): ConfigActivationOutcome =
        // branch on the current state
        if (previousConfig == null || !currentState.configurationUsable) {
            ConfigActivationOutcome.DISABLED
        // branch on the current state
        } else {
            ConfigActivationOutcome.KEPT_PREVIOUS
        }
}
