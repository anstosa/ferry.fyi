package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

internal const val AUTOMATIC_V0_FLEET_REFRESH_AGE_MS = 55_000L
internal const val AUTOMATIC_V0_FLEET_CONTEXT_MAX_AGE_MS = 120_000L
internal const val AUTOMATIC_V0_SNAPSHOT_PATH = "/api/vessels/snapshot"

// define the native contract
internal data class AutomaticV0Vessel(
    val id: String,
    val inService: Boolean,
    val locationLatitude: Double?,
    val locationLongitude: Double?,
)

// define the native contract
internal data class AutomaticV0FleetBody(
    val sourceUpdatedAtMs: Long,
    val vessels: List<AutomaticV0Vessel>,
    val canonicalBytes: ByteArray,
) {
    // compare array content
    override fun equals(other: Any?): Boolean = other is AutomaticV0FleetBody &&
        sourceUpdatedAtMs == other.sourceUpdatedAtMs &&
        vessels == other.vessels &&
        canonicalBytes.contentEquals(other.canonicalBytes)

    // hash array content
    override fun hashCode(): Int = 31 * (31 * sourceUpdatedAtMs.hashCode() + vessels.hashCode()) +
        canonicalBytes.contentHashCode()
}

// define the native contract
internal data class AutomaticV0FleetCacheEntry(
    val body: AutomaticV0FleetBody,
    val bodyHashHex: String,
    val receivedAtMs: Long,
)

// define the native contract
internal object AutomaticV0FleetEnvelopeParser {
    private val requiredVesselKeys = setOf(
        "abbreviation",
        "beam",
        "classId",
        "hasCarDeckRestroom",
        "hasElevator",
        "hasGalley",
        "hasRestroom",
        "hasWiFi",
        "horsepower",
        "id",
        "inMaintenance",
        "inService",
        "info",
        "isAdaAccessible",
        "maxClearance",
        "name",
        "passengerCapacity",
        "speed",
        "tallVehicleCapacity",
        "vesselWatchUrl",
        "vehicleCapacity",
        "weight",
        "yearBuilt",
    )
    private val allowedVesselKeys = requiredVesselKeys + setOf(
        "arrivingTerminalId",
        "departingTerminalId",
        "departedTime",
        "departureDelta",
        "gpsDelay",
        "dockedTime",
        "estimatedArrivalTime",
        "heading",
        "isAtDock",
        "length",
        "location",
        "mmsi",
        "yearRebuilt",
    )

    // parse the exact wrapped wire response
    fun parse(rawBytes: ByteArray): AutomaticV0FleetBody? {
        val outer = AutomaticV0JsonParser.parse(rawBytes) as? AutomaticV0JsonValue.ObjectValue ?: return null
        // require exactly the real wrapper
        if (outer.entries.keys != setOf("wsfStatus", "body")) {
            return null
        }
        val status = outer.entries["wsfStatus"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        // require operational wsf state
        if (!isOperationalStatus(status)) {
            return null
        }
        val body = outer.entries["body"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        return parseBody(body)
    }

    // parse cached canonical body bytes
    fun parseCanonicalBody(rawBytes: ByteArray): AutomaticV0FleetBody? {
        val body = AutomaticV0JsonParser.parse(rawBytes) as? AutomaticV0JsonValue.ObjectValue ?: return null
        val parsed = parseBody(body) ?: return null
        // run the bounded callback
        return parsed.takeIf { parsed.canonicalBytes.contentEquals(rawBytes) }
    }

    // require the strict wsf status schema
    private fun isOperationalStatus(status: AutomaticV0JsonValue.ObjectValue): Boolean {
        // reject unknown and missing keys
        if (
            // run the bounded callback
            status.entries.keys.any { it !in setOf("offline", "coreReady", "warming") } ||
            "offline" !in status.entries
        ) {
            return false
        }
        val offline = boolean(status.entries["offline"]) ?: return false
        val coreReady = optionalBoolean(status.entries["coreReady"], defaultValue = true) ?: return false
        val warming = optionalBoolean(status.entries["warming"], defaultValue = false) ?: return false
        return !offline && coreReady != false && warming != true
    }

    // validate the complete snapshot body
    private fun parseBody(body: AutomaticV0JsonValue.ObjectValue): AutomaticV0FleetBody? {
        // require exact snapshot keys
        if (body.entries.keys != setOf("sourceUpdatedAt", "vessels")) {
            return null
        }
        val sourceUpdatedAtMs = epochSecondsToMs(body.entries["sourceUpdatedAt"]) ?: return null
        val vesselsObject = body.entries["vessels"] as? AutomaticV0JsonValue.ObjectValue ?: return null
        val vessels = mutableListOf<AutomaticV0Vessel>()
        // validate every complete vessel record
        for ((recordKey, vesselValue) in vesselsObject.entries) {
            val vessel = parseVessel(recordKey, vesselValue) ?: return null
            vessels += vessel
        }
        return AutomaticV0FleetBody(
            sourceUpdatedAtMs = sourceUpdatedAtMs,
            vessels = vessels,
            canonicalBytes = AutomaticV0CanonicalJson.bytes(body),
        )
    }

    // validate one shared vessel record
    private fun parseVessel(recordKey: String, value: AutomaticV0JsonValue): AutomaticV0Vessel? {
        val vessel = value as? AutomaticV0JsonValue.ObjectValue ?: return null
        // reject unknown or missing fields
        if (
            // run the bounded callback
            vessel.entries.keys.any { it !in allowedVesselKeys } ||
            !vessel.entries.keys.containsAll(requiredVesselKeys)
        ) {
            return null
        }
        val id = string(vessel.entries["id"]) ?: return null
        // require the record key and public id to agree
        if (recordKey != id || id.isEmpty()) {
            return null
        }

        val stringFields = listOf("abbreviation", "beam", "classId", "name", "vesselWatchUrl")
        val booleanFields = listOf(
            "hasCarDeckRestroom",
            "hasElevator",
            "hasGalley",
            "hasRestroom",
            "hasWiFi",
            "inMaintenance",
            "inService",
            "isAdaAccessible",
        )
        val numberFields = listOf(
            "horsepower",
            "maxClearance",
            "passengerCapacity",
            "speed",
            "tallVehicleCapacity",
            "vehicleCapacity",
            "weight",
            "yearBuilt",
        )
        // validate required strings
        if (stringFields.any { string(vessel.entries[it]) == null }) {
            return null
        }
        // validate required booleans
        if (booleanFields.any { boolean(vessel.entries[it]) == null }) {
            return null
        }
        // validate required finite numbers
        if (numberFields.any { finiteDouble(vessel.entries[it]) == null }) {
            return null
        }
        // validate optional numeric fields
        if (
            listOf(
                "arrivingTerminalId",
                "departingTerminalId",
                "departedTime",
                "departureDelta",
                "dockedTime",
                "estimatedArrivalTime",
                "heading",
                "mmsi",
            // run the bounded callback
            ).any { vessel.entries[it] != null && finiteDouble(vessel.entries[it]) == null }
        ) {
            return null
        }
        // validate optional rebuilt year when present
        if (vessel.entries["yearRebuilt"] != null && finiteDouble(vessel.entries["yearRebuilt"]) == null) {
            return null
        }
        // validate optional primitive fields
        if (
            vessel.entries["isAtDock"] != null && boolean(vessel.entries["isAtDock"]) == null ||
            vessel.entries["length"] != null && string(vessel.entries["length"]) == null
        ) {
            return null
        }
        // validate info details
        if (!validateInfo(vessel.entries["info"])) {
            return null
        }
        // validate gps delay details
        if (vessel.entries["gpsDelay"] != null && !validateGpsDelay(vessel.entries["gpsDelay"])) {
            return null
        }

        val location = vessel.entries["location"]
        val parsedLocation = if (location == null) null else parseLocation(location) ?: return null
        return AutomaticV0Vessel(
            id = id,
            inService = boolean(vessel.entries["inService"])!!,
            locationLatitude = parsedLocation?.first,
            locationLongitude = parsedLocation?.second,
        )
    }

    // validate public vessel info
    private fun validateInfo(value: AutomaticV0JsonValue?): Boolean {
        val info = value as? AutomaticV0JsonValue.ObjectValue ?: return false
        // reject unknown info keys
        if (info.entries.keys.any { it !in setOf("ada", "crossing") }) {
            return false
        }
        // run the bounded callback
        return info.entries.values.all { string(it) != null }
    }

    // validate optional gps delay details
    private fun validateGpsDelay(value: AutomaticV0JsonValue?): Boolean {
        val delay = value as? AutomaticV0JsonValue.ObjectValue ?: return false
        // require the complete public shape
        if (delay.entries.keys != setOf("confidence", "delaySeconds", "explanation", "signals", "source")) {
            return false
        }
        val confidence = string(delay.entries["confidence"])
        val source = string(delay.entries["source"])
        val signals = delay.entries["signals"] as? AutomaticV0JsonValue.ObjectValue ?: return false
        // require the complete signal shape
        if (
            confidence !in setOf("low", "medium", "high") ||
            source != "gps" ||
            finiteDouble(delay.entries["delaySeconds"]) == null ||
            string(delay.entries["explanation"]) == null ||
            signals.entries.keys != setOf(
                "dockDelaySeconds",
                "etaDelaySeconds",
                "progress",
                "scheduledArrivalTime",
                "scheduledDepartureTime",
            )
        ) {
            return false
        }
        // validate nullable delay signals
        if (
            !nullableNumber(signals.entries["dockDelaySeconds"]) ||
            !nullableNumber(signals.entries["etaDelaySeconds"])
        ) {
            return false
        }
        return listOf("progress", "scheduledArrivalTime", "scheduledDepartureTime")
            // run the bounded callback
            .all { finiteDouble(signals.entries[it]) != null }
    }

    // validate one map point
    private fun parseLocation(value: AutomaticV0JsonValue): Pair<Double, Double>? {
        val location = value as? AutomaticV0JsonValue.ObjectValue ?: return null
        // require exact coordinates
        if (location.entries.keys != setOf("latitude", "longitude")) {
            return null
        }
        val latitude = finiteDouble(location.entries["latitude"]) ?: return null
        val longitude = finiteDouble(location.entries["longitude"]) ?: return null
        // reject coordinates outside the earth
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
            return null
        }
        return latitude to longitude
    }

    // read one string
    private fun string(value: AutomaticV0JsonValue?): String? =
        (value as? AutomaticV0JsonValue.StringValue)?.value

    // read one boolean
    private fun boolean(value: AutomaticV0JsonValue?): Boolean? =
        (value as? AutomaticV0JsonValue.BooleanValue)?.value

    // read one optional boolean
    private fun optionalBoolean(value: AutomaticV0JsonValue?, defaultValue: Boolean): Boolean? = when (value) {
        null -> defaultValue
        is AutomaticV0JsonValue.BooleanValue -> value.value
        // branch on the current state
        else -> null
    }

    // convert finite epoch seconds with millisecond precision
    private fun epochSecondsToMs(value: AutomaticV0JsonValue?): Long? {
        val seconds = (value as? AutomaticV0JsonValue.NumberValue)?.value ?: return null
        // reject seconds-as-milliseconds and nonpositive epochs
        if (seconds.signum() <= 0 || seconds > java.math.BigDecimal("9999999999")) {
            return null
        }
        return try {
            seconds.movePointRight(3).longValueExact()
        // fail closed on the error
        } catch (_: ArithmeticException) {
            null
        }
    }

    // read one finite double
    private fun finiteDouble(value: AutomaticV0JsonValue?): Double? {
        val number = (value as? AutomaticV0JsonValue.NumberValue)?.value?.toDouble() ?: return null
        return number.takeIf(Double::isFinite)
    }

    // validate nullable finite number
    private fun nullableNumber(value: AutomaticV0JsonValue?): Boolean =
        value == AutomaticV0JsonValue.NullValue || finiteDouble(value) != null
}

// define the native contract
internal interface AutomaticV0FleetCacheStore {
    // read one body-only cache entry
    fun read(): AutomaticV0FleetCacheEntry?

    // replace one body-only cache entry
    fun replace(entry: AutomaticV0FleetCacheEntry): Boolean

    // delete a corrupt cache entry
    fun delete()
}

// define the native contract
internal class AutomaticV0NoBackupFleetCacheStore(noBackupFilesDir: File) : AutomaticV0FleetCacheStore {
    private val cacheFile = File(noBackupFilesDir, "leaderboard-v0-fleet-context.bin")
    private val temporaryFile = File(noBackupFilesDir, "leaderboard-v0-fleet-context.tmp")

    // read and authenticate body-only bytes
    override fun read(): AutomaticV0FleetCacheEntry? {
        val bytes = try {
            cacheFile.readBytes()
        // fail closed on the error
        } catch (_: Exception) {
            return null
        }
        val decoded = decode(bytes)
        // remove corrupt cache state
        if (decoded == null) {
            delete()
        }
        return decoded
    }

    // fsync then atomically replace
    override fun replace(entry: AutomaticV0FleetCacheEntry): Boolean {
        val bytes = encode(entry) ?: return false
        return try {
            temporaryFile.parentFile?.mkdirs()
            // run the bounded callback
            FileOutputStream(temporaryFile).use { output ->
                output.write(bytes)
                output.fd.sync()
            }
            Files.move(
                temporaryFile.toPath(),
                cacheFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            true
        // fail closed on the error
        } catch (_: AtomicMoveNotSupportedException) {
            temporaryFile.delete()
            false
        // fail closed on the error
        } catch (_: Exception) {
            temporaryFile.delete()
            false
        }
    }

    // remove cache artifacts
    override fun delete() {
        cacheFile.delete()
        temporaryFile.delete()
    }

    // encode the fixed binary cache format
    private fun encode(entry: AutomaticV0FleetCacheEntry): ByteArray? {
        // reject a mismatched supplied hash
        if (AutomaticPayloadDigestV1.sha256Hex(entry.body.canonicalBytes) != entry.bodyHashHex) {
            return null
        }
        // run the bounded callback
        return ByteArrayOutputStream().use { bytes ->
            // run the bounded callback
            DataOutputStream(bytes).use { output ->
                output.writeLong(CACHE_MAGIC)
                output.writeInt(CACHE_VERSION)
                output.writeLong(entry.receivedAtMs)
                output.write(sha256(entry.body.canonicalBytes))
                output.writeInt(entry.body.canonicalBytes.size)
                output.write(entry.body.canonicalBytes)
            }
            bytes.toByteArray()
        }
    }

    // decode and verify the fixed binary cache format
    private fun decode(bytes: ByteArray): AutomaticV0FleetCacheEntry? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            // reject the wrong cache format
            if (input.readLong() != CACHE_MAGIC || input.readInt() != CACHE_VERSION) {
                return null
            }
            val receivedAtMs = input.readLong()
            val storedHash = ByteArray(32)
            input.readFully(storedHash)
            val bodyLength = input.readInt()
            // bound the cached snapshot
            if (bodyLength !in 1..MAX_BODY_BYTES || input.available() != bodyLength) {
                return null
            }
            val bodyBytes = ByteArray(bodyLength)
            input.readFully(bodyBytes)
            // authenticate the persisted body
            if (!sha256(bodyBytes).contentEquals(storedHash)) {
                return null
            }
            val body = AutomaticV0FleetEnvelopeParser.parseCanonicalBody(bodyBytes) ?: return null
            AutomaticV0FleetCacheEntry(
                body = body,
                bodyHashHex = AutomaticPayloadDigestV1.sha256Hex(bodyBytes),
                receivedAtMs = receivedAtMs,
            )
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // hash authenticated cache bytes
    private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    // define the native companion
    private companion object {
        const val CACHE_MAGIC = 0x4646594956304643L
        const val CACHE_VERSION = 1
        const val MAX_BODY_BYTES = 1_048_576
    }
}

// define the native contract
internal data class AutomaticV0HttpResponse(
    val statusCode: Int,
    val requestedUrl: String,
    val resolvedUrl: String,
    val wasRedirected: Boolean,
    val bodyBytes: ByteArray,
)

// define the native contract
internal interface AutomaticV0HttpTransport {
    // perform one unauthenticated get
    fun get(url: String): AutomaticV0HttpResponse?
}

// define the native contract
internal class AutomaticV0UrlConnectionTransport : AutomaticV0HttpTransport {
    // perform one bounded get without redirects
    override fun get(url: String): AutomaticV0HttpResponse? {
        val connection = try {
            URI(url).toURL().openConnection() as HttpURLConnection
        // fail closed on the error
        } catch (_: Exception) {
            return null
        }
        return try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.useCaches = false
            val statusCode = connection.responseCode
            // run the bounded callback
            val body = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8_192)
                // read at most one byte beyond the bound
                while (output.size() <= MAX_HTTP_BODY_BYTES) {
                    val remaining = MAX_HTTP_BODY_BYTES + 1 - output.size()
                    val count = input.read(buffer, 0, minOf(buffer.size, remaining))
                    // stop at end of stream
                    if (count < 0) {
                        break
                    }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            // reject oversized bodies
            if (body.size > MAX_HTTP_BODY_BYTES) {
                return null
            }
            AutomaticV0HttpResponse(
                statusCode = statusCode,
                requestedUrl = url,
                resolvedUrl = connection.url.toString(),
                wasRedirected = statusCode in 300..399,
                bodyBytes = body,
            )
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            connection.disconnect()
        }
    }

    // define the native companion
    private companion object {
        const val MAX_HTTP_BODY_BYTES = 1_048_576
    }
}

// define the native contract
internal class AutomaticV0FleetClient(
    expectedOrigin: String,
    private val transport: AutomaticV0HttpTransport,
) {
    private val snapshotUrl = exactSnapshotUrl(expectedOrigin)

    // fetch the sole named fleet context
    fun fetch(): ByteArray? {
        val requestedUrl = snapshotUrl ?: return null
        val response = transport.get(requestedUrl) ?: return null
        // reject redirect, substitution, and non-success
        if (
            response.statusCode != 200 ||
            response.wasRedirected ||
            response.requestedUrl != requestedUrl ||
            response.resolvedUrl != requestedUrl
        ) {
            return null
        }
        return response.bodyBytes
    }

    // define the native companion
    companion object {
        // derive one exact production endpoint
        private fun exactSnapshotUrl(expectedOrigin: String): String? {
            val origin = try {
                URI(expectedOrigin)
            // fail closed on the error
            } catch (_: Exception) {
                return null
            }
            // require a clean https origin
            if (
                origin.scheme?.lowercase() != "https" ||
                origin.host == null ||
                origin.userInfo != null ||
                origin.rawQuery != null ||
                origin.rawFragment != null ||
                origin.rawPath !in listOf("", "/")
            ) {
                return null
            }
            val normalizedPort = if (origin.port == -1) "" else ":${origin.port}"
            return "https://${origin.host.lowercase()}$normalizedPort$AUTOMATIC_V0_SNAPSHOT_PATH"
        }
    }
}

// define the native contract
internal class AutomaticV0FleetContextRepository(
    private val cacheStore: AutomaticV0FleetCacheStore,
    private val fleetClient: AutomaticV0FleetClient,
    private val responseReceiptNowMs: () -> Long?,
) {
    var snapshotGetCount: Int = 0
        private set

    // load fresh cache or perform one get
    fun contextForCallback(trustedNowMs: Long): AutomaticV0FleetBody? {
        val cached = cacheStore.read()
        // use only cache fresher than the refresh boundary
        if (cached != null && receiveAgeMs(trustedNowMs, cached.receivedAtMs) in 0 until AUTOMATIC_V0_FLEET_REFRESH_AGE_MS) {
            return validateFreshness(cached, trustedNowMs)
        }
        snapshotGetCount += 1
        val rawBytes = fleetClient.fetch() ?: return null
        val receivedAtMs = responseReceiptNowMs() ?: return null
        val body = AutomaticV0FleetEnvelopeParser.parse(rawBytes) ?: return null
        val entry = AutomaticV0FleetCacheEntry(
            body = body,
            bodyHashHex = AutomaticPayloadDigestV1.sha256Hex(body.canonicalBytes),
            receivedAtMs = receivedAtMs,
        )
        // classify against the post-response trusted time before persistence
        if (validateFreshness(entry, receivedAtMs) == null) {
            return null
        }
        // require successful body-only persistence
        if (!cacheStore.replace(entry)) {
            return null
        }
        return body
    }

    // prefetch after a foreground or policy contact
    fun prefetchIfDue(trustedNowMs: Long): Boolean {
        val cached = cacheStore.read()
        // keep a cache below the exact refresh boundary
        if (cached != null && receiveAgeMs(trustedNowMs, cached.receivedAtMs) in 0 until AUTOMATIC_V0_FLEET_REFRESH_AGE_MS) {
            return validateFreshness(cached, trustedNowMs) != null
        }
        return contextForCallback(trustedNowMs) != null
    }

    // enforce both provisional freshness bounds
    private fun validateFreshness(entry: AutomaticV0FleetCacheEntry, trustedNowMs: Long): AutomaticV0FleetBody? =
        // run the bounded callback
        entry.body.takeIf { AutomaticV0FleetFreshness.isFresh(entry, trustedNowMs) }

    // subtract without overflow acceptance
    private fun receiveAgeMs(trustedNowMs: Long, receivedAtMs: Long): Long = try {
        Math.subtractExact(trustedNowMs, receivedAtMs)
    // fail closed on the error
    } catch (_: ArithmeticException) {
        Long.MIN_VALUE
    }
}

// define the native contract
internal object AutomaticV0FleetFreshness {
    // enforce both provisional freshness bounds
    fun isFresh(entry: AutomaticV0FleetCacheEntry, trustedNowMs: Long): Boolean {
        val sourceAgeMs = subtract(trustedNowMs, entry.body.sourceUpdatedAtMs)
        val receiveAgeMs = subtract(trustedNowMs, entry.receivedAtMs)
        return sourceAgeMs in 0..AUTOMATIC_V0_FLEET_CONTEXT_MAX_AGE_MS &&
            receiveAgeMs in 0..AUTOMATIC_V0_FLEET_CONTEXT_MAX_AGE_MS
    }

    // subtract without overflow acceptance
    private fun subtract(left: Long, right: Long): Long = try {
        Math.subtractExact(left, right)
    // fail closed on the error
    } catch (_: ArithmeticException) {
        Long.MIN_VALUE
    }
}
