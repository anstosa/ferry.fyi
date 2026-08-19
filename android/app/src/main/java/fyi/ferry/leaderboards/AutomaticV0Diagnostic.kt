package fyi.ferry.leaderboards

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

internal const val AUTOMATIC_V0_MIN_SUPPORTED_SDK = 29
internal const val AUTOMATIC_V0_MAX_ACCURACY_MILLIMETERS = 100_000L
internal const val AUTOMATIC_V0_VESSEL_PROXIMITY_MILLIMETERS = 250_000L
internal const val AUTOMATIC_V0_FIX_MAX_AGE_MS = 30_000L

// define the native contract
internal enum class AutomaticV0CapabilityStatus {
    UNSUPPORTED_OS,
    DEFAULT_OFF,
    ELIGIBLE,
}

// define the native contract
internal data class AutomaticV0CapabilityReport(
    val status: AutomaticV0CapabilityStatus,
    val manualFallbackAvailable: Boolean,
    val automaticMaterialAllowed: Boolean,
)

// define the native contract
internal object AutomaticV0Eligibility {
    // classify without touching automatic material
    fun report(sdkInt: Int, diagnosticEnabled: Boolean): AutomaticV0CapabilityReport {
        // reject pre-android-q devices first
        if (sdkInt < AUTOMATIC_V0_MIN_SUPPORTED_SDK) {
            return AutomaticV0CapabilityReport(
                status = AutomaticV0CapabilityStatus.UNSUPPORTED_OS,
                manualFallbackAvailable = true,
                automaticMaterialAllowed = false,
            )
        }
        // keep the diagnostic default off
        if (!diagnosticEnabled) {
            return AutomaticV0CapabilityReport(
                status = AutomaticV0CapabilityStatus.DEFAULT_OFF,
                manualFallbackAvailable = true,
                automaticMaterialAllowed = false,
            )
        }
        return AutomaticV0CapabilityReport(
            status = AutomaticV0CapabilityStatus.ELIGIBLE,
            manualFallbackAvailable = true,
            automaticMaterialAllowed = true,
        )
    }
}

// define the native contract
internal data class AutomaticV0TerminalExitCallback(
    val terminalId: String,
    val configGeneration: ConfigGeneration,
)

// define the native contract
internal data class AutomaticV0LocationFix(
    val latitudeE7: Int,
    val longitudeE7: Int,
    val accuracyMillimeters: Long,
    val capturedAtMs: Long,
)

// define the native contract
internal interface AutomaticV0OneShotLocationAdapter {
    // request at most one fix
    fun requestOneFix(): AutomaticV0LocationFix?
}

// define the native contract
internal class AutomaticV0EphemeralCandidateSlot(vesselId: String, fix: AutomaticV0LocationFix) {
    private var vesselId = vesselId.toCharArray()
    private var latitudeE7 = fix.latitudeE7
    private var longitudeE7 = fix.longitudeE7
    private var accuracyMillimeters = fix.accuracyMillimeters
    private var capturedAtMs = fix.capturedAtMs

    // overwrite every mutable candidate field
    fun wipe() {
        java.util.Arrays.fill(vesselId, '\u0000')
        vesselId = CharArray(0)
        latitudeE7 = 0
        longitudeE7 = 0
        accuracyMillimeters = 0L
        capturedAtMs = 0L
    }

    // verify every candidate field is cleared
    fun isEmpty(): Boolean =
        vesselId.isEmpty() &&
            latitudeE7 == 0 &&
            longitudeE7 == 0 &&
            accuracyMillimeters == 0L &&
            capturedAtMs == 0L
}

// define the native contract
internal enum class AutomaticV0Outcome {
    UNSUPPORTED_OS,
    DEFAULT_OFF,
    TERMINAL_ENTRY_FIX_OBSERVED,
    LOCATION_UNAVAILABLE,
    LOCATION_INVALID,
    FLEET_CONTEXT_INVALID,
    NO_PLAUSIBLE_VESSEL,
    MULTIPLE_PLAUSIBLE_VESSELS,
    DIAGNOSTIC_CANDIDATE_WIPED,
}

// define the native contract
internal class AutomaticT0DiagnosticRunner(
    private val sdkInt: Int,
    private val diagnosticEnabled: Boolean,
    private val monotonicNowMs: () -> Long,
    private val locationAdapter: AutomaticV0OneShotLocationAdapter,
    private val metricSink: AutomaticV0MetricSink,
) {
    // handle one fixed terminal-entry callback
    fun onTerminalEntry(callback: AutomaticV0TerminalExitCallback): AutomaticV0RunEvidence {
        val startedAtMs = monotonicNowMs()
        val capability = AutomaticV0Eligibility.report(sdkInt, diagnosticEnabled)
        // stop before material on unsupported os
        if (capability.status == AutomaticV0CapabilityStatus.UNSUPPORTED_OS) {
            return finish(startedAtMs, AutomaticV0Outcome.UNSUPPORTED_OS, 0)
        }
        // stop before material while default off
        if (capability.status != AutomaticV0CapabilityStatus.ELIGIBLE) {
            return finish(startedAtMs, AutomaticV0Outcome.DEFAULT_OFF, 0)
        }
        // require fixed callback identity
        if (callback.terminalId.isEmpty() || callback.configGeneration.value < 0L) {
            return finish(startedAtMs, AutomaticV0Outcome.LOCATION_INVALID, 0)
        }
        val fix = locationAdapter.requestOneFix()
            ?: return finish(startedAtMs, AutomaticV0Outcome.LOCATION_UNAVAILABLE, 1)
        // reject inaccurate fixes
        if (
            fix.latitudeE7 !in -900_000_000..900_000_000 ||
            fix.longitudeE7 !in -1_800_000_000..1_800_000_000 ||
            fix.accuracyMillimeters !in 0..AUTOMATIC_V0_MAX_ACCURACY_MILLIMETERS ||
            fix.capturedAtMs <= 0L
        ) {
            return finish(startedAtMs, AutomaticV0Outcome.LOCATION_INVALID, 1)
        }
        return finish(startedAtMs, AutomaticV0Outcome.TERMINAL_ENTRY_FIX_OBSERVED, 1)
    }

    // emit one fixed terminal outcome
    private fun finish(
        startedAtMs: Long,
        outcome: AutomaticV0Outcome,
        locationRequests: Int,
    ): AutomaticV0RunEvidence {
        val durationMs = (monotonicNowMs() - startedAtMs).coerceAtLeast(0L)
        val durationBucket = when {
            durationMs < 1_000L -> AutomaticV0DurationBucket.UNDER_ONE_SECOND
            durationMs <= 5_000L -> AutomaticV0DurationBucket.ONE_TO_FIVE_SECONDS
            // branch on the current state
            else -> AutomaticV0DurationBucket.OVER_FIVE_SECONDS
        }
        metricSink.record(
            AutomaticV0Metric(
                detectorKind = AutomaticV0DetectorKind.TERMINAL_T0,
                outcome = outcome,
                durationBucket = durationBucket,
            ),
        )
        return AutomaticV0RunEvidence(
            outcome = outcome,
            locationRequestCount = locationRequests,
            snapshotGetCount = 0,
            fleetEvaluationCount = 0,
            diagnosticCandidateCount = 0,
            candidateWipeCount = 0,
        )
    }
}

// define the native contract
internal enum class AutomaticV0DurationBucket {
    UNDER_ONE_SECOND,
    ONE_TO_FIVE_SECONDS,
    OVER_FIVE_SECONDS,
}

// define the native contract
internal enum class AutomaticV0DetectorKind {
    TERMINAL_T0,
    VESSEL_V0,
}

// define the native contract
internal data class AutomaticV0Metric(
    val schemaVersion: Int = 1,
    val capabilityVersion: Int = 0,
    val platformCohort: String = "android",
    val detectorKind: AutomaticV0DetectorKind = AutomaticV0DetectorKind.VESSEL_V0,
    val outcome: AutomaticV0Outcome,
    val count: Int = 1,
    val durationBucket: AutomaticV0DurationBucket,
)

// define the native contract
internal interface AutomaticV0MetricSink {
    // record only one redacted aggregate
    fun record(metric: AutomaticV0Metric)
}

// define the native contract
internal interface AutomaticV0LifecycleProbe {
    // count an in-memory candidate construction
    fun candidateConstructed()

    // count immediate candidate wiping
    fun candidateWiped()
}

// define the native contract
internal data class AutomaticV0ForbiddenSurfaceEvidence(
    val bearerReads: Int = 0,
    val durableQueueWrites: Int = 0,
    val uploads: Int = 0,
    val receipts: Int = 0,
    val historyLookups: Int = 0,
    val notifications: Int = 0,
    val credits: Int = 0,
    val scheduledRetries: Int = 0,
    val scheduledTimers: Int = 0,
    val secondWakes: Int = 0,
)

// define the native contract
internal data class AutomaticV0RunEvidence(
    val outcome: AutomaticV0Outcome,
    val locationRequestCount: Int,
    val snapshotGetCount: Int,
    val fleetEvaluationCount: Int,
    val diagnosticCandidateCount: Int,
    val candidateWipeCount: Int,
    val forbidden: AutomaticV0ForbiddenSurfaceEvidence = AutomaticV0ForbiddenSurfaceEvidence(),
)

// define the native contract
internal class AutomaticV0TerminalExitAdapter(private val runner: AutomaticV0DiagnosticRunner) {
    // forward only one fixed exit callback
    fun onExit(terminalId: String, configGeneration: ConfigGeneration): AutomaticV0RunEvidence =
        runner.onTerminalExit(
            AutomaticV0TerminalExitCallback(
                terminalId = terminalId,
                configGeneration = configGeneration,
            ),
        )
}

// define the native contract
internal class AutomaticV0VesselMatcher {
    // return every diagnostically plausible vessel
    fun plausibleMatches(fix: AutomaticV0LocationFix, fleet: AutomaticV0FleetBody): List<AutomaticV0Vessel> =
        // run the bounded callback
        fleet.vessels.filter { vessel ->
            val latitude = vessel.locationLatitude
            val longitude = vessel.locationLongitude
            vessel.inService &&
                latitude != null &&
                longitude != null &&
                distanceMillimeters(
                    fix.latitudeE7 / 10_000_000.0,
                    fix.longitudeE7 / 10_000_000.0,
                    latitude,
                    longitude,
                ) + fix.accuracyMillimeters <= AUTOMATIC_V0_VESSEL_PROXIMITY_MILLIMETERS
        }

    // calculate haversine distance
    private fun distanceMillimeters(
        leftLatitude: Double,
        leftLongitude: Double,
        rightLatitude: Double,
        rightLongitude: Double,
    ): Long {
        val latitudeDelta = Math.toRadians(rightLatitude - leftLatitude)
        val longitudeDelta = Math.toRadians(rightLongitude - leftLongitude)
        val a = sin(latitudeDelta / 2.0) * sin(latitudeDelta / 2.0) +
            cos(Math.toRadians(leftLatitude)) *
            cos(Math.toRadians(rightLatitude)) *
            sin(longitudeDelta / 2.0) * sin(longitudeDelta / 2.0)
        val meters = 6_371_000.0 * 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
        return (meters * 1_000.0).toLong()
    }
}

// define the native contract
internal class AutomaticV0DiagnosticRunner(
    private val sdkInt: Int,
    private val diagnosticEnabled: Boolean,
    private val trustedNowMs: () -> Long?,
    private val monotonicNowMs: () -> Long,
    private val locationAdapter: AutomaticV0OneShotLocationAdapter,
    private val fleetRepository: AutomaticV0FleetContextRepository,
    private val matcher: AutomaticV0VesselMatcher,
    private val metricSink: AutomaticV0MetricSink,
    private val lifecycleProbe: AutomaticV0LifecycleProbe,
) {
    // handle one fixed terminal-exit callback
    fun onTerminalExit(callback: AutomaticV0TerminalExitCallback): AutomaticV0RunEvidence {
        val startedAtMs = monotonicNowMs()
        val capability = AutomaticV0Eligibility.report(sdkInt, diagnosticEnabled)
        // stop before all material on unsupported os
        if (capability.status == AutomaticV0CapabilityStatus.UNSUPPORTED_OS) {
            return finish(startedAtMs, AutomaticV0Outcome.UNSUPPORTED_OS, 0, 0, 0, 0, 0)
        }
        // stop before all material while default off
        if (capability.status != AutomaticV0CapabilityStatus.ELIGIBLE) {
            return finish(startedAtMs, AutomaticV0Outcome.DEFAULT_OFF, 0, 0, 0, 0, 0)
        }
        // require fixed callback identity
        if (callback.terminalId.isEmpty() || callback.configGeneration.value < 0L) {
            return finish(startedAtMs, AutomaticV0Outcome.LOCATION_INVALID, 0, 0, 0, 0, 0)
        }

        val fix = locationAdapter.requestOneFix()
            ?: return finish(startedAtMs, AutomaticV0Outcome.LOCATION_UNAVAILABLE, 1, 0, 0, 0, 0)
        // reject inaccurate or untrusted fixes
        if (!isValidFixShape(fix)) {
            return finish(startedAtMs, AutomaticV0Outcome.LOCATION_INVALID, 1, 0, 0, 0, 0)
        }
        val nowMs = trustedNowMs()
            ?: return finish(startedAtMs, AutomaticV0Outcome.FLEET_CONTEXT_INVALID, 1, 0, 0, 0, 0)
        // reject stale or future trusted capture times
        if (!isFreshFix(fix, nowMs)) {
            return finish(startedAtMs, AutomaticV0Outcome.LOCATION_INVALID, 1, 0, 0, 0, 0)
        }
        val fleet = fleetRepository.contextForCallback(nowMs)
            ?: return finish(
                startedAtMs,
                AutomaticV0Outcome.FLEET_CONTEXT_INVALID,
                1,
                fleetRepository.snapshotGetCount,
                1,
                0,
                0,
            )
        val matches = matcher.plausibleMatches(fix, fleet)
        // reject no plausible match
        if (matches.isEmpty()) {
            return finish(
                startedAtMs,
                AutomaticV0Outcome.NO_PLAUSIBLE_VESSEL,
                1,
                fleetRepository.snapshotGetCount,
                1,
                0,
                0,
            )
        }
        // reject ambiguous matches
        if (matches.size != 1) {
            return finish(
                startedAtMs,
                AutomaticV0Outcome.MULTIPLE_PLAUSIBLE_VESSELS,
                1,
                fleetRepository.snapshotGetCount,
                1,
                0,
                0,
            )
        }

        val diagnosticCandidate = AutomaticV0EphemeralCandidateSlot(
            vesselId = matches.single().id,
            fix = fix,
        )
        lifecycleProbe.candidateConstructed()
        diagnosticCandidate.wipe()
        lifecycleProbe.candidateWiped()
        check(diagnosticCandidate.isEmpty())
        return finish(
            startedAtMs,
            AutomaticV0Outcome.DIAGNOSTIC_CANDIDATE_WIPED,
            1,
            fleetRepository.snapshotGetCount,
            1,
            1,
            1,
        )
    }

    // validate one trusted fresh fix
    private fun isValidFixShape(fix: AutomaticV0LocationFix): Boolean =
        fix.latitudeE7 in -900_000_000..900_000_000 &&
            fix.longitudeE7 in -1_800_000_000..1_800_000_000 &&
            fix.accuracyMillimeters in 0..AUTOMATIC_V0_MAX_ACCURACY_MILLIMETERS &&
            fix.capturedAtMs > 0L

    // enforce the exact one-shot fix age
    private fun isFreshFix(fix: AutomaticV0LocationFix, trustedNowMs: Long): Boolean {
        val ageMs = try {
            Math.subtractExact(trustedNowMs, fix.capturedAtMs)
        // fail closed on the error
        } catch (_: ArithmeticException) {
            return false
        }
        return ageMs in 0..AUTOMATIC_V0_FIX_MAX_AGE_MS
    }

    // emit one fixed outcome and stop
    private fun finish(
        startedAtMs: Long,
        outcome: AutomaticV0Outcome,
        locationRequests: Int,
        snapshotGets: Int,
        fleetEvaluations: Int,
        candidates: Int,
        wipes: Int,
    ): AutomaticV0RunEvidence {
        val durationMs = (monotonicNowMs() - startedAtMs).coerceAtLeast(0L)
        metricSink.record(
            AutomaticV0Metric(
                outcome = outcome,
                durationBucket = durationBucket(durationMs),
            ),
        )
        return AutomaticV0RunEvidence(
            outcome = outcome,
            locationRequestCount = locationRequests,
            snapshotGetCount = snapshotGets,
            fleetEvaluationCount = fleetEvaluations,
            diagnosticCandidateCount = candidates,
            candidateWipeCount = wipes,
        )
    }

    // bucket duration without exact time
    private fun durationBucket(durationMs: Long): AutomaticV0DurationBucket {
        // map into fixed buckets
        return when {
            durationMs < 1_000L -> AutomaticV0DurationBucket.UNDER_ONE_SECOND
            durationMs <= 5_000L -> AutomaticV0DurationBucket.ONE_TO_FIVE_SECONDS
            // branch on the current state
            else -> AutomaticV0DurationBucket.OVER_FIVE_SECONDS
        }
    }
}
