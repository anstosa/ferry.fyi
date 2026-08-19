package fyi.ferry.leaderboards

import java.io.File
import java.nio.file.Files
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// define the native contract
internal class TestAeadV1(
    private var key: SecretKey? = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey(),
    private val random: SecureRandom = SecureRandom(),
) : AutomaticAeadV1 {
    val nonces = mutableListOf<ByteArray>()
    var deleteCount = 0

    // seal test plaintext with real aes-gcm
    override fun seal(plaintext: ByteArray, associatedData: ByteArray): AutomaticAeadSealedBox? {
        val currentKey = key ?: return null
        val nonce = ByteArray(AUTOMATIC_AEAD_NONCE_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, currentKey, GCMParameterSpec(128, nonce))
        cipher.updateAAD(associatedData)
        nonces += nonce.copyOf()
        return AutomaticAeadSealedBox(nonce, cipher.doFinal(plaintext))
    }

    // reject test tampering with real aes-gcm
    override fun open(box: AutomaticAeadSealedBox, associatedData: ByteArray): ByteArray? = try {
        val currentKey = key ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, currentKey, GCMParameterSpec(128, box.nonce))
        cipher.updateAAD(associatedData)
        cipher.doFinal(box.ciphertext)
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // delete only the test device key
    override fun deleteKey(): Boolean {
        deleteCount += 1
        key = null
        return true
    }

    // model non-exportable platform keys
    override fun isNonExportable(): Boolean = true
}

// define the native contract
internal class TestAtomicFileOpsV1 : AutomaticAtomicFileOpsV1 {
    var failDelete = false
    var failReplace = false
    var failReplaceName: String? = null

    // replace test ciphertext atomically enough for deterministic tests
    override fun replace(destination: File, bytes: ByteArray): Boolean {
        // inject one replacement failure
        if (failReplace || destination.name == failReplaceName) {
            return false
        }
        destination.parentFile?.mkdirs()
        destination.writeBytes(bytes)
        return true
    }

    // delete or inject final cleanup failure
    override fun delete(destination: File): Boolean {
        // match production idempotence for already absent records
        if (!destination.exists()) {
            return true
        }
        // preserve the active record on injected failure
        if (failDelete) {
            return false
        }
        return destination.delete() || !destination.exists()
    }

    // delete inactive test tombstones
    override fun deleteTombstone(tombstone: File): Boolean = tombstone.delete() || !tombstone.exists()
}

// define the native contract
internal class TestRegionStagerV1 : TerminalRegionGenerationStager, AutomaticLocalGenerationRegionStagerV1 {
    val staged = mutableMapOf<ConfigGeneration, Set<String>>()
    val stagedLocalGenerations = mutableMapOf<ConfigGeneration, LocalWorkGeneration>()
    var discarded = 0

    // stage one exact test generation
    override fun stage(config: AutomaticTerminalConfigGeneration): Boolean {
        // run the bounded callback
        staged[config.configGeneration] = config.regions.map { region -> region.terminalId }.toSet()
        return true
    }

    // stage one test generation under the exact callback generation
    override fun stage(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean {
        val stored = stage(config)
        // expose callback identity only after successful staging
        if (stored) {
            stagedLocalGenerations[config.configGeneration] = localWorkGeneration
        }
        return stored
    }

    // return one staged terminal set
    override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> = staged[configGeneration].orEmpty()

    // commit an existing test generation
    override fun commit(configGeneration: ConfigGeneration): Boolean = staged.containsKey(configGeneration)

    // discard one test generation
    override fun discard(configGeneration: ConfigGeneration) {
        staged.remove(configGeneration)
        stagedLocalGenerations.remove(configGeneration)
        discarded += 1
    }
}

// define the native contract
internal class FailingRegionStagerV1 : TerminalRegionGenerationStager {
    // reject every simulated platform registration
    override fun stage(config: AutomaticTerminalConfigGeneration): Boolean = false

    // expose no staged terminals after failure
    override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> = emptySet()

    // reject every simulated platform commit
    override fun commit(configGeneration: ConfigGeneration): Boolean = false

    // keep failed staging cleanup idempotent
    override fun discard(configGeneration: ConfigGeneration) = Unit
}

// define the native contract
internal class TestStopPortV1 : AutomaticStopPortV1 {
    var regions = 0
    var work = 0
    var requests = 0
    var regionsSucceed = true
    var workSucceeds = true
    var requestsSucceed = true

    // count owned region cancellation
    override fun unregisterRegions(): Boolean {
        regions += 1
        return regionsSucceed
    }

    // count zero-data work cancellation
    override fun cancelScheduledWork(): Boolean {
        work += 1
        return workSucceeds
    }

    // count request cancellation
    override fun cancelNetworkRequests(): Boolean {
        requests += 1
        return requestsSucceed
    }
}

// define the native contract
internal data class TestSecureRuntimeV1(
    val root: File,
    val bindingStore: AutomaticInstallationBindingStoreV1,
    val credentialAead: TestAeadV1,
    val credentialStore: AutomaticCredentialStoreV1,
    val queueAead: TestAeadV1,
    val queue: AutomaticEncryptedCandidateQueueV1,
    val stateStore: AutomaticNativeRuntimeStateStoreV1,
    val configActivator: AutomaticTerminalConfigActivator,
    val stopPort: TestStopPortV1,
    val coordinator: AutomaticCheckinPolicyCoordinatorV1,
)

// persist one test credential against the current installation
internal fun AutomaticCredentialStoreV1.replaceForTest(
    bindingStore: AutomaticInstallationBindingStoreV1,
    credential: AutomaticCredentialV1,
): Boolean {
    bindingStore.beginEnrollmentBootstrap() ?: return false
    val bootstrap = bindingStore.consumeEnrollmentBootstrap() ?: return false
    return try {
        replace(credential, bootstrap)
    // release protected state
    } finally {
        bootstrap.wipe()
    }
}

// build one isolated secure runtime
internal fun testSecureRuntime(
    trustedNowMs: () -> Long?,
    // run the bounded callback
    capacity: () -> Int = { 8 },
    fileOps: AutomaticAtomicFileOpsV1 = TestAtomicFileOpsV1(),
    stager: TerminalRegionGenerationStager = TestRegionStagerV1(),
): TestSecureRuntimeV1 {
    val root = Files.createTempDirectory("automatic-secure-runtime").toFile()
    val binding = AutomaticInstallationBindingStoreV1(root, fileOps = fileOps)
    binding.getOrCreate()
    val credentialAead = TestAeadV1()
    val credentialStore = AutomaticCredentialStoreV1(root, binding, credentialAead, fileOps)
    val queueAead = TestAeadV1()
    val queue = AutomaticEncryptedCandidateQueueV1(
        directory = File(root, "candidates"),
        bindingStore = binding,
        aead = queueAead,
        // run the bounded callback
        evaluateExpiry = { capturedAtMs ->
            val now = trustedNowMs()
            // block when the test clock is untrusted
            if (now == null) {
                ExpiryEvaluation.BlockedWithoutSameBootAnchor
            // branch on the current state
            } else {
                ExpiryEvaluation.Available(
                    expired = now >= capturedAtMs && now - capturedAtMs >= AUTOMATIC_CANDIDATE_RETENTION_MS,
                    trustedNowMs = now,
                )
            }
        },
        maxPendingCandidates = capacity,
        fileOps = fileOps,
    )
    val stateStore = AutomaticNativeRuntimeStateStoreV1(root, fileOps)
    val activator = AutomaticTerminalConfigActivator(stager, 20)
    val stopPort = TestStopPortV1()
    val coordinator = AutomaticCheckinPolicyCoordinatorV1(
        sdkInt = 35,
        stateStore = stateStore,
        configActivator = activator,
        queue = queue,
        credentialStore = credentialStore,
        bindingStore = binding,
        stopPort = stopPort,
    )
    return TestSecureRuntimeV1(
        root,
        binding,
        credentialAead,
        credentialStore,
        queueAead,
        queue,
        stateStore,
        activator,
        stopPort,
        coordinator,
    )
}

// create one canonical terminal candidate
internal fun testTerminalCandidate(
    candidateId: String = "AAECAwQFBgcICQoLDA0ODw",
    capturedAtMs: Long = 1_000L,
    terminalId: String = "7",
): AutomaticCheckinCandidateV1.Terminal = AutomaticCheckinCandidateV1.Terminal(
    accuracyMillimeters = 1_000L,
    candidateId = candidateId,
    capturedAtMs = capturedAtMs,
    latitudeE7 = 476_020_000,
    longitudeE7 = -1_223_390_000,
    terminalId = terminalId,
    configGeneration = 1L,
)

// create one fixed valid credential
internal fun testCredential(policyGeneration: Long = 0L): AutomaticCredentialV1 = AutomaticCredentialV1(
    bearerToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".toByteArray(),
    enrollmentId = "00000000-0000-4000-8000-000000000001",
    expiresAtMs = 100_000_000L,
    rotateAfterMs = 90_000_000L,
    serverPolicyGeneration = ServerPolicyGeneration(policyGeneration),
    urls = AutomaticNativeEndpointUrls(
        config = "https://ferry.fyi/api/leaderboards/native/config",
        status = "https://ferry.fyi/api/leaderboards/native/status",
        candidates = "https://ferry.fyi/api/leaderboards/native/candidates",
        enrollment = "https://ferry.fyi/api/leaderboards/native/enrollment",
    ),
)
