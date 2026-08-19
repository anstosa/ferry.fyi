package fyi.ferry.leaderboards

import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

// define the native contract
internal enum class AutomaticQueueMutationOutcome {
    STORED,
    EXPIRED,
    OVERFLOW_REJECTED,
    BLOCKED,
}

// define the native contract
internal data class AutomaticEncryptedQueueRecordV1(
    val recordKey: String,
    val queued: AutomaticQueuedCandidateV1,
)

// define the native contract
internal sealed interface AutomaticQueueReadResultV1 {
    // define the native contract
    data object Blocked : AutomaticQueueReadResultV1
    // define the native contract
    data class Ready(val records: List<AutomaticEncryptedQueueRecordV1>) : AutomaticQueueReadResultV1
}

// define the native contract
internal sealed interface AutomaticQueueNextReadResultV1 {
    // define the native contract
    data object Blocked : AutomaticQueueNextReadResultV1
    // define the native contract
    data class Ready(val record: AutomaticPreparedCandidateUploadV1?) : AutomaticQueueNextReadResultV1
}

// define the native contract
internal data class AutomaticPendingStopAuthorityV1(
    val outcome: String,
    val serverPolicyGeneration: ServerPolicyGeneration?,
    val localWorkGeneration: LocalWorkGeneration,
)

// define the native contract
internal class AutomaticEncryptedCandidateQueueV1(
    private val directory: File,
    private val bindingStore: AutomaticInstallationBindingStoreV1,
    private val aead: AutomaticAeadV1,
    private val evaluateExpiry: (Long) -> ExpiryEvaluation,
    private val maxPendingCandidates: () -> Int,
    private val random: SecureRandom = SecureRandom(),
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val recordPattern = Regex("[A-Za-z0-9_-]{22}\\.candidate")
    private val preparedPattern = Regex("[A-Za-z0-9_-]{22}\\.prepared")
    private val cleanupMarker = File(directory, "cleanup-required")
    private val cleanupTargetFile = File(directory, "cleanup-target-v1")
    private val stopAuthorityFile = File(directory, "pending-stop-authority-v1.bin")

    // store exactly one ciphertext for one event
    @Synchronized
    fun enqueue(value: AutomaticQueuedCandidateV1): AutomaticQueueMutationOutcome {
        // block new capture until failed final cleanup converges
        if (cleanupRequired() || !reconcileTombstones()) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        // require trusted same-boot expiry before capture
        when (val expiry = evaluateExpiry(value.candidate.capturedAtMs)) {
            ExpiryEvaluation.BlockedWithoutSameBootAnchor -> return AutomaticQueueMutationOutcome.BLOCKED
            // handle the fixed branch
            is ExpiryEvaluation.Available -> {
                // reject already expired candidates
                if (expiry.expired) {
                    return AutomaticQueueMutationOutcome.EXPIRED
                }
            }
        }
        val capacity = maxPendingCandidates()
        // fail closed on invalid remote capacity
        if (capacity <= 0) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        val existing = when (val read = readReadyRecords(deleteExpired = true)) {
            AutomaticQueueReadResultV1.Blocked -> return AutomaticQueueMutationOutcome.BLOCKED
            is AutomaticQueueReadResultV1.Ready -> read.records
        }
        // run the bounded callback
        val matchingCandidate = existing.singleOrNull { record ->
            record.queued.candidate.candidateId == value.candidate.candidateId
        }
        // treat exact callback replay as one already durable candidate
        if (matchingCandidate != null) {
            return if (matchingCandidate.queued == value) {
                AutomaticQueueMutationOutcome.STORED
            // branch on the current state
            } else {
                AutomaticQueueMutationOutcome.BLOCKED
            }
        }
        // enforce oldest-expiring-first overflow
        if (existing.size >= capacity) {
            // run the bounded callback
            val oldest = (existing.map { record -> record.queued.candidate } + value.candidate)
                .minWithOrNull(candidateComparator()) ?: return AutomaticQueueMutationOutcome.BLOCKED
            // reject the incoming oldest event without touching the queue
            if (oldest === value.candidate) {
                return AutomaticQueueMutationOutcome.OVERFLOW_REJECTED
            }
            // run the bounded callback
            val record = existing.firstOrNull { queued -> queued.queued.candidate == oldest }
                ?: return AutomaticQueueMutationOutcome.BLOCKED
            // require atomic removal before admitting replacement work
            if (!delete(record.recordKey)) {
                stageRecordCleanup(record.recordKey)
                return AutomaticQueueMutationOutcome.BLOCKED
            }
        }
        val binding = bindingStore.read() ?: return AutomaticQueueMutationOutcome.BLOCKED
        val recordKey = newRecordKey()
        val plaintext = AutomaticCandidateCodecV1.encodeQueued(value)
        return try {
            val box = aead.seal(plaintext, associatedData(binding, recordKey))
                ?: return AutomaticQueueMutationOutcome.BLOCKED
            val destination = recordFile(recordKey)
            // write authenticated ciphertext only
            if (fileOps.replace(destination, encodeBox(box))) {
                AutomaticQueueMutationOutcome.STORED
            // branch on the current state
            } else {
                AutomaticQueueMutationOutcome.BLOCKED
            }
        // release protected state
        } finally {
            binding.fill(0)
            plaintext.fill(0)
        }
    }

    // store one callback candidate ciphertext without making it upload-visible
    @Synchronized
    fun prepare(recordKey: String, value: AutomaticQueuedCandidateV1): AutomaticQueueMutationOutcome {
        // require one opaque stable callback identity and no cleanup block
        if (!Regex("[A-Za-z0-9_-]{22}").matches(recordKey) || cleanupRequired() || !reconcileTombstones()) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        // replay only the exact existing prepared ciphertext identity
        if (preparedFile(recordKey).isFile) {
            return AutomaticQueueMutationOutcome.STORED
        }
        // preserve the fixed aggregate capacity across active and prepared records
        val capacity = maxPendingCandidates()
        // branch on the current state
        if (capacity <= 0 || candidateFiles().size + preparedFiles().size >= capacity) {
            return AutomaticQueueMutationOutcome.OVERFLOW_REJECTED
        }
        // require trusted same-boot expiry before candidate preparation
        when (val expiry = evaluateExpiry(value.candidate.capturedAtMs)) {
            ExpiryEvaluation.BlockedWithoutSameBootAnchor -> return AutomaticQueueMutationOutcome.BLOCKED
            // handle the fixed branch
            is ExpiryEvaluation.Available -> {
                // reject an already expired callback candidate
                if (expiry.expired) {
                    return AutomaticQueueMutationOutcome.EXPIRED
                }
            }
        }
        val binding = bindingStore.read() ?: return AutomaticQueueMutationOutcome.BLOCKED
        val plaintext = AutomaticCandidateCodecV1.encodeQueued(value)
        return try {
            val box = aead.seal(plaintext, associatedData(binding, recordKey))
                ?: return AutomaticQueueMutationOutcome.BLOCKED
            // branch on the current state
            if (fileOps.replace(preparedFile(recordKey), encodeBox(box))) {
                AutomaticQueueMutationOutcome.STORED
            // branch on the current state
            } else {
                AutomaticQueueMutationOutcome.BLOCKED
            }
        // release protected state
        } finally {
            binding.fill(0)
            plaintext.fill(0)
        }
    }

    // atomically expose one prepared candidate to uploader selection
    @Synchronized
    fun promotePrepared(recordKey: String): Boolean {
        val source = preparedFile(recordKey)
        val destination = recordFile(recordKey)
        // converge a prior successful promotion
        if (destination.isFile) {
            return fileOps.delete(source)
        }
        // reject missing or non-opaque prepared identities
        if (!Regex("[A-Za-z0-9_-]{22}").matches(recordKey) || !source.isFile) {
            return false
        }
        return try {
            Files.move(
                source.toPath(),
                destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            destination.isFile
        // fail closed on the error
        } catch (_: Exception) {
            false
        }
    }

    // list only opaque prepared candidate identities
    fun preparedRecordKeys(): List<String> = preparedFiles().map { file -> file.name.removeSuffix(".prepared") }

    // read valid unexpired candidates for selection
    @Synchronized
    fun readReadyRecords(deleteExpired: Boolean = true): AutomaticQueueReadResultV1 {
        // block upload while deletion convergence is pending
        if (cleanupRequired() || !reconcileTombstones()) {
            return AutomaticQueueReadResultV1.Blocked
        }
        // require trusted same-boot time even when the queue is empty
        if (evaluateExpiry(0L) == ExpiryEvaluation.BlockedWithoutSameBootAnchor) {
            return AutomaticQueueReadResultV1.Blocked
        }
        val binding = bindingStore.read() ?: return AutomaticQueueReadResultV1.Blocked
        val records = mutableListOf<AutomaticEncryptedQueueRecordV1>()
        // attempt the protected operation
        try {
            // inspect only fixed opaque candidate files
            for (file in candidateFiles()) {
                val recordKey = file.name.removeSuffix(".candidate")
                val box = try {
                    decodeBox(file.readBytes())
                // fail closed on the error
                } catch (_: Exception) {
                    null
                }
                // run the bounded callback
                val plaintext = box?.let { sealed -> aead.open(sealed, associatedData(binding, recordKey)) }
                // delete unauthenticated ciphertext
                if (plaintext == null) {
                    // branch on the current state
                    if (!fileOps.delete(file)) {
                        stageRecordCleanup(recordKey)
                        return AutomaticQueueReadResultV1.Blocked
                    }
                    continue
                }
                // attempt the protected operation
                try {
                    val queued = AutomaticCandidateCodecV1.decodeQueued(plaintext)
                    // delete invalid authenticated payloads
                    if (queued == null) {
                        // branch on the current state
                        if (!fileOps.delete(file)) {
                            stageRecordCleanup(recordKey)
                            return AutomaticQueueReadResultV1.Blocked
                        }
                        continue
                    }
                    // enforce logical expiry on every read
                    when (val expiry = evaluateExpiry(queued.candidate.capturedAtMs)) {
                        ExpiryEvaluation.BlockedWithoutSameBootAnchor -> return AutomaticQueueReadResultV1.Blocked
                        // handle the fixed branch
                        is ExpiryEvaluation.Available -> {
                            // delete expired ciphertext before selection
                            if (expiry.expired) {
                                // branch on the current state
                                if (deleteExpired && !fileOps.delete(file)) {
                                    stageRecordCleanup(recordKey)
                                    return AutomaticQueueReadResultV1.Blocked
                                }
                                continue
                            }
                        }
                    }
                    records += AutomaticEncryptedQueueRecordV1(recordKey, queued)
                // release protected state
                } finally {
                    plaintext.fill(0)
                }
            }
        // release protected state
        } finally {
            binding.fill(0)
        }
        return AutomaticQueueReadResultV1.Ready(
            // run the bounded callback
            records.sortedWith { left, right -> candidateComparator().compare(left.queued.candidate, right.queued.candidate) },
        )
    }

    // select one oldest independent record while releasing every other decrypted candidate
    @Synchronized
    fun readNextReadyRecord(
        excludedEntityKeys: Set<String>,
        deleteExpired: Boolean = true,
    ): AutomaticQueueNextReadResultV1 {
        // block upload while deletion convergence is pending
        if (cleanupRequired() || !reconcileTombstones()) {
            return AutomaticQueueNextReadResultV1.Blocked
        }
        // require trusted same-boot time even when the queue is empty
        if (evaluateExpiry(0L) == ExpiryEvaluation.BlockedWithoutSameBootAnchor) {
            return AutomaticQueueNextReadResultV1.Blocked
        }
        val binding = bindingStore.read() ?: return AutomaticQueueNextReadResultV1.Blocked
        var selected: AutomaticPreparedCandidateUploadV1? = null
        // attempt the protected operation
        try {
            // inspect one authenticated plaintext buffer at a time
            for (file in candidateFiles()) {
                val recordKey = file.name.removeSuffix(".candidate")
                val box = try {
                    decodeBox(file.readBytes())
                // fail closed on the error
                } catch (_: Exception) {
                    null
                }
                // run the bounded callback
                val plaintext = box?.let { sealed -> aead.open(sealed, associatedData(binding, recordKey)) }
                // delete unauthenticated ciphertext
                if (plaintext == null) {
                    // branch on the current state
                    if (!fileOps.delete(file)) {
                        selected?.wipe()
                        stageRecordCleanup(recordKey)
                        return AutomaticQueueNextReadResultV1.Blocked
                    }
                    continue
                }
                // attempt the protected operation
                try {
                    val prepared = AutomaticCandidateCodecV1.decodePreparedUpload(recordKey, plaintext)
                    // delete invalid authenticated payloads
                    if (prepared == null) {
                        // branch on the current state
                        if (!fileOps.delete(file)) {
                            selected?.wipe()
                            stageRecordCleanup(recordKey)
                            return AutomaticQueueNextReadResultV1.Blocked
                        }
                        continue
                    }
                    // enforce logical expiry on every read
                    when (val expiry = evaluateExpiry(prepared.orderingCapturedAtMs())) {
                        // handle the fixed branch
                        ExpiryEvaluation.BlockedWithoutSameBootAnchor -> {
                            prepared.wipe()
                            selected?.wipe()
                            return AutomaticQueueNextReadResultV1.Blocked
                        }
                        // handle the fixed branch
                        is ExpiryEvaluation.Available -> {
                            // delete expired ciphertext before selection
                            if (expiry.expired) {
                                // branch on the current state
                                if (deleteExpired && !fileOps.delete(file)) {
                                    prepared.wipe()
                                    selected?.wipe()
                                    stageRecordCleanup(recordKey)
                                    return AutomaticQueueNextReadResultV1.Blocked
                                }
                                prepared.wipe()
                                continue
                            }
                        }
                    }
                    // exclude an already attempted independent lane
                    if (prepared.entityKey in excludedEntityKeys) {
                        prepared.wipe()
                        continue
                    }
                    val previous = selected
                    // retain only the oldest eligible candidate object
                    if (
                        previous == null ||
                        AutomaticCandidateCodecV1.comparePrepared(prepared, previous) < 0
                    ) {
                        previous?.wipe()
                        selected = prepared
                    // branch on the current state
                    } else {
                        prepared.wipe()
                    }
                // release protected state
                } finally {
                    plaintext.fill(0)
                }
            }
        // release protected state
        } finally {
            binding.fill(0)
        }
        selected?.releaseOrderingFields()
        return AutomaticQueueNextReadResultV1.Ready(selected)
    }

    // atomically remove one final record before exposure
    @Synchronized
    fun delete(recordKey: String): Boolean {
        // reject non-opaque paths
        if (!recordKey.matches(Regex("[A-Za-z0-9_-]{22}"))) {
            return false
        }
        return fileOps.delete(recordFile(recordKey))
    }

    // delete one final while durably retaining only its opaque cleanup target
    @Synchronized
    fun deleteFinal(recordKey: String): Boolean {
        // reject paths outside the opaque queue namespace
        if (!recordKey.matches(Regex("[A-Za-z0-9_-]{22}"))) {
            return false
        }
        // persist the exact deletion obligation before mutating ciphertext
        if (!stageRecordCleanup(recordKey)) {
            return false
        }
        // converge through the same targeted restart path
        return retryTargetCleanup()
    }

    // purge all ciphertext and optionally its device key
    @Synchronized
    fun purge(deleteKey: Boolean): Boolean {
        var success = true
        // delete every active ciphertext
        for (file in candidateFiles()) {
            // preserve aggregate success across records
            if (!fileOps.delete(file)) {
                success = false
            }
        }
        // delete every upload-invisible prepared ciphertext
        for (file in preparedFiles()) {
            // branch on the current state
            if (!fileOps.delete(file)) {
                success = false
            }
        }
        // retry every inactive tombstone
        if (!reconcileTombstones()) {
            success = false
        }
        // remove key only for identity-ending stops
        if (deleteKey && !aead.deleteKey()) {
            success = false
        }
        // clear any superseded targeted final obligation during a full stop
        if (!fileOps.delete(cleanupTargetFile)) {
            success = false
        }
        // retain the block marker until cleanup completes
        if (success) {
            cleanupMarker.delete()
        // branch on the current state
        } else {
            markCleanupRequired()
        }
        return success
    }

    // report aggregate encrypted record count only
    @Synchronized
    fun pendingCount(): Int = candidateFiles().size

    // mark final cleanup as mandatory
    @Synchronized
    fun markCleanupRequired(): Boolean = try {
        directory.mkdirs()
        cleanupMarker.createNewFile() || cleanupMarker.exists()
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // persist one opaque record-specific cleanup obligation
    private fun stageRecordCleanup(recordKey: String): Boolean {
        // reject paths outside the fixed record namespace
        if (!recordKey.matches(Regex("[A-Za-z0-9_-]{22}"))) {
            return false
        }
        val targetBytes = recordKey.toByteArray(Charsets.US_ASCII)
        val stored = try {
            fileOps.replace(cleanupTargetFile, targetBytes)
        // release protected state
        } finally {
            targetBytes.fill(0)
        }
        return stored && markCleanupRequired()
    }

    // persist one fixed stop authority before final ciphertext mutation
    @Synchronized
    fun stageStopAuthority(authority: AutomaticPendingStopAuthorityV1): Boolean {
        // reject non-stop outcomes and invalid generation relations
        if (!isValidStopAuthority(authority)) {
            return false
        }
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(2)
            output.writeUTF(authority.outcome)
            output.writeLong(authority.serverPolicyGeneration?.value ?: -1L)
            output.writeLong(authority.localWorkGeneration.value)
            output.flush()
        }
        // preserve replayable ciphertext when authority persistence fails
        if (!fileOps.replace(stopAuthorityFile, bytes.toByteArray())) {
            return false
        }
        // the authority file itself blocks capture if the marker write fails
        return markCleanupRequired()
    }

    // restore only a fixed validated stop authority
    @Synchronized
    fun pendingStopAuthority(): AutomaticPendingStopAuthorityV1? {
        // return no authority only when the latch is absent
        if (!stopAuthorityFile.isFile) {
            return null
        }
        return try {
            // run the bounded callback
            DataInputStream(ByteArrayInputStream(stopAuthorityFile.readBytes())).use { input ->
                // require the fixed authority schema
                if (input.readInt() != 2) {
                    return null
                }
                val outcome = input.readUTF()
                val generation = input.readLong()
                val localGeneration = input.readLong()
                val authority = AutomaticPendingStopAuthorityV1(
                    outcome = outcome,
                    // run the bounded callback
                    serverPolicyGeneration = generation.takeIf { value -> value >= 0L }
                        ?.let(::ServerPolicyGeneration),
                    localWorkGeneration = LocalWorkGeneration(localGeneration),
                )
                // reject trailing malformed or impossible authority
                if (input.available() != 0 || !isValidStopAuthority(authority)) {
                    return null
                }
                authority
            }
        // fail closed on the error
        } catch (_: Exception) {
            null
        }
    }

    // report only whether a durable stop authority file exists
    fun hasPendingStopAuthority(): Boolean = stopAuthorityFile.isFile

    // clear authority only after stop effects and deletion converge
    @Synchronized
    fun clearStopAuthority(): Boolean = fileOps.delete(stopAuthorityFile)

    // discard only the exact stale generation-bound authority
    @Synchronized
    fun discardStopAuthority(authority: AutomaticPendingStopAuthorityV1): Boolean {
        // preserve a concurrently replaced authority
        if (pendingStopAuthority() != authority) {
            return true
        }
        return fileOps.delete(stopAuthorityFile)
    }

    // retry cleanup and clear its block only at zero ciphertext
    @Synchronized
    fun retryRequiredCleanup(): Boolean {
        // skip work when no cleanup was requested
        if (!cleanupRequired()) {
            return true
        }
        // stop authority owns installation-wide ciphertext cleanup
        if (stopAuthorityFile.exists()) {
            val purged = purge(deleteKey = false)
            // require eventual zero matching ciphertext
            if (purged && candidateFiles().isEmpty() && preparedFiles().isEmpty()) {
                cleanupMarker.delete()
                return true
            }
            return false
        }
        // non-stop finals may remove only their exact opaque record
        if (cleanupTargetFile.exists()) {
            return retryTargetCleanup()
        }
        // retry inactive deletions without touching unrelated live records
        val reconciled = reconcileTombstones()
        // branch on the current state
        if (reconciled) {
            cleanupMarker.delete()
        }
        return reconciled
    }

    // expose only the coarse cleanup state
    fun cleanupRequired(): Boolean =
        cleanupMarker.exists() || cleanupTargetFile.exists() || stopAuthorityFile.exists()

    // converge only one non-stop final ciphertext and its tombstones
    private fun retryTargetCleanup(): Boolean {
        val recordKey = readCleanupTarget()
        // discard an unusable opaque marker without deleting live ciphertext
        if (recordKey == null) {
            val targetCleared = fileOps.delete(cleanupTargetFile)
            val tombstonesCleared = reconcileTombstones()
            // branch on the current state
            if (targetCleared && tombstonesCleared) {
                cleanupMarker.delete()
            }
            return targetCleared && tombstonesCleared
        }
        val activeCleared = fileOps.delete(recordFile(recordKey))
        val preparedCleared = fileOps.delete(preparedFile(recordKey))
        var tombstonesCleared = true
        // retry only tombstones belonging to the exact final record
        for (tombstone in recordTombstones(recordKey)) {
            // branch on the current state
            if (!fileOps.deleteTombstone(tombstone)) {
                tombstonesCleared = false
            }
        }
        // retain the target until all matching ciphertext is physically absent
        if (!activeCleared || !preparedCleared || !tombstonesCleared) {
            return false
        }
        val targetCleared = fileOps.delete(cleanupTargetFile)
        // branch on the current state
        if (targetCleared) {
            cleanupMarker.delete()
        }
        return targetCleared
    }

    // restore one exact opaque cleanup key
    private fun readCleanupTarget(): String? = try {
        val bytes = cleanupTargetFile.readBytes()
        // attempt the protected operation
        try {
            // run the bounded callback
            bytes.toString(Charsets.US_ASCII).takeIf { value -> value.matches(Regex("[A-Za-z0-9_-]{22}")) }
        // release protected state
        } finally {
            bytes.fill(0)
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // remove inactive delete files
    private fun reconcileTombstones(): Boolean {
        var success = true
        // run the bounded callback
        val tombstones = directory.listFiles { file -> file.name.endsWith(".delete") }.orEmpty()
        // retry each physical deletion independently
        for (tombstone in tombstones) {
            // preserve any failed deletion
            if (!fileOps.deleteTombstone(tombstone)) {
                success = false
            }
        }
        return success
    }

    // list inactive delete files for one opaque record only
    private fun recordTombstones(recordKey: String): List<File> = directory.listFiles { file ->
        file.name.startsWith(".$recordKey.candidate.") || file.name.startsWith(".$recordKey.prepared.")
    // run the bounded callback
    }.orEmpty().filter { file -> file.name.endsWith(".delete") }

    // list only active opaque records
    private fun candidateFiles(): List<File> = directory.listFiles { file -> recordPattern.matches(file.name) }
        .orEmpty()
        .sortedBy(File::getName)

    // list only upload-invisible prepared ciphertext
    private fun preparedFiles(): List<File> = directory.listFiles { file -> preparedPattern.matches(file.name) }
        .orEmpty()
        .sortedBy(File::getName)

    // derive one fixed record path
    private fun recordFile(recordKey: String): File = File(directory, "$recordKey.candidate")

    // derive one prepared callback candidate path
    private fun preparedFile(recordKey: String): File = File(directory, "$recordKey.prepared")

    // create one random opaque record key
    private fun newRecordKey(): String {
        // avoid collisions without exposing candidate identity
        while (true) {
            val bytes = ByteArray(16).also(random::nextBytes)
            val key = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            bytes.fill(0)
            // return the first absent opaque key
            if (!recordFile(key).exists() && !preparedFile(key).exists()) {
                return key
            }
        }
    }

    // bind ciphertext to installation and opaque file identity
    private fun associatedData(binding: ByteArray, recordKey: String): ByteArray =
        "ferry-fyi:automatic:candidate:v1:$recordKey:".toByteArray() + binding

    // validate the fixed detail-free stop authority set
    private fun isValidStopAuthority(authority: AutomaticPendingStopAuthorityV1): Boolean {
        val generation = authority.serverPolicyGeneration
        // reject invalid local work generations
        if (authority.localWorkGeneration.value < 0L) {
            return false
        }
        // allow either reviewed authentication race disclosure
        if (authority.outcome == "authentication_failed") {
            return generation == null || generation.value in 0..9_007_199_254_740_991L
        }
        return authority.outcome in setOf(
            "detector_disabled",
            "enrollment_expired",
            "enrollment_revoked",
            "policy_disabled",
        ) && generation?.value in 0..9_007_199_254_740_991L
    }

    // order by event time then candidate id
    private fun candidateComparator(): Comparator<AutomaticCheckinCandidateV1> =
        // run the bounded callback
        compareBy<AutomaticCheckinCandidateV1> { candidate -> candidate.capturedAtMs }
            // run the bounded callback
            .thenBy { candidate -> candidate.candidateId }
}
