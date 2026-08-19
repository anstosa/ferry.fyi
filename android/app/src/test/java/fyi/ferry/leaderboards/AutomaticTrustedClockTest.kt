package fyi.ferry.leaderboards

import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticTrustedClockTest {
    // define the native contract
    private data class TrustedClockVector(
        val name: String,
        val bootIdentity: String,
        val monotonicTimeMs: Long,
        val wallTimeMs: Long,
        val capturedAtMs: Long?,
        val expiryNowMs: Long?,
    )

    private var wallTimeMs = 50_000L
    private var monotonicTimeMs = 10_000L
    private var bootIdentity = "boot-a"

    // build an injected clock
    private fun clock(): AutomaticTrustedClock = AutomaticTrustedClock(
        // run the bounded callback
        wallClockMs = { wallTimeMs },
        // run the bounded callback
        monotonicClockMs = { monotonicTimeMs },
        // run the bounded callback
        bootIdentity = { bootIdentity },
    )

    // match the authoritative shared clock readings
    @Test
    fun trustedClockReadingsMatchSharedFixture() {
        val vectors = listOf(
            TrustedClockVector("same-boot-normal", "boot-a", 15_000, 1_800_000_005_000, 1_720_000_005_000, 1_720_000_005_000),
            TrustedClockVector("wall-rollback", "boot-a", 20_000, 1_799_999_940_000, 1_720_000_010_000, 1_720_000_010_000),
            TrustedClockVector("wall-forward", "boot-a", 15_000, 1_800_000_600_000, 1_720_000_005_000, 1_720_000_600_000),
            TrustedClockVector("frozen-wall", "boot-a", 130_000, 1_800_000_000_000, 1_720_000_120_000, 1_720_000_120_000),
            TrustedClockVector("reboot-without-anchor", "boot-b", 100, 1_800_000_001_000, null, null),
        )

        // evaluate every shared sample from the same anchor
        for (vector in vectors) {
            bootIdentity = "boot-a"
            monotonicTimeMs = 10_000
            wallTimeMs = 1_800_000_000_000
            val clock = clock()
            assertTrue(vector.name, clock.refreshAnchor(serverTimeMs = 1_720_000_000_000))

            bootIdentity = vector.bootIdentity
            monotonicTimeMs = vector.monotonicTimeMs
            wallTimeMs = vector.wallTimeMs
            assertEquals(vector.name, vector.capturedAtMs, clock.capturedAtMs())
            assertEquals(vector.name, vector.expiryNowMs, clock.trustedNowMs())
        }
    }

    // prove capture ignores wall rollback
    @Test
    fun captureUsesServerAnchorAndMonotonicProgress() {
        val clock = clock()
        assertTrue(clock.refreshAnchor(serverTimeMs = 1_000_000L))

        monotonicTimeMs += 5_000L
        wallTimeMs -= 40_000L

        assertEquals(1_005_000L, clock.capturedAtMs())
        assertEquals(1_005_000L, clock.trustedNowMs())
    }

    // prove frozen wall cannot freeze age
    @Test
    fun monotonicProgressAdvancesTrustedTimeWithFrozenWall() {
        val clock = clock()
        assertTrue(clock.refreshAnchor(serverTimeMs = 2_000_000L))

        monotonicTimeMs += 9_000L

        assertEquals(2_009_000L, clock.trustedNowMs())
    }

    // prove wall jumps expire early but do not change capture
    @Test
    fun wallForwardJumpOnlyAdvancesExpiryTime() {
        val clock = clock()
        assertTrue(clock.refreshAnchor(serverTimeMs = 3_000_000L))

        monotonicTimeMs += 123L
        wallTimeMs += AUTOMATIC_CANDIDATE_RETENTION_MS

        assertEquals(3_000_123L, clock.capturedAtMs())
        assertEquals(
            ExpiryEvaluation.Available(expired = true, trustedNowMs = 3_000_000L + AUTOMATIC_CANDIDATE_RETENTION_MS),
            clock.evaluateExpiry(capturedAtMs = 3_000_000L),
        )
    }

    // prove the exact twelve-hour boundary
    @Test
    fun expiryBoundaryIsExact() {
        monotonicTimeMs = 10_000
        wallTimeMs = 1_800_000_000_000
        val clock = clock()
        assertTrue(clock.refreshAnchor(serverTimeMs = 1_720_000_000_000L))

        monotonicTimeMs += AUTOMATIC_CANDIDATE_RETENTION_MS - 1L
        wallTimeMs += AUTOMATIC_CANDIDATE_RETENTION_MS - 1L
        assertEquals(
            ExpiryEvaluation.Available(expired = false, trustedNowMs = 1_720_043_199_999L),
            clock.evaluateExpiry(capturedAtMs = 1_720_000_000_000L),
        )

        monotonicTimeMs += 1L
        wallTimeMs += 1L
        assertEquals(
            ExpiryEvaluation.Available(expired = true, trustedNowMs = 1_720_043_200_000L),
            clock.evaluateExpiry(capturedAtMs = 1_720_000_000_000L),
        )
    }

    // prove reboot requires a new https anchor
    @Test
    fun rebootBlocksUntilServerAnchorRefresh() {
        monotonicTimeMs = 10_000
        wallTimeMs = 1_800_000_000_000
        val clock = clock()
        assertTrue(clock.refreshAnchor(serverTimeMs = 1_720_000_000_000L))
        val capturedAtMs = clock.capturedAtMs()!!

        bootIdentity = "boot-b"
        monotonicTimeMs = 100L

        assertNull(clock.capturedAtMs())
        assertEquals(ExpiryEvaluation.BlockedWithoutSameBootAnchor, clock.evaluateExpiry(capturedAtMs))

        wallTimeMs = 1_800_043_201_000L
        assertTrue(clock.refreshAnchor(serverTimeMs = capturedAtMs + AUTOMATIC_CANDIDATE_RETENTION_MS))
        assertEquals(
            ExpiryEvaluation.Available(
                expired = true,
                trustedNowMs = capturedAtMs + AUTOMATIC_CANDIDATE_RETENTION_MS,
            ),
            clock.evaluateExpiry(capturedAtMs),
        )
    }

    // restore same-boot server time across process restart
    @Test
    fun persistedAnchorSurvivesProcessRestartOnlyOnSameBoot() {
        val directory = Files.createTempDirectory("automatic-trusted-clock").toFile()
        // attempt the protected operation
        try {
            monotonicTimeMs = 10_000L
            wallTimeMs = 50_000L
            bootIdentity = "boot-a"
            val store = AutomaticNoBackupTrustedTimeAnchorStoreV1(directory)
            val first = AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs = { wallTimeMs },
                // run the bounded callback
                monotonicClockMs = { monotonicTimeMs },
                // run the bounded callback
                bootIdentity = { bootIdentity },
                anchorStore = store,
            )
            assertTrue(first.refreshAnchor(1_000_000L))
            monotonicTimeMs += 5_000L
            wallTimeMs -= 30_000L
            val restarted = AutomaticTrustedClock(
                // run the bounded callback
                wallClockMs = { wallTimeMs },
                // run the bounded callback
                monotonicClockMs = { monotonicTimeMs },
                // run the bounded callback
                bootIdentity = { bootIdentity },
                anchorStore = store,
            )
            assertEquals(1_005_000L, restarted.capturedAtMs())
            assertEquals(1_005_000L, restarted.trustedNowMs())

            bootIdentity = "boot-b"
            monotonicTimeMs = 100L
            assertNull(restarted.trustedNowMs())
            assertNull(store.read())
        // release protected state
        } finally {
            directory.deleteRecursively()
        }
    }

    // reject an older response that completes after a newer anchor
    @Test
    fun reversedConcurrentRefreshCannotRegressTrustedTime() {
        monotonicTimeMs = 10_000L
        wallTimeMs = 50_000L
        val clock = clock()
        val newerCommitted = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        // attempt the protected operation
        try {
            val newer = executor.submit<Boolean> {
                val applied = clock.refreshAnchor(2_000_000L)
                newerCommitted.countDown()
                applied
            }
            val older = executor.submit<Boolean> {
                assertTrue(newerCommitted.await(5, TimeUnit.SECONDS))
                clock.refreshAnchor(1_900_000L)
            }

            assertTrue(newer.get(5, TimeUnit.SECONDS))
            assertEquals(false, older.get(5, TimeUnit.SECONDS))
            assertEquals(2_000_000L, clock.trustedNowMs())
        // release protected state
        } finally {
            executor.shutdownNow()
        }
    }
}
