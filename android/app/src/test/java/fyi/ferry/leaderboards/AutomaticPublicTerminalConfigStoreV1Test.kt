package fyi.ferry.leaderboards

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticPublicTerminalConfigStoreV1Test {
    // create one exact public config generation
    private fun config(generation: Long): AutomaticTerminalConfigGeneration {
        val regions = listOf(
            AutomaticTerminalRegion(
                terminalId = "7",
                latitudeE7 = 476_020_000,
                longitudeE7 = -1_223_390_000,
                radiusMillimeters = 250_000L,
                configGeneration = ConfigGeneration(generation),
            ),
        )
        return AutomaticTerminalConfigGeneration(
            schemaVersion = 1,
            configGeneration = ConfigGeneration(generation),
            serverPolicyGeneration = ServerPolicyGeneration(3L),
            contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
            ),
            regions = regions,
        )
    }

    // preserve crash fallback generations until aggregate activation commits
    @Test
    fun restoresExactGenerationThenPrunesSupersededFiles() {
        val root = Files.createTempDirectory("automatic-public-config").toFile()
        // attempt the protected operation
        try {
            val store = AutomaticPublicTerminalConfigStoreV1(root, 20)
            assertTrue(store.replace(config(1L)))
            assertTrue(store.replace(config(2L)))
            assertEquals(1L, store.read(ConfigGeneration(1L))?.configGeneration?.value)
            assertEquals(2L, store.read(ConfigGeneration(2L))?.configGeneration?.value)

            assertTrue(store.retainOnly(ConfigGeneration(2L)))

            assertNull(store.read(ConfigGeneration(1L)))
            assertEquals(2L, store.read(ConfigGeneration(2L))?.configGeneration?.value)
            assertTrue(store.clear())
            assertNull(store.read(ConfigGeneration(2L)))
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }

    // reject malformed public config before durable exposure
    @Test
    fun rejectsHashMutationAndGenerationMismatch() {
        val root = Files.createTempDirectory("automatic-public-config-invalid").toFile()
        // attempt the protected operation
        try {
            val store = AutomaticPublicTerminalConfigStoreV1(root, 20)
            val mutated = config(2L).copy(contentHashHex = "0".repeat(64))

            assertTrue(!store.replace(mutated))
            assertNull(store.read(ConfigGeneration(2L)))
        // release protected state
        } finally {
            root.deleteRecursively()
        }
    }
}
