package fyi.ferry.leaderboards

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// define the native contract
internal enum class AutomaticGeofenceTransitionV1 {
    ENTER,
    EXIT,
}

// define the native contract
internal enum class AutomaticAccuracyCircleResultV1 {
    INSIDE,
    OUTSIDE,
    UNCERTAIN,
}

// define the native contract
internal object AutomaticTerminalAccuracyCircleV1 {
    private const val EARTH_RADIUS_MILLIMETERS = 6_371_008_800.0

    // classify the complete accuracy circle against one immutable region
    fun classify(region: AutomaticTerminalRegion, fix: AutomaticLocationFixV1): AutomaticAccuracyCircleResultV1 {
        val distanceMillimeters = distanceMillimeters(
            region.latitudeE7,
            region.longitudeE7,
            fix.latitudeE7,
            fix.longitudeE7,
        )
        // require the full circle inside at equality
        if (distanceMillimeters + fix.accuracyMillimeters <= region.radiusMillimeters) {
            return AutomaticAccuracyCircleResultV1.INSIDE
        }
        // require the full circle strictly outside
        if (distanceMillimeters - fix.accuracyMillimeters > region.radiusMillimeters) {
            return AutomaticAccuracyCircleResultV1.OUTSIDE
        }
        return AutomaticAccuracyCircleResultV1.UNCERTAIN
    }

    // calculate haversine distance from scaled integer coordinates
    private fun distanceMillimeters(
        firstLatitudeE7: Int,
        firstLongitudeE7: Int,
        secondLatitudeE7: Int,
        secondLongitudeE7: Int,
    ): Double {
        val firstLatitude = Math.toRadians(firstLatitudeE7 / 10_000_000.0)
        val secondLatitude = Math.toRadians(secondLatitudeE7 / 10_000_000.0)
        val latitudeDelta = secondLatitude - firstLatitude
        val longitudeDelta = Math.toRadians((secondLongitudeE7 - firstLongitudeE7) / 10_000_000.0)
        val haversine = sin(latitudeDelta / 2.0) * sin(latitudeDelta / 2.0) +
            cos(firstLatitude) * cos(secondLatitude) *
            sin(longitudeDelta / 2.0) * sin(longitudeDelta / 2.0)
        return 2.0 * EARTH_RADIUS_MILLIMETERS * asin(sqrt(haversine.coerceIn(0.0, 1.0)))
    }
}

// define the native contract
internal object AutomaticTerminalCandidateFactoryV1 {
    // create only a transition-consistent definitive terminal candidate
    fun create(
        callback: AutomaticGeofenceCallbackV1,
        region: AutomaticTerminalRegion,
        fix: AutomaticLocationFixV1,
        candidateId: String,
    ): AutomaticCheckinCandidateV1.Terminal? {
        // bind the callback to the exact active region identity
        if (
            region.terminalId != callback.terminalId ||
            region.configGeneration != callback.configGeneration
        ) {
            return null
        }
        val circle = AutomaticTerminalAccuracyCircleV1.classify(region, fix)
        val transitionMatches = when (callback.transition) {
            AutomaticGeofenceTransitionV1.ENTER -> circle == AutomaticAccuracyCircleResultV1.INSIDE
            AutomaticGeofenceTransitionV1.EXIT -> circle == AutomaticAccuracyCircleResultV1.OUTSIDE
        }
        // reject noisy boundary-crossing and opposite-state fixes
        if (!transitionMatches) {
            return null
        }
        return AutomaticCheckinCandidateV1.Terminal(
            accuracyMillimeters = fix.accuracyMillimeters,
            candidateId = candidateId,
            capturedAtMs = fix.capturedAtMs,
            latitudeE7 = fix.latitudeE7,
            longitudeE7 = fix.longitudeE7,
            terminalId = callback.terminalId,
            configGeneration = callback.configGeneration.value,
        )
    }
}

// define the native contract
internal object AutomaticGeofenceTrustedTimeGateV1 {
    // require a fresh same-boot trusted anchor before location acquisition
    fun canAcquireFix(trustedNowMs: Long?): Boolean = trustedNowMs != null
}

// define the native contract
internal object AutomaticGeofenceCandidateCommitV1 {
    // commit only under the callback's captured local generation
    fun commit(
        callback: AutomaticGeofenceCallbackV1,
        callbackLocalGeneration: LocalWorkGeneration,
        fix: AutomaticLocationFixV1,
        candidateId: String,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
        configActivator: AutomaticTerminalConfigActivator,
        queue: AutomaticEncryptedCandidateQueueV1,
        parameters: () -> AutomaticNativeParametersV1?,
        permissionAvailable: () -> Boolean,
        scheduleUpload: () -> Boolean,
        // run the bounded callback
        markScheduleRequired: () -> Boolean = { true },
        storeCandidate: (AutomaticQueuedCandidateV1) -> AutomaticQueueMutationOutcome = queue::enqueue,
        makeUploadVisible: Boolean = true,
    ): AutomaticQueueMutationOutcome {
        var outcome = AutomaticQueueMutationOutcome.BLOCKED
        coordinator.mutateIfCurrent(callbackLocalGeneration) {
            val status = coordinator.status()
            // revalidate config identity and policy after location acquisition
            if (
                !status.configurationUsable ||
                status.configGeneration != callback.configGeneration
            ) {
                return@mutateIfCurrent true
            }
            // stop captured work on a concurrent permission loss
            if (!permissionAvailable()) {
                coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED)
                return@mutateIfCurrent true
            }
            val currentParameters = parameters() ?: return@mutateIfCurrent true
            // stop future capture after a below-policy accuracy downgrade
            if (fix.accuracyMillimeters > currentParameters.maxLocationAccuracyMillimeters) {
                coordinator.knownStop(AutomaticStopTriggerV1.ACCURACY_DOWNGRADED)
                return@mutateIfCurrent true
            }
            val region = configActivator.activeRegion(callback.terminalId, callback.configGeneration)
                ?: return@mutateIfCurrent true
            val candidate = AutomaticTerminalCandidateFactoryV1.create(callback, region, fix, candidateId)
                ?: return@mutateIfCurrent true
            val queued = AutomaticQueuedCandidateV1(candidate, callbackLocalGeneration)
            // latch only direct upload-visible queue storage
            if (makeUploadVisible && !markScheduleRequired()) {
                return@mutateIfCurrent true
            }
            outcome = storeCandidate(queued)
            // schedule only while the stored generation remains current
            if (makeUploadVisible && outcome == AutomaticQueueMutationOutcome.STORED) {
                scheduleUpload()
            }
            true
        }
        return outcome
    }
}

// define the native contract
internal object AutomaticGeofenceLifecycleRecoveryV1 {
    // recover one cold-process callback before location acquisition
    fun currentStatus(
        callback: AutomaticGeofenceCallbackV1,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
        configActivator: AutomaticTerminalConfigActivator,
        // run the bounded callback
        restore: () -> Unit = {},
        reconcile: () -> Unit,
    ): AutomaticNativeRuntimeStatusV1? {
        var status = coordinator.status()
        // reject callbacks outside the persisted usable generation
        if (
            !status.configurationUsable ||
            status.configGeneration != callback.configGeneration
        ) {
            return null
        }
        // return an already restored active geometry
        if (configActivator.activeRegion(callback.terminalId, callback.configGeneration) != null) {
            return status
        }
        restore()
        status = coordinator.status()
        // prefer the exact no-network public config recovery path
        if (
            status.configurationUsable &&
            status.configGeneration == callback.configGeneration &&
            configActivator.activeRegion(callback.terminalId, callback.configGeneration) != null
        ) {
            return status
        }
        reconcile()
        status = coordinator.status()
        // require authoritative reconciliation to restore the exact generation
        if (
            !status.configurationUsable ||
            status.configGeneration != callback.configGeneration ||
            configActivator.activeRegion(callback.terminalId, callback.configGeneration) == null
        ) {
            return null
        }
        return status
    }
}

// define the native contract
internal object AutomaticPersistedTerminalConfigRecoveryV1 {
    // restore only the aggregate-bound exact public config generation
    fun restore(
        generation: ConfigGeneration,
        store: AutomaticPublicTerminalConfigStoreV1,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
    ): Boolean {
        val status = coordinator.status()
        val currentPolicy = status.serverPolicyGeneration
        // reject stale disabled or policy-free aggregate state
        if (
            !status.configurationUsable ||
            status.configGeneration != generation ||
            currentPolicy == null
        ) {
            return false
        }
        val persisted = store.read(generation) ?: return false
        // reject a public config newer than the persisted authoritative policy
        if (persisted.serverPolicyGeneration.value > currentPolicy.value) {
            return false
        }
        val rebound = persisted.copy(serverPolicyGeneration = currentPolicy)
        // branch on the fixed outcome
        return when (coordinator.activateConfiguration(rebound)) {
            ConfigActivationOutcome.ACTIVATED,
            ConfigActivationOutcome.ALREADY_ACTIVE,
            -> true
            ConfigActivationOutcome.KEPT_PREVIOUS,
            ConfigActivationOutcome.DISABLED,
            -> false
        }
    }
}
