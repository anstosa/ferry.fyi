package fyi.ferry.leaderboards

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticV0BuildBoundaryTest {
    // keep ordinary background material absent
    @Test
    fun sourceManifestsKeepBackgroundMaterialDiagnosticOnly() {
        val projectDir = File(System.getProperty("user.dir"))
        val mainManifest = File(projectDir, "src/main/AndroidManifest.xml").readText()
        val diagnosticManifest = File(projectDir, "src/v0Diagnostic/AndroidManifest.xml").readText()
        val buildFile = File(projectDir, "build.gradle").readText()

        assertFalse(mainManifest.contains("ACCESS_BACKGROUND_LOCATION"))
        assertFalse(mainManifest.contains("AutomaticV0GeofenceReceiver"))
        assertFalse(mainManifest.contains("foregroundServiceType=\"location\""))
        assertTrue(diagnosticManifest.contains("ACCESS_BACKGROUND_LOCATION"))
        assertTrue(diagnosticManifest.contains("AutomaticV0GeofenceReceiver"))
        assertTrue(diagnosticManifest.contains("android:exported=\"false\""))
        assertFalse(diagnosticManifest.contains("<service"))
        assertTrue(
            buildFile.contains(
                "buildConfigField 'boolean', 'AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED', 'false'",
            ),
        )
        assertTrue(buildFile.contains("v0Diagnostic"))
        // require side-by-side installation
        assertTrue(buildFile.contains("applicationIdSuffix '.v0diagnostic'"))
    }
}
