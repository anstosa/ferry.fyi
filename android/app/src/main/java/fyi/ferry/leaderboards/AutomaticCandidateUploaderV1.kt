package fyi.ferry.leaderboards

// define the native contract
internal enum class AutomaticUploadRunOutcomeV1 {
    SUCCESS,
    RETRY,
    CLEANUP_RETRY,
    BLOCKED,
}

// define the native contract
internal data class AutomaticUploadRunResultV1(
    val outcome: AutomaticUploadRunOutcomeV1,
    val finalizedCount: Int,
    val retryableCount: Int,
)

// define the native contract
internal enum class AutomaticUploaderCrashPhaseV1 {
    AFTER_FINAL_RESPONSE_BEFORE_DELETE,
    AFTER_DELETE_BEFORE_EXPOSURE,
}

// define the native contract
internal interface AutomaticUploaderCrashProbeV1 {
    // expose deterministic crash boundaries to tests
    fun reached(phase: AutomaticUploaderCrashPhaseV1)
}

// define the native contract
internal object AutomaticNoopUploaderCrashProbeV1 : AutomaticUploaderCrashProbeV1 {
    // preserve normal execution
    override fun reached(phase: AutomaticUploaderCrashPhaseV1) = Unit
}

// define the native contract
internal interface AutomaticCreditedSignalV1 {
    // emit one generic credited signal without detail
    fun credited()
}

// define the native contract
private sealed interface AutomaticCredentialPreflightV1 {
    // define the native contract
    data object Blocked : AutomaticCredentialPreflightV1
    // define the native contract
    data object Expired : AutomaticCredentialPreflightV1
    // define the native contract
    data object Revoked : AutomaticCredentialPreflightV1
    // define the native contract
    data class Ready(val urls: AutomaticNativeEndpointUrls, val origin: String) : AutomaticCredentialPreflightV1
}

// define the native contract
private sealed interface AutomaticRecordUploadResultV1 {
    // define the native contract
    data class Retry(val localWorkGeneration: LocalWorkGeneration) : AutomaticRecordUploadResultV1
    // define the native contract
    data object CleanupRetry : AutomaticRecordUploadResultV1
    // define the native contract
    data class StopCleanup(val effect: AutomaticFinalUploadEffectV1) : AutomaticRecordUploadResultV1
    // define the native contract
    data class LocalStop(val trigger: AutomaticStopTriggerV1) : AutomaticRecordUploadResultV1
    // define the native contract
    data class Final(val effect: AutomaticFinalUploadEffectV1) : AutomaticRecordUploadResultV1
}

// define the native contract
private data class AutomaticFinalUploadEffectV1(
    val localWorkGeneration: LocalWorkGeneration,
    val serverPolicyGeneration: ServerPolicyGeneration?,
    val outcome: String,
    val credited: Boolean,
)

// define the native contract
private enum class AutomaticFinalExposureResultV1 {
    APPLIED,
    FAILED,
    STALE,
}

// define the native contract
internal class AutomaticCandidateUploaderV1(
    private val queue: AutomaticEncryptedCandidateQueueV1,
    private val credentialStore: AutomaticCredentialStoreV1,
    private val trustedNowMs: () -> Long?,
    private val transport: AutomaticNativeHttpTransportV1,
    private val coordinator: AutomaticCheckinPolicyCoordinatorV1,
    private val creditedSignal: AutomaticCreditedSignalV1,
    private val crashProbe: AutomaticUploaderCrashProbeV1 = AutomaticNoopUploaderCrashProbeV1,
    private val didWipePreparedCandidate: ((AutomaticPreparedCandidateUploadV1) -> Unit)? = null,
) {
    // process one zero-data upload wake
    @Synchronized
    fun runOnce(): AutomaticUploadRunResultV1 {
        // replay durable stop authority before any credential or candidate read
        if (queue.hasPendingStopAuthority()) {
            val authority = queue.pendingStopAuthority()
                ?: return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, 0, 0)
            val stopResult = coordinator.applyFinalStopAuthority(authority)
            // discard only an authority invalidated by newer local work
            if (stopResult == AutomaticStopAuthorityResultV1.STALE) {
                val discarded = queue.discardStopAuthority(authority)
                val cleaned = discarded && queue.retryRequiredCleanup()
                return AutomaticUploadRunResultV1(
                    // branch on the current state
                    if (cleaned) AutomaticUploadRunOutcomeV1.SUCCESS else AutomaticUploadRunOutcomeV1.CLEANUP_RETRY,
                    0,
                    0,
                )
            }
            val cleaned = queue.retryRequiredCleanup()
            val cleared =
                stopResult == AutomaticStopAuthorityResultV1.APPLIED && cleaned && queue.clearStopAuthority()
            // retry only fixed stop and deletion effects until zero
            if (!cleared) {
                queue.markCleanupRequired()
                return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, 0, 0)
            }
            return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.SUCCESS, 0, 0)
        }
        // converge failed non-stop final cleanup before any capture or upload
        if (!queue.retryRequiredCleanup()) {
            coordinator.recordOutcome("cleanup_required")
            return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.CLEANUP_RETRY, 0, 0)
        }
        val preflight = credentialPreflight()
        // apply local identity stops only after credential memory is wiped
        when (preflight) {
            AutomaticCredentialPreflightV1.Blocked ->
                return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.BLOCKED, 0, 0)
            // handle the fixed branch
            AutomaticCredentialPreflightV1.Expired -> {
                coordinator.knownStop(AutomaticStopTriggerV1.ENROLLMENT_EXPIRED)
                return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.BLOCKED, 0, 0)
            }
            // handle the fixed branch
            AutomaticCredentialPreflightV1.Revoked -> {
                coordinator.knownStop(AutomaticStopTriggerV1.ENROLLMENT_REVOKED)
                return AutomaticUploadRunResultV1(AutomaticUploadRunOutcomeV1.BLOCKED, 0, 0)
            }
            is AutomaticCredentialPreflightV1.Ready -> Unit
        }
        val endpointValidator = AutomaticNativeEndpointValidator(preflight.origin)
        val attemptedEntityKeys = mutableSetOf<String>()
        var finalizedCount = 0
        var retryableCount = 0
        // process one wipeable decrypted entity head at a time
        while (true) {
            val attempt = when (val next = queue.readNextReadyRecord(attemptedEntityKeys)) {
                AutomaticQueueNextReadResultV1.Blocked ->
                    return AutomaticUploadRunResultV1(
                        AutomaticUploadRunOutcomeV1.BLOCKED,
                        finalizedCount,
                        retryableCount,
                    )
                // handle the fixed branch
                is AutomaticQueueNextReadResultV1.Ready -> {
                    val record = next.record ?: break
                    attemptedEntityKeys += record.entityKey
                    // attempt the protected operation
                    try {
                        processRecord(record, preflight, endpointValidator)
                    // release protected state
                    } finally {
                        // wipe request candidate and ordering bytes before any effect
                        record.wipe()
                        didWipePreparedCandidate?.invoke(record)
                    }
                }
            }
            // classify only after credential and candidate-bearing scopes end
            when (attempt) {
                // handle the fixed branch
                is AutomaticRecordUploadResultV1.Retry -> {
                    retryableCount += 1
                    // stop scanning after ambiguity under an invalidated generation
                    if (!coordinator.accepts(attempt.localWorkGeneration)) {
                        break
                    }
                }
                // handle the fixed branch
                AutomaticRecordUploadResultV1.CleanupRetry -> {
                    return AutomaticUploadRunResultV1(
                        AutomaticUploadRunOutcomeV1.CLEANUP_RETRY,
                        finalizedCount,
                        retryableCount,
                    )
                }
                // handle the fixed branch
                is AutomaticRecordUploadResultV1.LocalStop -> {
                    coordinator.knownStop(attempt.trigger)
                    return AutomaticUploadRunResultV1(
                        AutomaticUploadRunOutcomeV1.BLOCKED,
                        finalizedCount,
                        retryableCount,
                    )
                }
                // handle the fixed branch
                is AutomaticRecordUploadResultV1.StopCleanup -> {
                    val exposure = exposeFinal(attempt.effect)
                    val authority = stopAuthority(attempt.effect)
                    // discard an exact authority superseded before effect exposure
                    if (exposure == AutomaticFinalExposureResultV1.STALE && authority != null) {
                        queue.discardStopAuthority(authority)
                    }
                    val cleaned = queue.retryRequiredCleanup()
                    val cleared =
                        exposure == AutomaticFinalExposureResultV1.APPLIED && cleaned && queue.clearStopAuthority()
                    // preserve the latch until every physical stop effect converges
                    if (!cleared) {
                        queue.markCleanupRequired()
                    }
                    return AutomaticUploadRunResultV1(
                        AutomaticUploadRunOutcomeV1.CLEANUP_RETRY,
                        finalizedCount,
                        retryableCount,
                    )
                }
                // handle the fixed branch
                is AutomaticRecordUploadResultV1.Final -> {
                    finalizedCount += 1
                    crashProbe.reached(AutomaticUploaderCrashPhaseV1.AFTER_DELETE_BEFORE_EXPOSURE)
                    val exposure = exposeFinal(attempt.effect)
                    val stopAuthority = stopAuthority(attempt.effect)
                    // suppress a stale response after enrollment or local-stop replacement
                    if (exposure == AutomaticFinalExposureResultV1.STALE) {
                        // branch on the current state
                        if (stopAuthority != null) {
                            queue.discardStopAuthority(stopAuthority)
                            queue.retryRequiredCleanup()
                        }
                        break
                    }
                    // clear a stop latch only after every stop effect converges
                    if (
                        stopAuthority != null &&
                        (exposure != AutomaticFinalExposureResultV1.APPLIED || !queue.clearStopAuthority())
                    ) {
                        queue.markCleanupRequired()
                        return AutomaticUploadRunResultV1(
                            AutomaticUploadRunOutcomeV1.CLEANUP_RETRY,
                            finalizedCount,
                            retryableCount,
                        )
                    }
                    // stop scanning after a final invalidates this generation
                    if (!coordinator.accepts(attempt.effect.localWorkGeneration)) {
                        break
                    }
                }
            }
        }
        val hasPendingSuccessor = queue.pendingCount() > 0
        // keep the owned worker alive until coalesced lane successors drain
        val result = if (retryableCount > 0 || hasPendingSuccessor) {
            AutomaticUploadRunOutcomeV1.RETRY
        // branch on the current state
        } else {
            AutomaticUploadRunOutcomeV1.SUCCESS
        }
        return AutomaticUploadRunResultV1(result, finalizedCount, retryableCount)
    }

    // validate credential metadata and wipe bearer memory before effects
    private fun credentialPreflight(): AutomaticCredentialPreflightV1 {
        val credential = credentialStore.read() ?: return AutomaticCredentialPreflightV1.Blocked
        return try {
            val trustedNow = trustedNowMs() ?: return AutomaticCredentialPreflightV1.Blocked
            // report expiry only after the credential leaves scope
            if (trustedNow >= credential.expiresAtMs) {
                return AutomaticCredentialPreflightV1.Expired
            }
            val origin = credential.urls.canonicalOrigin() ?: return AutomaticCredentialPreflightV1.Revoked
            val validator = AutomaticNativeEndpointValidator(origin)
            // require the complete server-owned endpoint set
            if (!validator.validate(credential.urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)) {
                return AutomaticCredentialPreflightV1.Revoked
            }
            AutomaticCredentialPreflightV1.Ready(credential.urls, origin)
        // release protected state
        } finally {
            credential.wipe()
        }
    }

    // upload and delete one prepared record under narrow credential ownership
    private fun processRecord(
        record: AutomaticPreparedCandidateUploadV1,
        preflight: AutomaticCredentialPreflightV1.Ready,
        endpointValidator: AutomaticNativeEndpointValidator,
    ): AutomaticRecordUploadResultV1 {
        // ignore work from an invalidated local generation
        if (!coordinator.accepts(record.localWorkGeneration)) {
            return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        }
        val credential = credentialStore.read()
            ?: return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        val response = try {
            val trustedNow = trustedNowMs()
                ?: return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
            // stop expired identity only after credential scope exits
            if (trustedNow >= credential.expiresAtMs) {
                return AutomaticRecordUploadResultV1.LocalStop(AutomaticStopTriggerV1.ENROLLMENT_EXPIRED)
            }
            // reject credential replacement during this serialized run
            if (credential.urls != preflight.urls) {
                return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
            }
            val token = credential.bearerToken.copyOf()
            // attempt the protected operation
            try {
                transport.execute(
                    AutomaticNativeHttpRequestV1(
                        method = "POST",
                        url = credential.urls.candidates,
                        bearerToken = token,
                        body = record.requestBody,
                    ),
                )
            // release protected state
            } finally {
                token.fill(0)
            }
        // release protected state
        } finally {
            credential.wipe()
        }
        // retain authenticated ciphertext on transport ambiguity
        if (response == null) {
            return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        }
        val parsed = try {
            // reject redirects origin substitution and stale callbacks
            if (
                !endpointValidator.acceptsResponse(
                    AutomaticNativeEndpointKind.CANDIDATES,
                    response.requestedUrl,
                    response.resolvedUrl,
                    response.wasRedirected,
                ) ||
                !coordinator.accepts(record.localWorkGeneration)
            ) {
                return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
            }
            AutomaticNativeProtocolParserV1.parseCandidateResponse(response.body)
        // release protected state
        } finally {
            // wipe every response path including early rejection
            response.body.fill(0)
        }
        // retain malformed envelopes and mismatched http classes
        if (parsed == null || !AutomaticCandidateHttpStatusPolicyV1.accepts(response.statusCode, parsed)) {
            return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        }
        val policyGeneration = parsed.serverPolicyGeneration
        // reject disclosed policy rollback before final deletion
        if (policyGeneration != null && !coordinator.acceptsServerPolicyGeneration(policyGeneration)) {
            return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        }
        // retain only authenticated retryable outcomes
        if (parsed.disposition == "retryable") {
            coordinator.mutateIfCurrent(record.localWorkGeneration, policyGeneration) {
                // observe only a disclosed retryable policy generation
                if (policyGeneration != null) {
                    coordinator.reconcileAuthoritativePolicy(policyGeneration, enabled = true)
                }
                coordinator.recordOutcome(parsed.outcome)
                true
            }
            return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
        }
        val effect = AutomaticFinalUploadEffectV1(
            localWorkGeneration = record.localWorkGeneration,
            serverPolicyGeneration = policyGeneration,
            outcome = parsed.outcome,
            credited = parsed.credited,
        )
        val authority = stopAuthority(effect)
        // bind mandatory stop authority staging to the exact local generation
        if (authority != null) {
            // branch on the fixed outcome
            when (
                coordinator.mutateIfCurrent(record.localWorkGeneration, policyGeneration) {
                    queue.stageStopAuthority(authority)
                }
            ) {
                AutomaticGenerationMutationResultV1.STALE ->
                    return AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
                AutomaticGenerationMutationResultV1.FAILED ->
                    return AutomaticRecordUploadResultV1.StopCleanup(effect)
                AutomaticGenerationMutationResultV1.APPLIED -> Unit
            }
        }
        crashProbe.reached(AutomaticUploaderCrashPhaseV1.AFTER_FINAL_RESPONSE_BEFORE_DELETE)
        // bind final cleanup before status notification or bridge exposure
        return when (
            coordinator.mutateIfCurrent(record.localWorkGeneration, policyGeneration) {
                queue.deleteFinal(record.recordKey)
            }
        ) {
            // handle the fixed branch
            AutomaticGenerationMutationResultV1.STALE -> {
                // remove only the authority staged for the now-stale response
                if (authority != null) {
                    queue.discardStopAuthority(authority)
                    queue.retryRequiredCleanup()
                }
                AutomaticRecordUploadResultV1.Retry(record.localWorkGeneration)
            }
            // handle the fixed branch
            AutomaticGenerationMutationResultV1.FAILED -> {
                queue.markCleanupRequired()
                // retain mandatory stop authority across failed deletion
                if (authority != null) {
                    AutomaticRecordUploadResultV1.StopCleanup(effect)
                // branch on the current state
                } else {
                    coordinator.recordOutcome("cleanup_required")
                    AutomaticRecordUploadResultV1.CleanupRetry
                }
            }
            AutomaticGenerationMutationResultV1.APPLIED -> AutomaticRecordUploadResultV1.Final(effect)
        }
    }

    // expose one detail-free final effect after every sensitive scope is wiped
    private fun exposeFinal(effect: AutomaticFinalUploadEffectV1): AutomaticFinalExposureResultV1 {
        val authority = stopAuthority(effect)
        // converge durable stop authority without reusing candidate detail
        if (authority != null) {
            // branch on the fixed outcome
            return when (coordinator.applyFinalStopAuthority(authority)) {
                AutomaticStopAuthorityResultV1.APPLIED -> AutomaticFinalExposureResultV1.APPLIED
                AutomaticStopAuthorityResultV1.FAILED -> AutomaticFinalExposureResultV1.FAILED
                AutomaticStopAuthorityResultV1.STALE -> AutomaticFinalExposureResultV1.STALE
            }
        }
        // branch on the fixed outcome
        return when (coordinator.mutateIfCurrent(effect.localWorkGeneration, effect.serverPolicyGeneration) {
            val policyGeneration = effect.serverPolicyGeneration
            // observe only a disclosed non-stop policy generation
            if (policyGeneration != null) {
                coordinator.reconcileAuthoritativePolicy(policyGeneration, enabled = true)
            }
            coordinator.recordOutcome(effect.outcome)
            // notify only a confirmed server 201 credited final
            if (effect.credited) {
                creditedSignal.credited()
            }
            true
        }) {
            AutomaticGenerationMutationResultV1.APPLIED -> AutomaticFinalExposureResultV1.APPLIED
            AutomaticGenerationMutationResultV1.FAILED -> AutomaticFinalExposureResultV1.FAILED
            AutomaticGenerationMutationResultV1.STALE -> AutomaticFinalExposureResultV1.STALE
        }
    }

    // project one fixed detail-free stop authority from a final envelope
    private fun stopAuthority(effect: AutomaticFinalUploadEffectV1): AutomaticPendingStopAuthorityV1? =
        // branch on the current state
        if (
            effect.outcome in setOf(
                "authentication_failed",
                "detector_disabled",
                "enrollment_expired",
                "enrollment_revoked",
                "policy_disabled",
            )
        ) {
            AutomaticPendingStopAuthorityV1(
                effect.outcome,
                effect.serverPolicyGeneration,
                effect.localWorkGeneration,
            )
        // branch on the current state
        } else {
            null
        }
}
