package fyi.ferry.leaderboards

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64

// define the native contract
internal sealed interface AutomaticCheckinCandidateV1 {
    val accuracyMillimeters: Long
    val candidateId: String
    val capturedAtMs: Long
    val latitudeE7: Int
    val longitudeE7: Int

    // expose the fixed kind
    val kind: String

    // define the native contract
    data class Terminal(
        override val accuracyMillimeters: Long,
        override val candidateId: String,
        override val capturedAtMs: Long,
        override val latitudeE7: Int,
        override val longitudeE7: Int,
        val terminalId: String,
        val configGeneration: Long,
    ) : AutomaticCheckinCandidateV1 {
        override val kind = "terminal"
    }

    // define the native contract
    data class Vessel(
        override val accuracyMillimeters: Long,
        override val candidateId: String,
        override val capturedAtMs: Long,
        override val latitudeE7: Int,
        override val longitudeE7: Int,
        val vesselId: String,
        val sailingId: String,
    ) : AutomaticCheckinCandidateV1 {
        override val kind = "vessel"
    }
}

// define the native contract
internal object AutomaticPayloadDigestV1 {
    private const val VERSION_BYTE = 1
    private const val MAX_ACCURACY_MILLIMETERS = 0xffff_ffffL
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_IDENTIFIER_BYTES = 128

    // encode strict parsed semantics
    fun canonicalBytes(candidate: AutomaticCheckinCandidateV1): ByteArray {
        requireCandidate(candidate)

        val output = ByteArrayOutputStream()
        output.write(VERSION_BYTE)
        writeUtf8(output, candidate.kind)
        writeUtf8(output, candidate.candidateId)
        writeLong(output, candidate.capturedAtMs)
        writeInt(output, candidate.latitudeE7)
        writeInt(output, candidate.longitudeE7)
        writeUnsignedInt(output, candidate.accuracyMillimeters)

        // encode the discriminated suffix
        when (candidate) {
            // handle the fixed branch
            is AutomaticCheckinCandidateV1.Terminal -> {
                writeUtf8(output, candidate.terminalId)
                writeLong(output, candidate.configGeneration)
            }
            // handle the fixed branch
            is AutomaticCheckinCandidateV1.Vessel -> {
                writeUtf8(output, candidate.vesselId)
                writeUtf8(output, candidate.sailingId)
            }
        }

        return output.toByteArray()
    }

    // hash canonical bytes
    fun digestHex(candidate: AutomaticCheckinCandidateV1): String = sha256Hex(canonicalBytes(candidate))

    // hash arbitrary verified bytes
    fun sha256Hex(bytes: ByteArray): String = MessageDigest
        .getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

    // render fixture bytes
    fun hex(bytes: ByteArray): String = bytes.joinToString(separator = "") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }

    // reject non-contract values
    private fun requireCandidate(candidate: AutomaticCheckinCandidateV1) {
        require(isCanonicalCandidateId(candidate.candidateId)) { "candidateId must be canonical 128-bit base64url" }
        require(candidate.capturedAtMs in 0..MAX_SAFE_INTEGER) { "capturedAtMs must be a safe unsigned integer" }
        require(candidate.latitudeE7 in -900_000_000..900_000_000) { "latitudeE7 is out of range" }
        require(candidate.longitudeE7 in -1_800_000_000..1_800_000_000) { "longitudeE7 is out of range" }
        require(candidate.accuracyMillimeters in 0..MAX_ACCURACY_MILLIMETERS) {
            "accuracyMillimeters must fit u32"
        }

        // validate the discriminated suffix
        when (candidate) {
            // handle the fixed branch
            is AutomaticCheckinCandidateV1.Terminal -> {
                require(isIdentifier(candidate.terminalId)) { "terminalId is invalid" }
                require(candidate.configGeneration in 1..MAX_SAFE_INTEGER) {
                    "configGeneration must be a positive safe integer"
                }
            }
            // handle the fixed branch
            is AutomaticCheckinCandidateV1.Vessel -> {
                require(isIdentifier(candidate.vesselId)) { "vesselId is invalid" }
                require(isIdentifier(candidate.sailingId)) { "sailingId is invalid" }
            }
        }
    }

    // validate bounded unicode identifiers
    private fun isIdentifier(value: String): Boolean {
        // reject empty or oversized values
        if (value.isEmpty() || value.toByteArray(StandardCharsets.UTF_8).size > MAX_IDENTIFIER_BYTES) {
            return false
        }

        var index = 0

        // inspect every utf-16 code unit
        while (index < value.length) {
            val codeUnit = value[index].code

            // reject control characters
            if (codeUnit <= 0x1f || codeUnit == 0x7f) {
                return false
            }

            // validate surrogate pairs
            if (codeUnit in 0xd800..0xdfff) {
                // branch on the current state
                if (codeUnit >= 0xdc00 || index + 1 >= value.length || value[index + 1].code !in 0xdc00..0xdfff) {
                    return false
                }

                index += 1
            }

            index += 1
        }

        return true
    }

    // require canonical base64url
    private fun isCanonicalCandidateId(candidateId: String): Boolean {
        // reject wrong encoded lengths
        if (candidateId.length != 22) {
            return false
        }

        return try {
            val decoded = Base64.getUrlDecoder().decode("$candidateId==")
            decoded.size == 16 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == candidateId
        // fail closed on the error
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    // write length-prefixed utf-8
    private fun writeUtf8(output: ByteArrayOutputStream, value: String) {
        val bytes = value.toByteArray(StandardCharsets.UTF_8)
        writeUnsignedInt(output, bytes.size.toLong())
        output.write(bytes)
    }

    // write big-endian i32
    private fun writeInt(output: ByteArrayOutputStream, value: Int) {
        // write fixed-width bytes
        for (shift in 24 downTo 0 step 8) {
            output.write(value ushr shift and 0xff)
        }
    }

    // write big-endian u32
    private fun writeUnsignedInt(output: ByteArrayOutputStream, value: Long) {
        require(value in 0..MAX_ACCURACY_MILLIMETERS) { "value must fit u32" }

        // write fixed-width bytes
        for (shift in 24 downTo 0 step 8) {
            output.write((value ushr shift).toInt() and 0xff)
        }
    }

    // write big-endian u64
    private fun writeLong(output: ByteArrayOutputStream, value: Long) {
        require(value >= 0) { "value must fit signed transport range" }

        // write fixed-width bytes
        for (shift in 56 downTo 0 step 8) {
            output.write((value ushr shift).toInt() and 0xff)
        }
    }
}
