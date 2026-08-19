package fyi.ferry.leaderboards

import androidx.work.ExistingWorkPolicy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticCandidateUploadSchedulerV1Test {
    // append callback successors without cancelling in-flight location work
    @Test
    fun geofenceWakePolicySerializesSuccessors() {
        assertEquals(ExistingWorkPolicy.APPEND_OR_REPLACE, AUTOMATIC_GEOFENCE_EXISTING_WORK_POLICY_V1)
    }

    // prevent overlapping workers from acquiring two fixes for one callback
    @Test
    fun geofenceDrainGateAllowsOnlyOneInFlightOperation() {
        val gate = AutomaticGeofenceCallbackDrainGateV1()
        val firstEntered = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val secondEntered = CountDownLatch(1)
        val entries = AtomicInteger(0)
        val executor = Executors.newFixedThreadPool(2)
        // attempt the protected operation
        try {
            val first = executor.submit {
                // run the bounded callback
                gate.run {
                    entries.incrementAndGet()
                    firstEntered.countDown()
                    assertTrue(releaseFirst.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue(firstEntered.await(5, TimeUnit.SECONDS))
            val second = executor.submit {
                // run the bounded callback
                gate.run {
                    entries.incrementAndGet()
                    secondEntered.countDown()
                }
            }

            assertFalse(secondEntered.await(100, TimeUnit.MILLISECONDS))
            assertEquals(1, entries.get())
            releaseFirst.countDown()
            first.get(5, TimeUnit.SECONDS)
            second.get(5, TimeUnit.SECONDS)
            assertEquals(2, entries.get())
        // release protected state
        } finally {
            releaseFirst.countDown()
            executor.shutdownNow()
        }
    }

    // create one terminal candidate
    private fun terminal(candidateId: String, capturedAtMs: Long, terminalId: String) =
        AutomaticCheckinCandidateV1.Terminal(
            accuracyMillimeters = 1_000,
            candidateId = candidateId,
            capturedAtMs = capturedAtMs,
            latitudeE7 = 0,
            longitudeE7 = 0,
            terminalId = terminalId,
            configGeneration = 1,
        )

    // create independent vessel work
    private fun vessel(candidateId: String, capturedAtMs: Long) =
        AutomaticCheckinCandidateV1.Vessel(
            accuracyMillimeters = 1_000,
            candidateId = candidateId,
            capturedAtMs = capturedAtMs,
            latitudeE7 = 0,
            longitudeE7 = 0,
            vesselId = "1",
            sailingId = "1:$capturedAtMs",
        )

    // select equal-time terminal work by opaque id
    @Test
    fun selectsOldestTerminalHeadByCaptureTimeAndCandidateId() {
        val oldestById = terminal("AAAAAAAAAAAAAAAAAAAAAA", 1_000, "7")
        val laterId = terminal("AAECAwQFBgcICQoLDA0ODw", 1_000, "7")
        val laterTime = terminal("EBESExQVFhcYGRobHB0eHw", 1_001, "7")

        assertEquals(
            listOf(oldestById),
            AutomaticCandidateUploadSchedulerV1.selectHeads(listOf(laterTime, laterId, oldestById)),
        )
    }

    // keep retryable blocking local to one terminal
    @Test
    fun retryableHeadDoesNotBlockOtherTerminalOrVesselWork() {
        val retryableHead = terminal("AAAAAAAAAAAAAAAAAAAAAA", 1_000, "7")
        val vessel = vessel("AAECAwQFBgcICQoLDA0ODw", 2_000)
        val otherTerminal = terminal("EBESExQVFhcYGRobHB0eHw", 3_000, "8")
        val newerSameTerminal = terminal("_____________________w", 4_000, "7")
        val queued = listOf(newerSameTerminal, otherTerminal, retryableHead, vessel)
        val afterRetryable = queued.toList()
        // run the bounded callback
        val afterFinal = queued.filterNot {
            // remove only the finalized head
            it == retryableHead
        }

        assertEquals(
            listOf(retryableHead, vessel, otherTerminal),
            AutomaticCandidateUploadSchedulerV1.selectHeads(queued),
        )
        assertEquals(
            listOf(retryableHead, vessel, otherTerminal),
            AutomaticCandidateUploadSchedulerV1.selectHeads(afterRetryable),
        )
        assertEquals(
            listOf(vessel, otherTerminal, newerSameTerminal),
            AutomaticCandidateUploadSchedulerV1.selectHeads(afterFinal),
        )
    }
}
