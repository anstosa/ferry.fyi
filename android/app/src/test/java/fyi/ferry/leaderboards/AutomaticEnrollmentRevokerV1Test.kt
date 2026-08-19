package fyi.ferry.leaderboards

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticEnrollmentRevokerV1Test {
    // define the native contract
    private class Transport(
        private val response: AutomaticNativeHttpResponseV1,
    ) : AutomaticNativeHttpTransportV1 {
        var request: AutomaticNativeHttpRequestV1? = null

        // capture one deterministic revoke request
        override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1 {
            this.request = request.copy(bearerToken = request.bearerToken.copyOf())
            return response
        }

        // expose successful deterministic cancellation
        override fun cancelAll(): Boolean = true
    }

    // accept and wipe one exact direct revoke response
    @Test
    fun directStrictRevokeSucceedsAndWipesBuffers() {
        val response = AutomaticNativeHttpResponseV1(
            statusCode = 200,
            requestedUrl = "https://ferry.fyi/api/leaderboards/native/enrollment",
            resolvedUrl = "https://ferry.fyi/api/leaderboards/native/enrollment",
            wasRedirected = false,
            body = "{\"revoked\":true,\"schemaVersion\":1,\"serverPolicyGeneration\":4}".toByteArray(),
        )
        val transport = Transport(response)

        assertTrue(AutomaticBestEffortEnrollmentRevokerV1(transport).revoke(testCredential()))
        // run the bounded callback
        assertTrue(response.body.all { byte -> byte == 0.toByte() })
        assertTrue(transport.request?.method == "DELETE")
        assertTrue(transport.request?.body == null)
    }

    // reject redirects while still wiping the response buffer
    @Test
    fun redirectedRevokeFailsClosedAndWipesBuffers() {
        val response = AutomaticNativeHttpResponseV1(
            statusCode = 200,
            requestedUrl = "https://ferry.fyi/api/leaderboards/native/enrollment",
            resolvedUrl = "https://attacker.invalid/enrollment",
            wasRedirected = true,
            body = "{\"revoked\":true,\"schemaVersion\":1,\"serverPolicyGeneration\":4}".toByteArray(),
        )

        assertFalse(AutomaticBestEffortEnrollmentRevokerV1(Transport(response)).revoke(testCredential()))
        // run the bounded callback
        assertTrue(response.body.all { byte -> byte == 0.toByte() })
    }
}
