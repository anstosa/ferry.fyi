package fyi.ferry.leaderboards

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticEncryptedGeofenceCallbackInboxV1Test {
    // build one encrypted callback inbox around shared test key material
    private fun inbox(root: File, binding: AutomaticInstallationBindingStoreV1, aead: TestAeadV1) =
        AutomaticEncryptedGeofenceCallbackInboxV1(File(root, "callbacks"), binding, aead)

    // create one exact generation-bound callback
    private fun callback(terminalId: String = "7") = AutomaticGeofenceCallbackV1(
        terminalId = terminalId,
        configGeneration = ConfigGeneration(4L),
        localWorkGeneration = LocalWorkGeneration(3L),
        transition = AutomaticGeofenceTransitionV1.EXIT,
    )

    // restore one callback across process replacement until completion
    @Test
    fun encryptedCallbackSurvivesProcessReplacementUntilExplicitCompletion() {
        val root = Files.createTempDirectory("automatic-callback-inbox").toFile()
        // attempt the protected operation
        try {
            val binding = AutomaticInstallationBindingStoreV1(root)
            binding.getOrCreate()
            val aead = TestAeadV1()
            val first = inbox(root, binding, aead)
            assertTrue(first.enqueue(callback()))
            val stored = first.next()
            assertNotNull(stored)

            val replacement = inbox(root, binding, aead)
            assertEquals(callback(), replacement.next()?.callback)
            assertTrue(replacement.delete(stored!!.recordKey))
            assertEquals(0, replacement.pendingCount())
            assertNull(replacement.next())
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }

    // delete corrupt oldest ciphertext before advancing to later valid work
    @Test
    fun corruptOldestDoesNotBlockLaterAuthenticatedCallback() {
        val root = Files.createTempDirectory("automatic-callback-corrupt").toFile()
        // attempt the protected operation
        try {
            val binding = AutomaticInstallationBindingStoreV1(root)
            binding.getOrCreate()
            val aead = TestAeadV1()
            val subject = inbox(root, binding, aead)
            assertTrue(subject.enqueue(callback("7")))
            Thread.sleep(5L)
            assertTrue(subject.enqueue(callback("8")))
            val files = File(root, "callbacks").listFiles { file -> file.name.endsWith(".callback") }
                .orEmpty()
                .sortedWith(compareBy<File>({ file -> file.lastModified() }, File::getName))
            files.first().writeBytes(byteArrayOf(1, 2, 3))
            files.first().setLastModified(1L)

            val recovered = subject.next()

            assertEquals("8", recovered?.callback?.terminalId)
            assertEquals(1, subject.pendingCount())
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }
}
