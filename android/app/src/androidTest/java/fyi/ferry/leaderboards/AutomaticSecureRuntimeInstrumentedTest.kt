package fyi.ferry.leaderboards

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.WorkManager
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
// define the native contract
class AutomaticSecureRuntimeInstrumentedTest {
    // define the native contract
    private class InertRegionStager : TerminalRegionGenerationStager {
        // reject test registration without touching play services
        override fun stage(config: AutomaticTerminalConfigGeneration): Boolean = false

        // expose no staged region identity
        override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> = emptySet()

        // reject test registration commit
        override fun commit(configGeneration: ConfigGeneration): Boolean = false

        // discard no external test state
        override fun discard(configGeneration: ConfigGeneration) = Unit
    }

    // define the native contract
    private class SuccessfulStopPort : AutomaticStopPortV1 {
        var regionStops = 0
        var workStops = 0
        var requestStops = 0

        // record owned region convergence
        override fun unregisterRegions(): Boolean {
            regionStops += 1
            return true
        }

        // record owned work convergence
        override fun cancelScheduledWork(): Boolean {
            workStops += 1
            return true
        }

        // record network convergence
        override fun cancelNetworkRequests(): Boolean {
            requestStops += 1
            return true
        }
    }

    // exercise non-exportable android-keystore gcm and tamper rejection
    @Test
    fun androidKeystoreKeyIsNonExportableAndRejectsTamperingOrDeletion() {
        val aead = AutomaticAndroidKeystoreAeadV1("ferry-fyi-test-${UUID.randomUUID()}")
        val plaintext = "sensitive-test-payload".toByteArray()
        val associatedData = "installation-binding".toByteArray()
        // attempt the protected operation
        try {
            val box = aead.seal(plaintext, associatedData)
            assertNotNull(box)
            assertTrue(aead.isNonExportable())
            assertEquals(plaintext.toList(), aead.open(box!!, associatedData)?.toList())

            // run the bounded callback
            val tampered = box.copy(ciphertext = box.ciphertext.copyOf().also { bytes ->
                bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            })
            assertNull(aead.open(tampered, associatedData))
            assertTrue(aead.deleteKey())
            assertNull(aead.open(box, associatedData))
        // release protected state
        } finally {
            plaintext.fill(0)
            associatedData.fill(0)
            aead.deleteKey()
        }
    }

    // quarantine healthy state after sentinel ciphertext or key loss
    @Test
    fun physicalIdentityLossAdvancesGenerationAndPurgesAcrossReplacement() {
        val cases = listOf("missing-sentinel", "corrupt-credential", "missing-key")
        // isolate each physical identity inconsistency with real keystore keys
        for (case in cases) {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val root = File(context.noBackupFilesDir, "automatic-instrumentation-${UUID.randomUUID()}")
            val credentialAead = AutomaticAndroidKeystoreAeadV1("ferry-fyi-test-credential-${UUID.randomUUID()}")
            val queueAead = AutomaticAndroidKeystoreAeadV1("ferry-fyi-test-queue-${UUID.randomUUID()}")
            // attempt the protected operation
            try {
                val bindingStore = AutomaticInstallationBindingStoreV1(root)
                val credentialStore = AutomaticCredentialStoreV1(root, bindingStore, credentialAead)
                val queue = AutomaticEncryptedCandidateQueueV1(
                    directory = File(root, "candidates"),
                    bindingStore = bindingStore,
                    aead = queueAead,
                    // run the bounded callback
                    evaluateExpiry = { capturedAtMs ->
                        ExpiryEvaluation.Available(expired = false, trustedNowMs = capturedAtMs)
                    },
                    // run the bounded callback
                    maxPendingCandidates = { 8 },
                )
                val stateStore = AutomaticNativeRuntimeStateStoreV1(root)
                val activator = AutomaticTerminalConfigActivator(InertRegionStager(), 20)
                val stopPort = SuccessfulStopPort()
                bindingStore.beginEnrollmentBootstrap()
                val bootstrap = bindingStore.consumeEnrollmentBootstrap()
                assertNotNull(case, bootstrap)
                val credential = instrumentedCredential()
                // attempt the protected operation
                try {
                    assertTrue(case, credentialStore.replace(credential, bootstrap!!))
                // release protected state
                } finally {
                    credential.wipe()
                    bootstrap?.wipe()
                }
                assertTrue(
                    case,
                    stateStore.replace(
                        AutomaticNativeRuntimeStatusV1(
                            configGeneration = ConfigGeneration(4L),
                            serverPolicyGeneration = ServerPolicyGeneration(8L),
                            localWorkGeneration = LocalWorkGeneration(6L),
                            configurationUsable = true,
                            monitorHealth = AutomaticMonitorHealthV1.HEALTHY,
                            permissionHealth = AutomaticPermissionHealthV1.AUTHORIZED,
                            lastOutcome = null,
                        ),
                    ),
                )
                // corrupt exactly one device-only identity surface
                when (case) {
                    "missing-sentinel" -> File(root, "installation-v1.bin").delete()
                    "corrupt-credential" -> File(root, "credential-v1.bin").writeBytes(byteArrayOf(1, 2, 3))
                    "missing-key" -> credentialAead.deleteKey()
                }

                val replacement = AutomaticCheckinPolicyCoordinatorV1(
                    sdkInt = android.os.Build.VERSION.SDK_INT,
                    stateStore = stateStore,
                    configActivator = activator,
                    queue = queue,
                    credentialStore = credentialStore,
                    bindingStore = bindingStore,
                    stopPort = stopPort,
                )

                assertEquals(case, AutomaticMonitorHealthV1.STOPPED, replacement.status().monitorHealth)
                assertEquals(case, 7L, replacement.localWorkGeneration().value)
                assertFalse(case, replacement.status().configurationUsable)
                assertNull(case, credentialStore.read())
                assertNull(case, bindingStore.read())
                assertEquals(case, 1, stopPort.regionStops)
                assertEquals(case, 1, stopPort.workStops)
                assertEquals(case, 1, stopPort.requestStops)
            // release protected state
            } finally {
                credentialAead.deleteKey()
                queueAead.deleteKey()
                root.deleteRecursively()
            }
        }
    }

    // prove workmanager accepts an owned request with no serialized input
    @Test
    fun zeroDataWorkRequestIsAcceptedAndRemainsMetadataFree() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val workManager = WorkManager.getInstance(context)
        val request = AutomaticZeroDataWorkRequestFactoryV1.create()
        val uniqueName = "automatic-instrumentation-${UUID.randomUUID()}"
        // attempt the protected operation
        try {
            val operation = workManager.enqueueUniqueWork(
                uniqueName,
                androidx.work.ExistingWorkPolicy.REPLACE,
                request,
            )
            operation.result.get(5L, TimeUnit.SECONDS)

            val accepted = workManager.getWorkInfoById(request.id).get(5L, TimeUnit.SECONDS)
            assertNotNull(accepted)
            assertTrue(request.workSpec.input.size() == 0)
        // release protected state
        } finally {
            workManager.cancelUniqueWork(uniqueName).result.get(5L, TimeUnit.SECONDS)
        }
    }

    // build one canonical device credential for secure-store instrumentation
    private fun instrumentedCredential(): AutomaticCredentialV1 = AutomaticCredentialV1(
        bearerToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".toByteArray(),
        enrollmentId = "00000000-0000-4000-8000-000000000001",
        expiresAtMs = 100_000_000L,
        rotateAfterMs = 90_000_000L,
        serverPolicyGeneration = ServerPolicyGeneration(8L),
        urls = AutomaticNativeEndpointUrls(
            config = "https://ferry.fyi/api/leaderboards/native/config",
            status = "https://ferry.fyi/api/leaderboards/native/status",
            candidates = "https://ferry.fyi/api/leaderboards/native/candidates",
            enrollment = "https://ferry.fyi/api/leaderboards/native/enrollment",
        ),
    )
}
