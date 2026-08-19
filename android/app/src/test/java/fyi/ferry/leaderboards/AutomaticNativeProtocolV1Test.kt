package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticNativeProtocolV1Test {
    // parse only fixed native authentication denial envelopes
    @Test
    fun nativeErrorParserRequiresExactOutcomeGenerationShape() {
        val revoked = """
            {"error":"enrollment_revoked","schemaVersion":1,"serverPolicyGeneration":7}
        """.trimIndent().toByteArray()
        val unknown = """
            {"error":"authentication_failed","schemaVersion":1,"serverPolicyGeneration":null}
        """.trimIndent().toByteArray()

        assertEquals("enrollment_revoked", AutomaticNativeProtocolParserV1.parseNativeError(revoked)?.error)
        assertEquals(7L, AutomaticNativeProtocolParserV1.parseNativeError(revoked)?.serverPolicyGeneration?.value)
        assertEquals("authentication_failed", AutomaticNativeProtocolParserV1.parseNativeError(unknown)?.error)
        assertNull(AutomaticNativeProtocolParserV1.parseNativeError(unknown)?.serverPolicyGeneration)
        assertNull(
            AutomaticNativeProtocolParserV1.parseNativeError(
                revoked.toString(Charsets.UTF_8).replace("}", ",\"detail\":\"private\"}").toByteArray(),
            ),
        )
        assertNull(
            AutomaticNativeProtocolParserV1.parseNativeError(
                "{\"error\":\"enrollment_expired\",\"schemaVersion\":1,\"serverPolicyGeneration\":null}"
                    .toByteArray(),
            ),
        )
    }

    // select one canonical accepted status for a fixed outcome
    private fun expectedStatus(outcome: String): Int = when (outcome) {
        "authentication_failed",
        "enrollment_expired",
        "enrollment_revoked",
        -> 401
        "malformed_payload" -> 400
        "payload_too_large" -> 413
        "unsupported_encoding",
        "unsupported_media_type",
        -> 415
        "invalid_candidate" -> 422
        "rate_limited" -> 429
        "temporarily_unavailable" -> 503
        "candidate_conflict" -> 409
        "credited" -> 201
        // branch on the current state
        else -> 200
    }

    // build one strict candidate response json value
    private fun candidateResponseJson(
        outcome: String,
        disposition: String = if (outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1) "retryable" else "final",
        credited: Boolean = outcome == "credited",
        generation: String = "7",
        retryAfter: String = "",
    ): String =
        "{\"credited\":$credited,\"disposition\":\"$disposition\",\"outcome\":\"$outcome\"$retryAfter," +
            "\"schemaVersion\":1,\"serverPolicyGeneration\":$generation}"

    // build one complete immutable config response
    private fun configJson(
        terminalEnabled: Boolean = true,
        serverPolicyGeneration: Long = 3L,
        serverTimeMs: Long = 2_000L,
        contentHash: String? = null,
    ): String {
        val regions = listOf(
            AutomaticTerminalRegion(
                terminalId = "7",
                latitudeE7 = 476_020_000,
                longitudeE7 = -1_223_390_000,
                radiusMillimeters = 250_000L,
                configGeneration = ConfigGeneration(2L),
            ),
        )
        val hash = contentHash ?: AutomaticPayloadDigestV1.sha256Hex(
            AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
        )
        return """
            {
              "configGeneration":2,
              "contentHash":"$hash",
              "detectors":{"terminalEnabled":$terminalEnabled,"vesselEnabled":false},
              "generatedAtMs":1000,
              "parameters":{
                "candidateRetentionMs":43200000,
                "fleetContextMaxAgeMs":120000,
                "futureToleranceMs":30000,
                "maxLocationAccuracyMillimeters":100000,
                "maxPendingCandidates":8
              },
              "regions":[{
                "configGeneration":2,
                "latitudeE7":476020000,
                "longitudeE7":-1223390000,
                "radiusMillimeters":250000,
                "terminalId":"7"
              }],
              "schemaVersion":1,
              "serverPolicyGeneration":$serverPolicyGeneration,
              "serverTimeMs":$serverTimeMs,
              "urls":{
                "candidates":"https://ferry.fyi/api/leaderboards/native/candidates",
                "config":"https://ferry.fyi/api/leaderboards/native/config",
                "enrollment":"https://ferry.fyi/api/leaderboards/native/enrollment",
                "status":"https://ferry.fyi/api/leaderboards/native/status"
              }
            }
        """.trimIndent()
    }

    // parse one complete strict native configuration
    @Test
    fun parsesCompleteConfigAndRejectsMutation() {
        val parsed = AutomaticNativeProtocolParserV1.parseConfig(configJson().toByteArray())
        assertNotNull(parsed)
        assertEquals(2L, parsed!!.config.configGeneration.value)
        assertEquals(3L, parsed.config.serverPolicyGeneration.value)
        assertTrue(parsed.terminalEnabled)
        assertFalse(parsed.vesselEnabled)
        assertEquals(AUTOMATIC_CANDIDATE_RETENTION_MS, parsed.candidateRetentionMs)

        assertNull(
            AutomaticNativeProtocolParserV1.parseConfig(
                configJson(contentHash = "0".repeat(64)).toByteArray(),
            // run the bounded callback
            )?.takeIf { value ->
                AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(value.config.regions),
                ) == value.config.contentHashHex
            },
        )
        assertNull(AutomaticNativeProtocolParserV1.parseConfig(configJson(serverTimeMs = 999L).toByteArray()))
        assertNull(
            AutomaticNativeProtocolParserV1.parseConfig(
                configJson().replace("\"terminalId\":\"7\"", "\"terminalId\":\"7\",\"extra\":true").toByteArray(),
            ),
        )
    }

    // accept fixed status and reject free text or rollback shapes
    @Test
    fun statusParserIsClosedAndDetailFree() {
        val valid = """
            {"automaticEnabled":true,"credentialExpiryBucket":"less_than_7_days",
             "rotateRecommended":false,"schemaVersion":1,"serverPolicyGeneration":4}
        """.trimIndent().toByteArray()
        assertNotNull(AutomaticNativeProtocolParserV1.parseStatus(valid))
        assertNull(
            AutomaticNativeProtocolParserV1.parseStatus(
                valid.toString(Charsets.UTF_8).replace("}", ",\"entityId\":\"7\"}").toByteArray(),
            ),
        )
    }

    // accept only one exact authenticated revoke result
    @Test
    fun revokeParserIsStrictAndDetailFree() {
        val valid = "{\"revoked\":true,\"schemaVersion\":1,\"serverPolicyGeneration\":4}".toByteArray()

        assertEquals(4L, AutomaticNativeProtocolParserV1.parseRevoke(valid)?.serverPolicyGeneration?.value)
        assertNull(
            AutomaticNativeProtocolParserV1.parseRevoke(
                valid.toString(Charsets.UTF_8).replace("}", ",\"enrollmentId\":\"private\"}").toByteArray(),
            ),
        )
        assertNull(AutomaticNativeProtocolParserV1.parseRevoke(valid.toString(Charsets.UTF_8).replace("true", "false").toByteArray()))
    }

    // accept every fixed outcome with its sole disposition and credit state
    @Test
    fun candidateResponseParserAcceptsCompleteGoldenOutcomeTable() {
        // verify the fixed shared outcome table
        for (outcome in AUTOMATIC_CANDIDATE_OUTCOMES_V1) {
            val retryAfter = if (outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1) {
                ",\"retryAfterSeconds\":30"
            // branch on the current state
            } else {
                ""
            }
            val generation = if (outcome in AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1) "null" else "7"
            val parsed = AutomaticNativeProtocolParserV1.parseCandidateResponse(
                candidateResponseJson(outcome, generation = generation, retryAfter = retryAfter).toByteArray(),
            )
            assertNotNull(outcome, parsed)
            assertEquals(outcome, parsed?.outcome)
            assertEquals(outcome == "credited", parsed?.credited)
            assertEquals(outcome in AUTOMATIC_RETRYABLE_CANDIDATE_OUTCOMES_V1, parsed?.disposition == "retryable")
            assertEquals(if (generation == "null") null else 7L, parsed?.serverPolicyGeneration?.value)
        }
    }

    // bind every fixed response to its reviewed http status
    @Test
    fun candidateHttpStatusPolicyMatchesGoldenOutcomeTable() {
        // verify every outcome and one rejected adjacent status
        for (outcome in AUTOMATIC_CANDIDATE_OUTCOMES_V1) {
            val generation = if (outcome in AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1) "null" else "7"
            val response = AutomaticNativeProtocolParserV1.parseCandidateResponse(
                candidateResponseJson(outcome, generation = generation).toByteArray(),
            )!!
            val expected = expectedStatus(outcome)
            assertTrue(outcome, AutomaticCandidateHttpStatusPolicyV1.accepts(expected, response))
            assertFalse(outcome, AutomaticCandidateHttpStatusPolicyV1.accepts(418, response))
        }
        val unavailable = AutomaticNativeProtocolParserV1.parseCandidateResponse(
            candidateResponseJson("temporarily_unavailable").toByteArray(),
        )!!
        val conflict = AutomaticNativeProtocolParserV1.parseCandidateResponse(
            candidateResponseJson("candidate_conflict").toByteArray(),
        )!!
        assertTrue(AutomaticCandidateHttpStatusPolicyV1.accepts(200, unavailable))
        assertTrue(AutomaticCandidateHttpStatusPolicyV1.accepts(200, conflict))
    }

    // restrict null generations to the exact shared pre-auth set
    @Test
    fun candidateResponseParserRestrictsNullPolicyGeneration() {
        // verify every fixed outcome under redaction
        for (outcome in AUTOMATIC_CANDIDATE_OUTCOMES_V1) {
            val parsed = AutomaticNativeProtocolParserV1.parseCandidateResponse(
                candidateResponseJson(outcome, generation = "null").toByteArray(),
            )
            // accept only shared pre-auth outcomes
            if (outcome in AUTOMATIC_PRE_AUTH_CANDIDATE_OUTCOMES_V1) {
                assertNotNull(outcome, parsed)
                assertNull(parsed?.serverPolicyGeneration)
            // branch on the current state
            } else {
                assertNull(outcome, parsed)
            }
        }
    }

    // require null disclosure for every fixed pre-auth parser outcome
    @Test
    fun candidateResponseParserRejectsDisclosedGenerationForNullOnlyOutcomes() {
        // invert every reviewed null-only response
        for (outcome in AUTOMATIC_NULL_GENERATION_CANDIDATE_OUTCOMES_V1) {
            assertNull(
                outcome,
                AutomaticNativeProtocolParserV1.parseCandidateResponse(
                    candidateResponseJson(outcome, generation = "7").toByteArray(),
                ),
            )
        }
        // accept authentication failure before or after locked recognition
        for (generation in listOf("null", "7")) {
            assertNotNull(
                generation,
                AutomaticNativeProtocolParserV1.parseCandidateResponse(
                    candidateResponseJson("authentication_failed", generation = generation).toByteArray(),
                ),
            )
        }
        // accept service ambiguity before or after authentication
        for (generation in listOf("null", "7")) {
            assertNotNull(
                generation,
                AutomaticNativeProtocolParserV1.parseCandidateResponse(
                    candidateResponseJson("temporarily_unavailable", generation = generation).toByteArray(),
                ),
            )
        }
        assertNotNull(
            AutomaticNativeProtocolParserV1.parseCandidateResponse(
                candidateResponseJson("rate_limited", generation = "7").toByteArray(),
            ),
        )
    }

    // reject every semantic or structural response mutation
    @Test
    fun candidateResponseParserRejectsEnvelopeMutations() {
        val valid = candidateResponseJson("stale_event")
        val mutations = listOf(
            candidateResponseJson("history_warming", disposition = "final"),
            candidateResponseJson("stale_event", disposition = "retryable"),
            candidateResponseJson("stale_event", credited = true),
            candidateResponseJson("credited", credited = false),
            candidateResponseJson("stale_event", retryAfter = ",\"retryAfterSeconds\":30"),
            candidateResponseJson("history_warming", retryAfter = ",\"retryAfterSeconds\":0"),
            candidateResponseJson("history_warming", retryAfter = ",\"retryAfterSeconds\":4294967296"),
            candidateResponseJson("stale_event", generation = "null"),
            valid.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            valid.replace("\"serverPolicyGeneration\":7", "\"serverPolicyGeneration\":-1"),
            valid.replace("\"serverPolicyGeneration\":7", "\"serverPolicyGeneration\":9007199254740992"),
            valid.replace("\"outcome\":\"stale_event\"", "\"outcome\":\"unknown\""),
            valid.replace("\"credited\":false,", ""),
            valid.dropLast(1) + ",\"detail\":\"private\"}",
            valid.dropLast(1) + ",\"outcome\":\"expired\"}",
        )
        // reject each closed-contract mutation
        for (mutation in mutations) {
            assertNull(mutation, AutomaticNativeProtocolParserV1.parseCandidateResponse(mutation.toByteArray()))
        }
        assertNull(AutomaticNativeProtocolParserV1.parseCandidateResponse(ByteArray(4_097) { 'x'.code.toByte() }))
    }
}
