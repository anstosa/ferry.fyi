package fyi.ferry.leaderboards

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

// define the native contract
class AutomaticV0FleetEnvelopeParserTest {
    // accept every operational optional-status shape
    @Test
    fun operationalStatusVariantsPass() {
        val variants = listOf(
            "{\"offline\":false}",
            "{\"offline\":false,\"coreReady\":true}",
            "{\"offline\":false,\"warming\":false}",
            "{\"offline\":false,\"coreReady\":true,\"warming\":false}",
        )
        // validate each permitted shape
        for (status in variants) {
            assertNotNull(status, AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope(status)))
        }
    }

    // collapse every invalid wrapper to rejection
    @Test
    fun invalidEnvelopeTableFailsClosed() {
        val body = AutomaticV0TestFixtures.body()
        val invalid = listOf(
            body.toByteArray(),
            "null".toByteArray(),
            "{}".toByteArray(),
            "{\"wsfStatus\":null,\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false,\"unknown\":true},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":\"false\"},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false,\"coreReady\":null},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false,\"warming\":null},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":true},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false,\"warming\":true},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false,\"coreReady\":false},\"body\":$body}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false},\"body\":null}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false},\"body\":[],\"extra\":true}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false},\"body\":$body,\"extra\":true}".toByteArray(),
            "{\"wsfStatus\":{\"offline\":false},\"body\":$body,\"body\":$body}".toByteArray(),
        )
        // reject every malformed fixture
        for (raw in invalid) {
            assertNull(String(raw), AutomaticV0FleetEnvelopeParser.parse(raw))
        }
    }

    // accept the real fractional epoch-seconds wire shape
    @Test
    fun fractionalEpochSecondsPreserveExactMilliseconds() {
        val parsed = AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope())!!

        assertEquals(1_720_000_000_123L, parsed.sourceUpdatedAtMs)
    }

    // reject missing null unit and sub-millisecond source times
    @Test
    fun invalidSourceUpdatedAtFailsClosed() {
        val vesselMap = "{\"144\":${AutomaticV0TestFixtures.vessel()}}"
        val invalidBodies = listOf(
            "{\"vessels\":$vesselMap}",
            "{\"sourceUpdatedAt\":null,\"vessels\":$vesselMap}",
            "{\"sourceUpdatedAt\":0,\"vessels\":$vesselMap}",
            "{\"sourceUpdatedAt\":1720000000.1234,\"vessels\":$vesselMap}",
            "{\"sourceUpdatedAt\":1720000000000,\"vessels\":$vesselMap}",
        )
        // reject every invalid unit shape
        for (body in invalidBodies) {
            assertNull(body, AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope(body = body)))
        }
    }

    // reject malformed complete vessel records
    @Test
    fun malformedVesselRecordsFailClosed() {
        val complete = AutomaticV0TestFixtures.vessel()
        val invalidRecords = listOf(
            "null",
            complete.replace("\"id\":\"144\"", "\"id\":144"),
            complete.replace("\"inService\":true", "\"inService\":\"true\""),
            complete.replace("\"latitude\":47.602", "\"latitude\":97.0"),
            complete.replace("\"speed\":17.2,", ""),
            complete.dropLast(1) + ",\"unknown\":true}",
        )
        // reject every malformed record
        for (record in invalidRecords) {
            val body = "{\"sourceUpdatedAt\":1720000000,\"vessels\":{\"144\":$record}}"
            assertNull(record, AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope(body = body)))
        }
    }

    // reject null drift after public normalization
    @Test
    fun liveWireNullContractDriftFailsClosed() {
        val complete = AutomaticV0TestFixtures.vessel()
        val invalidRecords = listOf(
            complete.replace("\"arrivingTerminalId\":7", "\"arrivingTerminalId\":null"),
            complete.replace("\"crossing\":\"30 min\"", "\"crossing\":null"),
            complete.replace("\"yearRebuilt\":1997", "\"yearRebuilt\":null"),
        )
        // reject every observed contract violation
        for (record in invalidRecords) {
            val body = "{\"sourceUpdatedAt\":1720000000,\"vessels\":{\"144\":$record}}"
            assertNull(record, AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope(body = body)))
        }
    }

    // accept the normalized live-wire optional shape
    @Test
    fun normalizedLiveWireShapePasses() {
        val normalized = AutomaticV0TestFixtures.vessel()
            .replace("\"arrivingTerminalId\":7,", "")
            .replace(",\"crossing\":\"30 min\"", "")
            .replace(",\"yearRebuilt\":1997", "")
            .replace(
                "\"heading\":180,",
                "\"gpsDelay\":{" +
                    "\"confidence\":\"medium\",\"delaySeconds\":30," +
                    "\"explanation\":\"bounded\",\"signals\":{" +
                    "\"dockDelaySeconds\":null,\"etaDelaySeconds\":null," +
                    "\"progress\":0.5,\"scheduledArrivalTime\":1720000600," +
                    "\"scheduledDepartureTime\":1720000000},\"source\":\"gps\"}," +
                    "\"heading\":180,",
            )
        val body = "{\"sourceUpdatedAt\":1720000000.123,\"vessels\":{\"144\":$normalized}}"

        assertNotNull(AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope(body = body)))
    }

    // canonicalize only the validated body
    @Test
    fun canonicalBodyExcludesOuterStatus() {
        val parsed = AutomaticV0FleetEnvelopeParser.parse(AutomaticV0TestFixtures.envelope())!!
        val canonicalText = parsed.canonicalBytes.toString(Charsets.UTF_8)

        assertEquals(true, canonicalText.startsWith("{\"sourceUpdatedAt\":"))
        assertEquals(false, canonicalText.contains("wsfStatus"))
        assertEquals(false, canonicalText.contains("offline"))
        assertArrayEquals(parsed.canonicalBytes, AutomaticV0CanonicalJson.bytes(AutomaticV0JsonParser.parse(parsed.canonicalBytes)!!))
    }
}
