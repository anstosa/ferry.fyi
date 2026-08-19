package fyi.ferry.leaderboards

// define the native contract
internal object AutomaticBridgeStatusV1 {
    val exactKeys = setOf(
        "capabilityVersion",
        "configGeneration",
        "credentialExpiryBucket",
        "lastOutcome",
        "monitorHealth",
        "pendingCandidateCount",
        "permissionHealth",
        "platform",
        "schemaVersion",
        "serverPolicyGeneration",
    )

    // project only the strict aggregate shared status contract
    fun project(
        status: AutomaticNativeRuntimeStatusV1,
        pendingCandidateCount: Int,
        credentialExpiryBucket: String,
    ): Map<String, Any?> = linkedMapOf(
        "capabilityVersion" to 1,
        "configGeneration" to status.configGeneration?.value,
        "credentialExpiryBucket" to credentialExpiryBucket,
        "lastOutcome" to status.lastOutcome,
        "monitorHealth" to status.monitorHealth.name.lowercase(),
        "pendingCandidateCount" to pendingCandidateCount,
        "permissionHealth" to status.permissionHealth.name.lowercase(),
        "platform" to "android",
        "schemaVersion" to 1,
        "serverPolicyGeneration" to (status.serverPolicyGeneration?.value ?: 0L),
    )

    // project the default-off build without native storage access
    fun defaultOff(): Map<String, Any?> = linkedMapOf(
        "capabilityVersion" to 1,
        "configGeneration" to null,
        "credentialExpiryBucket" to "unavailable",
        "lastOutcome" to null,
        "monitorHealth" to "disabled",
        "pendingCandidateCount" to 0,
        "permissionHealth" to "not_determined",
        "platform" to "android",
        "schemaVersion" to 1,
        "serverPolicyGeneration" to 0L,
    )

    // project an api-floor rejection without native storage access
    fun unsupportedOs(): Map<String, Any?> = linkedMapOf(
        "capabilityVersion" to 1,
        "configGeneration" to null,
        "credentialExpiryBucket" to "unavailable",
        "lastOutcome" to "unsupported_os",
        "monitorHealth" to "unsupported_os",
        "pendingCandidateCount" to 0,
        "permissionHealth" to "not_determined",
        "platform" to "android",
        "schemaVersion" to 1,
        "serverPolicyGeneration" to 0L,
    )

    // select an inert status before runtime construction
    fun inertFor(sdkInt: Int, buildEnabled: Boolean): Map<String, Any?>? {
        // reject unsupported android versions first
        if (!AutomaticAndroidEligibilityV1.isSupported(sdkInt)) {
            return unsupportedOs()
        }
        // preserve default-off builds without native material
        if (!buildEnabled) {
            return defaultOff()
        }
        return null
    }
}
