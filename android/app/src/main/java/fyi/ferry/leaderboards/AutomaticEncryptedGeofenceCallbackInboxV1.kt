package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.SecureRandom
import java.util.Base64

// define the native contract
internal data class AutomaticStoredGeofenceCallbackV1(
    val recordKey: String,
    val callback: AutomaticGeofenceCallbackV1,
)

// define the native contract
internal class AutomaticEncryptedGeofenceCallbackInboxV1(
    private val directory: File,
    private val bindingStore: AutomaticInstallationBindingStoreV1,
    private val aead: AutomaticAeadV1,
    private val random: SecureRandom = SecureRandom(),
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val recordPattern = Regex("[A-Za-z0-9_-]{22}\\.callback")
    private val cleanupMarker = File(directory, "cleanup-required")

    // persist one encrypted callback before receiver completion
    @Synchronized
    fun enqueue(callback: AutomaticGeofenceCallbackV1): Boolean {
        // block new callbacks until corrupt record cleanup converges
        if (!retryCleanup()) {
            return false
        }
        // require one canonical public region identity
        if (
            callback.configGeneration.value < 0L ||
            AutomaticGeofenceRequestIdV1.parse(AutomaticGeofenceRequestIdV1.encode(callback)) == null
        ) {
            return false
        }
        val binding = bindingStore.read() ?: return false
        val recordKey = newRecordKey()
        val plaintext = encode(callback)
        var box: AutomaticAeadSealedBox? = null
        var encodedBox: ByteArray? = null
        return try {
            box = aead.seal(plaintext, associatedData(binding, recordKey)) ?: return false
            encodedBox = encodeBox(box!!)
            fileOps.replace(recordFile(recordKey), encodedBox!!)
        // release protected state
        } finally {
            binding.fill(0)
            plaintext.fill(0)
            box?.nonce?.fill(0)
            box?.ciphertext?.fill(0)
            encodedBox?.fill(0)
        }
    }

    // read only the oldest encrypted callback handoff
    @Synchronized
    fun next(): AutomaticStoredGeofenceCallbackV1? {
        // clean invalid oldest records before advancing to usable work
        for (file in callbackFiles()) {
            val stored = read(file)
            // return the first authenticated callback
            if (stored != null) {
                return stored
            }
            // latch cleanup if invalid ciphertext cannot be removed
            if (!fileOps.delete(file)) {
                markCleanupRequired()
                return null
            }
        }
        cleanupMarker.delete()
        return null
    }

    // decrypt one exact callback record
    private fun read(file: File): AutomaticStoredGeofenceCallbackV1? {
        val recordKey = file.name.removeSuffix(".callback")
        val binding = bindingStore.read() ?: return null
        val encoded = try {
            file.readBytes()
        // fail closed on the error
        } catch (_: Exception) {
            binding.fill(0)
            return null
        }
        val box = decodeBox(encoded)
        encoded.fill(0)
        // run the bounded callback
        val plaintext = box?.let { value -> aead.open(value, associatedData(binding, recordKey)) }
        binding.fill(0)
        box?.nonce?.fill(0)
        box?.ciphertext?.fill(0)
        return try {
            // run the bounded callback
            plaintext?.let(::decode)?.let { callback -> AutomaticStoredGeofenceCallbackV1(recordKey, callback) }
        // release protected state
        } finally {
            plaintext?.fill(0)
        }
    }

    // delete only the completed callback handoff
    @Synchronized
    fun delete(recordKey: String): Boolean {
        // reject paths outside the opaque callback namespace
        if (!Regex("[A-Za-z0-9_-]{22}").matches(recordKey)) {
            return false
        }
        return fileOps.delete(recordFile(recordKey))
    }

    // report only aggregate pending callback count
    fun pendingCount(): Int = callbackFiles().size

    // purge callback state during every exhaustive stop
    @Synchronized
    fun clear(deleteKey: Boolean): Boolean {
        var cleared = true
        // delete every owned encrypted callback
        for (file in callbackFiles()) {
            // branch on the current state
            if (!fileOps.delete(file)) {
                cleared = false
            }
        }
        val keyCleared = !deleteKey || aead.deleteKey()
        // clear the corruption latch only at physical zero
        if (cleared && keyCleared) {
            cleanupMarker.delete()
        }
        return cleared && keyCleared
    }

    // retry corrupt callback cleanup before new capture
    @Synchronized
    fun retryCleanup(): Boolean {
        // skip cleanup without a durable latch
        if (!cleanupMarker.exists()) {
            return true
        }
        var success = true
        // remove only callback records already known unusable by the blocked reader
        for (file in callbackFiles()) {
            // preserve aggregate failure for lifecycle retry
            if (read(file) == null && !fileOps.delete(file)) {
                success = false
            }
        }
        // clear only after every unusable file converges
        if (success) {
            cleanupMarker.delete()
        }
        return success
    }

    // latch corrupt callback cleanup without event detail
    private fun markCleanupRequired(): Boolean = try {
        directory.mkdirs()
        cleanupMarker.createNewFile() || cleanupMarker.exists()
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // encode one bounded fixed callback record
    private fun encode(callback: AutomaticGeofenceCallbackV1): ByteArray {
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(1)
            output.writeUTF(callback.terminalId)
            output.writeLong(callback.configGeneration.value)
            output.writeLong(callback.localWorkGeneration.value)
            output.writeUTF(callback.transition.name)
            output.flush()
        }
        return bytes.toByteArray()
    }

    // decode one exact callback record
    private fun decode(bytes: ByteArray): AutomaticGeofenceCallbackV1? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            // require the fixed schema
            if (input.readInt() != 1) {
                return null
            }
            val callback = AutomaticGeofenceCallbackV1(
                terminalId = input.readUTF(),
                configGeneration = ConfigGeneration(input.readLong()),
                localWorkGeneration = LocalWorkGeneration(input.readLong()),
                transition = AutomaticGeofenceTransitionV1.valueOf(input.readUTF()),
            )
            // require canonical identity and no trailing bytes
            if (
                input.available() != 0 ||
                callback.configGeneration.value < 0L ||
                AutomaticGeofenceRequestIdV1.parse(AutomaticGeofenceRequestIdV1.encode(callback)) == null
            ) {
                return null
            }
            callback
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // encode one authenticated callback box
    private fun encodeBox(box: AutomaticAeadSealedBox): ByteArray {
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(1)
            output.writeInt(box.nonce.size)
            output.write(box.nonce)
            output.writeInt(box.ciphertext.size)
            output.write(box.ciphertext)
            output.flush()
        }
        return bytes.toByteArray()
    }

    // decode one bounded authenticated callback box
    private fun decodeBox(bytes: ByteArray): AutomaticAeadSealedBox? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            // require the fixed box schema and nonce
            if (input.readInt() != 1 || input.readInt() != AUTOMATIC_AEAD_NONCE_BYTES) {
                return null
            }
            val nonce = ByteArray(AUTOMATIC_AEAD_NONCE_BYTES).also(input::readFully)
            val ciphertextLength = input.readInt()
            // reject empty oversized or truncated ciphertext
            if (ciphertextLength !in 1..4_096 || ciphertextLength > input.available()) {
                nonce.fill(0)
                return null
            }
            val ciphertext = ByteArray(ciphertextLength).also(input::readFully)
            // reject trailing bytes
            if (input.available() != 0) {
                nonce.fill(0)
                ciphertext.fill(0)
                return null
            }
            AutomaticAeadSealedBox(nonce, ciphertext)
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // list only owned opaque callback records
    private fun callbackFiles(): List<File> = directory.listFiles { file -> recordPattern.matches(file.name) }
        .orEmpty()
        .sortedWith(compareBy<File>({ file -> file.lastModified() }, File::getName))

    // create one absent opaque callback identity
    private fun newRecordKey(): String {
        // avoid collisions without exposing region identity
        while (true) {
            val bytes = ByteArray(16).also(random::nextBytes)
            val recordKey = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            bytes.fill(0)
            // return the first absent key
            if (!recordFile(recordKey).exists()) {
                return recordKey
            }
        }
    }

    // resolve one owned callback path
    private fun recordFile(recordKey: String): File = File(directory, "$recordKey.callback")

    // bind callback ciphertext to installation and opaque file identity
    private fun associatedData(binding: ByteArray, recordKey: String): ByteArray =
        "ferry-fyi:automatic:callback:v1:$recordKey:".toByteArray() + binding

}
