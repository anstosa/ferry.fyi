package fyi.ferry.leaderboards

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
// define the native contract
class AutomaticV0PhysicalHarnessTest {
    // install one operator-supplied fixed diagnostic region
    @Test
    fun installConfiguredDiagnostic() {
        val arguments = InstrumentationRegistry.getArguments()
        val terminalId = arguments.getString("terminalId")
        val latitudeE7 = arguments.getString("latitudeE7")?.toIntOrNull()
        val longitudeE7 = arguments.getString("longitudeE7")?.toIntOrNull()
        val radiusMillimeters = arguments.getString("radiusMillimeters")?.toLongOrNull()
        // skip ordinary automated suites without explicit physical inputs
        assumeTrue(
            "physical v0 arguments are required",
            terminalId != null && latitudeE7 != null && longitudeE7 != null && radiusMillimeters != null,
        )
        val context = ApplicationProvider.getApplicationContext<Context>()
        // require the supported diagnostic build and permissions
        assertTrue(fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED)
        assertTrue(Build.VERSION.SDK_INT >= AUTOMATIC_V0_MIN_SUPPORTED_SDK)
        assertTrue(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED,
        )
        assertTrue(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                PackageManager.PERMISSION_GRANTED,
        )

        val serverTimeMs = fetchTrustedHttpsDateMs()
        assertTrue(serverTimeMs != null)
        val completed = CountDownLatch(1)
        var status = AutomaticV0ControlStatus.NOT_REGISTERED
        val configGeneration = ConfigGeneration(1)
        val regions = listOf(
            AutomaticTerminalRegion(
                terminalId = terminalId!!,
                latitudeE7 = latitudeE7!!,
                longitudeE7 = longitudeE7!!,
                radiusMillimeters = radiusMillimeters!!,
                configGeneration = configGeneration,
            ),
        )
        AutomaticV0AndroidDiagnosticControl(context).install(
            serverTimeMs = serverTimeMs!!,
            config = AutomaticTerminalConfigGeneration(
                schemaVersion = 1,
                configGeneration = configGeneration,
                serverPolicyGeneration = ServerPolicyGeneration(1),
                contentHashHex = AutomaticPayloadDigestV1.sha256Hex(
                    AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(regions),
                ),
                regions = regions,
            ),
        // run the bounded callback
        ) { result ->
            status = result
            completed.countDown()
        }
        assertTrue(completed.await(30, TimeUnit.SECONDS))
        assertTrue(status == AutomaticV0ControlStatus.READY)
    }

    // report only fixed prepared registration status
    @Test
    fun statusConfiguredDiagnostic() {
        val arguments = InstrumentationRegistry.getArguments()
        // skip unless status is explicit
        assumeTrue("physical status flag is required", arguments.getString("status") == "true")
        val context = ApplicationProvider.getApplicationContext<Context>()

        assertTrue(AutomaticV0AndroidDiagnosticControl(context).status() == AutomaticV0ControlStatus.READY)
    }

    // run one supporting simulated entry without claiming os delivery
    @Test
    fun simulateConfiguredEntry() {
        val arguments = InstrumentationRegistry.getArguments()
        // require explicit simulation inputs
        assumeTrue("simulation flag is required", arguments.getString("simulation") == "true")
        val terminalId = arguments.getString("terminalId")
        assertTrue(!terminalId.isNullOrEmpty())
        val context = ApplicationProvider.getApplicationContext<Context>()

        val evidence = AutomaticV0AndroidRuntime.runEntry(
            context,
            AutomaticV0TerminalExitCallback(terminalId!!, ConfigGeneration(1)),
        )

        assertEquals(AutomaticV0Outcome.TERMINAL_ENTRY_FIX_OBSERVED, evidence.outcome)
        assertEquals(1, evidence.locationRequestCount)
        assertEquals(0, evidence.snapshotGetCount)
        assertEquals(0, evidence.fleetEvaluationCount)
        assertEquals(AutomaticV0ForbiddenSurfaceEvidence(), evidence.forbidden)
        reportSimulationEvidence(evidence)
    }

    // run one supporting simulated exit without claiming os delivery
    @Test
    fun simulateConfiguredExit() {
        val arguments = InstrumentationRegistry.getArguments()
        // require explicit simulation inputs
        assumeTrue("simulation flag is required", arguments.getString("simulation") == "true")
        val terminalId = arguments.getString("terminalId")
        assertTrue(!terminalId.isNullOrEmpty())
        val context = ApplicationProvider.getApplicationContext<Context>()

        val evidence = AutomaticV0AndroidRuntime.runExit(
            context,
            AutomaticV0TerminalExitCallback(terminalId!!, ConfigGeneration(1)),
        )

        assertTrue(
            evidence.outcome in
                setOf(
                    AutomaticV0Outcome.NO_PLAUSIBLE_VESSEL,
                    AutomaticV0Outcome.MULTIPLE_PLAUSIBLE_VESSELS,
                    AutomaticV0Outcome.DIAGNOSTIC_CANDIDATE_WIPED,
                ),
        )
        assertEquals(1, evidence.locationRequestCount)
        assertEquals(1, evidence.fleetEvaluationCount)
        assertTrue(evidence.snapshotGetCount in 0..1)
        assertTrue(evidence.diagnosticCandidateCount in 0..1)
        assertEquals(evidence.diagnosticCandidateCount, evidence.candidateWipeCount)
        assertEquals(AutomaticV0ForbiddenSurfaceEvidence(), evidence.forbidden)
        reportSimulationEvidence(evidence)
    }

    // remove the installed diagnostic namespace
    @Test
    fun removeConfiguredDiagnostic() {
        val arguments = InstrumentationRegistry.getArguments()
        // skip unless cleanup is explicit
        assumeTrue("physical cleanup flag is required", arguments.getString("cleanup") == "true")
        val context = ApplicationProvider.getApplicationContext<Context>()
        val completed = CountDownLatch(1)
        var status = AutomaticV0ControlStatus.READY
        // run the bounded callback
        AutomaticV0AndroidDiagnosticControl(context).uninstall { result ->
            status = result
            completed.countDown()
        }
        assertTrue(completed.await(30, TimeUnit.SECONDS))
        assertTrue(status == AutomaticV0ControlStatus.NOT_REGISTERED)
    }

    // read one https server-date anchor without fleet context
    private fun fetchTrustedHttpsDateMs(): Long? {
        val connection = try {
            URI("https://ferry.fyi/").toURL().openConnection() as HttpURLConnection
        // fail closed on the error
        } catch (_: Exception) {
            return null
        }
        return try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "HEAD"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            val status = connection.responseCode
            // require one direct successful origin response
            if (status !in 200..299 || connection.url.toString() != "https://ferry.fyi/") {
                return null
            }
            // run the bounded callback
            connection.date.takeIf { it > 0L }
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            connection.disconnect()
        }
    }

    // publish only fixed supporting-simulation counters
    private fun reportSimulationEvidence(evidence: AutomaticV0RunEvidence) {
        val status = Bundle()
        status.putString("simulationEvidenceClass", "supporting-only-not-physical")
        status.putString("simulationOutcome", evidence.outcome.name)
        status.putInt("simulationLocationRequests", evidence.locationRequestCount)
        status.putInt("simulationSnapshotGets", evidence.snapshotGetCount)
        status.putInt("simulationFleetEvaluations", evidence.fleetEvaluationCount)
        status.putInt("simulationCandidates", evidence.diagnosticCandidateCount)
        status.putInt("simulationCandidateWipes", evidence.candidateWipeCount)
        InstrumentationRegistry.getInstrumentation().sendStatus(0, status)
    }
}
