package fyi.ferry.leaderboards

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticNativeEndpointValidatorTest {
    private val validator = AutomaticNativeEndpointValidator("https://ferry.fyi")
    private val validUrls = AutomaticNativeEndpointUrls(
        config = "https://ferry.fyi/api/leaderboards/native/config",
        status = "https://ferry.fyi/api/leaderboards/native/status",
        candidates = "https://ferry.fyi/api/leaderboards/native/candidates",
        enrollment = "https://ferry.fyi/api/leaderboards/native/enrollment",
    )

    // accept only the server-owned endpoint set
    @Test
    fun trustedExactEndpointsAreAccepted() {
        assertTrue(validator.validate(validUrls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG))
    }

    // reject non-https and wrong origins
    @Test
    fun transportAndOriginChangesAreRejected() {
        assertFalse(validator.validate(
            validUrls.copy(config = "http://ferry.fyi/api/leaderboards/native/config"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
        assertFalse(validator.validate(
            validUrls.copy(status = "https://evil.example/api/leaderboards/native/status"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
    }

    // reject url data outside the fixed paths
    @Test
    fun credentialsQueriesFragmentsAndPathsAreRejected() {
        assertFalse(validator.validate(
            validUrls.copy(config = "https://user@ferry.fyi/api/leaderboards/native/config"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
        assertFalse(validator.validate(
            validUrls.copy(status = "https://ferry.fyi/api/leaderboards/native/status?source=js"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
        assertFalse(validator.validate(
            validUrls.copy(candidates = "https://ferry.fyi/api/leaderboards/native/candidates#fragment"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
        assertFalse(validator.validate(
            validUrls.copy(enrollment = "https://ferry.fyi/api/leaderboards/native/config"),
            AutomaticEndpointSource.TRUSTED_SERVER_CONFIG,
        ))
    }

    // reject javascript and user overrides
    @Test
    fun bridgeOverrideSourceIsRejected() {
        assertFalse(validator.validate(validUrls, AutomaticEndpointSource.JAVASCRIPT_OR_USER_OVERRIDE))
    }

    // reject any redirect or final-url substitution
    @Test
    fun redirectTargetSubstitutionIsRejected() {
        val requested = validUrls.config
        assertFalse(validator.acceptsResponse(
            AutomaticNativeEndpointKind.CONFIG,
            requested,
            "https://evil.example/api/leaderboards/native/config",
            wasRedirected = true,
        ))
        assertFalse(validator.acceptsResponse(
            AutomaticNativeEndpointKind.CONFIG,
            requested,
            requested,
            wasRedirected = true,
        ))
        assertTrue(validator.acceptsResponse(
            AutomaticNativeEndpointKind.CONFIG,
            requested,
            requested,
            wasRedirected = false,
        ))
    }
}
