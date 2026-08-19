package fyi.ferry.leaderboards

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticV0DiagnosticRunnerTest {
    // define the native contract
    private class CountingLocationAdapter(var fix: AutomaticV0LocationFix?) : AutomaticV0OneShotLocationAdapter {
        var calls = 0

        // return at most one injected fix
        override fun requestOneFix(): AutomaticV0LocationFix? {
            calls += 1
            return fix
        }
    }

    // define the native contract
    private class MemoryCache(private var entry: AutomaticV0FleetCacheEntry) : AutomaticV0FleetCacheStore {
        // return the body-only entry
        override fun read(): AutomaticV0FleetCacheEntry = entry

        // replace the body-only entry
        override fun replace(entry: AutomaticV0FleetCacheEntry): Boolean {
            this.entry = entry
            return true
        }

        // clear the entry
        override fun delete() = Unit
    }

    // define the native contract
    private class NeverTransport : AutomaticV0HttpTransport {
        var calls = 0

        // fail on any unexpected get
        override fun get(url: String): AutomaticV0HttpResponse? {
            calls += 1
            return null
        }
    }

    // define the native contract
    private class MetricCollector : AutomaticV0MetricSink {
        val metrics = mutableListOf<AutomaticV0Metric>()

        // collect one redacted metric
        override fun record(metric: AutomaticV0Metric) {
            metrics += metric
        }
    }

    // define the native contract
    private class LifecycleCounter : AutomaticV0LifecycleProbe {
        var constructed = 0
        var wiped = 0

        // count construction only
        override fun candidateConstructed() {
            constructed += 1
        }

        // count wiping only
        override fun candidateWiped() {
            wiped += 1
        }
    }

    private val nowMs = 1_720_000_010_000L

    // create one fresh body-only cache
    private fun cache(vessels: Map<String, String>): MemoryCache {
        val body = AutomaticV0FleetEnvelopeParser.parse(
            AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(1_720_000_000L, vessels)),
        )!!
        return MemoryCache(
            AutomaticV0FleetCacheEntry(
                body = body,
                bodyHashHex = AutomaticPayloadDigestV1.sha256Hex(body.canonicalBytes),
                receivedAtMs = nowMs,
            ),
        )
    }

    // create one diagnostic runner
    private fun runner(
        sdkInt: Int,
        enabled: Boolean,
        location: CountingLocationAdapter,
        cache: MemoryCache = cache(mapOf("144" to AutomaticV0TestFixtures.vessel())),
        transport: NeverTransport = NeverTransport(),
        metrics: MetricCollector = MetricCollector(),
        lifecycle: LifecycleCounter = LifecycleCounter(),
    ): AutomaticV0DiagnosticRunner = AutomaticV0DiagnosticRunner(
        sdkInt = sdkInt,
        diagnosticEnabled = enabled,
        // run the bounded callback
        trustedNowMs = { nowMs },
        // run the bounded callback
        monotonicNowMs = { 100L },
        locationAdapter = location,
        fleetRepository = AutomaticV0FleetContextRepository(
            cache,
            AutomaticV0FleetClient("https://ferry.fyi", transport),
            // run the bounded callback
            responseReceiptNowMs = { nowMs },
        ),
        matcher = AutomaticV0VesselMatcher(),
        metricSink = metrics,
        lifecycleProbe = lifecycle,
    )

    // prove api twenty-six through twenty-eight never touch material
    @Test
    fun unsupportedOsHasNoAutomaticMaterialAndKeepsManualFallback() {
        // exercise every unsupported sdk
        for (sdkInt in 26..28) {
            val location = CountingLocationAdapter(validFix())
            val report = AutomaticV0Eligibility.report(sdkInt, diagnosticEnabled = true)
            val evidence = runner(sdkInt, enabled = true, location = location).onTerminalExit(callback())

            assertEquals(AutomaticV0CapabilityStatus.UNSUPPORTED_OS, report.status)
            assertTrue(report.manualFallbackAvailable)
            assertFalse(report.automaticMaterialAllowed)
            assertEquals(AutomaticV0Outcome.UNSUPPORTED_OS, evidence.outcome)
            assertEquals(0, location.calls)
            assertZeroForbiddenSurfaces(evidence)
        }
    }

    // prove api twenty-nine remains default off
    @Test
    fun supportedOsIsDefaultOffUntilExplicitDiagnosticBuild() {
        val location = CountingLocationAdapter(validFix())
        val report = AutomaticV0Eligibility.report(29, diagnosticEnabled = false)
        val evidence = runner(29, enabled = false, location = location).onTerminalExit(callback())

        assertEquals(AutomaticV0CapabilityStatus.DEFAULT_OFF, report.status)
        assertFalse(report.automaticMaterialAllowed)
        assertEquals(AutomaticV0Outcome.DEFAULT_OFF, evidence.outcome)
        assertEquals(0, location.calls)
        assertZeroForbiddenSurfaces(evidence)
    }

    // prove one callback one fix one context one wiped candidate
    @Test
    fun supportedDiagnosticFlowIsExactlyBounded() {
        val location = CountingLocationAdapter(validFix())
        val transport = NeverTransport()
        val metrics = MetricCollector()
        val lifecycle = LifecycleCounter()
        val evidence = runner(
            sdkInt = 29,
            enabled = true,
            location = location,
            transport = transport,
            metrics = metrics,
            lifecycle = lifecycle,
        ).onTerminalExit(callback())

        assertEquals(AutomaticV0Outcome.DIAGNOSTIC_CANDIDATE_WIPED, evidence.outcome)
        assertEquals(1, location.calls)
        assertEquals(1, evidence.locationRequestCount)
        assertEquals(0, evidence.snapshotGetCount)
        assertEquals(1, evidence.fleetEvaluationCount)
        assertEquals(1, evidence.diagnosticCandidateCount)
        assertEquals(1, evidence.candidateWipeCount)
        assertEquals(1, lifecycle.constructed)
        assertEquals(1, lifecycle.wiped)
        assertEquals(0, transport.calls)
        assertEquals(
            listOf(
                AutomaticV0Metric(
                    outcome = AutomaticV0Outcome.DIAGNOSTIC_CANDIDATE_WIPED,
                    durationBucket = AutomaticV0DurationBucket.UNDER_ONE_SECOND,
                ),
            ),
            metrics.metrics,
        )
        assertZeroForbiddenSurfaces(evidence)
    }

    // overwrite every mutable diagnostic candidate field
    @Test
    fun ephemeralCandidateWipeClearsAllFields() {
        val slot = AutomaticV0EphemeralCandidateSlot("144", validFix())

        assertFalse(slot.isEmpty())
        slot.wipe()
        assertTrue(slot.isEmpty())
    }

    // prove terminal entry requests one fix and performs no fleet work
    @Test
    fun terminalEntryIsOneShotAndFleetFree() {
        val location = CountingLocationAdapter(validFix())
        val metrics = MetricCollector()
        val evidence = AutomaticT0DiagnosticRunner(
            sdkInt = 29,
            diagnosticEnabled = true,
            // run the bounded callback
            monotonicNowMs = { 100L },
            locationAdapter = location,
            metricSink = metrics,
        ).onTerminalEntry(callback())

        assertEquals(AutomaticV0Outcome.TERMINAL_ENTRY_FIX_OBSERVED, evidence.outcome)
        assertEquals(1, location.calls)
        assertEquals(1, evidence.locationRequestCount)
        assertEquals(0, evidence.snapshotGetCount)
        assertEquals(0, evidence.fleetEvaluationCount)
        assertEquals(0, evidence.diagnosticCandidateCount)
        assertEquals(AutomaticV0DetectorKind.TERMINAL_T0, metrics.metrics.single().detectorKind)
        assertZeroForbiddenSurfaces(evidence)
    }

    // enforce exact trusted fix freshness
    @Test
    fun trustedFixAgeEqualityPassesAndPlusOneFails() {
        val atBoundary = runner(
            29,
            true,
            CountingLocationAdapter(validFix().copy(capturedAtMs = nowMs - AUTOMATIC_V0_FIX_MAX_AGE_MS)),
        ).onTerminalExit(callback())
        val overBoundary = runner(
            29,
            true,
            CountingLocationAdapter(validFix().copy(capturedAtMs = nowMs - AUTOMATIC_V0_FIX_MAX_AGE_MS - 1L)),
        ).onTerminalExit(callback())
        val future = runner(
            29,
            true,
            CountingLocationAdapter(validFix().copy(capturedAtMs = nowMs + 1L)),
        ).onTerminalExit(callback())

        assertEquals(AutomaticV0Outcome.DIAGNOSTIC_CANDIDATE_WIPED, atBoundary.outcome)
        assertEquals(AutomaticV0Outcome.LOCATION_INVALID, overBoundary.outcome)
        assertEquals(AutomaticV0Outcome.LOCATION_INVALID, future.outcome)
        assertEquals(0, overBoundary.fleetEvaluationCount)
        assertEquals(0, future.fleetEvaluationCount)
    }

    // reject bad accuracy before fleet evaluation
    @Test
    fun badAccuracyCreatesNoCandidateOrFleetWork() {
        val location = CountingLocationAdapter(validFix().copy(accuracyMillimeters = 100_001L))
        val evidence = runner(29, enabled = true, location = location).onTerminalExit(callback())

        assertEquals(AutomaticV0Outcome.LOCATION_INVALID, evidence.outcome)
        assertEquals(1, location.calls)
        assertEquals(0, evidence.fleetEvaluationCount)
        assertEquals(0, evidence.diagnosticCandidateCount)
        assertZeroForbiddenSurfaces(evidence)
    }

    // reject zero and multiple plausible vessels
    @Test
    fun ambiguousFleetCreatesNoCandidate() {
        val noMatch = runner(
            29,
            true,
            CountingLocationAdapter(validFix()),
            cache(mapOf("144" to AutomaticV0TestFixtures.vessel(latitude = 48.0))),
        ).onTerminalExit(callback())
        val multiple = runner(
            29,
            true,
            CountingLocationAdapter(validFix()),
            cache(
                mapOf(
                    "144" to AutomaticV0TestFixtures.vessel(id = "144"),
                    "145" to AutomaticV0TestFixtures.vessel(id = "145"),
                ),
            ),
        ).onTerminalExit(callback())

        assertEquals(AutomaticV0Outcome.NO_PLAUSIBLE_VESSEL, noMatch.outcome)
        assertEquals(AutomaticV0Outcome.MULTIPLE_PLAUSIBLE_VESSELS, multiple.outcome)
        assertEquals(0, noMatch.diagnosticCandidateCount)
        assertEquals(0, multiple.diagnosticCandidateCount)
        assertZeroForbiddenSurfaces(noMatch)
        assertZeroForbiddenSurfaces(multiple)
    }

    // create one fixed exit callback
    private fun callback(): AutomaticV0TerminalExitCallback = AutomaticV0TerminalExitCallback(
        terminalId = "7",
        configGeneration = ConfigGeneration(1),
    )

    // create one accurate one-shot fix
    private fun validFix(): AutomaticV0LocationFix = AutomaticV0LocationFix(
        latitudeE7 = 476_020_000,
        longitudeE7 = -1_223_390_000,
        accuracyMillimeters = 10_000,
        capturedAtMs = nowMs,
    )

    // assert every prohibited surface stays zero
    private fun assertZeroForbiddenSurfaces(evidence: AutomaticV0RunEvidence) {
        assertEquals(AutomaticV0ForbiddenSurfaceEvidence(), evidence.forbidden)
    }
}
