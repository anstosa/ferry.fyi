package fyi.ferry.leaderboards

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Parcel
import android.os.Parcelable
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.location.Geofence
import fyi.ferry.BuildConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
// define the native contract
class AutomaticN1CapabilityManifestTest {
    // define the native contract
    private class RecordingReceiverPort : AutomaticGeofenceReceiverPortV1 {
        val callbacks = mutableListOf<AutomaticGeofenceCallbackV1>()
        var platformErrors = 0

        // record one validated receiver callback
        override fun enqueue(callback: AutomaticGeofenceCallbackV1): Boolean {
            callbacks += callback
            return true
        }

        // record one authoritative platform error
        override fun stopForPlatformError(): Boolean {
            platformErrors += 1
            return true
        }
    }
    // prove the opt-in build contains only reviewed background material
    @Test
    fun capabilityBuildHasPermissionOwnedReceiversAndNoLocationService() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS or
                PackageManager.GET_RECEIVERS or
                PackageManager.GET_SERVICES or
                PackageManager.MATCH_DISABLED_COMPONENTS,
        )
        val permissions = packageInfo.requestedPermissions?.toSet().orEmpty()

        assertTrue(BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED)
        assertFalse(BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED)
        assertTrue(permissions.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        // run the bounded callback
        val receivers = packageInfo.receivers.orEmpty().filter { receiver ->
            receiver.name in setOf(
                AutomaticGeofenceReceiverV1::class.java.name,
                AutomaticBootReceiverV1::class.java.name,
            )
        }
        assertTrue(receivers.size == 2)
        // require every clean-install entry point to be disabled and non-exported
        for (receiver in receivers) {
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

    // reject forged receiver entry without creating automatic runtime material
    @Test
    fun forgedReceiverActionsRemainInert() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val secureDirectory = java.io.File(context.noBackupFilesDir, "leaderboard-automatic/v1")
        secureDirectory.deleteRecursively()

        AutomaticGeofenceReceiverV1().onReceive(context, Intent("fyi.ferry.forged.GEOFENCE"))
        AutomaticBootReceiverV1().onReceive(context, Intent("fyi.ferry.forged.BOOT"))

        assertFalse(secureDirectory.exists())
    }

    // parse exact owned enter and exit callbacks while rejecting forged work
    @Test
    fun geofenceReceiverAcceptsOwnedCallbacksAndStopsOnPlatformError() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val port = RecordingReceiverPort()
        val receiver = AutomaticGeofenceReceiverV1 { port }
        val callback = AutomaticGeofenceCallbackV1(
            terminalId = "7",
            configGeneration = ConfigGeneration(4L),
            localWorkGeneration = LocalWorkGeneration(6L),
            transition = AutomaticGeofenceTransitionV1.ENTER,
        )

        receiver.onReceive(context, geofenceIntent(callback, Geofence.GEOFENCE_TRANSITION_ENTER))
        receiver.onReceive(context, geofenceIntent(callback, Geofence.GEOFENCE_TRANSITION_EXIT))
        receiver.onReceive(context, Intent("fyi.ferry.forged.GEOFENCE"))
        receiver.onReceive(
            context,
            Intent("fyi.ferry.leaderboards.AUTOMATIC_GEOFENCE_V1").putExtra("gms_error_code", 1000),
        )

        assertTrue(port.callbacks.size == 2)
        assertTrue(port.callbacks[0].transition == AutomaticGeofenceTransitionV1.ENTER)
        assertTrue(port.callbacks[1].transition == AutomaticGeofenceTransitionV1.EXIT)
        // run the bounded callback
        assertTrue(port.callbacks.all { observed -> observed.localWorkGeneration == LocalWorkGeneration(6L) })
        assertTrue(port.platformErrors == 1)
    }

    // keep boot and unlock inert before any committed enrollment
    @Test
    fun cleanInstallLifecycleCreatesNoRuntimeOrWork() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val secureDirectory = java.io.File(context.noBackupFilesDir, "leaderboard-automatic/v1")
        secureDirectory.deleteRecursively()

        AutomaticBootReceiverV1().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))
        AutomaticBootReceiverV1().onReceive(context, Intent(Intent.ACTION_USER_UNLOCKED))
        AutomaticBootReceiverV1().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

        assertFalse(secureDirectory.exists())
        assertFalse(AutomaticAndroidRuntimeV1.hasReconciliationMaterial(context))
    }

    // serialize one real play-services geofence callback intent
    private fun geofenceIntent(callback: AutomaticGeofenceCallbackV1, transition: Int): Intent {
        val geofence = Geofence.Builder()
            .setRequestId(AutomaticGeofenceRequestIdV1.encode(callback))
            .setCircularRegion(47.602, -122.339, 250.0f)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .build()
        val parcel = Parcel.obtain()
        val bytes = try {
            (geofence as Parcelable).writeToParcel(parcel, 0)
            parcel.marshall()
        // release protected state
        } finally {
            parcel.recycle()
        }
        return Intent("fyi.ferry.leaderboards.AUTOMATIC_GEOFENCE_V1")
            .putExtra("com.google.android.location.intent.extra.transition", transition)
            .putExtra("com.google.android.location.intent.extra.geofence_list", arrayListOf(bytes))
    }
}
