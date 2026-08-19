package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import kotlin.math.max

internal const val AUTOMATIC_CANDIDATE_RETENTION_MS = 12L * 60L * 60L * 1_000L
private const val AUTOMATIC_MAX_SAFE_INTEGER = 9_007_199_254_740_991L

// define the native contract
internal data class TrustedTimeAnchor(
    val bootIdentity: String,
    val monotonicTimeMs: Long,
    val serverTimeMs: Long,
    val wallTimeMs: Long,
)

// define the native contract
internal sealed interface ExpiryEvaluation {
    // define the native contract
    data object BlockedWithoutSameBootAnchor : ExpiryEvaluation
    // define the native contract
    data class Available(val expired: Boolean, val trustedNowMs: Long) : ExpiryEvaluation
}

// define the native contract
internal interface AutomaticTrustedTimeAnchorStoreV1 {
    // read one persisted server-time anchor
    fun read(): TrustedTimeAnchor?

    // replace one server-time anchor atomically
    fun replace(anchor: TrustedTimeAnchor): Boolean

    // delete an unusable anchor
    fun clear(): Boolean
}

// define the native contract
internal object AutomaticMemorylessTrustedTimeAnchorStoreV1 : AutomaticTrustedTimeAnchorStoreV1 {
    // expose no persisted anchor
    override fun read(): TrustedTimeAnchor? = null

    // accept in-memory-only test anchors
    override fun replace(anchor: TrustedTimeAnchor): Boolean = true

    // preserve empty storage
    override fun clear(): Boolean = true
}

// define the native contract
internal class AutomaticNoBackupTrustedTimeAnchorStoreV1(
    directory: File,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) : AutomaticTrustedTimeAnchorStoreV1 {
    private val anchorFile = File(directory, "trusted-time-v1.bin")

    // restore one exact persisted anchor
    override fun read(): TrustedTimeAnchor? = try {
        // run the bounded callback
        DataInputStream(ByteArrayInputStream(anchorFile.readBytes())).use { input ->
            // require the fixed anchor schema
            if (input.readInt() != 1) {
                return null
            }
            val anchor = TrustedTimeAnchor(
                bootIdentity = input.readUTF(),
                monotonicTimeMs = input.readLong(),
                serverTimeMs = input.readLong(),
                wallTimeMs = input.readLong(),
            )
            // reject invalid or trailing anchor data
            if (
                anchor.bootIdentity.isEmpty() ||
                anchor.monotonicTimeMs < 0L ||
                anchor.serverTimeMs !in 0..AUTOMATIC_MAX_SAFE_INTEGER ||
                input.available() != 0
            ) {
                return null
            }
            anchor
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // atomically store public server-time state
    override fun replace(anchor: TrustedTimeAnchor): Boolean {
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(1)
            output.writeUTF(anchor.bootIdentity)
            output.writeLong(anchor.monotonicTimeMs)
            output.writeLong(anchor.serverTimeMs)
            output.writeLong(anchor.wallTimeMs)
            output.flush()
        }
        return fileOps.replace(anchorFile, bytes.toByteArray())
    }

    // remove the stale server-time anchor
    override fun clear(): Boolean = fileOps.delete(anchorFile)
}

// define the native contract
internal class AutomaticTrustedClock(
    private val wallClockMs: () -> Long,
    private val monotonicClockMs: () -> Long,
    private val bootIdentity: () -> String,
    private val anchorStore: AutomaticTrustedTimeAnchorStoreV1 = AutomaticMemorylessTrustedTimeAnchorStoreV1,
) {
    private var anchor: TrustedTimeAnchor? = anchorStore.read()

    // replace the https server anchor
    @Synchronized
    fun refreshAnchor(serverTimeMs: Long): Boolean {
        val currentBootIdentity = bootIdentity()
        val currentMonotonicTimeMs = monotonicClockMs()

        // reject unusable anchors
        if (serverTimeMs !in 0..AUTOMATIC_MAX_SAFE_INTEGER || currentBootIdentity.isEmpty() || currentMonotonicTimeMs < 0) {
            return false
        }

        val currentAnchor = anchor
        // reject same-boot time regression from delayed responses
        if (currentAnchor != null && currentAnchor.bootIdentity == currentBootIdentity) {
            val monotonicElapsedMs = monotonicElapsed(currentAnchor) ?: return false
            val wallElapsedMs = nonNegativeElapsed(wallClockMs(), currentAnchor.wallTimeMs)
            val currentTrustedNowMs = addWithoutOverflow(
                currentAnchor.serverTimeMs,
                max(monotonicElapsedMs, wallElapsedMs),
            ) ?: return false
            // preserve the most conservative committed time
            if (serverTimeMs < currentTrustedNowMs) {
                return false
            }
        }

        val nextAnchor = TrustedTimeAnchor(
            bootIdentity = currentBootIdentity,
            monotonicTimeMs = currentMonotonicTimeMs,
            serverTimeMs = serverTimeMs,
            wallTimeMs = wallClockMs(),
        )
        // expose the anchor only after durable replacement
        if (!anchorStore.replace(nextAnchor)) {
            return false
        }
        anchor = nextAnchor
        return true
    }

    // derive capture time from monotonic progress only
    @Synchronized
    fun capturedAtMs(): Long? {
        val currentAnchor = sameBootAnchor() ?: return null
        val monotonicElapsedMs = monotonicElapsed(currentAnchor) ?: return null
        return addWithoutOverflow(currentAnchor.serverTimeMs, monotonicElapsedMs)
    }

    // derive conservative trusted time
    @Synchronized
    fun trustedNowMs(): Long? {
        val currentAnchor = sameBootAnchor() ?: return null
        val monotonicElapsedMs = monotonicElapsed(currentAnchor) ?: return null
        val wallElapsedMs = nonNegativeElapsed(wallClockMs(), currentAnchor.wallTimeMs)
        val trustedElapsedMs = max(monotonicElapsedMs, wallElapsedMs)
        return addWithoutOverflow(currentAnchor.serverTimeMs, trustedElapsedMs)
    }

    // enforce the exact retention boundary
    @Synchronized
    fun evaluateExpiry(capturedAtMs: Long): ExpiryEvaluation {
        val trustedNowMs = trustedNowMs() ?: return ExpiryEvaluation.BlockedWithoutSameBootAnchor
        val expired = capturedAtMs < 0 || trustedNowMs >= capturedAtMs && trustedNowMs - capturedAtMs >= AUTOMATIC_CANDIDATE_RETENTION_MS
        return ExpiryEvaluation.Available(expired = expired, trustedNowMs = trustedNowMs)
    }

    // require an unchanged boot
    private fun sameBootAnchor(): TrustedTimeAnchor? {
        val currentAnchor = anchor ?: return null

        // block stale boot anchors
        if (currentAnchor.bootIdentity != bootIdentity()) {
            anchorStore.clear()
            anchor = null
            return null
        }

        return currentAnchor
    }

    // calculate monotonic progress
    private fun monotonicElapsed(currentAnchor: TrustedTimeAnchor): Long? {
        val currentMonotonicTimeMs = monotonicClockMs()

        // block regressed monotonic clocks
        if (currentMonotonicTimeMs < currentAnchor.monotonicTimeMs) {
            return null
        }

        return currentMonotonicTimeMs - currentAnchor.monotonicTimeMs
    }

    // clamp rollback to zero
    private fun nonNegativeElapsed(currentMs: Long, anchorMs: Long): Long {
        // avoid subtraction overflow
        if (currentMs <= anchorMs) {
            return 0
        }

        return currentMs - anchorMs
    }

    // reject overflow
    private fun addWithoutOverflow(left: Long, right: Long): Long? {
        // require non-negative clock values
        if (left < 0 || right < 0 || left > AUTOMATIC_MAX_SAFE_INTEGER - right) {
            return null
        }

        return left + right
    }
}
