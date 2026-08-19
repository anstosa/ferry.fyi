package fyi.ferry.leaderboards

import java.nio.charset.StandardCharsets

// define the native contract
internal data class AutomaticNativeHttpRequestV1(
    val method: String,
    val url: String,
    val bearerToken: ByteArray,
    val body: ByteArray?,
)

// define the native contract
internal data class AutomaticNativeHttpResponseV1(
    val statusCode: Int,
    val requestedUrl: String,
    val resolvedUrl: String,
    val wasRedirected: Boolean,
    val body: ByteArray,
)

// define the native contract
internal interface AutomaticNativeHttpTransportV1 {
    // execute one bounded direct request
    fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1?

    // cancel every cancellable request
    fun cancelAll(): Boolean
}

// define the native contract
internal data class AutomaticCheckinResponseEnvelopeV1(
    val credited: Boolean,
    val disposition: String,
    val outcome: String,
    val retryAfterSeconds: Long?,
    val serverPolicyGeneration: ServerPolicyGeneration?,
)

// define the native contract
internal data class AutomaticNativePolicyStatusEnvelopeV1(
    val automaticEnabled: Boolean,
    val credentialExpiryBucket: String,
    val rotateRecommended: Boolean,
    val serverPolicyGeneration: ServerPolicyGeneration,
)

// define the native contract
internal data class AutomaticNativeRevokeEnvelopeV1(
    val serverPolicyGeneration: ServerPolicyGeneration,
)

// define the native contract
internal data class AutomaticNativeErrorEnvelopeV1(
    val error: String,
    val serverPolicyGeneration: ServerPolicyGeneration?,
)

// define the native contract
internal data class AutomaticNativeConfigEnvelopeV1(
    val config: AutomaticTerminalConfigGeneration,
    val serverTimeMs: Long,
    val terminalEnabled: Boolean,
    val vesselEnabled: Boolean,
    val candidateRetentionMs: Long,
    val fleetContextMaxAgeMs: Long,
    val futureToleranceMs: Long,
    val maxLocationAccuracyMillimeters: Long,
    val maxPendingCandidates: Int,
    val urls: AutomaticNativeEndpointUrls,
)

internal val AUTOMATIC_CANDIDATE_OUTCOMES_V1 = listOf(
    "authentication_failed",
    "candidate_conflict",
    "credited",
    "detector_disabled",
    "enrollment_expired",
    "enrollment_revoked",
    "expired",
    "future_timestamp",
    "history_unavailable",
    "history_warming",
    "invalid_candidate",
    "location_accuracy_too_low",
    "malformed_payload",
    "outside_terminal",
    "payload_too_large",
    "policy_disabled",
    "rate_limited",
    "sailing_already_credited",
    "stale_event",
    "temporarily_unavailable",
    "terminal_config_unavailable",
    "terminal_not_found",
    "too_close_to_shore",
    "unsupported_encoding",
    "unsupported_media_type",
    "vessel_not_found",
)

internal val AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1 = setOf(
    "history_warming",
    "rate_limited",
    "temporarily_unavailable",
)

internal val AUTOMATIC_PRE_AUTH_CANDIDATE_OUTCOMES_V1 = setOf(
    "authentication_failed",
    "invalid_candidate",
    "malformed_payload",
    "payload_too_large",
    "rate_limited",
    "temporarily_unavailable",
    "unsupported_encoding",
    "unsupported_media_type",
)

internal val AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1 = setOf(
    "invalid_candidate",
    "malformed_payload",
    "payload_too_large",
    "unsupported_encoding",
    "unsupported_media_type",
)

// define the native contract
internal object AutomaticCandidateHttpStatusPolicyV1 {
    // bind each fixed envelope to its reviewed http class
    fun accepts(statusCode: Int, response: AutomaticCheckinResponseEnvelopeV1): Boolean {
        // map pre-auth and authenticated outcomes exactly
        return when (response.outcome) {
            "authentication_failed",
            "enrollment_expired",
            "enrollment_revoked",
            -> statusCode == 401
            "malformed_payload" -> statusCode == 400
            "payload_too_large" -> statusCode == 413
            "unsupported_encoding",
            "unsupported_media_type",
            -> statusCode == 415
            "invalid_candidate" -> statusCode == 422
            "rate_limited" -> statusCode == 429
            "temporarily_unavailable" -> statusCode == 200 || statusCode == 503
            "candidate_conflict" -> statusCode == 200 || statusCode == 409
            "credited" -> statusCode == 201
            // branch on the current state
            else -> statusCode == 200
        }
    }
}

// define the native contract
internal object AutomaticNativeProtocolParserV1 {
    // parse one strict status or config authentication denial
    fun parseNativeError(bytes: ByteArray): AutomaticNativeErrorEnvelopeV1? {
        // enforce the fixed small native response bound
        if (bytes.isEmpty() || bytes.size > 4_096) {
            return null
        }
        val root = objectValue(bytes) ?: return null
        // reject every missing or extra error field
        if (
            root.entries.keys != setOf("error", "schemaVersion", "serverPolicyGeneration") ||
            integer(root, "schemaVersion") != 1L
        ) {
            return null
        }
        val error = string(root, "error") ?: return null
        val generationValue = root.entries["serverPolicyGeneration"] ?: return null
        val generation = if (generationValue == AutomaticV0JsonValue.NullValue) {
            null
        // branch on the current state
        } else {
            nonNegativeLong(generationValue)?.let(::ServerPolicyGeneration) ?: return null
        }
        // bind nullable policy only to an unrecognized bearer
        if (
            error !in setOf("authentication_failed", "enrollment_expired", "enrollment_revoked") ||
            error != "authentication_failed" && generation == null
        ) {
            return null
        }
        return AutomaticNativeErrorEnvelopeV1(error, generation)
    }

    // parse one strict candidate response
    fun parseCandidateResponse(bytes: ByteArray): AutomaticCheckinResponseEnvelopeV1? {
        // enforce the dedicated candidate response bound
        if (bytes.isEmpty() || bytes.size > 4_096) {
            return null
        }
        val root = objectValue(bytes) ?: return null
        val requiredKeys = setOf(
            "credited",
            "disposition",
            "outcome",
            "schemaVersion",
            "serverPolicyGeneration",
        )
        // reject unknown or missing response keys
        if (root.entries.keys !in setOf(requiredKeys, requiredKeys + "retryAfterSeconds")) {
            return null
        }
        val credited = boolean(root, "credited") ?: return null
        val disposition = string(root, "disposition") ?: return null
        val outcome = string(root, "outcome") ?: return null
        val schemaVersion = integer(root, "schemaVersion") ?: return null
        val generationValue = root.entries["serverPolicyGeneration"] ?: return null
        val generation = if (generationValue == AutomaticV0JsonValue.NullValue) {
            null
        // branch on the current state
        } else {
            nonNegativeLong(generationValue) ?: return null
        }
        val retryAfter = root.entries["retryAfterSeconds"]?.let { value -> positiveUint32(value) ?: return null }
        val retryable = outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1
        // require fixed shared response semantics
        if (
            schemaVersion != 1L ||
            disposition !in setOf("final", "retryable") ||
            outcome !in AUTOMATIC_CANDIDATE_OUTCOMES_V1 ||
            (disposition == "retryable") != retryable ||
            credited != (outcome == "credited") ||
            outcome !in setOf("authentication_failed", "rate_limited", "temporarily_unavailable") &&
            ((outcome in AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1) != (generation == null)) ||
            retryAfter != null && !retryable
        ) {
            return null
        }
        return AutomaticCheckinResponseEnvelopeV1(
            credited = credited,
            disposition = disposition,
            outcome = outcome,
            retryAfterSeconds = retryAfter,
            serverPolicyGeneration = generation?.let(::ServerPolicyGeneration),
        )
    }

    // parse one strict policy status
    fun parseStatus(bytes: ByteArray): AutomaticNativePolicyStatusEnvelopeV1? {
        val root = objectValue(bytes) ?: return null
        // require the complete fixed status shape
        if (
            root.entries.keys != setOf(
                "automaticEnabled",
                "credentialExpiryBucket",
                "rotateRecommended",
                "schemaVersion",
                "serverPolicyGeneration",
            ) ||
            integer(root, "schemaVersion") != 1L
        ) {
            return null
        }
        val expiryBucket = string(root, "credentialExpiryBucket") ?: return null
        // reject unknown credential states
        if (expiryBucket !in setOf("expired", "less_than_1_day", "less_than_7_days", "seven_days_or_more", "unavailable")) {
            return null
        }
        return AutomaticNativePolicyStatusEnvelopeV1(
            automaticEnabled = boolean(root, "automaticEnabled") ?: return null,
            credentialExpiryBucket = expiryBucket,
            rotateRecommended = boolean(root, "rotateRecommended") ?: return null,
            serverPolicyGeneration = ServerPolicyGeneration(nonNegativeLong(root.entries["serverPolicyGeneration"]) ?: return null),
        )
    }

    // parse one exact authenticated revoke result
    fun parseRevoke(bytes: ByteArray): AutomaticNativeRevokeEnvelopeV1? {
        val root = objectValue(bytes) ?: return null
        // require the complete fixed revoke shape
        if (
            root.entries.keys != setOf("revoked", "schemaVersion", "serverPolicyGeneration") ||
            boolean(root, "revoked") != true ||
            integer(root, "schemaVersion") != 1L
        ) {
            return null
        }
        return AutomaticNativeRevokeEnvelopeV1(
            ServerPolicyGeneration(nonNegativeLong(root.entries["serverPolicyGeneration"]) ?: return null),
        )
    }

    // parse one complete immutable native configuration
    fun parseConfig(bytes: ByteArray): AutomaticNativeConfigEnvelopeV1? {
        val root = objectValue(bytes) ?: return null
        // require the complete top-level configuration
        if (
            root.entries.keys != setOf(
                "configGeneration",
                "contentHash",
                "detectors",
                "generatedAtMs",
                "parameters",
                "regions",
                "schemaVersion",
                "serverPolicyGeneration",
                "serverTimeMs",
                "urls",
            ) ||
            integer(root, "schemaVersion") != 1L
        ) {
            return null
        }
        val configGeneration = positiveLong(root.entries["configGeneration"]) ?: return null
        val policyGeneration = nonNegativeLong(root.entries["serverPolicyGeneration"]) ?: return null
        val generatedAtMs = nonNegativeLong(root.entries["generatedAtMs"]) ?: return null
        val contentHash = string(root, "contentHash") ?: return null
        val detectors = root.entries["detectors"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        val parameters = root.entries["parameters"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        val urls = root.entries["urls"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        // require every fixed nested key
        if (
            detectors.entries.keys != setOf("terminalEnabled", "vesselEnabled") ||
            parameters.entries.keys != setOf(
                "candidateRetentionMs",
                "fleetContextMaxAgeMs",
                "futureToleranceMs",
                "maxLocationAccuracyMillimeters",
                "maxPendingCandidates",
            ) ||
            urls.entries.keys != setOf("candidates", "config", "enrollment", "status")
        ) {
            return null
        }
        val regionsValue = root.entries["regions"] as? AutomaticV0JsonValue.ArrayValue ?: return null
        val regions = mutableListOf<AutomaticTerminalRegion>()
        // parse every complete public region
        for (value in regionsValue.values) {
            val region = value as? AutomaticV0JsonValue.ObjectValue ?: return null
            // reject partial region records
            if (
                region.entries.keys != setOf(
                    "configGeneration",
                    "latitudeE7",
                    "longitudeE7",
                    "radiusMillimeters",
                    "terminalId",
                )
            ) {
                return null
            }
            val regionGeneration = positiveLong(region.entries["configGeneration"]) ?: return null
            // bind every region to the immutable generation
            if (regionGeneration != configGeneration) {
                return null
            }
            regions += AutomaticTerminalRegion(
                terminalId = string(region, "terminalId") ?: return null,
                latitudeE7 = exactInt(region.entries["latitudeE7"]) ?: return null,
                longitudeE7 = exactInt(region.entries["longitudeE7"]) ?: return null,
                radiusMillimeters = positiveLong(region.entries["radiusMillimeters"]) ?: return null,
                configGeneration = ConfigGeneration(configGeneration),
            )
        }
        val maxPending = positiveLong(parameters.entries["maxPendingCandidates"]) ?: return null
        // require platform-sized queue configuration
        if (maxPending > Int.MAX_VALUE.toLong()) {
            return null
        }
        return AutomaticNativeConfigEnvelopeV1(
            config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = ConfigGeneration(configGeneration),
                serverPolicyGeneration = ServerPolicyGeneration(policyGeneration),
                contentHashHex = contentHash,
                regions = regions,
            ),
            // preserve generated time validation without local authority
            serverTimeMs = nonNegativeLong(root.entries["serverTimeMs"]) ?: return null,
            terminalEnabled = boolean(detectors, "terminalEnabled") ?: return null,
            vesselEnabled = boolean(detectors, "vesselEnabled") ?: return null,
            candidateRetentionMs = positiveLong(parameters.entries["candidateRetentionMs"]) ?: return null,
            fleetContextMaxAgeMs = positiveLong(parameters.entries["fleetContextMaxAgeMs"]) ?: return null,
            futureToleranceMs = nonNegativeLong(parameters.entries["futureToleranceMs"]) ?: return null,
            maxLocationAccuracyMillimeters = positiveLong(parameters.entries["maxLocationAccuracyMillimeters"]) ?: return null,
            maxPendingCandidates = maxPending.toInt(),
            urls = AutomaticNativeEndpointUrls(
                candidates = string(urls, "candidates") ?: return null,
                config = string(urls, "config") ?: return null,
                enrollment = string(urls, "enrollment") ?: return null,
                status = string(urls, "status") ?: return null,
            ),
        // run the bounded callback
        ).also {
            // reject future-unsafe generated times before activation
            if (generatedAtMs > it.serverTimeMs) {
                return null
            }
        }
    }

    // parse one bounded json object
    private fun objectValue(bytes: ByteArray): AutomaticV0JsonValue.ObjectValue? {
        // reject oversized native envelopes
        if (bytes.isEmpty() || bytes.size > 128 * 1_024) {
            return null
        }
        return AutomaticV0JsonParser.parse(bytes) as? AutomaticV0JsonValue.ObjectValue
    }

    // read one exact string
    private fun string(value: AutomaticV0JsonValue.ObjectValue, key: String): String? =
        (value.entries[key] as? AutomaticV0JsonValue.StringValue)?.value

    // read one exact boolean
    private fun boolean(value: AutomaticV0JsonValue.ObjectValue, key: String): Boolean? =
        (value.entries[key] as? AutomaticV0JsonValue.BooleanValue)?.value

    // read one exact integer field
    private fun integer(value: AutomaticV0JsonValue.ObjectValue, key: String): Long? = nonNegativeLong(value.entries[key])

    // read one positive safe integer
    private fun positiveLong(value: AutomaticV0JsonValue?): Long? = nonNegativeLong(value)?.takeIf { number -> number > 0L }

    // read one positive unsigned 32-bit integer
    private fun positiveUint32(value: AutomaticV0JsonValue?): Long? =
        // run the bounded callback
        nonNegativeLong(value)?.takeIf { number -> number in 1..0xffff_ffffL }

    // read one nonnegative safe integer
    private fun nonNegativeLong(value: AutomaticV0JsonValue?): Long? {
        val number = (value as? AutomaticV0JsonValue.NumberValue)?.value ?: return null
        return try {
            // run the bounded callback
            number.longValueExact().takeIf { parsed -> parsed in 0..9_007_199_254_740_991L }
        // fail closed on the error
        } catch (_: ArithmeticException) {
            null
        }
    }

    // read one exact signed integer
    private fun exactInt(value: AutomaticV0JsonValue?): Int? {
        val number = (value as? AutomaticV0JsonValue.NumberValue)?.value ?: return null
        return try {
            number.intValueExact()
        // fail closed on the error
        } catch (_: ArithmeticException) {
            null
        }
    }
}

// handle the native operation
internal fun AutomaticNativeEndpointUrls.canonicalOrigin(): String? {
    val configUri = try {
        java.net.URI(config)
    // fail closed on the error
    } catch (_: Exception) {
        return null
    }
    val host = configUri.host ?: return null
    val port = if (configUri.port == -1) 443 else configUri.port
    return "https://${host.lowercase()}:$port"
}

// handle the native operation
internal fun ByteArray.utf8Copy(): String = String(copyOf(), StandardCharsets.UTF_8)
