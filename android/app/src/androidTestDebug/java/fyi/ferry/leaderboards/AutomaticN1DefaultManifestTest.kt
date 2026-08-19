package fyi.ferry.leaderboards

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import fyi.ferry.BuildConfig
import fyi.ferry.R
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
// define the native contract
class AutomaticN1DefaultManifestTest {
    // prove debug remains production-like and automatic behavior stays off
    @Test
    fun debugBuildIsDefaultOffWithoutBackgroundLocationOrLocationService() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS or
                PackageManager.GET_RECEIVERS or
                PackageManager.GET_SERVICES or
                PackageManager.MATCH_DISABLED_COMPONENTS,
        )
        val permissions = packageInfo.requestedPermissions?.toSet().orEmpty()

        assertFalse(BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED)
        assertFalse(BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED)
        assertFalse(permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        // run the bounded callback
        val automaticReceivers = packageInfo.receivers.orEmpty().filter { receiver ->
            receiver.name in setOf(
                AutomaticGeofenceReceiverV1::class.java.name,
                AutomaticBootReceiverV1::class.java.name,
            )
        }
        assertTrue(automaticReceivers.size == 2)
        // require every default automatic entry point to be disabled and non-exported
        for (receiver in automaticReceivers) {
            assertFalse(receiver.enabled)
            assertFalse(receiver.exported)
        }
        assertFalse(
            // run the bounded callback
            packageInfo.services.orEmpty().any { service ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                    service.foregroundServiceType and
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION != 0
            },
        )
    }

    // prove backup and transfer exclusions are packaged in debug
    @Test
    fun backupExclusionResourcesArePackaged() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()

        assertNotEquals(0, R.xml.automatic_leaderboard_backup_rules)
        assertNotEquals(0, R.xml.automatic_leaderboard_data_extraction_rules)
        assertTrue(context.resources.getXml(R.xml.automatic_leaderboard_backup_rules).eventType >= 0)
        assertTrue(context.resources.getXml(R.xml.automatic_leaderboard_data_extraction_rules).eventType >= 0)
    }

    // prove the runtime floor matches the current device sdk
    @Test
    fun automaticSdkFloorIsAndroidQ() {
        assertTrue(
            AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ==
                (Build.VERSION.SDK_INT >= 29),
        )
    }

    // prove workmanager receives no candidate or credential metadata
    @Test
    fun uploadWorkRequestHasEmptyInputData() {
        val request = AutomaticZeroDataWorkRequestFactoryV1.create()

        assertTrue(request.workSpec.input.size() == 0)
    }
}
