package fyi.ferry.leaderboards

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import fyi.ferry.BuildConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
// define the native contract
class AutomaticV0ManifestTest {
    // prove the diagnostic build has only bounded background material
    @Test
    fun diagnosticBuildHasNonExportedReceiverAndNoLocationService() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS or PackageManager.GET_RECEIVERS or PackageManager.GET_SERVICES,
        )
        val requestedPermissions = packageInfo.requestedPermissions?.toSet().orEmpty()

        assertTrue(BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED)
        assertTrue(requestedPermissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        // run the bounded callback
        val receiver = packageInfo.receivers.orEmpty().single { receiver ->
            receiver.name == "fyi.ferry.leaderboards.AutomaticV0GeofenceReceiver"
        }
        assertFalse(receiver.exported)
        // run the bounded callback
        assertFalse(packageInfo.services.orEmpty().any { service -> service.name.contains("AutomaticV0") })
        assertFalse(
            // run the bounded callback
            packageInfo.services.orEmpty().any { service ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                    service.foregroundServiceType and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION != 0
            },
        )
    }
}
