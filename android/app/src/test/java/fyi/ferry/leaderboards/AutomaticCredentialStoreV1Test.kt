package fyi.ferry.leaderboards

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticCredentialStoreV1Test {
    // stop exactly at trusted expiry and preserve it across process replacement
    @Test
    fun trustedCredentialExpiryPurgesEmptyQueueAcrossRestart() {
        val runtime = testSecureRuntime({ 100_000_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            assertNull(
                AutomaticCredentialExpiryGateV1.stopIfExpired(
                    runtime.credentialStore,
                    99_999_999L,
                    runtime.coordinator,
                ),
            )
            assertEquals(
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
                AutomaticCredentialExpiryGateV1.stopIfExpired(
                    runtime.credentialStore,
                    100_000_000L,
                    runtime.coordinator,
                ),
            )
            assertNull(runtime.credentialStore.read())
            assertNull(runtime.bindingStore.read())
            val replacement = AutomaticCheckinPolicyCoordinatorV1(
                sdkInt = 35,
                stateStore = runtime.stateStore,
                configActivator = AutomaticTerminalConfigActivator(TestRegionStagerV1(), 20),
                queue = runtime.queue,
                credentialStore = runtime.credentialStore,
                bindingStore = runtime.bindingStore,
                stopPort = TestStopPortV1(),
            )
            assertEquals(AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
            assertEquals("enrollment_expired", replacement.status().lastOutcome)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // require one pending bootstrap and consume it once
    @Test
    fun credentialInstallationConsumesOnePriorBootstrap() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertNull(runtime.bindingStore.consumeEnrollmentBootstrap())
            assertNotNull(runtime.bindingStore.beginEnrollmentBootstrap())
            val bootstrap = runtime.bindingStore.consumeEnrollmentBootstrap()!!
            assertNull(runtime.bindingStore.consumeEnrollmentBootstrap())
            assertTrue(runtime.credentialStore.replace(testCredential(), bootstrap))
            assertFalse(runtime.credentialStore.replace(testCredential(policyGeneration = 2L), bootstrap))
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // reject a bootstrap lease transferred across installations
    @Test
    fun credentialCannotUseAnotherInstallationsBootstrap() {
        val first = testSecureRuntime({ 2_000L })
        val second = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertNotNull(first.bindingStore.beginEnrollmentBootstrap())
            val firstBootstrap = first.bindingStore.consumeEnrollmentBootstrap()!!
            val transferredCredential = testCredential()

            assertFalse(second.credentialStore.replace(transferredCredential, firstBootstrap))
            assertNull(second.credentialStore.read())
            assertNull(second.bindingStore.consumeEnrollmentBootstrap())
            transferredCredential.wipe()
        // release protected state
        } finally {
            first.root.deleteRecursively()
            second.root.deleteRecursively()
        }
    }

    // persist only encrypted bearer material under a non-exportable key
    @Test
    fun credentialIsEncryptedAndDeviceBound() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val credential = testCredential()
            val expectedToken = credential.bearerToken.copyOf()
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, credential))
            assertTrue(runtime.credentialStore.keyIsNonExportable())
            val disk = runtime.root.walkTopDown()
                // run the bounded callback
                .filter { file -> file.isFile }
                // run the bounded callback
                .flatMap { file -> file.readBytes().asSequence() }
                .toList()
                .toByteArray()
                .toString(Charsets.ISO_8859_1)
            assertFalse(disk.contains(expectedToken.toString(Charsets.US_ASCII)))
            val restored = runtime.credentialStore.read()!!
            assertArrayEquals(expectedToken, restored.bearerToken)
            restored.wipe()
            runtime.bindingStore.clear()
            runtime.bindingStore.getOrCreate()
            assertNull(runtime.credentialStore.read())
            expectedToken.fill(0)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // replace credentials without retaining predecessor plaintext
    @Test
    fun rotationAtomicallyReplacesCredential() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            val first = testCredential()
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, first))
            val second = testCredential(policyGeneration = 4L).copy(
                bearerToken = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE".toByteArray(),
                expiresAtMs = 200_000_000L,
                rotateAfterMs = 190_000_000L,
            )
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, second))
            val restored = runtime.credentialStore.read()!!
            assertEquals(4L, restored.serverPolicyGeneration.value)
            assertArrayEquals(second.bearerToken, restored.bearerToken)
            restored.wipe()
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }

    // identity-ending clear deletes both ciphertext and device key
    @Test
    fun clearDeletesCiphertextAndKeyIdempotently() {
        val runtime = testSecureRuntime({ 2_000L })
        // attempt the protected operation
        try {
            assertTrue(runtime.credentialStore.replaceForTest(runtime.bindingStore, testCredential()))
            assertTrue(runtime.credentialStore.clear())
            assertNull(runtime.credentialStore.read())
            assertEquals(1, runtime.credentialAead.deleteCount)
            assertTrue(runtime.credentialStore.clear())
            assertEquals(2, runtime.credentialAead.deleteCount)
        // release protected state
        } finally {
            runtime.root.deleteRecursively()
        }
    }
}
