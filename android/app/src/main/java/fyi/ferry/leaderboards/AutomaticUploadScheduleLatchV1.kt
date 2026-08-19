package fyi.ferry.leaderboards

import java.io.File

// define the native contract
internal class AutomaticUploadScheduleLatchV1(
    directory: File,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val latchFile = File(directory, "upload-schedule-required-v1")

    // persist the zero-data wake requirement before ciphertext exposure
    @Synchronized
    fun markRequired(): Boolean = fileOps.replace(latchFile, byteArrayOf(1))

    // clear only after workmanager accepts or starts the owned work
    @Synchronized
    fun clear(): Boolean = fileOps.delete(latchFile)

    // report only the durable aggregate wake requirement
    fun required(): Boolean = latchFile.isFile
}

// define the native contract
internal object AutomaticDurableUploadScheduleRecoveryV1 {
    // retry a missing or failed owned wake while encrypted work remains
    fun reconcile(
        pendingCount: Int,
        latch: AutomaticUploadScheduleLatchV1,
        schedule: () -> Boolean,
    ): Boolean {
        // skip scheduling only when no encrypted or latched work exists
        if (pendingCount <= 0 && !latch.required()) {
            return true
        }
        // preserve a durable retry before invoking workmanager
        if (!latch.markRequired()) {
            return false
        }
        return schedule()
    }
}
