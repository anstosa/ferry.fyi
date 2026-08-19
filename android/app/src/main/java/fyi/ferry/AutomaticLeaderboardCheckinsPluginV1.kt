package fyi.ferry

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import fyi.ferry.leaderboards.AutomaticAndroidEligibilityV1
import fyi.ferry.leaderboards.AutomaticAndroidPermissionsV1
import fyi.ferry.leaderboards.AutomaticAndroidRuntimeV1
import fyi.ferry.leaderboards.AutomaticBridgeStatusV1
import fyi.ferry.leaderboards.AutomaticCreditSignalHubV1
import fyi.ferry.leaderboards.AutomaticStopTriggerV1
import org.json.JSONObject

private const val AUTOMATIC_BRIDGE_EVENT_V1 = "leaderboard-checkins-changed"

@CapacitorPlugin(
    name = "AutomaticLeaderboardCheckins",
    permissions = [
        Permission(
            alias = "foregroundLocation",
            strings = [Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION],
        ),
    ],
)
// define the native contract
class AutomaticLeaderboardCheckinsPluginV1 : Plugin() {
    // run the bounded callback
    private val creditedListener: () -> Unit = {
        // dispatch an empty payload only
        notifyListeners(AUTOMATIC_BRIDGE_EVENT_V1, JSObject(), true)
    }

    // attach one detail-free credited listener
    override fun load() {
        // keep default builds free of native runtime listeners
        if (
            BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED &&
            AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            AutomaticCreditSignalHubV1.add(creditedListener)
        }
    }

    // remove the process bridge listener
    override fun handleOnDestroy() {
        AutomaticCreditSignalHubV1.remove(creditedListener)
        super.handleOnDestroy()
    }

    // reconcile force-stop and foreground recovery opportunities
    override fun handleOnResume() {
        // keep ordinary foreground resumes inert
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !AutomaticAndroidRuntimeV1.hasReconciliationMaterial(context)
        ) {
            return
        }
        // hand long foreground recovery to accepted durable work
        AutomaticAndroidRuntimeV1.get(context).enqueueLifecycleReconciliation()
    }

    // request only foreground location after explicit disclosure
    @PluginMethod
    fun requestForegroundLocationPermission(call: PluginCall) {
        // reject detail-bearing permission input
        if (call.data.length() != 0) {
            call.reject("Automatic foreground permission takes no input.", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        if (!automaticCapabilityAvailable()) {
            call.resolve(permissionResult("not_determined", false))
            return
        }
        // open settings after permanent denial or approximate-only access
        if (
            getPermissionState("foregroundLocation") == PermissionState.DENIED ||
            foregroundPermissionHealth() == "limited_accuracy"
        ) {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.packageName, null))
            startActivityForResult(call, intent, "foregroundLocationSettingsResult")
            return
        }
        requestPermissionForAlias(
            "foregroundLocation",
            call,
            "foregroundLocationPermissionResult",
        )
    }

    // return the foreground permission result without coordinates
    @PermissionCallback
    private fun foregroundLocationPermissionResult(call: PluginCall) {
        call.resolve(permissionResult(foregroundPermissionHealth(), false))
    }

    // report the post-settings foreground permission state
    @ActivityCallback
    private fun foregroundLocationSettingsResult(call: PluginCall, result: ActivityResult) {
        call.resolve(permissionResult(foregroundPermissionHealth(), true))
    }

    // open the reviewed android background-location settings boundary
    @PluginMethod
    fun requestBackgroundLocationPermission(call: PluginCall) {
        // reject detail-bearing permission input
        if (call.data.length() != 0) {
            call.reject("Automatic background permission takes no input.", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        if (!automaticCapabilityAvailable()) {
            call.resolve(permissionResult("not_determined", false))
            return
        }
        // require precise foreground authority first
        if (foregroundPermissionHealth() != "authorized") {
            call.resolve(permissionResult(foregroundPermissionHealth(), false))
            return
        }
        val current = AutomaticAndroidPermissionsV1.decision(context)
        // avoid reopening settings after full authority
        if (current.health.name.lowercase() == "authorized") {
            call.resolve(permissionResult("authorized", false))
            return
        }
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
        startActivityForResult(call, intent, "backgroundLocationSettingsResult")
    }

    // report the post-settings aggregate permission state
    @ActivityCallback
    private fun backgroundLocationSettingsResult(call: PluginCall, result: ActivityResult) {
        val health = AutomaticAndroidPermissionsV1.decision(context).health.name.lowercase()
        call.resolve(permissionResult(health, true))
    }

    // open the reviewed application-settings recovery boundary
    @PluginMethod
    fun openAutomaticCheckinSettings(call: PluginCall) {
        // reject detail-bearing settings input
        if (call.data.length() != 0) {
            call.reject("Automatic settings takes no input.", "INVALID_INPUT")
            return
        }
        // keep default and unsupported builds inert
        if (!automaticCapabilityAvailable()) {
            call.resolve(settingsResult(false))
            return
        }
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
        startActivityForResult(call, intent, "automaticSettingsResult")
    }

    // report only whether the settings boundary opened
    @ActivityCallback
    private fun automaticSettingsResult(call: PluginCall, result: ActivityResult) {
        call.resolve(settingsResult(true))
    }

    // return inert build and api capability without creating runtime material
    @PluginMethod
    fun getCapability(call: PluginCall) {
        // reject detail-bearing capability input
        if (call.data.length() != 0) {
            call.reject("Automatic capability takes no input.", "INVALID_INPUT")
            return
        }
        val result = JSObject()
        result.put("androidSdkInt", Build.VERSION.SDK_INT)
        result.put("capabilityVersion", 1)
        result.put(
            "enabled",
            BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED &&
                AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT),
        )
        result.put("platform", "android")
        result.put("schemaVersion", 1)
        result.put("supported", AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT))
        call.resolve(result)
    }

    // return the fixed bootstrap contract without candidate data
    @PluginMethod
    fun getEnrollmentBootstrap(call: PluginCall) {
        // reject detail-bearing bootstrap input
        if (call.data.length() != 0) {
            call.reject("Automatic enrollment bootstrap takes no input.", "INVALID_INPUT")
            return
        }
        val supported = AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        val enabled = BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED && supported
        val result = JSObject()
        result.put("schemaVersion", 1)
        result.put("capabilityVersion", 1)
        result.put("platform", "android")
        result.put("androidSdkInt", Build.VERSION.SDK_INT)
        result.put("supported", supported)
        result.put("enabled", enabled)
        result.put("manualFallbackAvailable", true)
        // expose a nonce only to an explicitly enabled supported build
        if (supported && enabled) {
            result.put("installationNonce", AutomaticAndroidRuntimeV1.get(context).prepareEnrollment())
        }
        call.resolve(result)
    }

    // store one one-time server enrollment response natively
    @PluginMethod
    fun installCredential(call: PluginCall) {
        // reject ordinary builds before reading credential material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            call.unavailable("Automatic leaderboard check-ins are disabled for this build.")
            return
        }
        val credential = AutomaticBridgeEnrollmentCredentialParserV1.parse(call.data)
        // require the exact shared server credential response
        if (credential == null) {
            call.reject("Invalid automatic enrollment credential.", "INVALID_ENROLLMENT")
            return
        }
        val installed = AutomaticAndroidRuntimeV1.get(context).installCredential(credential)
        // return only after the device credential transition is durable
        if (installed) {
            call.resolve(JSObject().put("installed", true))
        // branch on the current state
        } else {
            call.reject("Automatic enrollment could not be installed.", "INSTALLATION_FAILED")
        }
    }

    // bind one transient subject without returning its device digest
    @PluginMethod
    fun bindIdentity(call: PluginCall) {
        // keep default and unsupported builds inert before reading subject input
        if (!automaticCapabilityAvailable()) {
            call.resolve(JSObject().put("bound", false).put("schemaVersion", 1))
            return
        }
        // require one exact transient subject key
        if (call.data.length() != 1 || !call.data.has("subject")) {
            call.reject("Invalid automatic identity owner.", "INVALID_IDENTITY")
            return
        }
        val subject = call.getString("subject")
        // reject missing subject ownership
        if (subject == null) {
            call.reject("Invalid automatic identity owner.", "INVALID_IDENTITY")
            return
        }
        val bound = AutomaticAndroidRuntimeV1.get(context).bindIdentity(subject)
        call.resolve(JSObject().put("bound", bound).put("schemaVersion", 1))
    }

    // check one transient subject without exposing raw or derived identity
    @PluginMethod
    fun checkIdentity(call: PluginCall) {
        // keep default and unsupported builds inert before reading subject input
        if (!automaticCapabilityAvailable()) {
            call.resolve(identityCheckResult(bound = false, matches = false))
            return
        }
        // require one exact transient subject key
        if (call.data.length() != 1 || !call.data.has("subject")) {
            call.reject("Invalid automatic identity owner.", "INVALID_IDENTITY")
            return
        }
        val subject = call.getString("subject")
        // reject missing subject ownership
        if (subject == null) {
            call.reject("Invalid automatic identity owner.", "INVALID_IDENTITY")
            return
        }
        // avoid runtime creation on a clean supported installation
        if (!AutomaticAndroidRuntimeV1.hasReconciliationMaterial(context)) {
            call.resolve(identityCheckResult(bound = false, matches = false))
            return
        }
        val checked = AutomaticAndroidRuntimeV1.get(context).checkIdentity(subject)
        call.resolve(identityCheckResult(checked.bound, checked.matches))
    }

    // stage one device-only cleanup obligation before local purge
    @PluginMethod
    fun stageEnrollmentCleanup(call: PluginCall) {
        // keep default and unsupported builds inert before reading subject input
        if (!automaticCapabilityAvailable()) {
            call.resolve(JSObject().put("staged", false).put("schemaVersion", 1))
            return
        }
        // require one exact transient subject key
        if (call.data.length() != 1 || !call.data.has("subject")) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        val subject = call.getString("subject")
        // reject missing subject ownership
        if (subject == null) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        val staged = AutomaticAndroidRuntimeV1.get(context).stageEnrollmentCleanup(subject)
        call.resolve(JSObject().put("staged", staged).put("schemaVersion", 1))
    }

    // check one cleanup obligation without exposing its owner proof
    @PluginMethod
    fun checkEnrollmentCleanup(call: PluginCall) {
        // keep default and unsupported builds inert before reading subject input
        if (!automaticCapabilityAvailable()) {
            call.resolve(cleanupCheckResult(matches = false, pending = false, valid = true))
            return
        }
        // require one exact transient subject key
        if (call.data.length() != 1 || !call.data.has("subject")) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        val subject = call.getString("subject")
        // reject missing subject ownership
        if (subject == null) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        // avoid runtime creation on a clean supported installation
        if (!AutomaticAndroidRuntimeV1.hasReconciliationMaterial(context)) {
            call.resolve(cleanupCheckResult(matches = false, pending = false, valid = true))
            return
        }
        val checked = AutomaticAndroidRuntimeV1.get(context).checkEnrollmentCleanup(subject)
        call.resolve(cleanupCheckResult(checked.matches, checked.pending, checked.valid))
    }

    // clear only one exactly matched cleanup obligation
    @PluginMethod
    fun clearEnrollmentCleanup(call: PluginCall) {
        // keep default and unsupported builds inert before reading subject input
        if (!automaticCapabilityAvailable()) {
            call.resolve(JSObject().put("cleared", false).put("schemaVersion", 1))
            return
        }
        // require one exact transient subject key
        if (call.data.length() != 1 || !call.data.has("subject")) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        val subject = call.getString("subject")
        // reject missing subject ownership
        if (subject == null) {
            call.reject("Invalid automatic cleanup owner.", "INVALID_IDENTITY")
            return
        }
        val cleared = AutomaticAndroidRuntimeV1.get(context).clearEnrollmentCleanup(subject)
        call.resolve(JSObject().put("cleared", cleared).put("schemaVersion", 1))
    }

    // fetch authoritative status and configuration
    @PluginMethod
    fun reconcile(call: PluginCall) {
        // keep default builds free of native storage and network work
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            call.resolve(JSObject().put("outcome", "retryable"))
            return
        }
        val scheduled = AutomaticAndroidRuntimeV1.get(context).enqueueLifecycleReconciliation()
        call.resolve(JSObject().put("outcome", if (scheduled) "applied" else "retryable"))
    }

    // invalidate and purge before controllable auth teardown
    @PluginMethod
    fun disableAndPurge(call: PluginCall) {
        // require one exact reviewed stop-reason key
        if (call.data.length() != 1 || !call.data.has("reason")) {
            call.reject("Invalid automatic stop reason.", "INVALID_STOP_REASON")
            return
        }
        // keep unsupported and default builds free of secure runtime material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            call.resolve(JSObject().put("purged", true))
            return
        }
        val reason = call.getString("reason")
        val trigger = when (reason) {
            "account_deleted" -> AutomaticStopTriggerV1.ACCOUNT_DELETED
            "identity_lost" -> AutomaticStopTriggerV1.IDENTITY_LOST
            "profile_opted_out" -> AutomaticStopTriggerV1.PROFILE_OPTED_OUT
            "enrollment_revoked" -> AutomaticStopTriggerV1.ENROLLMENT_REVOKED
            "local_disable" -> AutomaticStopTriggerV1.LOCAL_DISABLE
            // branch on the current state
            else -> null
        }
        // reject unknown free-text stop reasons
        if (trigger == null) {
            call.reject("Invalid automatic stop reason.", "INVALID_STOP_REASON")
            return
        }
        val purged = AutomaticAndroidRuntimeV1.get(context).disableAndPurge(trigger)
        // resolve only after the local stop authority and purge are durable
        call.resolve(JSObject().put("purged", purged))
    }

    // return only privacy-minimal aggregate runtime state
    @PluginMethod
    fun getStatus(call: PluginCall) {
        // reject detail-bearing status input
        if (call.data.length() != 0) {
            call.reject("Automatic status takes no input.", "INVALID_INPUT")
            return
        }
        val result = JSObject()
        val projection = AutomaticBridgeStatusV1.inertFor(
            Build.VERSION.SDK_INT,
            BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED,
        // run the bounded callback
        ) ?: run {
            val runtime = AutomaticAndroidRuntimeV1.get(context)
            AutomaticBridgeStatusV1.project(
                status = runtime.status(),
                pendingCandidateCount = runtime.pendingCount(),
                credentialExpiryBucket = runtime.credentialExpiryBucket(),
            )
        }
        // copy only the strict contract keys
        for ((key, value) in projection) {
            result.put(key, value ?: JSONObject.NULL)
        }
        call.resolve(result)
    }

    // test the fixed build and api boundary without runtime construction
    private fun automaticCapabilityAvailable(): Boolean =
        BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED &&
            AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)

    // classify precise foreground authority without reading coordinates
    private fun foregroundPermissionHealth(): String {
        val coarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val fine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        // distinguish approximate-only authorization
        if (coarse && !fine) {
            return "limited_accuracy"
        }
        return if (fine) "authorized" else "denied"
    }

    // build one exact detail-free permission result
    private fun permissionResult(permissionHealth: String, settingsOpened: Boolean): JSObject =
        JSObject()
            .put("permissionHealth", permissionHealth)
            .put("schemaVersion", 1)
            .put("settingsOpened", settingsOpened)

    // build one exact detail-free settings result
    private fun settingsResult(settingsOpened: Boolean): JSObject =
        JSObject()
            .put("schemaVersion", 1)
            .put("settingsOpened", settingsOpened)

    // build one exact detail-free identity proof result
    private fun identityCheckResult(bound: Boolean, matches: Boolean): JSObject =
        JSObject()
            .put("bound", bound)
            .put("matches", matches)
            .put("schemaVersion", 1)

    // build one exact detail-free cleanup proof result
    private fun cleanupCheckResult(matches: Boolean, pending: Boolean, valid: Boolean): JSObject =
        JSObject()
            .put("matches", matches)
            .put("pending", pending)
            .put("schemaVersion", 1)
            .put("valid", valid)
}
