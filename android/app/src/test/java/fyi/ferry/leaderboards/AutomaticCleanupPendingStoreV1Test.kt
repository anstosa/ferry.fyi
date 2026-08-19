package fyi.ferry.leaderboards

import java.io.File
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// verify durable cleanup ownership without raw subject persistence
class AutomaticCleanupPendingStoreV1Test {
    // allow only one concurrent direct caller to own the pending marker
    @Test
    fun concurrentSubjectsCannotReplaceTheFirstOwner() {
        val root = Files.createTempDirectory("automatic-cleanup-concurrent").toFile()
        // attempt the protected operation
        try {
            val store = AutomaticCleanupPendingStoreV1(root, TestAeadV1())
            val start = CountDownLatch(1)
            val results = ConcurrentHashMap<String, Boolean>()
            val subjects = listOf("auth0|first", "auth0|second")
            // build one caller for each competing subject
            val threads = subjects.map { subject ->
                // create one competing direct native caller
                Thread {
                    start.await()
                    results[subject] = store.stage(subject)
                }
            }
            // start every direct caller before releasing the barrier
            for (thread in threads) {
                thread.start()
            }
            start.countDown()
            // wait for every direct caller to settle
            for (thread in threads) {
                thread.join()
            }

            // require exactly one successful owner
            assertEquals(1, results.values.count { staged -> staged })
            // identify the exact persisted winner
            val winner = results.entries.single { entry -> entry.value }.key
            // identify the rejected competing subject
            val loser = subjects.single { subject -> subject != winner }
            assertTrue(store.check(winner).matches)
            assertFalse(store.check(loser).matches)
            assertFalse(store.stage(loser))
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }

    // preserve one exact owner across process replacement and identity purge
    @Test
    fun exactOwnerSurvivesReplacementUntilConfirmedClear() {
        val root = Files.createTempDirectory("automatic-cleanup-pending").toFile()
        // attempt the protected operation
        try {
            val aead = TestAeadV1()
            val first = AutomaticCleanupPendingStoreV1(root, aead)
            val subject = "auth0|private-rider"

            assertTrue(first.stage(subject))
            val ciphertext = File(root, "cleanup-pending-v1.bin").readBytes()
            assertFalse(ciphertext.toString(Charsets.UTF_8).contains(subject))
            assertTrue(first.stage(subject))
            assertTrue(ciphertext.contentEquals(File(root, "cleanup-pending-v1.bin").readBytes()))
            assertFalse(first.stage("auth0|other-rider"))
            assertTrue(ciphertext.contentEquals(File(root, "cleanup-pending-v1.bin").readBytes()))

            val replacement = AutomaticCleanupPendingStoreV1(root, aead)
            assertTrue(replacement.check(subject).matches)
            assertTrue(replacement.check(subject).pending)
            assertTrue(replacement.check(subject).valid)
            assertFalse(replacement.check("auth0|other-rider").matches)
            assertFalse(replacement.clear("auth0|other-rider"))
            assertTrue(replacement.check(subject).pending)
            assertTrue(replacement.clear(subject))
            assertFalse(replacement.check(subject).pending)
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }

    // fail closed when ciphertext or the device key becomes unreadable
    @Test
    fun corruptOrMissingKeyRemainsPendingAndUnverifiable() {
        val root = Files.createTempDirectory("automatic-cleanup-corrupt").toFile()
        // attempt the protected operation
        try {
            val aead = TestAeadV1()
            val store = AutomaticCleanupPendingStoreV1(root, aead)
            val file = File(root, "cleanup-pending-v1.bin")
            assertTrue(store.stage("auth0|private-rider"))
            file.writeBytes(byteArrayOf(1, 2, 3))

            val corrupt = store.check("auth0|private-rider")
            assertTrue(corrupt.pending)
            assertFalse(corrupt.valid)
            assertFalse(corrupt.matches)
            assertFalse(store.clear("auth0|private-rider"))
            val corruptBytes = file.readBytes()
            assertFalse(store.stage("auth0|private-rider"))
            assertTrue(corruptBytes.contentEquals(file.readBytes()))

            assertTrue(file.delete())
            val keyLossAead = TestAeadV1()
            val keyLossStore = AutomaticCleanupPendingStoreV1(root, keyLossAead)
            assertTrue(keyLossStore.stage("auth0|private-rider"))
            val keyLossBytes = file.readBytes()
            assertTrue(keyLossAead.deleteKey())
            val keyLost = keyLossStore.check("auth0|private-rider")
            assertTrue(keyLost.pending)
            assertFalse(keyLost.valid)
            assertFalse(keyLost.matches)
            assertFalse(keyLossStore.stage("auth0|private-rider"))
            assertTrue(keyLossBytes.contentEquals(file.readBytes()))
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }
}
