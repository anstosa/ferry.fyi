package fyi.ferry.leaderboards

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticEncryptedCandidateQueueV1Test {
    // encrypt each candidate with a unique nonce and no plaintext file
    @Test
    fun storesOnlyUniqueNonceCiphertexts() {
        var now = 2_000L
        val runtime = testSecureRuntime({ now })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L)
            val second = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 1_001L,
                terminalId = "8",
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(first, LocalWorkGeneration(0))),
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(second, LocalWorkGeneration(0))),
            )
            assertEquals(2, runtime.queueAead.nonces.distinctBy(ByteArray::toList).size)
            val disk = File(runtime.root, "candidates").walkTopDown()
                .filter(File::isFile)
                // run the bounded callback
                .flatMap { file -> file.readBytes().asSequence() }
                .toList()
                .toByteArray()
                .toString(Charsets.ISO_8859_1)
            assertFalse(disk.contains(first.candidateId))
            assertFalse(disk.contains("476020000"))
            assertFalse(File(runtime.root, "candidates").listFiles().orEmpty().any { file -> file.name.endsWith(".tmp") })
            now += 1L
            assertEquals(2, (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records.size)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject tampering and delete the unauthenticated ciphertext
    @Test
    fun tamperingDeletesRecordWithoutPlaintextFallback() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            // run the bounded callback
            val file = File(runtime.root, "candidates").listFiles()!!.single { candidate ->
                candidate.name.endsWith(".candidate")
            }
            val bytes = file.readBytes()
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            file.writeBytes(bytes)

            assertEquals(emptyList<AutomaticEncryptedQueueRecordV1>(), (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records)
            assertEquals(0, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject oldest-expiring overflow while preserving newer work
    @Test
    fun overflowDropsOnlyOldestExpiringCandidate() {
        // run the bounded callback
        val runtime = testSecureRuntime({ 10_000L }, capacity = { 2 })
        // attempt the protected operation
        try {
            val first = testTerminalCandidate(capturedAtMs = 1_000L)
            val second = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 2_000L,
                terminalId = "8",
            )
            val third = testTerminalCandidate(
                candidateId = "_____________________w",
                capturedAtMs = 3_000L,
                terminalId = "9",
            )
            assertEquals(AutomaticQueueMutationOutcome.STORED, runtime.queue.enqueue(AutomaticQueuedCandidateV1(first, LocalWorkGeneration(0))))
            assertEquals(AutomaticQueueMutationOutcome.STORED, runtime.queue.enqueue(AutomaticQueuedCandidateV1(second, LocalWorkGeneration(0))))
            assertEquals(AutomaticQueueMutationOutcome.STORED, runtime.queue.enqueue(AutomaticQueuedCandidateV1(third, LocalWorkGeneration(0))))
            val remaining = (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records
                // run the bounded callback
                .map { record -> record.queued.candidate }
            assertEquals(listOf(second, third), remaining)
            val olderIncoming = testTerminalCandidate(
                candidateId = "AAAAAAAAAAAAAAAAAAAAAA",
                capturedAtMs = 500L,
                terminalId = "10",
            )
            assertEquals(
                AutomaticQueueMutationOutcome.OVERFLOW_REJECTED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(olderIncoming, LocalWorkGeneration(0))),
            )
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // delete at the exact twelve-hour boundary without upload selection
    @Test
    fun exactExpiryDeletesLocallyAndRollbackCannotExtend() {
        var now: Long? = 1_000L + AUTOMATIC_CANDIDATE_RETENTION_MS - 1L
        val runtime = testSecureRuntime({ now })
        // attempt the protected operation
        try {
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            assertEquals(1, (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records.size)
            now = 1_000L + AUTOMATIC_CANDIDATE_RETENTION_MS
            assertEquals(0, (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records.size)
            assertEquals(0, runtime.queue.pendingCount())
            val rebootCandidate = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = now,
                terminalId = "8",
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(rebootCandidate, LocalWorkGeneration(0))),
            )
            now = null
            assertEquals(AutomaticQueueReadResultV1.Blocked, runtime.queue.readReadyRecords())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // bind queue ciphertext to one installation sentinel and key
    @Test
    fun reinstallOrTransferCannotOpenOldCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0)),
                ),
            )
            runtime.bindingStore.clear()
            runtime.bindingStore.getOrCreate()
            val read = runtime.queue.readReadyRecords()
            assertTrue(read is AutomaticQueueReadResultV1.Ready)
            assertEquals(0, (read as AutomaticQueueReadResultV1.Ready).records.size)
            assertEquals(0, runtime.queue.pendingCount())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // retry only a failed final deletion and preserve unrelated ciphertext
    @Test
    fun cleanupFailureBlocksAndConvergesAtNextExecution() {
        val fileOps = TestAtomicFileOpsV1()
        val runtime = testSecureRuntime({ 2_000L }, fileOps = fileOps)
        // attempt the protected operation
        try {
            val first = testTerminalCandidate()
            val second = testTerminalCandidate(
                candidateId = "EBESExQVFhcYGRobHB0eHw",
                capturedAtMs = 1_001L,
                terminalId = "8",
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(first, LocalWorkGeneration(0)),
                ),
            )
            assertEquals(
                AutomaticQueueMutationOutcome.STORED,
                runtime.queue.enqueue(AutomaticQueuedCandidateV1(second, LocalWorkGeneration(0))),
            )
            val record = (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records
                // run the bounded callback
                .single { value -> value.queued.candidate.candidateId == first.candidateId }
            fileOps.failDelete = true
            assertFalse(runtime.queue.deleteFinal(record.recordKey))
            assertEquals(
                AutomaticQueueMutationOutcome.BLOCKED,
                runtime.queue.enqueue(
                    AutomaticQueuedCandidateV1(
                        testTerminalCandidate(
                            candidateId = "EBESExQVFhcYGRobHB0eHw",
                            capturedAtMs = 1_001L,
                        ),
                        LocalWorkGeneration(0),
                    ),
                ),
            )
            assertFalse(runtime.queue.retryRequiredCleanup())
            fileOps.failDelete = false
            assertTrue(runtime.queue.retryRequiredCleanup())
            assertEquals(1, runtime.queue.pendingCount())
            val remaining = (runtime.queue.readReadyRecords() as AutomaticQueueReadResultV1.Ready).records.single()
            assertEquals(second.candidateId, remaining.queued.candidate.candidateId)
            assertFalse(runtime.queue.cleanupRequired())
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // keep one candidate ciphertext invisible until callback ownership completes
    @Test
    fun preparedCallbackCandidatePromotesWithoutDuplicateCiphertext() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val recordKey = "AAECAwQFBgcICQoLDA0ODw"
            val queued = AutomaticQueuedCandidateV1(testTerminalCandidate(), LocalWorkGeneration(0))

            assertEquals(AutomaticQueueMutationOutcome.STORED, runtime.queue.prepare(recordKey, queued))
            assertEquals(0, runtime.queue.pendingCount())
            assertEquals(listOf(recordKey), runtime.queue.preparedRecordKeys())
            assertEquals(AutomaticQueueMutationOutcome.STORED, runtime.queue.prepare(recordKey, queued))
            // run the bounded callback
            assertEquals(1, File(runtime.root, "candidates").listFiles().orEmpty().count { file ->
                file.name.endsWith(".prepared") || file.name.endsWith(".candidate")
            })

            assertTrue(runtime.queue.promotePrepared(recordKey))
            assertEquals(1, runtime.queue.pendingCount())
            assertTrue(runtime.queue.preparedRecordKeys().isEmpty())
            // run the bounded callback
            assertEquals(1, File(runtime.root, "candidates").listFiles().orEmpty().count { file ->
                file.name.endsWith(".prepared") || file.name.endsWith(".candidate")
            })
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }
}
