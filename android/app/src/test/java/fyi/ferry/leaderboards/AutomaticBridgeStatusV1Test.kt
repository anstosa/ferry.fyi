package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

// define the native contract
class AutomaticBridgeStatusV1Test {
    // expose the exact aggregate shared contract without device generation
    @Test
    fun statusProjectionHasExactPrivacyMinimalKeys() {
        val projection = AutomaticBridgeStatusV1.project(
            status = AutomaticNativeRuntimeStatusV1(
                configGeneration = ConfigGeneration(4L),
                serverPolicyGeneration = ServerPolicyGeneration(7L),
                localWorkGeneration = LocalWorkGeneration(99L),
                configurationUsable = true,
                monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                permissionHealth = AutomaticPermissionHealthV1.AUTHORIZED,
                lastOutcome = "credited",
            ),
            pendingCandidateCount = 2,
            credentialExpiryBucket = "less_than_7_days",
        )

        assertEquals(AutomaticBridgeStatusV1.exactKeys, projection.keys)
        assertFalse(projection.containsKey("localWorkGeneration"))
        assertFalse(projection.containsKey("manualFallbackAvailable"))
        assertEquals("less_than_7_days", projection["credentialExpiryBucket"])
        assertEquals(2, projection["pendingCandidateCount"])
    }

    // preserve the exact contract without touching default-off storage
    @Test
    fun defaultOffProjectionIsStrictAndInert() {
        val projection = AutomaticBridgeStatusV1.defaultOff()

        assertEquals(AutomaticBridgeStatusV1.exactKeys, projection.keys)
        assertEquals("disabled", projection["monitorHealth"])
        assertEquals("not_determined", projection["permissionHealth"])
        assertEquals("unavailable", projection["credentialExpiryBucket"])
        assertEquals(0, projection["pendingCandidateCount"])
        assertEquals(0L, projection["serverPolicyGeneration"])
    }

    // reject api 26 through 28 before default-off selection
    @Test
    fun apiFloorProjectionIsStrictAndRuntimeFree() {
        // verify every packaged but unsupported android sdk
        for (sdkInt in 26..28) {
            val projection = AutomaticBridgeStatusV1.inertFor(sdkInt, buildEnabled = false)
            assertEquals(sdkInt.toString(), AutomaticBridgeStatusV1.exactKeys, projection?.keys)
            assertEquals(sdkInt.toString(), "unsupported_os", projection?.get("monitorHealth"))
            assertEquals(sdkInt.toString(), "unsupported_os", projection?.get("lastOutcome"))
            assertEquals(sdkInt.toString(), 0, projection?.get("pendingCandidateCount"))
        }
        assertEquals("disabled", AutomaticBridgeStatusV1.inertFor(29, buildEnabled = false)?.get("monitorHealth"))
        assertEquals(null, AutomaticBridgeStatusV1.inertFor(29, buildEnabled = true))
    }
}
