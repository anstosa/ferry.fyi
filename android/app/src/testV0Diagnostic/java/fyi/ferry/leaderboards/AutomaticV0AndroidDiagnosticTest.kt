package fyi.ferry.leaderboards

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticV0AndroidDiagnosticTest {
    // parse only the fixed geofence request namespace
    @Test
    fun requestIdParserRejectsForgedAndMalformedValues() {
        assertEquals(
            AutomaticV0TerminalExitCallback("7", ConfigGeneration(12)),
            AutomaticV0GeofenceReceiver.parseRequestId("v0:12:7"),
        )
        assertNull(AutomaticV0GeofenceReceiver.parseRequestId("v0:0:7"))
        assertNull(AutomaticV0GeofenceReceiver.parseRequestId("v1:12:7"))
        assertNull(AutomaticV0GeofenceReceiver.parseRequestId("v0:12:"))
        assertNull(AutomaticV0GeofenceReceiver.parseRequestId("v0:not-a-number:7"))
    }

    // enforce the exact platform-fix age boundary
    @Test
    fun platformLocationAgeEqualityPassesAndPlusOneFails() {
        assertTrue(AutomaticV0AndroidLocationAge.isAcceptable(130_000L, 100_000L))
        assertFalse(AutomaticV0AndroidLocationAge.isAcceptable(130_001L, 100_000L))
        assertFalse(AutomaticV0AndroidLocationAge.isAcceptable(99_999L, 100_000L))
        assertFalse(AutomaticV0AndroidLocationAge.isAcceptable(Long.MAX_VALUE, Long.MIN_VALUE))
    }

    // keep adapter telemetry fixed and duration-bucketed
    @Test
    fun adapterTelemetryContainsOnlyFixedAggregateFields() {
        assertEquals(
            "schema=1 capability=0 platform=android detector=region_v0 " +
                "outcome=REGION_CALLBACK_INVALID count=1 duration=UNDER_ONE_SECOND",
            AutomaticV0AdapterTelemetry.line(
                AutomaticV0AdapterOutcome.REGION_CALLBACK_INVALID,
                AutomaticV0DurationBucket.UNDER_ONE_SECOND,
            ),
        )
    }

    // persist only bounded redacted registration state
    @Test
    fun registrationMarkerRejectsMalformedAndTrailingState() {
        val directory = Files.createTempDirectory("automatic-v0-registration").toFile()
        val marker = AutomaticV0RegistrationMarker(directory)

        assertFalse(marker.record(0, 1L))
        assertFalse(marker.record(1, 0L))
        assertTrue(marker.record(2, 7L))
        assertTrue(marker.isRegistered())
        val markerFile = directory.resolve("leaderboard-v0-registration.bin")
        markerFile.appendBytes(byteArrayOf(1))
        assertFalse(marker.isRegistered())
        marker.clear()
        assertFalse(marker.isRegistered())
        directory.deleteRecursively()
    }

    // require a complete immutable diagnostic configuration
    @Test
    fun diagnosticConfigRejectsHashMutationAndIncompleteRegions() {
        val generation = ConfigGeneration(7)
        val regions = listOf(
            AutomaticTerminalRegion("7", 476_020_000, -1_223_400_000, 250_000L, generation),
        )
        val config = AutomaticTerminalConfigGeneration(
            schemaVersion = 1,
            configGeneration = generation,
            serverPolicyGeneration = ServerPolicyGeneration(2),
            contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
            ),
            regions = regions,
        )

        assertTrue(AutomaticV0DiagnosticConfig.isValid(config))
        assertFalse(AutomaticV0DiagnosticConfig.isValid(config.copy(contentHashHex = "0".repeat(64))))
        assertFalse(AutomaticV0DiagnosticConfig.isValid(config.copy(regions = emptyList())))
        assertFalse(
            AutomaticV0DiagnosticConfig.isValid(
                config.copy(
                    regions = listOf(regions.single().copy(configGeneration = ConfigGeneration(8))),
                ),
            ),
        )
    }
}
