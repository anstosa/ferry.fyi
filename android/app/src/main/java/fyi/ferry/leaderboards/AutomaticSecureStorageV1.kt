package fyi.ferry.leaderboards

import android.annotation.TargetApi
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal const val AUTOMATIC_AEAD_NONCE_BYTES = 12
private const val AUTOMATIC_AEAD_TAG_BITS = 128
private const val AUTOMATIC_INSTALLATION_BYTES = 32
private const val AUTOMATIC_CREDENTIAL_SCHEMA_VERSION = 1
private const val AUTOMATIC_MAX_CREDENTIAL_BYTES = 2_048
private const val AUTOMATIC_KEYSTORE_PROVIDER = "AndroidKeyStore"
private const val AUTOMATIC_QUEUE_KEY_ALIAS = "ferry-fyi-automatic-queue-v1"
private const val AUTOMATIC_CREDENTIAL_KEY_ALIAS = "ferry-fyi-automatic-credential-v1"
private const val AUTOMATIC_CALLBACK_KEY_ALIAS = "ferry-fyi-automatic-callback-v1"
private const val AUTOMATIC_CLEANUP_KEY_ALIAS = "ferry-fyi-automatic-cleanup-v1"
private const val AUTOMATIC_SUBJECT_BINDING_BYTES = 32
private const val AUTOMATIC_MAX_SUBJECT_BYTES = 512
private val AUTOMATIC_CLEANUP_ASSOCIATED_DATA = "ferry-fyi:automatic:cleanup:v1".toByteArray()

// define the native contract
internal data class AutomaticAeadSealedBox(
    val nonce: ByteArray,
    val ciphertext: ByteArray,
)

// define the native contract
internal interface AutomaticAeadV1 {
    // seal one bounded plaintext
    fun seal(plaintext: ByteArray, associatedData: ByteArray): AutomaticAeadSealedBox?

    // open one authenticated ciphertext
    fun open(box: AutomaticAeadSealedBox, associatedData: ByteArray): ByteArray?

    // delete the device-bound key
    fun deleteKey(): Boolean

    // report non-exportable key material
    fun isNonExportable(): Boolean
}

// define the native contract
internal class AutomaticAndroidKeystoreAeadV1(
    private val alias: String,
) : AutomaticAeadV1 {
    // seal with a unique random gcm nonce
    override fun seal(plaintext: ByteArray, associatedData: ByteArray): AutomaticAeadSealedBox? = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val nonce = cipher.iv
        // require the canonical gcm nonce
        if (nonce.size != AUTOMATIC_AEAD_NONCE_BYTES) {
            return null
        }
        cipher.updateAAD(associatedData)
        AutomaticAeadSealedBox(nonce, cipher.doFinal(plaintext))
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // reject tampering or unavailable device keys
    override fun open(box: AutomaticAeadSealedBox, associatedData: ByteArray): ByteArray? {
        // reject malformed nonce material
        if (box.nonce.size != AUTOMATIC_AEAD_NONCE_BYTES || box.ciphertext.isEmpty()) {
            return null
        }
        return try {
            val key = existingKey() ?: return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(AUTOMATIC_AEAD_TAG_BITS, box.nonce))
            cipher.updateAAD(associatedData)
            cipher.doFinal(box.ciphertext)
        // fail closed on the error
        } catch (_: Exception) {
            null
        }
    }

    // remove the installation key alias
    override fun deleteKey(): Boolean = try {
        // run the bounded callback
        val keyStore = KeyStore.getInstance(AUTOMATIC_KEYSTORE_PROVIDER).apply { load(null) }
        // delete only this fixed alias
        if (keyStore.containsAlias(alias)) {
            keyStore.deleteEntry(alias)
        }
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // android keystore secret keys expose no bytes
    override fun isNonExportable(): Boolean = try {
        existingKey()?.encoded == null
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // load or create the fixed key
    @TargetApi(Build.VERSION_CODES.P)
    private fun getOrCreateKey(): SecretKey {
        val existing = existingKey()
        // reuse only the existing device key
        if (existing != null) {
            return existing
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, AUTOMATIC_KEYSTORE_PROVIDER)
        val specification = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setKeySize(256)
            .build()
        generator.init(specification)
        return generator.generateKey()
    }

    // load one existing non-exportable key
    private fun existingKey(): SecretKey? {
        // run the bounded callback
        val keyStore = KeyStore.getInstance(AUTOMATIC_KEYSTORE_PROVIDER).apply { load(null) }
        return keyStore.getKey(alias, null) as? SecretKey
    }

    // define the native companion
    companion object {
        // create the queue key boundary
        fun queue(): AutomaticAndroidKeystoreAeadV1 = AutomaticAndroidKeystoreAeadV1(AUTOMATIC_QUEUE_KEY_ALIAS)

        // create the credential key boundary
        fun credential(): AutomaticAndroidKeystoreAeadV1 =
            AutomaticAndroidKeystoreAeadV1(AUTOMATIC_CREDENTIAL_KEY_ALIAS)

        // create the durable callback handoff key boundary
        fun callback(): AutomaticAndroidKeystoreAeadV1 = AutomaticAndroidKeystoreAeadV1(AUTOMATIC_CALLBACK_KEY_ALIAS)

        // create the durable cleanup proof key boundary
        fun cleanup(): AutomaticAndroidKeystoreAeadV1 = AutomaticAndroidKeystoreAeadV1(AUTOMATIC_CLEANUP_KEY_ALIAS)
    }
}

// define the native contract
internal interface AutomaticAtomicFileOpsV1 {
    // replace one ciphertext atomically
    fun replace(destination: File, bytes: ByteArray): Boolean

    // atomically remove one ciphertext from selection
    fun delete(destination: File): Boolean

    // delete one leftover tombstone
    fun deleteTombstone(tombstone: File): Boolean
}

// define the native contract
internal object AutomaticNoBackupAtomicFileOpsV1 : AutomaticAtomicFileOpsV1 {
    // write ciphertext only before same-directory rename
    override fun replace(destination: File, bytes: ByteArray): Boolean {
        val temporary = File(destination.parentFile, ".${destination.name}.${randomSuffix()}.tmp")
        return try {
            destination.parentFile?.mkdirs()
            // run the bounded callback
            FileOutputStream(temporary).use { output ->
                output.write(bytes)
                output.flush()
                output.fd.sync()
            }
            Files.move(
                temporary.toPath(),
                destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            destination.isFile
        // fail closed on the error
        } catch (_: Exception) {
            temporary.delete()
            false
        }
    }

    // rename before physical deletion
    override fun delete(destination: File): Boolean {
        // treat an already absent record as deleted
        if (!destination.exists()) {
            return true
        }
        val tombstone = File(destination.parentFile, ".${destination.name}.${randomSuffix()}.delete")
        return try {
            Files.move(destination.toPath(), tombstone.toPath(), StandardCopyOption.ATOMIC_MOVE)
            tombstone.delete() || !tombstone.exists()
        // fail closed on the error
        } catch (_: Exception) {
            false
        }
    }

    // retry physical deletion without reactivating work
    override fun deleteTombstone(tombstone: File): Boolean = tombstone.delete() || !tombstone.exists()

    // create an opaque temporary suffix
    private fun randomSuffix(): String = java.lang.Long.toUnsignedString(SecureRandom().nextLong(), 36)
}

// define the native contract
internal class AutomaticEnrollmentBootstrapLeaseV1(
    private var binding: ByteArray,
) {
    // consume the device binding through one native operation
    @Synchronized
    fun consume(operation: (ByteArray) -> Boolean): Boolean {
        // reject every replay after the first attempted installation
        if (binding.isEmpty()) {
            return false
        }
        val owned = binding
        binding = ByteArray(0)
        return try {
            operation(owned)
        // release protected state
        } finally {
            owned.fill(0)
        }
    }

    // wipe an unused consumed-bootstrap lease
    @Synchronized
    fun wipe() {
        binding.fill(0)
        binding = ByteArray(0)
    }
}

// define the native contract
internal class AutomaticInstallationBindingStoreV1(
    private val directory: File,
    private val random: SecureRandom = SecureRandom(),
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val sentinelFile = File(directory, "installation-v1.bin")
    private val pendingBootstrapFile = File(directory, "enrollment-bootstrap-v1.bin")

    // return or create one no-backup installation nonce
    @Synchronized
    fun getOrCreate(): ByteArray? {
        val existing = read()
        // reuse only a complete sentinel
        if (existing != null) {
            return existing
        }
        val created = ByteArray(AUTOMATIC_INSTALLATION_BYTES).also(random::nextBytes)
        // persist before exposing the binding
        if (!fileOps.replace(sentinelFile, created)) {
            created.fill(0)
            return null
        }
        return created
    }

    // persist one bootstrap binding before exposing its nonce
    @Synchronized
    fun beginEnrollmentBootstrap(): String? {
        val bytes = getOrCreate() ?: return null
        // attempt the protected operation
        try {
            // invalidate any earlier one-time bootstrap first
            if (!fileOps.delete(pendingBootstrapFile)) {
                return null
            }
            // require durable pending state before javascript receives the nonce
            if (!fileOps.replace(pendingBootstrapFile, bytes)) {
                return null
            }
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        // release protected state
        } finally {
            bytes.fill(0)
        }
    }

    // consume one current-installation bootstrap exactly once
    @Synchronized
    fun consumeEnrollmentBootstrap(): AutomaticEnrollmentBootstrapLeaseV1? {
        val pending = readBinding(pendingBootstrapFile)
        val sentinel = read()
        // discard incomplete or transferred bootstrap state
        if (
            pending == null ||
            sentinel == null ||
            !MessageDigest.isEqual(pending, sentinel)
        ) {
            pending?.fill(0)
            sentinel?.fill(0)
            fileOps.delete(pendingBootstrapFile)
            return null
        }
        pending.fill(0)
        // remove the one-time marker before returning its binding
        if (!fileOps.delete(pendingBootstrapFile)) {
            sentinel.fill(0)
            return null
        }
        return AutomaticEnrollmentBootstrapLeaseV1(sentinel)
    }

    // read one complete no-backup sentinel
    @Synchronized
    fun read(): ByteArray? = readBinding(sentinelFile)

    // report physical sentinel presence without creating it
    fun hasSentinelMaterial(): Boolean = sentinelFile.exists()

    // remove the installation binding
    @Synchronized
    fun clear(): Boolean {
        val pendingCleared = fileOps.delete(pendingBootstrapFile)
        val sentinelCleared = fileOps.delete(sentinelFile)
        return pendingCleared && sentinelCleared
    }

    // read one exact fixed-size binding
    private fun readBinding(file: File): ByteArray? = try {
        // run the bounded callback
        file.readBytes().takeIf { bytes -> bytes.size == AUTOMATIC_INSTALLATION_BYTES }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }
}

// define the native contract
internal data class AutomaticSubjectBindingCheckV1(
    val bound: Boolean,
    val matches: Boolean,
)

// persist only a keyed digest of one credential owner
internal class AutomaticSubjectBindingStoreV1(
    directory: File,
    private val bindingStore: AutomaticInstallationBindingStoreV1,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val subjectBindingFile = File(directory, "subject-binding-v1.bin")

    // bind one transient subject to the current installed credential
    @Synchronized
    fun bind(subject: String, enrollmentId: String): Boolean {
        val digest = digest(subject, enrollmentId) ?: return false
        // release protected state
        return try {
            fileOps.replace(subjectBindingFile, digest)
        // release protected state
        } finally {
            digest.fill(0)
        }
    }

    // compare one transient subject without exposing the stored digest
    @Synchronized
    fun check(subject: String, enrollmentId: String): AutomaticSubjectBindingCheckV1 {
        // distinguish a clean unbound installation
        if (!subjectBindingFile.exists()) {
            return AutomaticSubjectBindingCheckV1(bound = false, matches = false)
        }
        val stored = try {
            subjectBindingFile.readBytes()
        // fail closed on the error
        } catch (_: Exception) {
            return AutomaticSubjectBindingCheckV1(bound = true, matches = false)
        }
        val expected = digest(subject, enrollmentId)
        // release protected state
        return try {
            AutomaticSubjectBindingCheckV1(
                bound = true,
                matches = stored.size == AUTOMATIC_SUBJECT_BINDING_BYTES &&
                    expected != null && MessageDigest.isEqual(stored, expected),
            )
        // release protected state
        } finally {
            stored.fill(0)
            expected?.fill(0)
        }
    }

    // remove only the device-owner proof
    @Synchronized
    fun clear(): Boolean = fileOps.delete(subjectBindingFile)

    // derive one fixed digest from device binding and credential identity
    private fun digest(subject: String, enrollmentId: String): ByteArray? {
        val subjectBytes = subject.toByteArray(Charsets.UTF_8)
        val enrollmentBytes = enrollmentId.toByteArray(Charsets.UTF_8)
        // reject empty or unbounded transient identity input
        if (
            subjectBytes.isEmpty() ||
            subjectBytes.size > AUTOMATIC_MAX_SUBJECT_BYTES ||
            enrollmentBytes.isEmpty()
        ) {
            subjectBytes.fill(0)
            enrollmentBytes.fill(0)
            return null
        }
        val installationBinding = bindingStore.read()
        // fail closed without the device-only installation key
        if (installationBinding == null) {
            subjectBytes.fill(0)
            enrollmentBytes.fill(0)
            return null
        }
        // release protected state
        return try {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(installationBinding, "HmacSHA256"))
            mac.update("ferry-fyi:automatic:subject:v1:".toByteArray())
            mac.update(subjectBytes)
            mac.update(0.toByte())
            mac.doFinal(enrollmentBytes)
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            installationBinding.fill(0)
            subjectBytes.fill(0)
            enrollmentBytes.fill(0)
        }
    }
}

// define the native contract
internal data class AutomaticCleanupPendingCheckV1(
    val matches: Boolean,
    val pending: Boolean,
    val valid: Boolean,
)

// preserve one subject-bound cleanup obligation across identity purge
internal class AutomaticCleanupPendingStoreV1(
    directory: File,
    private val aead: AutomaticAeadV1,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val cleanupFile = File(directory, "cleanup-pending-v1.bin")

    // stage one opaque subject proof before local purge
    @Synchronized
    fun stage(subject: String): Boolean {
        // preserve the first unresolved cleanup owner byte-for-byte
        if (cleanupFile.exists()) {
            val checked = check(subject)
            return checked.valid && checked.matches
        }
        val digest = digest(subject) ?: return false
        val box = aead.seal(digest, AUTOMATIC_CLEANUP_ASSOCIATED_DATA)
        val encoded = box?.let(::encodeBox)
        // release protected state
        return try {
            encoded != null && fileOps.replace(cleanupFile, encoded)
        // release protected state
        } finally {
            digest.fill(0)
            encoded?.fill(0)
            box?.nonce?.fill(0)
            box?.ciphertext?.fill(0)
        }
    }

    // check one pending proof without exposing its digest
    @Synchronized
    fun check(subject: String): AutomaticCleanupPendingCheckV1 {
        // distinguish a clean installation from pending cleanup
        if (!cleanupFile.exists()) {
            return AutomaticCleanupPendingCheckV1(matches = false, pending = false, valid = true)
        }
        val encoded = try {
            cleanupFile.readBytes()
        // fail closed on the error
        } catch (_: Exception) {
            return AutomaticCleanupPendingCheckV1(matches = false, pending = true, valid = false)
        }
        val box = decodeBox(encoded)
        val stored = box?.let { sealed -> aead.open(sealed, AUTOMATIC_CLEANUP_ASSOCIATED_DATA) }
        val expected = digest(subject)
        // release protected state
        return try {
            val valid = stored != null && stored.size == AUTOMATIC_SUBJECT_BINDING_BYTES
            AutomaticCleanupPendingCheckV1(
                matches = stored != null &&
                    stored.size == AUTOMATIC_SUBJECT_BINDING_BYTES &&
                    expected != null &&
                    MessageDigest.isEqual(stored, expected),
                pending = true,
                valid = valid,
            )
        // release protected state
        } finally {
            encoded.fill(0)
            box?.nonce?.fill(0)
            box?.ciphertext?.fill(0)
            stored?.fill(0)
            expected?.fill(0)
        }
    }

    // clear only an exactly matched cleanup proof
    @Synchronized
    fun clear(subject: String): Boolean {
        val checked = check(subject)
        // accept an already empty marker
        if (!checked.pending) {
            return true
        }
        // preserve corrupt or different-subject cleanup
        if (!checked.valid || !checked.matches) {
            return false
        }
        return fileOps.delete(cleanupFile)
    }

    // hash one bounded transient subject before device encryption
    private fun digest(subject: String): ByteArray? {
        val subjectBytes = subject.toByteArray(Charsets.UTF_8)
        // reject empty or unbounded transient identity input
        if (subjectBytes.isEmpty() || subjectBytes.size > AUTOMATIC_MAX_SUBJECT_BYTES) {
            subjectBytes.fill(0)
            return null
        }
        // release protected state
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            digest.update("ferry-fyi:automatic:cleanup-subject:v1:".toByteArray())
            digest.digest(subjectBytes)
        // release protected state
        } finally {
            subjectBytes.fill(0)
        }
    }
}

// define the native contract
internal data class AutomaticCredentialV1(
    val bearerToken: ByteArray,
    val enrollmentId: String,
    val expiresAtMs: Long,
    val rotateAfterMs: Long,
    val serverPolicyGeneration: ServerPolicyGeneration,
    val urls: AutomaticNativeEndpointUrls,
) {
    // wipe the credential copy
    fun wipe() {
        bearerToken.fill(0)
    }
}

// define the native contract
internal class AutomaticCredentialStoreV1(
    private val directory: File,
    private val bindingStore: AutomaticInstallationBindingStoreV1,
    private val aead: AutomaticAeadV1,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val credentialFile = File(directory, "credential-v1.bin")

    // atomically replace one consumed-bootstrap-bound credential
    @Synchronized
    fun replace(credential: AutomaticCredentialV1, bootstrap: AutomaticEnrollmentBootstrapLeaseV1): Boolean {
        // run the bounded callback
        return bootstrap.consume { installationBinding ->
            val currentBinding = bindingStore.read() ?: return@consume false
            // reject a credential carried from another installation
            if (!MessageDigest.isEqual(currentBinding, installationBinding)) {
                currentBinding.fill(0)
                return@consume false
            }
            val plaintext = encode(credential)
            // attempt the protected operation
            try {
                val box = aead.seal(plaintext, credentialAssociatedData(currentBinding)) ?: return@consume false
                fileOps.replace(credentialFile, encodeBox(box))
            // release protected state
            } finally {
                currentBinding.fill(0)
                plaintext.fill(0)
            }
        }
    }

    // read one credential only on the bound installation
    @Synchronized
    fun read(): AutomaticCredentialV1? {
        val binding = bindingStore.read() ?: return null
        val sealed = try {
            decodeBox(credentialFile.readBytes())
        // fail closed on the error
        } catch (_: Exception) {
            null
        }
        return try {
            // run the bounded callback
            val plaintext = sealed?.let { box -> aead.open(box, credentialAssociatedData(binding)) } ?: return null
            // attempt the protected operation
            try {
                decode(plaintext)
            // release protected state
            } finally {
                plaintext.fill(0)
            }
        // release protected state
        } finally {
            binding.fill(0)
        }
    }

    // delete the credential and its non-exportable key
    @Synchronized
    fun clear(): Boolean {
        val fileDeleted = fileOps.delete(credentialFile)
        val keyDeleted = aead.deleteKey()
        return fileDeleted && keyDeleted
    }

    // report only device-key exportability
    fun keyIsNonExportable(): Boolean = aead.isNonExportable()

    // report physical ciphertext presence without decrypting it
    fun hasCredentialMaterial(): Boolean = credentialFile.exists()

    // encode credential plaintext in a closed format
    private fun encode(value: AutomaticCredentialV1): ByteArray {
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(AUTOMATIC_CREDENTIAL_SCHEMA_VERSION)
            output.writeInt(value.bearerToken.size)
            output.write(value.bearerToken)
            output.writeUTF(value.enrollmentId)
            output.writeLong(value.expiresAtMs)
            output.writeLong(value.rotateAfterMs)
            output.writeLong(value.serverPolicyGeneration.value)
            output.writeUTF(value.urls.config)
            output.writeUTF(value.urls.status)
            output.writeUTF(value.urls.candidates)
            output.writeUTF(value.urls.enrollment)
            output.flush()
        }
        // run the bounded callback
        return bytes.toByteArray().also { encoded ->
            require(encoded.size <= AUTOMATIC_MAX_CREDENTIAL_BYTES) { "credential exceeds bound" }
        }
    }

    // decode one authenticated credential
    private fun decode(bytes: ByteArray): AutomaticCredentialV1? = try {
        // reject oversized decrypted material
        if (bytes.isEmpty() || bytes.size > AUTOMATIC_MAX_CREDENTIAL_BYTES) {
            return null
        }
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            // require the fixed credential format
            if (input.readInt() != AUTOMATIC_CREDENTIAL_SCHEMA_VERSION) {
                return null
            }
            val tokenLength = input.readInt()
            // require one 256-bit base64url bearer
            if (tokenLength != 43) {
                return null
            }
            val token = ByteArray(tokenLength)
            input.readFully(token)
            var accepted = false
            // attempt the protected operation
            try {
                val value = AutomaticCredentialV1(
                    bearerToken = token,
                    enrollmentId = input.readUTF(),
                    expiresAtMs = input.readLong(),
                    rotateAfterMs = input.readLong(),
                    serverPolicyGeneration = ServerPolicyGeneration(input.readLong()),
                    urls = AutomaticNativeEndpointUrls(
                        config = input.readUTF(),
                        status = input.readUTF(),
                        candidates = input.readUTF(),
                        enrollment = input.readUTF(),
                    ),
                )
                // reject trailing or malformed lifecycle data
                if (
                    input.available() != 0 ||
                    value.enrollmentId.isEmpty() ||
                    value.expiresAtMs <= 0L ||
                    value.rotateAfterMs <= 0L ||
                    value.rotateAfterMs >= value.expiresAtMs ||
                    value.serverPolicyGeneration.value < 0L ||
                    !canonicalAutomaticBearerTokenV1(value.bearerToken)
                ) {
                    return null
                }
                accepted = true
                value
            // release protected state
            } finally {
                // wipe token bytes on every rejected or truncated decode
                if (!accepted) {
                    token.fill(0)
                }
            }
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // bind credentials to this feature and installation
    private fun credentialAssociatedData(binding: ByteArray): ByteArray =
        "ferry-fyi:automatic:credential:v1:".toByteArray() + binding
}

// require one canonical unpadded 256-bit base64url bearer
internal fun canonicalAutomaticBearerTokenV1(value: ByteArray): Boolean {
    // reject wrong length or alphabet before decoder allocation
    if (
        value.size != 43 ||
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
    val padded = value.copyOf(44).also { bytes -> bytes[43] = '='.code.toByte() }
    var decoded: ByteArray? = null
    var canonical: ByteArray? = null
    return try {
        decoded = Base64.getUrlDecoder().decode(padded)
        canonical = Base64.getUrlEncoder().withoutPadding().encode(decoded)
        decoded.size == 32 && canonical.contentEquals(value)
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

// handle the native operation
internal fun encodeBox(box: AutomaticAeadSealedBox): ByteArray {
    val output = ByteArrayOutputStream()
    // run the bounded callback
    DataOutputStream(output).use { data ->
        data.writeInt(1)
        data.writeInt(box.nonce.size)
        data.write(box.nonce)
        data.writeInt(box.ciphertext.size)
        data.write(box.ciphertext)
        data.flush()
    }
    return output.toByteArray()
}

// handle the native operation
internal fun decodeBox(bytes: ByteArray): AutomaticAeadSealedBox? = try {
    // run the bounded callback
    DataInputStream(ByteArrayInputStream(bytes)).use { input ->
        // require fixed bounded ciphertext fields
        if (input.readInt() != 1 || input.readInt() != AUTOMATIC_AEAD_NONCE_BYTES) {
            return null
        }
        val nonce = ByteArray(AUTOMATIC_AEAD_NONCE_BYTES)
        input.readFully(nonce)
        val ciphertextLength = input.readInt()
        // reject empty or oversized ciphertext
        if (ciphertextLength !in 16..8_192) {
            return null
        }
        val ciphertext = ByteArray(ciphertextLength)
        input.readFully(ciphertext)
        // reject trailing data
        if (input.available() != 0) {
            return null
        }
        AutomaticAeadSealedBox(nonce, ciphertext)
    }
// fail closed on the error
} catch (_: Exception) {
    null
}
