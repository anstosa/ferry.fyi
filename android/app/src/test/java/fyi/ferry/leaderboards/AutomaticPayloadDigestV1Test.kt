package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

// define the native contract
class AutomaticPayloadDigestV1Test {
    // define the native contract
    private data class GoldenVector(
        val name: String,
        val candidate: AutomaticCheckinCandidateV1,
        val canonicalHex: String,
        val digestHex: String,
    )

    private val vectors = listOf(
        GoldenVector(
            name = "terminal-minimum",
            candidate = AutomaticCheckinCandidateV1.Terminal(
                accuracyMillimeters = 0,
                candidateId = "AAAAAAAAAAAAAAAAAAAAAA",
                capturedAtMs = 0,
                latitudeE7 = -900_000_000,
                longitudeE7 = -1_800_000_000,
                terminalId = "1",
                configGeneration = 1,
            ),
            canonicalHex = "01000000087465726d696e616c00000016414141414141414141414141414141414141414141410000000000000000ca5b170094b62e000000000000000001310000000000000001",
            digestHex = "c9373b5cd580e5d6aefcb7a8ab88798dd556289c33f97369a41e9eee394b186a",
        ),
        GoldenVector(
            name = "terminal-maximum-unicode",
            candidate = AutomaticCheckinCandidateV1.Terminal(
                accuracyMillimeters = 4_294_967_295L,
                candidateId = "_____________________w",
                capturedAtMs = 9_007_199_254_740_991L,
                latitudeE7 = 900_000_000,
                longitudeE7 = 1_800_000_000,
                terminalId = "⛴️-船",
                configGeneration = 9_007_199_254_740_991L,
            ),
            canonicalHex = "01000000087465726d696e616c000000165f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f77001fffffffffffff35a4e9006b49d200ffffffff0000000ae29bb4efb88f2de888b9001fffffffffffff",
            digestHex = "faa5cf985c15127e82656c20926ab0a60ea68b075a51d5278c8dd8e422fc70ae",
        ),
        GoldenVector(
            name = "vessel-ascii",
            candidate = AutomaticCheckinCandidateV1.Vessel(
                accuracyMillimeters = 12_500,
                candidateId = "AAECAwQFBgcICQoLDA0ODw",
                capturedAtMs = 1_720_000_000_123,
                latitudeE7 = 473_000_001,
                longitudeE7 = -1_225_000_001,
                vesselId = "144",
                sailingId = "144:1720000000",
            ),
            canonicalHex = "010000000676657373656c0000001641414543417751464267634943516f4c4441304f44770000019077fd307b1c316841b6fbfbbf000030d4000000033134340000000e3134343a31373230303030303030",
            digestHex = "4b16cb37a1988b14bfb2acf57df908b316c117d7ee15a935d0db446b05ce1220",
        ),
        GoldenVector(
            name = "vessel-unicode",
            candidate = AutomaticCheckinCandidateV1.Vessel(
                accuracyMillimeters = 250_000,
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 1_720_000_000_999,
                latitudeE7 = 0,
                longitudeE7 = 0,
                vesselId = "船-α",
                sailingId = "航路-β:1720000000",
            ),
            canonicalHex = "010000000676657373656c0000001645424553457851564668635947526f624842306548770000019077fd33e700000000000000000003d09000000006e888b92dceb100000014e888aae8b7af2dceb23a31373230303030303030",
            digestHex = "9ce4966cbfae7b87479607fd458214a9c7d9cf0a2f421847a3e53a3117ed132f",
        ),
        GoldenVector(
            name = "vessel-ascii-accuracy-low-bit",
            candidate = AutomaticCheckinCandidateV1.Vessel(
                accuracyMillimeters = 12_501,
                candidateId = "AAECAwQFBgcICQoLDA0ODw",
                capturedAtMs = 1_720_000_000_123,
                latitudeE7 = 473_000_001,
                longitudeE7 = -1_225_000_001,
                vesselId = "144",
                sailingId = "144:1720000000",
            ),
            canonicalHex = "010000000676657373656c0000001641414543417751464267634943516f4c4441304f44770000019077fd307b1c316841b6fbfbbf000030d5000000033134340000000e3134343a31373230303030303030",
            digestHex = "f64eb34e3f737bf182c34dc6f4979e6e8c845281a7a685e2af1fde0aa0737d91",
        ),
    )

    // match every shared golden vector
    @Test
    fun canonicalBytesAndDigestsMatchSharedFixture() {
        // verify the shared fixture order and hashes
        for (vector in vectors) {
            assertEquals(vector.name, vector.canonicalHex, AutomaticPayloadDigestV1.hex(
                AutomaticPayloadDigestV1.canonicalBytes(vector.candidate),
            ))
            assertEquals(vector.name, vector.digestHex, AutomaticPayloadDigestV1.digestHex(vector.candidate))
        }
    }

    // prove a one-bit semantic mutation changes the digest
    @Test
    fun oneBitMutationChangesDigest() {
        assertNotEquals(
            AutomaticPayloadDigestV1.digestHex(vectors[2].candidate),
            AutomaticPayloadDigestV1.digestHex(vectors[4].candidate),
        )
    }

    // reject values outside the strict shared schema
    @Test
    fun invalidCandidateSemanticsAreRejected() {
        val valid = vectors[2].candidate as AutomaticCheckinCandidateV1.Vessel

        assertThrows(IllegalArgumentException::class.java) {
            AutomaticPayloadDigestV1.digestHex(valid.copy(accuracyMillimeters = -1))
        }
        assertThrows(IllegalArgumentException::class.java) {
            AutomaticPayloadDigestV1.digestHex(valid.copy(candidateId = "not-a-128-bit-id"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            AutomaticPayloadDigestV1.digestHex(valid.copy(vesselId = "bad\u0000id"))
        }
    }
}
