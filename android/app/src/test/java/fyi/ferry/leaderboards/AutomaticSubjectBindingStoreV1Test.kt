package fyi.ferry.leaderboards

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// verify device-only subject ownership without raw identity persistence
class AutomaticSubjectBindingStoreV1Test {
    // preserve only the same subject and credential across process replacement
    @Test
    fun sameSubjectMatchesWithoutRawPersistence() {
        val root = Files.createTempDirectory("automatic-subject-binding").toFile()
        // attempt the protected operation
        try {
            val installation = AutomaticInstallationBindingStoreV1(root)
            assertTrue(installation.getOrCreate() != null)
            val first = AutomaticSubjectBindingStoreV1(root, installation)
            val subject = "auth0|private-rider"
            val enrollmentId = "123e4567-e89b-42d3-a456-426614174000"

            assertTrue(first.bind(subject, enrollmentId))
            assertTrue(first.check(subject, enrollmentId).matches)
            assertFalse(first.check("auth0|other-rider", enrollmentId).matches)
            assertFalse(first.check(subject, "223e4567-e89b-42d3-a456-426614174000").matches)
            val persisted = File(root, "subject-binding-v1.bin").readBytes()
            assertFalse(persisted.toString(Charsets.UTF_8).contains(subject))

            val replacement = AutomaticSubjectBindingStoreV1(root, installation)
            assertTrue(replacement.check(subject, enrollmentId).matches)
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }

    // fail closed for corrupt and explicitly cleared owner state
    @Test
    fun corruptBindingNeverMatchesAndClearRemovesOwnership() {
        val root = Files.createTempDirectory("automatic-subject-binding-corrupt").toFile()
        // attempt the protected operation
        try {
            val installation = AutomaticInstallationBindingStoreV1(root)
            assertTrue(installation.getOrCreate() != null)
            val store = AutomaticSubjectBindingStoreV1(root, installation)
            val file = File(root, "subject-binding-v1.bin")
            file.writeBytes(byteArrayOf(1, 2, 3))

            val corrupt = store.check(
                "auth0|private-rider",
                "123e4567-e89b-42d3-a456-426614174000",
            )
            assertTrue(corrupt.bound)
            assertFalse(corrupt.matches)
            assertTrue(store.clear())
            val cleared = store.check(
                "auth0|private-rider",
                "123e4567-e89b-42d3-a456-426614174000",
            )
            assertFalse(cleared.bound)
            assertFalse(cleared.matches)
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }
}
