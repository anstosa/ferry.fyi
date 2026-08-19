package fyi.ferry.leaderboards

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.max

private const val AUTOMATIC_V0_GEOFENCE_ACTION = "fyi.ferry.leaderboards.V0_GEOFENCE"
private const val AUTOMATIC_V0_GEOFENCE_PREFIX = "v0"
private const val AUTOMATIC_V0_BACKGROUND_LOCATION_PERMISSION = "android.permission.ACCESS_BACKGROUND_LOCATION"
private const val AUTOMATIC_V0_MAX_REGION_COUNT = 20
private const val AUTOMATIC_V0_LOCATION_TIMEOUT_SECONDS = 15L
private const val AUTOMATIC_V0_LOCATION_MAX_AGE_MS = 30_000L
private const val AUTOMATIC_V0_TRUSTED_TIME_MAGIC = 0x4656593054494d45L
private const val AUTOMATIC_V0_REGISTRATION_MAGIC = 0x4656593052454749L

// define the native contract
internal enum class AutomaticV0ControlStatus {
    UNSUPPORTED_OS,
    DIAGNOSTIC_DISABLED,
    PERMISSION_MISSING,
    INVALID_CONFIG,
    NOT_REGISTERED,
    NOT_PREPARED,
    READY,
}

// define the native contract
internal class AutomaticV0AndroidDiagnosticControl(private val context: Context) {
    private val registrar = AutomaticV0AndroidRegionRegistrar(context)

    // install one complete prepared diagnostic generation
    fun install(
        serverTimeMs: Long,
        config: AutomaticTerminalConfigGeneration,
        onComplete: (AutomaticV0ControlStatus) -> Unit,
    ) {
        val currentStatus = platformStatus()
        // stop before native material when the platform is ineligible
        if (currentStatus != null) {
            onComplete(currentStatus)
            return
        }
        // reject incomplete or mutated configuration before network work
        if (!AutomaticV0DiagnosticConfig.isValid(config)) {
            onComplete(AutomaticV0ControlStatus.INVALID_CONFIG)
            return
        }
        // require trusted time and a fresh fleet cache before registration
        if (!AutomaticV0AndroidRuntime.onSuccessfulForegroundContact(context, serverTimeMs)) {
            onComplete(AutomaticV0ControlStatus.NOT_PREPARED)
            return
        }
        // run the bounded callback
        registrar.register(config.regions) { success ->
            onComplete(if (success) status() else AutomaticV0ControlStatus.NOT_REGISTERED)
        }
    }

    // remove the installed diagnostic namespace
    fun uninstall(onComplete: (AutomaticV0ControlStatus) -> Unit) {
        registrar.unregister {
            onComplete(status())
        }
    }

    // report one fixed redacted readiness state
    fun status(): AutomaticV0ControlStatus {
        val currentStatus = platformStatus()
        // return the fixed platform failure first
        if (currentStatus != null) {
            return currentStatus
        }
        // require a successful owned registration marker
        if (!registrar.hasRegistrationMarker()) {
            return AutomaticV0ControlStatus.NOT_REGISTERED
        }
        val trustedTime = AutomaticV0AndroidTrustedTime(context.noBackupFilesDir)
        // require both prepared native inputs without network work
        if (
            trustedTime.trustedNowMs() == null ||
            AutomaticV0NoBackupFleetCacheStore(context.noBackupFilesDir).read() == null
        ) {
            return AutomaticV0ControlStatus.NOT_PREPARED
        }
        return AutomaticV0ControlStatus.READY
    }

    // classify the platform without touching automatic state
    private fun platformStatus(): AutomaticV0ControlStatus? {
        // reject pre-android-q platforms
        if (Build.VERSION.SDK_INT < AUTOMATIC_V0_MIN_SUPPORTED_SDK) {
            return AutomaticV0ControlStatus.UNSUPPORTED_OS
        }
        // keep all ordinary builds inert
        if (!fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED) {
            return AutomaticV0ControlStatus.DIAGNOSTIC_DISABLED
        }
        // require explicit foreground and background grants
        if (!AutomaticV0AndroidPermissions.hasRequiredLocation(context)) {
            return AutomaticV0ControlStatus.PERMISSION_MISSING
        }
        return null
    }
}

// define the native contract
internal object AutomaticV0DiagnosticConfig {
    // verify one complete immutable terminal generation
    fun isValid(config: AutomaticTerminalConfigGeneration): Boolean {
        // require fixed schema generations count and canonical content
        if (
            config.schemaVersion != 1 ||
            config.configGeneration.value !in 1..9_007_199_254_740_991L ||
            config.serverPolicyGeneration.value !in 0..9_007_199_254_740_991L ||
            !config.contentHashHex.matches(Regex("[0-9a-f]{64}")) ||
            AutomaticPayloadDigestV1.sha256Hex(
                AutomaticTerminalRegionCanonicalizerV1.canonicalBytes(config.regions),
            ) != config.contentHashHex ||
            !AutomaticV0DiagnosticRegions.isValid(config.regions)
        ) {
            return false
        }
        // run the bounded callback
        return config.regions.all { region -> region.configGeneration == config.configGeneration }
    }
}

// define the native contract
internal object AutomaticV0DiagnosticRegions {
    // verify one bounded fixed region set
    fun isValid(regions: List<AutomaticTerminalRegion>): Boolean {
        // require one nonempty immutable generation
        if (
            regions.isEmpty() ||
            regions.size > AUTOMATIC_V0_MAX_REGION_COUNT ||
            // run the bounded callback
            regions.map { it.terminalId }.toSet().size != regions.size ||
            // run the bounded callback
            regions.map { it.configGeneration }.toSet().size != 1
        ) {
            return false
        }
        // run the bounded callback
        return regions.all { region ->
            region.terminalId.isNotEmpty() &&
                region.terminalId.toByteArray(Charsets.UTF_8).size <= 128 &&
                // run the bounded callback
                region.terminalId.none { character -> character.code <= 0x1f || character.code == 0x7f } &&
                region.configGeneration.value in 1..9_007_199_254_740_991L &&
                region.latitudeE7 in -900_000_000..900_000_000 &&
                region.longitudeE7 in -1_800_000_000..1_800_000_000 &&
                region.radiusMillimeters in 1..0xffff_ffffL
        }
    }
}

// define the native contract
internal object AutomaticV0AndroidPermissions {
    // require fine foreground and android-q background access
    fun hasRequiredLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, AUTOMATIC_V0_BACKGROUND_LOCATION_PERMISSION) ==
            PackageManager.PERMISSION_GRANTED
}

// define the native contract
internal class AutomaticV0AndroidRegionRegistrar(private val context: Context) {
    private val client = LocationServices.getGeofencingClient(context)
    private val registrationMarker = AutomaticV0RegistrationMarker(context.noBackupFilesDir)

    // register one complete fixed generation
    @SuppressLint("MissingPermission")
    fun register(
        regions: List<AutomaticTerminalRegion>,
        onComplete: (Boolean) -> Unit,
    ) {
        // fail before platform material on unsupported or disabled builds
        if (
            !fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED ||
            Build.VERSION.SDK_INT < AUTOMATIC_V0_MIN_SUPPORTED_SDK ||
            !AutomaticV0AndroidPermissions.hasRequiredLocation(context)
        ) {
            onComplete(false)
            return
        }
        // require one bounded immutable generation
        if (!AutomaticV0DiagnosticRegions.isValid(regions)) {
            onComplete(false)
            return
        }
        // run the bounded callback
        val geofences = regions.map { region ->
            Geofence.Builder()
                .setRequestId(requestId(region))
                .setCircularRegion(
                    region.latitudeE7 / 10_000_000.0,
                    region.longitudeE7 / 10_000_000.0,
                    region.radiusMillimeters / 1_000.0f,
                )
                .setTransitionTypes(
                    Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT,
                )
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .build()
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(0)
            .addGeofences(geofences)
            .build()
        val pendingIntent = pendingIntent()
        registrationMarker.clear()
        client.addGeofences(request, pendingIntent)
            // run the bounded callback
            .addOnSuccessListener {
                val generation = regions.first().configGeneration.value
                // remove platform state when the redacted marker cannot be stored
                if (!registrationMarker.record(regions.size, generation)) {
                    // run the bounded callback
                    client.removeGeofences(pendingIntent).addOnCompleteListener { onComplete(false) }
                // branch on the current state
                } else {
                    onComplete(true)
                }
            }
            // run the bounded callback
            .addOnFailureListener {
                // remove any partially accepted owned set
                client.removeGeofences(pendingIntent).addOnCompleteListener {
                    registrationMarker.clear()
                    onComplete(false)
                }
            }
    }

    // remove the complete diagnostic namespace
    fun unregister(onComplete: (Boolean) -> Unit) {
        client.removeGeofences(pendingIntent())
            // run the bounded callback
            .addOnCompleteListener { task ->
                // clear the marker only after platform removal succeeds
                if (task.isSuccessful) {
                    registrationMarker.clear()
                }
                onComplete(task.isSuccessful)
            }
    }

    // expose only redacted registration presence
    fun hasRegistrationMarker(): Boolean = registrationMarker.isRegistered()

    // build one explicit non-exported receiver target
    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, AutomaticV0GeofenceReceiver::class.java).setAction(AUTOMATIC_V0_GEOFENCE_ACTION)
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    // encode only generation and terminal identity locally
    private fun requestId(region: AutomaticTerminalRegion): String =
        "$AUTOMATIC_V0_GEOFENCE_PREFIX:${region.configGeneration.value}:${region.terminalId}"
}

// define the native contract
internal class AutomaticV0RegistrationMarker(noBackupFilesDir: File) {
    private val markerFile = File(noBackupFilesDir, "leaderboard-v0-registration.bin")

    // store only count and generation after platform success
    fun record(regionCount: Int, generation: Long): Boolean {
        // reject invalid redacted marker values
        if (regionCount !in 1..AUTOMATIC_V0_MAX_REGION_COUNT || generation <= 0L) {
            return false
        }
        return try {
            // run the bounded callback
            FileOutputStream(markerFile).use { fileOutput ->
                // run the bounded callback
                DataOutputStream(fileOutput).use { output ->
                    output.writeLong(AUTOMATIC_V0_REGISTRATION_MAGIC)
                    output.writeInt(regionCount)
                    output.writeLong(generation)
                    output.flush()
                    fileOutput.fd.sync()
                }
            }
            true
        // fail closed on the error
        } catch (_: Exception) {
            clear()
            false
        }
    }

    // validate one exact redacted marker
    fun isRegistered(): Boolean = try {
        // run the bounded callback
        DataInputStream(FileInputStream(markerFile)).use { input ->
            // require the fixed format and bounded values
            if (input.readLong() != AUTOMATIC_V0_REGISTRATION_MAGIC) {
                return false
            }
            val regionCount = input.readInt()
            val generation = input.readLong()
            regionCount in 1..AUTOMATIC_V0_MAX_REGION_COUNT && generation > 0L && input.available() == 0
        }
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // remove the redacted registration marker
    fun clear() {
        markerFile.delete()
    }
}

// define the native contract
internal class AutomaticV0AndroidOneShotLocationAdapter(
    context: Context,
    private val capturedAtMs: () -> Long?,
) : AutomaticV0OneShotLocationAdapter {
    private val client = LocationServices.getFusedLocationProviderClient(context)

    // issue exactly one bounded platform request
    @SuppressLint("MissingPermission")
    override fun requestOneFix(): AutomaticV0LocationFix? {
        val cancellation = CancellationTokenSource()
        return try {
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0L)
                .setDurationMillis(TimeUnit.SECONDS.toMillis(AUTOMATIC_V0_LOCATION_TIMEOUT_SECONDS))
                .build()
            val location = Tasks.await(
                client.getCurrentLocation(request, cancellation.token),
                AUTOMATIC_V0_LOCATION_TIMEOUT_SECONDS,
                TimeUnit.SECONDS,
            ) ?: return null
            val observedElapsedMs = TimeUnit.NANOSECONDS.toMillis(location.elapsedRealtimeNanos)
            // reject stale or future platform observations
            if (!AutomaticV0AndroidLocationAge.isAcceptable(SystemClock.elapsedRealtime(), observedElapsedMs)) {
                return null
            }
            // reject malformed platform values before scaling
            if (
                !location.latitude.isFinite() ||
                !location.longitude.isFinite() ||
                location.latitude !in -90.0..90.0 ||
                location.longitude !in -180.0..180.0 ||
                !location.hasAccuracy() ||
                !location.accuracy.isFinite() ||
                location.accuracy < 0.0f
            ) {
                return null
            }
            val capturedAtMs = capturedAtMs() ?: return null
            AutomaticV0LocationFix(
                latitudeE7 = (location.latitude * 10_000_000.0).toInt(),
                longitudeE7 = (location.longitude * 10_000_000.0).toInt(),
                accuracyMillimeters = (location.accuracy * 1_000.0).toLong(),
                capturedAtMs = capturedAtMs,
            )
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            cancellation.cancel()
        }
    }
}

// define the native contract
internal object AutomaticV0AndroidLocationAge {
    // enforce one fixed platform-location age
    fun isAcceptable(nowElapsedMs: Long, observedElapsedMs: Long): Boolean {
        val ageMs = try {
            Math.subtractExact(nowElapsedMs, observedElapsedMs)
        // fail closed on the error
        } catch (_: ArithmeticException) {
            return false
        }
        return ageMs in 0..AUTOMATIC_V0_LOCATION_MAX_AGE_MS
    }
}

// define the native contract
internal class AutomaticV0GeofenceReceiver : BroadcastReceiver() {
    // accept only one legitimate region event
    override fun onReceive(context: Context, intent: Intent) {
        // reject unsupported disabled or forged actions
        if (
            !fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED ||
            Build.VERSION.SDK_INT < AUTOMATIC_V0_MIN_SUPPORTED_SDK ||
            intent.action != AUTOMATIC_V0_GEOFENCE_ACTION
        ) {
            return
        }
        val event = GeofencingEvent.fromIntent(intent) ?: return
        // require one successful owned transition
        if (
            event.hasError() ||
            event.geofenceTransition !in setOf(
                Geofence.GEOFENCE_TRANSITION_ENTER,
                Geofence.GEOFENCE_TRANSITION_EXIT,
            ) ||
            event.triggeringGeofences?.size != 1
        ) {
            AutomaticV0AndroidMetricSink.recordAdapterOutcome(
                AutomaticV0AdapterOutcome.REGION_CALLBACK_INVALID,
                AutomaticV0DurationBucket.UNDER_ONE_SECOND,
            )
            return
        }
        // run the bounded callback
        val callback = parseRequestId(event.triggeringGeofences!!.single().requestId) ?: run {
            AutomaticV0AndroidMetricSink.recordAdapterOutcome(
                AutomaticV0AdapterOutcome.REGION_CALLBACK_INVALID,
                AutomaticV0DurationBucket.UNDER_ONE_SECOND,
            )
            return
        }
        val transition = event.geofenceTransition
        val pendingResult = goAsync()
        // move bounded network and location work off the receiver thread
        thread(name = "automatic-v0-diagnostic", isDaemon = true) {
            // attempt the protected operation
            try {
                // dispatch one bounded detector path
                if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) {
                    AutomaticV0AndroidRuntime.runEntry(context.applicationContext, callback)
                // branch on the current state
                } else {
                    AutomaticV0AndroidRuntime.runExit(context.applicationContext, callback)
                }
            // release protected state
            } finally {
                pendingResult.finish()
            }
        }
    }

    // define the native companion
    companion object {
        // parse one fixed owned request id
        internal fun parseRequestId(requestId: String): AutomaticV0TerminalExitCallback? {
            val parts = requestId.split(':', limit = 3)
            // require the complete fixed namespace
            if (parts.size != 3 || parts[0] != AUTOMATIC_V0_GEOFENCE_PREFIX || parts[2].isEmpty()) {
                return null
            }
            val generation = parts[1].toLongOrNull() ?: return null
            // reject nonpositive generations
            if (generation <= 0L) {
                return null
            }
            return AutomaticV0TerminalExitCallback(parts[2], ConfigGeneration(generation))
        }
    }
}

// define the native contract
internal object AutomaticV0AndroidRuntime {
    // refresh time and due fleet cache after a foreground contact
    fun onSuccessfulForegroundContact(context: Context, serverTimeMs: Long): Boolean =
        refreshTimeAndPrefetch(context, serverTimeMs)

    // refresh time and due fleet cache after a policy contact
    fun onSuccessfulPolicyContact(context: Context, serverTimeMs: Long): Boolean =
        refreshTimeAndPrefetch(context, serverTimeMs)

    // run one terminal-entry callback without fleet work
    fun runEntry(context: Context, callback: AutomaticV0TerminalExitCallback): AutomaticV0RunEvidence {
        val trustedTime = AutomaticV0AndroidTrustedTime(context.noBackupFilesDir)
        return AutomaticT0DiagnosticRunner(
            sdkInt = Build.VERSION.SDK_INT,
            diagnosticEnabled = fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED,
            monotonicNowMs = SystemClock::elapsedRealtime,
            locationAdapter = AutomaticV0AndroidOneShotLocationAdapter(context, trustedTime::capturedAtMs),
            metricSink = AutomaticV0AndroidMetricSink,
        ).onTerminalEntry(callback)
    }

    // run one exit callback and discard all transient state
    fun runExit(context: Context, callback: AutomaticV0TerminalExitCallback): AutomaticV0RunEvidence {
        val trustedTime = AutomaticV0AndroidTrustedTime(context.noBackupFilesDir)
        val fleetRepository = AutomaticV0FleetContextRepository(
            AutomaticV0NoBackupFleetCacheStore(context.noBackupFilesDir),
            AutomaticV0FleetClient("https://ferry.fyi", AutomaticV0UrlConnectionTransport()),
            trustedTime::trustedNowMs,
        )
        val runner = AutomaticV0DiagnosticRunner(
            sdkInt = Build.VERSION.SDK_INT,
            diagnosticEnabled = fyi.ferry.BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED,
            trustedNowMs = trustedTime::trustedNowMs,
            monotonicNowMs = SystemClock::elapsedRealtime,
            locationAdapter = AutomaticV0AndroidOneShotLocationAdapter(context, trustedTime::capturedAtMs),
            fleetRepository = fleetRepository,
            matcher = AutomaticV0VesselMatcher(),
            metricSink = AutomaticV0AndroidMetricSink,
            lifecycleProbe = AutomaticV0AndroidLifecycleProbe,
        )
        return runner.onTerminalExit(callback)
    }

    // refresh the native anchor and bounded named cache
    private fun refreshTimeAndPrefetch(context: Context, serverTimeMs: Long): Boolean {
        val trustedTime = AutomaticV0AndroidTrustedTime(context.noBackupFilesDir)
        // require a valid https-derived anchor first
        if (!trustedTime.refresh(serverTimeMs)) {
            return false
        }
        val trustedNowMs = trustedTime.trustedNowMs() ?: return false
        return AutomaticV0FleetContextRepository(
            AutomaticV0NoBackupFleetCacheStore(context.noBackupFilesDir),
            AutomaticV0FleetClient("https://ferry.fyi", AutomaticV0UrlConnectionTransport()),
            trustedTime::trustedNowMs,
        ).prefetchIfDue(trustedNowMs)
    }
}

// define the native contract
internal enum class AutomaticV0AdapterOutcome {
    REGION_CALLBACK_INVALID,
}

// define the native contract
internal object AutomaticV0AdapterTelemetry {
    // format only fixed adapter fields
    fun line(outcome: AutomaticV0AdapterOutcome, durationBucket: AutomaticV0DurationBucket): String =
        "schema=1 capability=0 platform=android detector=region_v0 " +
            "outcome=${outcome.name} count=1 duration=${durationBucket.name}"
}

// define the native contract
private object AutomaticV0AndroidMetricSink : AutomaticV0MetricSink {
    // record only fixed aggregate fields
    override fun record(metric: AutomaticV0Metric) {
        Log.i(
            "AutomaticV0",
            "schema=${metric.schemaVersion} capability=${metric.capabilityVersion} " +
                "platform=${metric.platformCohort} detector=${metric.detectorKind.name} " +
                "outcome=${metric.outcome.name} count=${metric.count} duration=${metric.durationBucket.name}",
        )
    }

    // record one closed adapter outcome
    fun recordAdapterOutcome(
        outcome: AutomaticV0AdapterOutcome,
        durationBucket: AutomaticV0DurationBucket,
    ) {
        Log.i("AutomaticV0", AutomaticV0AdapterTelemetry.line(outcome, durationBucket))
    }
}

// define the native contract
private object AutomaticV0AndroidLifecycleProbe : AutomaticV0LifecycleProbe {
    // avoid candidate detail exposure
    override fun candidateConstructed() = Unit

    // avoid candidate detail exposure
    override fun candidateWiped() = Unit
}

// define the native contract
private class AutomaticV0AndroidTrustedTime(private val noBackupFilesDir: File) {
    private val anchorFile = File(noBackupFilesDir, "leaderboard-v0-time-anchor.bin")

    // persist one https server anchor
    fun refresh(serverTimeMs: Long): Boolean {
        val bootIdentity = bootIdentity() ?: return false
        // reject invalid server time
        if (serverTimeMs !in 0..9_007_199_254_740_991L) {
            return false
        }
        return try {
            // run the bounded callback
            FileOutputStream(anchorFile).use { fileOutput ->
                // run the bounded callback
                DataOutputStream(fileOutput).use { output ->
                    output.writeLong(AUTOMATIC_V0_TRUSTED_TIME_MAGIC)
                    output.writeUTF(bootIdentity)
                    output.writeLong(SystemClock.elapsedRealtime())
                    output.writeLong(System.currentTimeMillis())
                    output.writeLong(serverTimeMs)
                    output.flush()
                    fileOutput.fd.sync()
                }
            }
            true
        // fail closed on the error
        } catch (_: Exception) {
            anchorFile.delete()
            false
        }
    }

    // derive conservative current time
    fun trustedNowMs(): Long? {
        val anchor = readAnchor() ?: return null
        val currentBoot = bootIdentity() ?: return null
        // reject rebooted or regressed anchors
        if (anchor.bootIdentity != currentBoot || SystemClock.elapsedRealtime() < anchor.elapsedRealtimeMs) {
            return null
        }
        val monotonicElapsed = SystemClock.elapsedRealtime() - anchor.elapsedRealtimeMs
        val wallElapsed = (System.currentTimeMillis() - anchor.wallTimeMs).coerceAtLeast(0L)
        return addWithoutOverflow(anchor.serverTimeMs, max(monotonicElapsed, wallElapsed))
    }

    // derive capture time from monotonic progress only
    fun capturedAtMs(): Long? {
        val anchor = readAnchor() ?: return null
        val currentBoot = bootIdentity() ?: return null
        // reject rebooted or regressed anchors
        if (anchor.bootIdentity != currentBoot || SystemClock.elapsedRealtime() < anchor.elapsedRealtimeMs) {
            return null
        }
        return addWithoutOverflow(anchor.serverTimeMs, SystemClock.elapsedRealtime() - anchor.elapsedRealtimeMs)
    }

    // read one exact anchor file
    private fun readAnchor(): Anchor? = try {
        // run the bounded callback
        DataInputStream(FileInputStream(anchorFile)).use { input ->
            // reject the wrong file format
            if (input.readLong() != AUTOMATIC_V0_TRUSTED_TIME_MAGIC) {
                return null
            }
            val anchor = Anchor(
                bootIdentity = input.readUTF(),
                elapsedRealtimeMs = input.readLong(),
                wallTimeMs = input.readLong(),
                serverTimeMs = input.readLong(),
            )
            // reject trailing bytes
            if (input.available() != 0) {
                return null
            }
            anchor
        }
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // read the linux boot identity
    private fun bootIdentity(): String? = try {
        File("/proc/sys/kernel/random/boot_id").readText().trim().takeIf(String::isNotEmpty)
    // fail closed on the error
    } catch (_: Exception) {
        null
    }

    // add within safe integer range
    private fun addWithoutOverflow(left: Long, right: Long): Long? {
        // reject invalid time arithmetic
        if (left < 0L || right < 0L || left > 9_007_199_254_740_991L - right) {
            return null
        }
        return left + right
    }

    // define the native contract
    private data class Anchor(
        val bootIdentity: String,
        val elapsedRealtimeMs: Long,
        val wallTimeMs: Long,
        val serverTimeMs: Long,
    )
}
