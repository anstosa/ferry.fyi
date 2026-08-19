package fyi.ferry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

// define the native contract
class AutomaticBridgeEnrollmentCredentialParserV1Test {
    // mirror one exact createAutomaticEnrollment server response
    private fun serverResponse(): Map<String, Any?> = linkedMapOf(
        "bearerToken" to "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "enrollmentId" to "00000000-0000-4000-8000-000000000001",
        "expiresAtMs" to 1_893_456_000_000L,
        "rotateAfterMs" to 1_892_851_200_000L,
        "schemaVersion" to 1,
        "scopes" to listOf(
            "automatic-checkins:config:read",
            "automatic-checkins:status:read",
            "automatic-checkins:candidates:write",
            "automatic-checkins:enrollment:revoke",
        ),
        "serverPolicyGeneration" to 7,
        "urls" to linkedMapOf(
            "candidates" to "https://ferry.fyi/api/leaderboards/native/candidates",
            "config" to "https://ferry.fyi/api/leaderboards/native/config",
            "enrollment" to "https://ferry.fyi/api/leaderboards/native/enrollment",
            "status" to "https://ferry.fyi/api/leaderboards/native/status",
        ),
    )

    // accept the exact frozen shared server credential
    @Test
    fun parsesExactRealServerResponseWithoutInstallationNonce() {
        val credential = AutomaticBridgeEnrollmentCredentialParserV1.parse(serverResponse())

        assertNotNull(credential)
        assertEquals("00000000-0000-4000-8000-000000000001", credential?.enrollmentId)
        assertEquals(1_893_456_000_000L, credential?.expiresAtMs)
        assertEquals(1_892_851_200_000L, credential?.rotateAfterMs)
        assertEquals(7L, credential?.serverPolicyGeneration?.value)
        assertEquals("https://ferry.fyi/api/leaderboards/native/config", credential?.urls?.config)
        assertEquals("https://ferry.fyi/api/leaderboards/native/status", credential?.urls?.status)
        assertEquals("https://ferry.fyi/api/leaderboards/native/candidates", credential?.urls?.candidates)
        assertEquals("https://ferry.fyi/api/leaderboards/native/enrollment", credential?.urls?.enrollment)
        credential?.wipe()
    }

    // reject missing extra and locally merged credential fields
    @Test
    fun rejectsExtraMissingAndInstallationNonceKeys() {
        // run the bounded callback
        val extra = serverResponse().toMutableMap().apply { put("detail", "private") }
        // run the bounded callback
        val missing = serverResponse().toMutableMap().apply { remove("schemaVersion") }
        // run the bounded callback
        val mergedNonce = serverResponse().toMutableMap().apply {
            put("installationNonce", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        }

        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(extra))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(missing))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(mergedNonce))
    }

    // reject wrong duplicate and non-string scope sets
    @Test
    fun rejectsWrongScopeSets() {
        val mutations = listOf(
            listOf(
                "automatic-checkins:config:read",
                "automatic-checkins:status:read",
                "automatic-checkins:candidates:write",
                "automatic-checkins:admin",
            ),
            listOf(
                "automatic-checkins:config:read",
                "automatic-checkins:status:read",
                "automatic-checkins:candidates:write",
                "automatic-checkins:candidates:write",
            ),
            listOf(
                "automatic-checkins:config:read",
                "automatic-checkins:status:read",
                "automatic-checkins:candidates:write",
                4,
            ),
        )
        // reject every non-exact four-scope mutation
        for (scopes in mutations) {
            // run the bounded callback
            val value = serverResponse().toMutableMap().apply { put("scopes", scopes) }
            assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(value))
        }
    }

    // reject origin path query and nested-key url mutations
    @Test
    fun rejectsWrongOrExtendedUrls() {
        val mutations = listOf(
            "https://attacker.invalid/api/leaderboards/native/config",
            "https://ferry.fyi/api/leaderboards/native/status",
            "https://ferry.fyi/api/leaderboards/native/config?candidate=private",
        )
        // reject every config endpoint substitution
        for (url in mutations) {
            val value = serverResponse().toMutableMap()
            val urls = (value["urls"] as Map<*, *>).toMutableMap().apply { put("config", url) }
            value["urls"] = urls
            assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(value))
        }
        val extraUrl = serverResponse().toMutableMap()
        val extendedUrls = (extraUrl["urls"] as Map<*, *>).toMutableMap().apply {
            put("telemetry", "https://ferry.fyi/telemetry")
        }
        extraUrl["urls"] = extendedUrls
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(extraUrl))
    }

    // reject wrong schema numeric and lifecycle semantics
    @Test
    fun rejectsWrongTypesSchemaAndLifecycle() {
        // run the bounded callback
        val wrongSchema = serverResponse().toMutableMap().apply { put("schemaVersion", 2) }
        // run the bounded callback
        val fractionalGeneration = serverResponse().toMutableMap().apply { put("serverPolicyGeneration", 7.5) }
        // run the bounded callback
        val invalidRotation = serverResponse().toMutableMap().apply { put("rotateAfterMs", 1_893_456_000_000L) }

        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(wrongSchema))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(fractionalGeneration))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(invalidRotation))
    }

    // reject noncanonical or non-256-bit bearer encodings
    @Test
    fun rejectsNoncanonicalBearerTokens() {
        // run the bounded callback
        val invalidLastQuantum = serverResponse().toMutableMap().apply {
            put("bearerToken", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB")
        }
        // run the bounded callback
        val padded = serverResponse().toMutableMap().apply {
            put("bearerToken", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        }
        // run the bounded callback
        val short = serverResponse().toMutableMap().apply {
            put("bearerToken", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        }

        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(invalidLastQuantum))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(padded))
        assertNull(AutomaticBridgeEnrollmentCredentialParserV1.parse(short))
    }
}
