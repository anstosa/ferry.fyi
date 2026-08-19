package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64

// define the native contract
internal data class AutomaticQueuedCandidateV1(
    val candidate: AutomaticCheckinCandidateV1,
    val localWorkGeneration: LocalWorkGeneration,
)

// define the native contract
internal class AutomaticPreparedCandidateUploadV1(
    val recordKey: String,
    val localWorkGeneration: LocalWorkGeneration,
    capturedAtMs: Long,
    private val candidateIdSortKey: ByteArray,
    val entityKey: String,
    val requestBody: ByteArray,
) {
    private var capturedAtMs = capturedAtMs

    // expose exact time only inside queue ordering
    fun orderingCapturedAtMs(): Long = capturedAtMs

    // release fields that transport never needs
    fun releaseOrderingFields() {
        capturedAtMs = 0L
        candidateIdSortKey.fill(0)
    }

    // wipe every retained decrypted candidate field
    fun wipe() {
        releaseOrderingFields()
        requestBody.fill(0)
    }

    // expose only one testable wipe aggregate
    fun isWiped(): Boolean =
        capturedAtMs == 0L &&
            // run the bounded callback
            candidateIdSortKey.all { byte -> byte == 0.toByte() } &&
            // run the bounded callback
            requestBody.all { byte -> byte == 0.toByte() }

    // compare opaque ordering bytes inside their owner
    fun compareCandidateIdSortKey(other: AutomaticPreparedCandidateUploadV1): Int {
        val sharedLength = minOf(candidateIdSortKey.size, other.candidateIdSortKey.size)
        // compare every unsigned candidate-id byte
        for (index in 0 until sharedLength) {
            val difference = (candidateIdSortKey[index].toInt() and 0xff) -
                (other.candidateIdSortKey[index].toInt() and 0xff)
            // return the first byte difference
            if (difference != 0) {
                return difference
            }
        }
        return candidateIdSortKey.size - other.candidateIdSortKey.size
    }
}

// define the native contract
internal object AutomaticCandidateCodecV1 {
    private const val QUEUE_SCHEMA_VERSION = 2
    private const val MAX_PLAINTEXT_BYTES = 4_096
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_IDENTIFIER_BYTES = 128

    // encode one candidate for authenticated storage
    fun encodeQueued(value: AutomaticQueuedCandidateV1): ByteArray {
        val outputBytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(outputBytes).use { output ->
            output.writeInt(QUEUE_SCHEMA_VERSION)
            output.writeLong(value.localWorkGeneration.value)
            writeUtf8(output, value.candidate.kind)
            writeUtf8(output, value.candidate.candidateId)
            output.writeLong(value.candidate.capturedAtMs)
            output.writeInt(value.candidate.latitudeE7)
            output.writeInt(value.candidate.longitudeE7)
            output.writeLong(value.candidate.accuracyMillimeters)
            // encode the exact discriminated suffix
            when (val candidate = value.candidate) {
                // handle the fixed branch
                is AutomaticCheckinCandidateV1.Terminal -> {
                    writeUtf8(output, candidate.terminalId)
                    output.writeLong(candidate.configGeneration)
                }
                // handle the fixed branch
                is AutomaticCheckinCandidateV1.Vessel -> {
                    writeUtf8(output, candidate.vesselId)
                    writeUtf8(output, candidate.sailingId)
                }
            }
            output.flush()
        }
        val encoded = outputBytes.toByteArray()
        require(encoded.size <= MAX_PLAINTEXT_BYTES) { "candidate plaintext exceeds bound" }
        // reuse canonical validation before persistence
        AutomaticPayloadDigestV1.canonicalBytes(value.candidate)
        return encoded
    }

    // decode one authenticated candidate record for non-exposure queue operations
    fun decodeQueued(bytes: ByteArray): AutomaticQueuedCandidateV1? {
        // reject oversized authenticated plaintext
        if (bytes.isEmpty() || bytes.size > MAX_PLAINTEXT_BYTES) {
            return null
        }
        return try {
            // run the bounded callback
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                // require the fixed storage schema
                if (input.readInt() != QUEUE_SCHEMA_VERSION) {
                    return null
                }
                val localGeneration = input.readLong()
                val kind = readUtf8String(input, 16) ?: return null
                val candidateId = readUtf8String(input, 22) ?: return null
                val capturedAtMs = input.readLong()
                val latitudeE7 = input.readInt()
                val longitudeE7 = input.readInt()
                val accuracyMillimeters = input.readLong()
                // decode the fixed suffix
                val candidate = when (kind) {
                    "terminal" -> AutomaticCheckinCandidateV1.Terminal(
                        accuracyMillimeters = accuracyMillimeters,
                        candidateId = candidateId,
                        capturedAtMs = capturedAtMs,
                        latitudeE7 = latitudeE7,
                        longitudeE7 = longitudeE7,
                        terminalId = readUtf8String(input, MAX_IDENTIFIER_BYTES) ?: return null,
                        configGeneration = input.readLong(),
                    )
                    "vessel" -> AutomaticCheckinCandidateV1.Vessel(
                        accuracyMillimeters = accuracyMillimeters,
                        candidateId = candidateId,
                        capturedAtMs = capturedAtMs,
                        latitudeE7 = latitudeE7,
                        longitudeE7 = longitudeE7,
                        vesselId = readUtf8String(input, MAX_IDENTIFIER_BYTES) ?: return null,
                        sailingId = readUtf8String(input, MAX_IDENTIFIER_BYTES) ?: return null,
                    )
                    // branch on the current state
                    else -> return null
                }
                // reject trailing or semantically invalid data
                if (input.available() != 0 || localGeneration < 0L) {
                    return null
                }
                AutomaticPayloadDigestV1.canonicalBytes(candidate)
                AutomaticQueuedCandidateV1(candidate, LocalWorkGeneration(localGeneration))
            }
        // fail closed on the error
        } catch (_: Exception) {
            null
        }
    }

    // decode directly into one wipeable upload request without immutable candidate fields
    fun decodePreparedUpload(recordKey: String, bytes: ByteArray): AutomaticPreparedCandidateUploadV1? {
        // reject oversized authenticated plaintext
        if (bytes.isEmpty() || bytes.size > MAX_PLAINTEXT_BYTES) {
            return null
        }
        var kind: ByteArray? = null
        var candidateId: ByteArray? = null
        var firstSuffix: ByteArray? = null
        var secondSuffix: ByteArray? = null
        var requestBody: ByteArray? = null
        return try {
            // run the bounded callback
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                // require the fixed storage schema and local generation
                if (input.readInt() != QUEUE_SCHEMA_VERSION) {
                    return null
                }
                val localGeneration = input.readLong()
                kind = readUtf8Bytes(input, 16) ?: return null
                candidateId = readUtf8Bytes(input, 22) ?: return null
                val capturedAtMs = input.readLong()
                val latitudeE7 = input.readInt()
                val longitudeE7 = input.readInt()
                val accuracyMillimeters = input.readLong()
                val terminal = kind!!.contentEquals("terminal".toByteArray(StandardCharsets.US_ASCII))
                val vessel = kind!!.contentEquals("vessel".toByteArray(StandardCharsets.US_ASCII))
                // require fixed kind and suffix bytes
                if (!terminal && !vessel) {
                    return null
                }
                firstSuffix = readUtf8Bytes(input, MAX_IDENTIFIER_BYTES) ?: return null
                val suffixGeneration = if (terminal) input.readLong() else null
                // read the second vessel suffix only for vessel candidates
                if (vessel) {
                    secondSuffix = readUtf8Bytes(input, MAX_IDENTIFIER_BYTES) ?: return null
                }
                // reject trailing or invalid primitive semantics
                if (
                    input.available() != 0 ||
                    localGeneration < 0L ||
                    !isCanonicalCandidateId(candidateId!!) ||
                    capturedAtMs !in 0..MAX_SAFE_INTEGER ||
                    latitudeE7 !in -900_000_000..900_000_000 ||
                    longitudeE7 !in -1_800_000_000..1_800_000_000 ||
                    accuracyMillimeters !in 0..0xffff_ffffL ||
                    !isIdentifier(firstSuffix!!) ||
                    vessel && !isIdentifier(secondSuffix!!) ||
                    terminal && (suffixGeneration == null || suffixGeneration !in 1..MAX_SAFE_INTEGER)
                ) {
                    return null
                }
                requestBody = encodePreparedRequest(
                    terminal = terminal,
                    candidateId = candidateId!!,
                    capturedAtMs = capturedAtMs,
                    latitudeE7 = latitudeE7,
                    longitudeE7 = longitudeE7,
                    accuracyMillimeters = accuracyMillimeters,
                    firstSuffix = firstSuffix!!,
                    secondSuffix = secondSuffix,
                    configGeneration = suffixGeneration,
                )
                val entitySource = if (terminal) firstSuffix!! else candidateId!!
                val entityKey = hashedEntityKey(if (terminal) 1 else 2, entitySource)
                val prepared = AutomaticPreparedCandidateUploadV1(
                    recordKey = recordKey,
                    localWorkGeneration = LocalWorkGeneration(localGeneration),
                    capturedAtMs = capturedAtMs,
                    candidateIdSortKey = candidateId!!,
                    entityKey = entityKey,
                    requestBody = requestBody!!,
                )
                candidateId = null
                requestBody = null
                prepared
            }
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            kind?.fill(0)
            candidateId?.fill(0)
            firstSuffix?.fill(0)
            secondSuffix?.fill(0)
            requestBody?.fill(0)
        }
    }

    // encode one strict server request
    fun encodeRequest(candidate: AutomaticCheckinCandidateV1): ByteArray {
        // validate the same semantics used by the payload digest
        AutomaticPayloadDigestV1.canonicalBytes(candidate)
        val suffix = when (candidate) {
            is AutomaticCheckinCandidateV1.Terminal ->
                ",\"configGeneration\":${candidate.configGeneration}," +
                    "\"terminalId\":\"${escapeJson(candidate.terminalId)}\""
            is AutomaticCheckinCandidateV1.Vessel ->
                ",\"sailingId\":\"${escapeJson(candidate.sailingId)}\"," +
                    "\"vesselId\":\"${escapeJson(candidate.vesselId)}\""
        }
        return (
            "{\"accuracyMillimeters\":${candidate.accuracyMillimeters}," +
                "\"candidateId\":\"${candidate.candidateId}\"," +
                "\"capturedAtMs\":${candidate.capturedAtMs}," +
                "\"kind\":\"${candidate.kind}\"," +
                "\"latitudeE7\":${candidate.latitudeE7}," +
                "\"longitudeE7\":${candidate.longitudeE7}," +
                "\"schemaVersion\":1$suffix}"
            ).toByteArray(StandardCharsets.UTF_8)
    }

    // encode one request from wipeable validated byte fields
    private fun encodePreparedRequest(
        terminal: Boolean,
        candidateId: ByteArray,
        capturedAtMs: Long,
        latitudeE7: Int,
        longitudeE7: Int,
        accuracyMillimeters: Long,
        firstSuffix: ByteArray,
        secondSuffix: ByteArray?,
        configGeneration: Long?,
    ): ByteArray {
        val output = ByteArrayOutputStream()
        writeAscii(output, "{\"accuracyMillimeters\":")
        writeNumber(output, accuracyMillimeters)
        writeAscii(output, ",\"candidateId\":\"")
        writeJsonUtf8(output, candidateId)
        writeAscii(output, "\",\"capturedAtMs\":")
        writeNumber(output, capturedAtMs)
        writeAscii(output, if (terminal) ",\"kind\":\"terminal\"," else ",\"kind\":\"vessel\",")
        writeAscii(output, "\"latitudeE7\":")
        writeNumber(output, latitudeE7.toLong())
        writeAscii(output, ",\"longitudeE7\":")
        writeNumber(output, longitudeE7.toLong())
        writeAscii(output, ",\"schemaVersion\":1")
        // encode the exact discriminated suffix
        if (terminal) {
            writeAscii(output, ",\"configGeneration\":")
            writeNumber(output, configGeneration!!)
            writeAscii(output, ",\"terminalId\":\"")
            writeJsonUtf8(output, firstSuffix)
        // branch on the current state
        } else {
            writeAscii(output, ",\"sailingId\":\"")
            writeJsonUtf8(output, secondSuffix!!)
            writeAscii(output, "\",\"vesselId\":\"")
            writeJsonUtf8(output, firstSuffix)
        }
        writeAscii(output, "\"}")
        return output.toByteArray()
    }

    // write one length-prefixed utf-8 field and wipe its copy
    private fun writeUtf8(output: DataOutputStream, value: String) {
        val bytes = value.toByteArray(StandardCharsets.UTF_8)
        // attempt the protected operation
        try {
            output.writeInt(bytes.size)
            output.write(bytes)
        // release protected state
        } finally {
            bytes.fill(0)
        }
    }

    // read one bounded utf-8 field for non-exposure operations
    private fun readUtf8String(input: DataInputStream, maximumBytes: Int): String? {
        val bytes = readUtf8Bytes(input, maximumBytes) ?: return null
        return try {
            String(bytes, StandardCharsets.UTF_8)
        // release protected state
        } finally {
            bytes.fill(0)
        }
    }

    // read one bounded raw utf-8 field
    private fun readUtf8Bytes(input: DataInputStream, maximumBytes: Int): ByteArray? {
        val length = input.readInt()
        // reject empty oversized or truncated fields
        if (length !in 1..maximumBytes || length > input.available()) {
            return null
        }
        return ByteArray(length).also(input::readFully)
    }

    // validate canonical 128-bit base64url bytes
    private fun isCanonicalCandidateId(value: ByteArray): Boolean {
        // reject wrong length or alphabet
        if (
            value.size != 22 ||
            // run the bounded callback
            value.any { byte ->
                val character = byte.toInt() and 0xff
                character !in 'A'.code..'Z'.code &&
                    character !in 'a'.code..'z'.code &&
                    character !in '0'.code..'9'.code &&
                    character != '-'.code &&
                    character != '_'.code
            }
        ) {
            return false
        }
        // run the bounded callback
        val padded = value.copyOf(24).also { bytes ->
            bytes[22] = '='.code.toByte()
            bytes[23] = '='.code.toByte()
        }
        var decoded: ByteArray? = null
        var canonical: ByteArray? = null
        return try {
            decoded = Base64.getUrlDecoder().decode(padded)
            canonical = Base64.getUrlEncoder().withoutPadding().encode(decoded)
            decoded.size == 16 && canonical.contentEquals(value)
        // fail closed on the error
        } catch (_: IllegalArgumentException) {
            false
        // release protected state
        } finally {
            padded.fill(0)
            decoded?.fill(0)
            canonical?.fill(0)
        }
    }

    // validate bounded utf-8 identifier bytes without immutable strings
    private fun isIdentifier(value: ByteArray): Boolean {
        // reject empty oversized or ascii control-bearing values
        if (
            value.isEmpty() ||
            value.size > MAX_IDENTIFIER_BYTES ||
            // run the bounded callback
            value.any { byte -> (byte.toInt() and 0xff) <= 0x1f || (byte.toInt() and 0xff) == 0x7f }
        ) {
            return false
        }
        var characters: CharArray? = null
        return try {
            val decoded = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(value))
            characters = CharArray(decoded.remaining())
            decoded.get(characters)
            characters?.isNotEmpty() == true
        // fail closed on the error
        } catch (_: Exception) {
            false
        // release protected state
        } finally {
            characters?.fill('\u0000')
        }
    }

    // hash one entity lane before it leaves decrypted scope
    private fun hashedEntityKey(kind: Int, value: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(kind.toByte())
        val hashed = digest.digest(value)
        return try {
            Base64.getUrlEncoder().withoutPadding().encodeToString(hashed)
        // release protected state
        } finally {
            hashed.fill(0)
        }
    }

    // compare wipeable prepared queue order
    fun comparePrepared(
        left: AutomaticPreparedCandidateUploadV1,
        right: AutomaticPreparedCandidateUploadV1,
    ): Int {
        val timeComparison = left.orderingCapturedAtMs().compareTo(right.orderingCapturedAtMs())
        // return the first time difference
        if (timeComparison != 0) {
            return timeComparison
        }
        return left.compareCandidateIdSortKey(right)
    }

    // write one static ascii fragment
    private fun writeAscii(output: ByteArrayOutputStream, value: String) {
        output.write(value.toByteArray(StandardCharsets.US_ASCII))
    }

    // write one signed decimal number without immutable data strings
    private fun writeNumber(output: ByteArrayOutputStream, value: Long) {
        // handle the only negative coordinate range
        if (value < 0L) {
            output.write('-'.code)
        }
        var remaining = if (value < 0L) -value else value
        val digits = ByteArray(20)
        var index = digits.size
        // write at least one digit in reverse
        do {
            index -= 1
            digits[index] = ('0'.code + (remaining % 10L).toInt()).toByte()
            remaining /= 10L
        } while (remaining > 0L)
        // attempt the protected operation
        try {
            output.write(digits, index, digits.size - index)
        // release protected state
        } finally {
            digits.fill(0)
        }
    }

    // write validated utf-8 with json ascii escaping
    private fun writeJsonUtf8(output: ByteArrayOutputStream, value: ByteArray) {
        // escape only ascii quote and backslash bytes
        for (byte in value) {
            val character = byte.toInt() and 0xff
            // prefix json structural bytes
            if (character == '"'.code || character == '\\'.code) {
                output.write('\\'.code)
            }
            output.write(character)
        }
    }

    // escape one bounded json identifier
    private fun escapeJson(value: String): String {
        val output = StringBuilder(value.length)
        // escape every code unit
        for (character in value) {
            // select one json escape
            when (character) {
                '"' -> output.append("\\\"")
                '\\' -> output.append("\\\\")
                '\b' -> output.append("\\b")
                '\u000c' -> output.append("\\f")
                '\n' -> output.append("\\n")
                '\r' -> output.append("\\r")
                '\t' -> output.append("\\t")
                // branch on the current state
                else -> {
                    // escape remaining controls defensively
                    if (character.code <= 0x1f) {
                        output.append("\\u%04x".format(character.code))
                    // branch on the current state
                    } else {
                        output.append(character)
                    }
                }
            }
        }
        return output.toString()
    }
}
