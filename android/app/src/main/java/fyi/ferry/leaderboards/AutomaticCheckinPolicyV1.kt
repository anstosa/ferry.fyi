package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

internal const val AUTOMATIC_MIN_SUPPORTED_SDK = 29

// define the native contract
internal enum class AutomaticStopTriggerV1(val identityEnding: Boolean) {
    BACKGROUND_PERMISSION_REVOKED(false),
    ACCURACY_DOWNGRADED(false),
    IDENTITY_LOST(true),
    PROFILE_OPTED_OUT(true),
    LOCAL_DISABLE(true),
    ENROLLMENT_REVOKED(true),
    ENROLLMENT_EXPIRED(true),
    ACCOUNT_DELETED(true),
    REMOTE_POLICY_DISABLED(false),
    DETECTOR_DISABLED(false),
    GEOFENCE_UNAVAILABLE(false),
}

// define the native contract
internal enum class AutomaticPermissionHealthV1 {
    AUTHORIZED,
    DENIED,
    LIMITED_ACCURACY,
    NOT_DETERMINED,
    RESTRICTED,
    UNSUPPORTED_OS,
}

// define the native contract
internal enum class AutomaticMonitorHealthV1 {
    DISABLED,
    FIRST_UNLOCK_REQUIRED,
    FORCE_STOPPED,
    GEOFENCE_UNAVAILABLE,
    HEALTHY,
    NEEDS_CONFIG,
    POLICY_DISABLED,
    REGISTRATION_FAILED,
    STALE_CONFIG,
    STOPPED,
    UNAVAILABLE,
}

// define the native contract
internal data class AutomaticNativeRuntimeStatusV1(
    val configGeneration: ConfigGeneration?,
    val serverPolicyGeneration: ServerPolicyGeneration?,
    val localWorkGeneration: LocalWorkGeneration,
    val configurationUsable: Boolean,
    val monitorHealth: AutomaticMonitorHealthV1,
    val permissionHealth: AutomaticPermissionHealthV1,
    val lastOutcome: String?,
    val stopCleanupRequired: Boolean = false,
    val identityCleanupRequired: Boolean = false,
)

// define the native contract
internal enum class AutomaticGenerationMutationResultV1 {
    APPLIED,
    FAILED,
    STALE,
}

// define the native contract
internal enum class AutomaticStopAuthorityResultV1 {
    APPLIED,
    FAILED,
    STALE,
}

// define the native contract
internal interface AutomaticStopPortV1 {
    // unregister every owned region
    fun unregisterRegions(): Boolean

    // cancel zero-data scheduled work
    fun cancelScheduledWork(): Boolean

    // cancel cancellable native requests
    fun cancelNetworkRequests(): Boolean
}

// define the native contract
internal class AutomaticNativeRuntimeStateStoreV1(
    private val directory: File,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
    private val stopFileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val stateFile = File(directory, "runtime-state-v1.bin")
    private val pendingStopFile = File(directory, "runtime-pending-stop-v1.bin")

    // persist only fixed aggregate runtime state
    @Synchronized
    fun replace(status: AutomaticNativeRuntimeStatusV1): Boolean {
        return fileOps.replace(stateFile, encode(status))
    }

    // stage one independent stop authority before aggregate state mutation
    @Synchronized
    fun stagePendingStop(status: AutomaticNativeRuntimeStatusV1): Boolean =
        stopFileOps.replace(pendingStopFile, encode(status))

    // restore one independent stop authority
    @Synchronized
    fun readPendingStop(): AutomaticNativeRuntimeStatusV1? = readFile(pendingStopFile)

    // clear stop authority only after state and physical effects converge
    @Synchronized
    fun clearPendingStop(): Boolean = stopFileOps.delete(pendingStopFile)

    // distinguish fresh install from corrupt aggregate state
    fun hasStateMaterial(): Boolean = stateFile.exists() || pendingStopFile.exists()

    // expose an unreadable pending-stop authority conservatively
    fun hasPendingStopMaterial(): Boolean = pendingStopFile.exists()

    // encode one exact aggregate state payload
    private fun encode(status: AutomaticNativeRuntimeStatusV1): ByteArray {
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(2)
            output.writeLong(status.configGeneration?.value ?: -1L)
            output.writeLong(status.serverPolicyGeneration?.value ?: -1L)
            output.writeLong(status.localWorkGeneration.value)
            output.writeBoolean(status.configurationUsable)
            output.writeUTF(status.monitorHealth.name)
            output.writeUTF(status.permissionHealth.name)
            output.writeBoolean(status.lastOutcome != null)
            // persist only the fixed outcome enum
            if (status.lastOutcome != null) {
                output.writeUTF(status.lastOutcome)
            }
            output.writeBoolean(status.stopCleanupRequired)
            output.writeBoolean(status.identityCleanupRequired)
            output.flush()
        }
        return bytes.toByteArray()
    }

    // restore one exact aggregate runtime state
    @Synchronized
    fun read(): AutomaticNativeRuntimeStatusV1? = readFile(stateFile)

    // decode one exact aggregate state file
    private fun readFile(file: File): AutomaticNativeRuntimeStatusV1? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(file.readBytes())).use { input ->
            // require the fixed state schema
            val schemaVersion = input.readInt()
            // accept only the current state and prior aggregate schema
            if (schemaVersion !in 1..2) {
                return null
            }
            val configGeneration = input.readLong()
            val serverPolicyGeneration = input.readLong()
            val localGeneration = input.readLong()
            val configurationUsable = input.readBoolean()
            val monitorHealth = AutomaticMonitorHealthV1.valueOf(input.readUTF())
            val permissionHealth = AutomaticPermissionHealthV1.valueOf(input.readUTF())
            val lastOutcome = if (input.readBoolean()) input.readUTF() else null
            val stopCleanupRequired = schemaVersion >= 2 && input.readBoolean()
            val identityCleanupRequired = schemaVersion >= 2 && input.readBoolean()
            // reject invalid generations and trailing data
            if (
                configGeneration < -1L ||
                serverPolicyGeneration < -1L ||
                localGeneration < 0L ||
                input.available() != 0
            ) {
                return null
            }
            AutomaticNativeRuntimeStatusV1(
                // run the bounded callback
                configGeneration = configGeneration.takeIf { value -> value >= 0L }?.let(::ConfigGeneration),
                // run the bounded callback
                serverPolicyGeneration = serverPolicyGeneration.takeIf { value -> value >= 0L }
                    ?.let(::ServerPolicyGeneration),
                localWorkGeneration = LocalWorkGeneration(localGeneration),
                configurationUsable = configurationUsable,
                monitorHealth = monitorHealth,
                permissionHealth = permissionHealth,
                lastOutcome = lastOutcome,
                stopCleanupRequired = stopCleanupRequired,
                identityCleanupRequired = identityCleanupRequired,
            )
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }
}

// define the native contract
internal class AutomaticCheckinPolicyCoordinatorV1(
    sdkInt: Int,
    private val stateStore: AutomaticNativeRuntimeStateStoreV1,
    private val configActivator: AutomaticTerminalConfigActivator,
    private val queue: AutomaticEncryptedCandidateQueueV1,
    private val credentialStore: AutomaticCredentialStoreV1,
    private val bindingStore: AutomaticInstallationBindingStoreV1,
    private val stopPort: AutomaticStopPortV1,
) {
    private val pendingStopAtLaunch = stateStore.readPendingStop()
    private val restoredStateAtLaunch = stateStore.read()
    private val credentialMaterialAtLaunch = credentialStore.hasCredentialMaterial()
    private val sentinelMaterialAtLaunch = bindingStore.hasSentinelMaterial()
    private val readableCredentialAtLaunch = credentialIsReadableAtLaunch()
    private val activeStateAtLaunch = restoredStateAtLaunch?.requiresCredentialAtLaunch() == true
    private val inconsistentIdentityAtLaunch =
        credentialMaterialAtLaunch && (!sentinelMaterialAtLaunch || !readableCredentialAtLaunch) ||
            activeStateAtLaunch && (!sentinelMaterialAtLaunch || !readableCredentialAtLaunch)
    private val orphanedSensitiveStateAtLaunch =
        pendingStopAtLaunch == null &&
            (
                stateStore.hasPendingStopMaterial() ||
                    inconsistentIdentityAtLaunch ||
                    restoredStateAtLaunch == null &&
                    (stateStore.hasStateMaterial() || credentialMaterialAtLaunch || queue.pendingCount() > 0)
            )
    // run the bounded callback
    private val quarantineGenerationAtLaunch = restoredStateAtLaunch?.localWorkGeneration?.value?.let { value ->
        // advance whenever the persisted generation has remaining range
        if (value < Long.MAX_VALUE) value + 1L else value
    } ?: 1L
    // run the bounded callback
    private var current = pendingStopAtLaunch ?: restoredStateAtLaunch.takeUnless {
        orphanedSensitiveStateAtLaunch
    } ?: AutomaticNativeRuntimeStatusV1(
        configGeneration = null,
        serverPolicyGeneration = null,
        localWorkGeneration = LocalWorkGeneration(if (orphanedSensitiveStateAtLaunch) quarantineGenerationAtLaunch else 0L),
        configurationUsable = false,
        monitorHealth = if (orphanedSensitiveStateAtLaunch) {
            AutomaticMonitorHealthV1.STOPPED
        // branch on the current state
        } else if (sdkInt < AUTOMATIC_MIN_SUPPORTED_SDK) {
            AutomaticMonitorHealthV1.UNAVAILABLE
        // branch on the current state
        } else {
            AutomaticMonitorHealthV1.DISABLED
        },
        permissionHealth = if (sdkInt < AUTOMATIC_MIN_SUPPORTED_SDK) {
            AutomaticPermissionHealthV1.UNSUPPORTED_OS
        // branch on the current state
        } else {
            AutomaticPermissionHealthV1.NOT_DETERMINED
        },
        lastOutcome = if (sdkInt < AUTOMATIC_MIN_SUPPORTED_SDK) "unsupported_os" else null,
        stopCleanupRequired = orphanedSensitiveStateAtLaunch,
        identityCleanupRequired = orphanedSensitiveStateAtLaunch,
    )

    // branch on the current state
    init {
        // replay independent or corruption-triggered stop authority before use
        if (pendingStopAtLaunch != null || orphanedSensitiveStateAtLaunch) {
            stateStore.replace(current)
            val effectsConverged = performStopEffects(current.identityCleanupRequired, invalidateConfig = true)
            // clear authority only after the stopped aggregate state persists
            if (effectsConverged) {
                current = current.copy(stopCleanupRequired = false, identityCleanupRequired = false)
                // branch on the current state
                if (stateStore.replace(current)) {
                    stateStore.clearPendingStop()
                }
            }
        }
    }

    // inspect and wipe one credential copy during launch quarantine
    private fun credentialIsReadableAtLaunch(): Boolean {
        val credential = credentialStore.read() ?: return false
        credential.wipe()
        return true
    }

    // require credential material for any restorable active identity
    private fun AutomaticNativeRuntimeStatusV1.requiresCredentialAtLaunch(): Boolean =
        configurationUsable ||
            configGeneration != null ||
            monitorHealth in setOf(
                AutomaticMonitorHealthV1.HEALTHY,
                AutomaticMonitorHealthV1.NEEDS_CONFIG,
                AutomaticMonitorHealthV1.REGISTRATION_FAILED,
                AutomaticMonitorHealthV1.STALE_CONFIG,
            )

    // return one immutable aggregate status
    @Synchronized
    fun status(): AutomaticNativeRuntimeStatusV1 = current

    // return the active device-work generation
    @Synchronized
    fun localWorkGeneration(): LocalWorkGeneration = current.localWorkGeneration

    // reject stale callbacks and responses
    @Synchronized
    fun accepts(generation: LocalWorkGeneration): Boolean =
        generation == current.localWorkGeneration &&
            // reserve exhausted stopped generations as a permanent rejection boundary
            !(
                generation.value == Long.MAX_VALUE &&
                    !current.configurationUsable
            )

    // reject disclosed policy rollback before response effects
    @Synchronized
    fun acceptsServerPolicyGeneration(generation: ServerPolicyGeneration): Boolean =
        generation.value >= 0L &&
            // run the bounded callback
            current.serverPolicyGeneration?.let { observed -> generation.value >= observed.value } != false

    // preflight one immutable configuration under current policy
    @Synchronized
    fun acceptsConfiguration(config: AutomaticTerminalConfigGeneration): Boolean =
        acceptsServerPolicyGeneration(config.serverPolicyGeneration) && configActivator.canActivate(config)

    // bind one mutation to the current callback generation
    @Synchronized
    fun mutateIfCurrent(
        generation: LocalWorkGeneration,
        disclosedPolicyGeneration: ServerPolicyGeneration? = null,
        mutation: () -> Boolean,
    ): AutomaticGenerationMutationResultV1 {
        val observedPolicyGeneration = current.serverPolicyGeneration
        // reject work or policy invalidated before lock acquisition
        if (
            generation != current.localWorkGeneration ||
            generation.value == Long.MAX_VALUE && !current.configurationUsable ||
            disclosedPolicyGeneration != null &&
            observedPolicyGeneration != null &&
            disclosedPolicyGeneration.value < observedPolicyGeneration.value
        ) {
            return AutomaticGenerationMutationResultV1.STALE
        }
        return if (mutation()) {
            AutomaticGenerationMutationResultV1.APPLIED
        // branch on the current state
        } else {
            AutomaticGenerationMutationResultV1.FAILED
        }
    }

    // replace enrollment work without reusing prior callbacks
    @Synchronized
    fun replaceEnrollment(serverPolicyGeneration: ServerPolicyGeneration): Boolean {
        // reject policy rollback before local mutation
        val currentPolicy = current.serverPolicyGeneration
        // branch on the current state
        if (currentPolicy != null && serverPolicyGeneration.value < currentPolicy.value) {
            return false
        }
        return invalidate(
            identityEnding = false,
            nextMonitorHealth = AutomaticMonitorHealthV1.NEEDS_CONFIG,
            nextOutcome = null,
            nextServerPolicyGeneration = serverPolicyGeneration,
        )
    }

    // apply a policy-bearing authoritative response
    @Synchronized
    fun reconcileAuthoritativePolicy(generation: ServerPolicyGeneration, enabled: Boolean): Boolean {
        val currentPolicy = current.serverPolicyGeneration
        // reject server policy rollback
        if (generation.value < 0L || currentPolicy != null && generation.value < currentPolicy.value) {
            return false
        }
        // purge only after an authoritative learned denial
        if (!enabled) {
            return invalidate(
                identityEnding = false,
                nextMonitorHealth = AutomaticMonitorHealthV1.POLICY_DISABLED,
                nextOutcome = "policy_disabled",
                nextServerPolicyGeneration = generation,
            )
        }
        current = current.copy(serverPolicyGeneration = generation)
        return stateStore.replace(current)
    }

    // activate one complete authoritative configuration
    @Synchronized
    fun activateConfiguration(config: AutomaticTerminalConfigGeneration): ConfigActivationOutcome {
        // reconcile policy before region state
        if (!reconcileAuthoritativePolicy(config.serverPolicyGeneration, enabled = true)) {
            return ConfigActivationOutcome.DISABLED
        }
        val outcome = configActivator.activate(config)
        // expose activation state only after commit
        if (outcome == ConfigActivationOutcome.ACTIVATED || outcome == ConfigActivationOutcome.ALREADY_ACTIVE) {
            current = current.copy(
                configGeneration = config.configGeneration,
                serverPolicyGeneration = config.serverPolicyGeneration,
                configurationUsable = true,
                monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                lastOutcome = null,
            )
            // fail closed when aggregate state cannot persist
            if (!stateStore.replace(current)) {
                knownStop(AutomaticStopTriggerV1.DETECTOR_DISABLED)
                return ConfigActivationOutcome.DISABLED
            }
        // branch on the current state
        } else if (!configActivator.state().configurationUsable) {
            // invalidate all work after destructive registration failure
            knownStop(AutomaticStopTriggerV1.GEOFENCE_UNAVAILABLE)
        }
        return outcome
    }

    // apply one locally known exhaustive stop trigger
    @Synchronized
    fun knownStop(trigger: AutomaticStopTriggerV1): Boolean = invalidate(
        identityEnding = trigger.identityEnding,
        // branch on the fixed outcome
        nextMonitorHealth = when (trigger) {
            AutomaticStopTriggerV1.REMOTE_POLICY_DISABLED,
            AutomaticStopTriggerV1.DETECTOR_DISABLED,
            -> AutomaticMonitorHealthV1.POLICY_DISABLED
            AutomaticStopTriggerV1.GEOFENCE_UNAVAILABLE -> AutomaticMonitorHealthV1.GEOFENCE_UNAVAILABLE
            // branch on the current state
            else -> AutomaticMonitorHealthV1.STOPPED
        },
        // branch on the fixed outcome
        nextOutcome = when (trigger) {
            AutomaticStopTriggerV1.ENROLLMENT_EXPIRED -> "enrollment_expired"
            AutomaticStopTriggerV1.ENROLLMENT_REVOKED -> "enrollment_revoked"
            AutomaticStopTriggerV1.REMOTE_POLICY_DISABLED -> "policy_disabled"
            AutomaticStopTriggerV1.DETECTOR_DISABLED -> "detector_disabled"
            // branch on the current state
            else -> null
        },
        nextServerPolicyGeneration = current.serverPolicyGeneration,
    )

    // apply or idempotently converge one durable server stop authority
    @Synchronized
    fun applyFinalStopAuthority(authority: AutomaticPendingStopAuthorityV1): AutomaticStopAuthorityResultV1 {
        val generation = authority.serverPolicyGeneration
        val currentPolicy = current.serverPolicyGeneration
        val identityEnding = authority.outcome in setOf(
            "authentication_failed",
            "enrollment_expired",
            "enrollment_revoked",
        )
        val monitorHealth = if (authority.outcome in setOf("detector_disabled", "policy_disabled")) {
            AutomaticMonitorHealthV1.POLICY_DISABLED
        // branch on the current state
        } else {
            AutomaticMonitorHealthV1.STOPPED
        }
        val alreadyApplied =
            current.localWorkGeneration.value == authority.localWorkGeneration.value + 1L &&
                !current.configurationUsable &&
                current.lastOutcome == authority.outcome &&
                current.monitorHealth == monitorHealth &&
                (generation == null || current.serverPolicyGeneration == generation)
        // reject malformed or rollback authority before state mutation
        if (
            authority.outcome !in setOf(
                "authentication_failed",
                "detector_disabled",
                "enrollment_expired",
                "enrollment_revoked",
                "policy_disabled",
            ) ||
            generation != null && currentPolicy != null && generation.value < currentPolicy.value ||
            current.localWorkGeneration != authority.localWorkGeneration && !alreadyApplied
        ) {
            return AutomaticStopAuthorityResultV1.STALE
        }
        // retry only physical effects after the logical stop already persisted
        if (alreadyApplied) {
            val statePersisted = stateStore.replace(current)
            val effectsConverged = performStopEffects(identityEnding, invalidateConfig = false)
            return if (statePersisted && effectsConverged) {
                AutomaticStopAuthorityResultV1.APPLIED
            // branch on the current state
            } else {
                AutomaticStopAuthorityResultV1.FAILED
            }
        }
        return if (invalidate(
            identityEnding = identityEnding,
            nextMonitorHealth = monitorHealth,
            nextOutcome = authority.outcome,
            nextServerPolicyGeneration = generation ?: current.serverPolicyGeneration,
        )) {
            AutomaticStopAuthorityResultV1.APPLIED
        // branch on the current state
        } else {
            AutomaticStopAuthorityResultV1.FAILED
        }
    }

    // update fixed permission health without candidate data
    @Synchronized
    fun updatePermission(health: AutomaticPermissionHealthV1): Boolean {
        current = current.copy(permissionHealth = health)
        return stateStore.replace(current)
    }

    // mark a fixed degraded lifecycle state
    @Synchronized
    fun markMonitorHealth(health: AutomaticMonitorHealthV1): Boolean {
        current = current.copy(monitorHealth = health)
        return stateStore.replace(current)
    }

    // record one fixed aggregate outcome
    @Synchronized
    fun recordOutcome(outcome: String?): Boolean {
        current = current.copy(lastOutcome = outcome)
        return stateStore.replace(current)
    }

    // retry every durable local stop effect before policy or config work
    @Synchronized
    fun retryPendingStopEffects(): Boolean {
        // skip physical stop work only after prior convergence
        if (!current.stopCleanupRequired) {
            return true
        }
        val effectsConverged = performStopEffects(
            identityEnding = current.identityCleanupRequired,
            invalidateConfig = false,
        )
        // preserve the durable retry flags until every effect succeeds
        if (!effectsConverged) {
            return false
        }
        current = current.copy(stopCleanupRequired = false, identityCleanupRequired = false)
        val persisted = stateStore.replace(current)
        return persisted && stateStore.clearPendingStop()
    }

    // execute the atomic logical invalidation boundary
    private fun invalidate(
        identityEnding: Boolean,
        nextMonitorHealth: AutomaticMonitorHealthV1,
        nextOutcome: String?,
        nextServerPolicyGeneration: ServerPolicyGeneration?,
    ): Boolean {
        val nextGeneration = current.localWorkGeneration.value + 1L
        // fail closed at local generation exhaustion
        if (nextGeneration <= 0L) {
            current = current.copy(
                configurationUsable = false,
                monitorHealth = AutomaticMonitorHealthV1.STOPPED,
                lastOutcome = null,
                stopCleanupRequired = true,
                identityCleanupRequired = true,
            )
            val authorityPersisted = stateStore.stagePendingStop(current)
            val statePersisted = stateStore.replace(current)
            val effectsConverged = performStopEffects(identityEnding = true, invalidateConfig = true)
            // retain cleanup authority until every exhaustive effect converges
            if (effectsConverged) {
                current = current.copy(stopCleanupRequired = false, identityCleanupRequired = false)
                // branch on the current state
                if (stateStore.replace(current)) {
                    stateStore.clearPendingStop()
                }
            }
            // report failure because no fresh generation can ever be issued
            if (!authorityPersisted || !statePersisted || !effectsConverged) {
                return false
            }
            return false
        }
        val next = current.copy(
            localWorkGeneration = LocalWorkGeneration(nextGeneration),
            serverPolicyGeneration = nextServerPolicyGeneration,
            configurationUsable = false,
            monitorHealth = nextMonitorHealth,
            lastOutcome = nextOutcome,
            stopCleanupRequired = true,
            identityCleanupRequired = identityEnding,
        )
        // persist independent stop authority before aggregate state replacement
        val authorityPersisted = stateStore.stagePendingStop(next)
        current = next
        val statePersisted = stateStore.replace(current)
        val mustQuarantineIdentity = !authorityPersisted && !statePersisted
        val effectsConverged = performStopEffects(
            identityEnding = identityEnding || mustQuarantineIdentity,
            invalidateConfig = true,
        )
        // clear durable cleanup only after every physical stop effect converges
        if (effectsConverged) {
            current = current.copy(stopCleanupRequired = false, identityCleanupRequired = false)
        }
        val completionPersisted = !effectsConverged || stateStore.replace(current)
        val authorityCleared = !effectsConverged || !completionPersisted || stateStore.clearPendingStop()
        return authorityPersisted && statePersisted && effectsConverged && completionPersisted && authorityCleared
    }

    // execute every physical stop effect without short-circuiting
    private fun performStopEffects(identityEnding: Boolean, invalidateConfig: Boolean): Boolean {
        val configInvalidated =
            !invalidateConfig || configActivator.invalidateLocalWork(current.localWorkGeneration)
        val regionsStopped = stopPort.unregisterRegions()
        val workCancelled = stopPort.cancelScheduledWork()
        val requestsCancelled = stopPort.cancelNetworkRequests()
        val queuePurged = queue.purge(deleteKey = identityEnding)
        val credentialPurged = !identityEnding || credentialStore.clear()
        val bindingPurged = !identityEnding || bindingStore.clear()
        return configInvalidated && regionsStopped && workCancelled && requestsCancelled &&
            queuePurged && credentialPurged && bindingPurged
    }
}

// define the native contract
internal object AutomaticAndroidEligibilityV1 {
    // reject unsupported os before any automatic material
    fun isSupported(sdkInt: Int): Boolean = sdkInt >= AUTOMATIC_MIN_SUPPORTED_SDK
}
