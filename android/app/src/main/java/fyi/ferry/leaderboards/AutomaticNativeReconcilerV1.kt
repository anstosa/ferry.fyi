package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

// define the native contract
internal data class AutomaticNativeParametersV1(
    val candidateRetentionMs: Long,
    val fleetContextMaxAgeMs: Long,
    val futureToleranceMs: Long,
    val maxLocationAccuracyMillimeters: Long,
    val maxPendingCandidates: Int,
)

// define the native contract
internal class AutomaticNativeParametersStoreV1(
    private val directory: File,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val parameterPattern = Regex("native-parameters-v1-[0-9]+\\.bin")

    // persist only public bounded policy parameters
    @Synchronized
    fun replace(configGeneration: ConfigGeneration, value: AutomaticNativeParametersV1): Boolean {
        // require exact candidate retention and positive safety bounds
        if (
            configGeneration.value <= 0L ||
            value.candidateRetentionMs != AUTOMATIC_CANDIDATE_RETENTION_MS ||
            value.fleetContextMaxAgeMs <= 0L ||
            value.futureToleranceMs < 0L ||
            value.maxLocationAccuracyMillimeters <= 0L ||
            value.maxPendingCandidates <= 0
        ) {
            return false
        }
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(1)
            output.writeLong(value.candidateRetentionMs)
            output.writeLong(value.fleetContextMaxAgeMs)
            output.writeLong(value.futureToleranceMs)
            output.writeLong(value.maxLocationAccuracyMillimeters)
            output.writeInt(value.maxPendingCandidates)
            output.flush()
        }
        return fileOps.replace(parameterFile(configGeneration), bytes.toByteArray())
    }

    // restore one exact public parameter set
    @Synchronized
    fun read(configGeneration: ConfigGeneration): AutomaticNativeParametersV1? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(parameterFile(configGeneration).readBytes())).use { input ->
            // require the fixed parameter schema
            if (input.readInt() != 1) {
                return null
            }
            val value = AutomaticNativeParametersV1(
                candidateRetentionMs = input.readLong(),
                fleetContextMaxAgeMs = input.readLong(),
                futureToleranceMs = input.readLong(),
                maxLocationAccuracyMillimeters = input.readLong(),
                maxPendingCandidates = input.readInt(),
            )
            // reject trailing or unsafe persisted policy
            if (
                input.available() != 0 ||
                value.candidateRetentionMs != AUTOMATIC_CANDIDATE_RETENTION_MS ||
                value.fleetContextMaxAgeMs <= 0L ||
                value.futureToleranceMs < 0L ||
                value.maxLocationAccuracyMillimeters <= 0L ||
                value.maxPendingCandidates <= 0
            ) {
                return null
            }
            value
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // delete stale local policy parameters
    @Synchronized
    fun clear(): Boolean {
        var cleared = true
        // delete every generation-bound public parameter file
        for (file in parameterFiles()) {
            // branch on the current state
            if (!fileOps.delete(file)) {
                cleared = false
            }
        }
        return cleared
    }

    // retain only the activated parameter generation
    @Synchronized
    fun retainOnly(configGeneration: ConfigGeneration): Boolean {
        var retained = true
        // delete every superseded generation independently
        for (file in parameterFiles()) {
            // branch on the current state
            if (file != parameterFile(configGeneration) && !fileOps.delete(file)) {
                retained = false
            }
        }
        return retained
    }

    // resolve one immutable parameter generation path
    private fun parameterFile(configGeneration: ConfigGeneration): File =
        File(directory, "native-parameters-v1-${configGeneration.value}.bin")

    // list only owned parameter generation files
    private fun parameterFiles(): List<File> = directory.listFiles { file -> parameterPattern.matches(file.name) }
        .orEmpty()
        .toList()
}

// define the native contract
internal enum class AutomaticReconciliationOutcomeV1 {
    APPLIED,
    DISABLED_AND_PURGED,
    RETRYABLE,
}

// define the native contract
internal interface AutomaticReconcilerCredentialWipeProbeV1 {
    // observe only the wiped credential boundary in deterministic tests
    fun credentialWiped(credential: AutomaticCredentialV1)
}

// define the native contract
internal object AutomaticNoopReconcilerCredentialWipeProbeV1 : AutomaticReconcilerCredentialWipeProbeV1 {
    // keep production effects free of test behavior
    override fun credentialWiped(credential: AutomaticCredentialV1) = Unit
}

// define the native contract
internal class AutomaticNativeReconcilerV1(
    private val credentialStore: AutomaticCredentialStoreV1,
    private val transport: AutomaticNativeHttpTransportV1,
    private val trustedClock: AutomaticTrustedClock,
    private val parametersStore: AutomaticNativeParametersStoreV1,
    private val coordinator: AutomaticCheckinPolicyCoordinatorV1,
    private val publicConfigStore: AutomaticPublicTerminalConfigStoreV1? = null,
    private val credentialWipeProbe: AutomaticReconcilerCredentialWipeProbeV1 =
        AutomaticNoopReconcilerCredentialWipeProbeV1,
) {
    // reconcile one aggregate status response
    @Synchronized
    fun reconcileStatus(): AutomaticReconciliationOutcomeV1 {
        val localWorkGeneration = coordinator.localWorkGeneration()
        val credential = credentialStore.read() ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        val response = try {
            executeGet(credential, AutomaticNativeEndpointKind.STATUS)
        // release protected state
        } finally {
            credential.wipe()
            credentialWipeProbe.credentialWiped(credential)
        } ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        // apply only a strict direct 401 identity denial
        if (response.statusCode != 200) {
            return reconcileNativeError(localWorkGeneration, response)
        }
        val parsed = try {
            AutomaticNativeProtocolParserV1.parseStatus(response.body)
        // release protected state
        } finally {
            response.body.fill(0)
        } ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        var outcome = AutomaticReconciliationOutcomeV1.RETRYABLE
        val applied = coordinator.mutateIfCurrent(localWorkGeneration, parsed.serverPolicyGeneration) {
            // expire identity only after an authenticated current-generation status
            if (parsed.credentialExpiryBucket == "expired") {
                coordinator.reconcileAuthoritativePolicy(parsed.serverPolicyGeneration, enabled = true)
                val stopped = coordinator.knownStop(AutomaticStopTriggerV1.ENROLLMENT_EXPIRED)
                outcome = AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
                return@mutateIfCurrent stopped
            }
            // learn remote kill only from this current policy-bearing response
            if (!parsed.automaticEnabled) {
                val stopped = coordinator.reconcileAuthoritativePolicy(
                    parsed.serverPolicyGeneration,
                    enabled = false,
                )
                outcome = AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
                return@mutateIfCurrent stopped
            }
            val reconciled = coordinator.reconcileAuthoritativePolicy(
                parsed.serverPolicyGeneration,
                enabled = true,
            )
            outcome = if (reconciled) {
                AutomaticReconciliationOutcomeV1.APPLIED
            // branch on the current state
            } else {
                AutomaticReconciliationOutcomeV1.RETRYABLE
            }
            reconciled
        }
        return if (applied == AutomaticGenerationMutationResultV1.APPLIED) {
            outcome
        // branch on the current state
        } else {
            AutomaticReconciliationOutcomeV1.RETRYABLE
        }
    }

    // reconcile complete configuration and trusted server time
    @Synchronized
    fun reconcileConfig(): AutomaticReconciliationOutcomeV1 {
        val localWorkGeneration = coordinator.localWorkGeneration()
        val credential = credentialStore.read() ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        val credentialUrls = credential.urls
        val response = try {
            executeGet(credential, AutomaticNativeEndpointKind.CONFIG)
        // release protected state
        } finally {
            credential.wipe()
            credentialWipeProbe.credentialWiped(credential)
        } ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        // apply only a strict direct 401 identity denial
        if (response.statusCode != 200) {
            return reconcileNativeError(localWorkGeneration, response)
        }
        val parsed = try {
            AutomaticNativeProtocolParserV1.parseConfig(response.body)
        // release protected state
        } finally {
            response.body.fill(0)
        } ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        val origin = credentialUrls.canonicalOrigin() ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
            val endpointValidator = AutomaticNativeEndpointValidator(origin)
            // reject any changed or bridge-controlled endpoint set
            if (
                parsed.urls != credentialUrls ||
                !endpointValidator.validate(parsed.urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)
            ) {
                val stopped = coordinator.mutateIfCurrent(localWorkGeneration) {
                    coordinator.knownStop(AutomaticStopTriggerV1.ENROLLMENT_REVOKED)
                }
                return if (stopped == AutomaticGenerationMutationResultV1.APPLIED) {
                    AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
                // branch on the current state
                } else {
                    AutomaticReconciliationOutcomeV1.RETRYABLE
                }
            }
            val parameters = AutomaticNativeParametersV1(
                candidateRetentionMs = parsed.candidateRetentionMs,
                fleetContextMaxAgeMs = parsed.fleetContextMaxAgeMs,
                futureToleranceMs = parsed.futureToleranceMs,
                maxLocationAccuracyMillimeters = parsed.maxLocationAccuracyMillimeters,
                maxPendingCandidates = parsed.maxPendingCandidates,
            )
            var outcome = AutomaticReconciliationOutcomeV1.RETRYABLE
            val mutation = coordinator.mutateIfCurrent(
                localWorkGeneration,
                parsed.config.serverPolicyGeneration,
            ) {
                // reject config rollback or mutation before current-generation writes
                if (!coordinator.acceptsConfiguration(parsed.config)) {
                    return@mutateIfCurrent false
                }
                // learn detector denial only inside the captured local generation
                if (!parsed.terminalEnabled) {
                    coordinator.reconcileAuthoritativePolicy(parsed.config.serverPolicyGeneration, enabled = true)
                    val stopped = coordinator.knownStop(AutomaticStopTriggerV1.DETECTOR_DISABLED)
                    outcome = AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
                    return@mutateIfCurrent stopped
                }
                // stage generation-bound public state before atomic activation visibility
                if (
                    !trustedClock.refreshAnchor(parsed.serverTimeMs) ||
                    !parametersStore.replace(parsed.config.configGeneration, parameters) ||
                    publicConfigStore?.replace(parsed.config) == false
                ) {
                    return@mutateIfCurrent false
                }
                // branch on the fixed outcome
                outcome = when (coordinator.activateConfiguration(parsed.config)) {
                    ConfigActivationOutcome.ACTIVATED,
                    ConfigActivationOutcome.ALREADY_ACTIVE,
                    // handle the fixed branch
                    -> {
                        publicConfigStore?.retainOnly(parsed.config.configGeneration)
                        // branch on the current state
                        if (parametersStore.retainOnly(parsed.config.configGeneration)) {
                            AutomaticReconciliationOutcomeV1.APPLIED
                        // branch on the current state
                        } else {
                            coordinator.knownStop(AutomaticStopTriggerV1.DETECTOR_DISABLED)
                            AutomaticReconciliationOutcomeV1.RETRYABLE
                        }
                    }
                    ConfigActivationOutcome.KEPT_PREVIOUS -> AutomaticReconciliationOutcomeV1.RETRYABLE
                    ConfigActivationOutcome.DISABLED -> AutomaticReconciliationOutcomeV1.RETRYABLE
                }
                outcome == AutomaticReconciliationOutcomeV1.APPLIED ||
                    outcome == AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
            }
            return if (mutation == AutomaticGenerationMutationResultV1.APPLIED) {
                outcome
            // branch on the current state
            } else {
                AutomaticReconciliationOutcomeV1.RETRYABLE
            }
    }

    // execute one direct policy-bearing get
    private fun executeGet(
        credential: AutomaticCredentialV1,
        kind: AutomaticNativeEndpointKind,
    ): AutomaticNativeHttpResponseV1? {
        val origin = credential.urls.canonicalOrigin() ?: return null
        val validator = AutomaticNativeEndpointValidator(origin)
        // reject incomplete trusted endpoints before network work
        if (!validator.validate(credential.urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)) {
            return null
        }
        val token = credential.bearerToken.copyOf()
        val requestedUrl = credential.urls.url(kind)
        val response = try {
            transport.execute(
                AutomaticNativeHttpRequestV1(
                    method = "GET",
                    url = requestedUrl,
                    bearerToken = token,
                    body = null,
                ),
            )
        // release protected state
        } finally {
            token.fill(0)
        } ?: return null
        // accept only unchanged direct endpoints before body classification
        if (
            !validator.acceptsResponse(kind, response.requestedUrl, response.resolvedUrl, response.wasRedirected)
        ) {
            response.body.fill(0)
            return null
        }
        return response
    }

    // apply one strict authenticated native identity denial
    private fun reconcileNativeError(
        localWorkGeneration: LocalWorkGeneration,
        response: AutomaticNativeHttpResponseV1,
    ): AutomaticReconciliationOutcomeV1 {
        val parsed = try {
            // reject successful or non-authentication status classes
            if (response.statusCode != 401) {
                return AutomaticReconciliationOutcomeV1.RETRYABLE
            }
            AutomaticNativeProtocolParserV1.parseNativeError(response.body)
        // release protected state
        } finally {
            response.body.fill(0)
        } ?: return AutomaticReconciliationOutcomeV1.RETRYABLE
        val authority = AutomaticPendingStopAuthorityV1(
            outcome = parsed.error,
            serverPolicyGeneration = parsed.serverPolicyGeneration,
            localWorkGeneration = localWorkGeneration,
        )
        // branch on the fixed outcome
        return when (coordinator.applyFinalStopAuthority(authority)) {
            AutomaticStopAuthorityResultV1.APPLIED -> AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
            AutomaticStopAuthorityResultV1.FAILED,
            AutomaticStopAuthorityResultV1.STALE,
            -> AutomaticReconciliationOutcomeV1.RETRYABLE
        }
    }
}
