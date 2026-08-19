package fyi.ferry.leaderboards

import android.Manifest
import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.os.UserManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import fyi.ferry.BuildConfig
import fyi.ferry.R
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

private const val AUTOMATIC_GEOFENCE_ACTION_V1 = "fyi.ferry.leaderboards.AUTOMATIC_GEOFENCE_V1"
private const val AUTOMATIC_GEOFENCE_PREFIX_V1 = "automatic-v1"
private const val AUTOMATIC_UPLOAD_WORK_V1 = "leaderboard-automatic-upload-v1"
private const val AUTOMATIC_GEOFENCE_WORK_V1 = "leaderboard-automatic-geofence-v1"
private const val AUTOMATIC_RECONCILE_WORK_V1 = "leaderboard-automatic-reconcile-v1"
private const val AUTOMATIC_MAX_REGION_COUNT_V1 = 20
private const val AUTOMATIC_LOCATION_TIMEOUT_SECONDS_V1 = 15L
private const val AUTOMATIC_LOCATION_MAX_AGE_MS_V1 = 30_000L
private const val AUTOMATIC_HTTP_TIMEOUT_MS_V1 = 15_000
private const val AUTOMATIC_HTTP_MAX_RESPONSE_BYTES_V1 = 128 * 1_024
private const val AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1 = 3L
private const val AUTOMATIC_NOTIFICATION_CHANNEL_V1 = "leaderboard-automatic-credit"
private const val AUTOMATIC_NOTIFICATION_ID_V1 = 74_103
private const val AUTOMATIC_PRODUCTION_ORIGIN_V1 = "https://ferry.fyi"

// define the native contract
internal data class AutomaticGeofenceCallbackV1(
    val terminalId: String,
    val configGeneration: ConfigGeneration,
    val localWorkGeneration: LocalWorkGeneration,
    val transition: AutomaticGeofenceTransitionV1,
)

// define the native contract
internal object AutomaticGeofenceRequestIdV1 {
    // encode only public terminal and config identity
    fun encode(callback: AutomaticGeofenceCallbackV1): String =
        "$AUTOMATIC_GEOFENCE_PREFIX_V1:${callback.localWorkGeneration.value}:" +
            "${callback.configGeneration.value}:${callback.terminalId}"

    // parse one fixed owned request id
    fun parse(requestId: String): AutomaticGeofenceCallbackV1? {
        val parts = requestId.split(':', limit = 4)
        // require the complete owned namespace
        if (parts.size != 4 || parts[0] != AUTOMATIC_GEOFENCE_PREFIX_V1 || parts[3].isEmpty()) {
            return null
        }
        val localGeneration = parts[1].toLongOrNull() ?: return null
        val generation = parts[2].toLongOrNull() ?: return null
        // reject invalid immutable generations
        if (localGeneration < 0L || generation <= 0L) {
            return null
        }
        return AutomaticGeofenceCallbackV1(
            parts[3],
            ConfigGeneration(generation),
            LocalWorkGeneration(localGeneration),
            AutomaticGeofenceTransitionV1.ENTER,
        )
    }
}

// define the native contract
internal interface AutomaticOwnedRegionPlatformV1 {
    // add one complete owned platform generation
    fun add(config: AutomaticTerminalConfigGeneration): Boolean

    // add one generation-bound callback namespace
    fun add(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean = add(config)

    // remove every region owned by the stable pending intent
    fun removeAll(): Boolean

    // update both owned passive components
    fun setReceiversEnabled(enabled: Boolean): Boolean
}

// define the native contract
internal class AutomaticOwnedRegionRegistrationV1(
    private val platform: AutomaticOwnedRegionPlatformV1,
) : TerminalRegionGenerationStager, TerminalRegionRegistrationHealthV1, AutomaticLocalGenerationRegionStagerV1 {
    private val staged = mutableMapOf<ConfigGeneration, List<AutomaticTerminalRegion>>()
    private var registeredConfig: AutomaticTerminalConfigGeneration? = null
    private var registeredLocalGeneration: LocalWorkGeneration? = null
    private var pendingConfig: AutomaticTerminalConfigGeneration? = null
    private var pendingLocalGeneration: LocalWorkGeneration? = null
    private var pendingPreviousConfig: AutomaticTerminalConfigGeneration? = null
    private var pendingPreviousLocalGeneration: LocalWorkGeneration? = null
    private var registrationUsable = false

    // replace any process-owned or recovered generation before staging
    override fun stage(config: AutomaticTerminalConfigGeneration): Boolean {
        return stage(config, LocalWorkGeneration(0))
    }

    // replace one owned generation with exact callback work identity
    override fun stage(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean {
        pendingPreviousConfig = registeredConfig
        pendingPreviousLocalGeneration = registeredLocalGeneration
        pendingConfig = null
        pendingLocalGeneration = null
        registrationUsable = false
        val removed = platform.removeAll()
        val disabled = platform.setReceiversEnabled(false)
        staged.clear()
        // fail closed when old ownership cannot converge
        if (!removed || !disabled) {
            restorePrevious()
            return false
        }
        // register only the complete replacement generation
        if (!platform.add(config, localWorkGeneration)) {
            platform.removeAll()
            restorePrevious()
            return false
        }
        pendingConfig = config
        pendingLocalGeneration = localWorkGeneration
        staged[config.configGeneration] = config.regions
        return true
    }

    // return the exact in-process staged terminal set
    override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> =
        // run the bounded callback
        staged[configGeneration].orEmpty().map { region -> region.terminalId }.toSet()

    // expose receivers only after complete registration
    override fun commit(configGeneration: ConfigGeneration): Boolean {
        // require the current replacement generation
        if (staged[configGeneration].isNullOrEmpty()) {
            return false
        }
        val config = pendingConfig
        // require the full pending config identity
        if (config == null || config.configGeneration != configGeneration) {
            return false
        }
        val enabled = platform.setReceiversEnabled(true)
        // commit only after both platform components are exposed
        if (enabled) {
            registeredConfig = config
            registeredLocalGeneration = pendingLocalGeneration
            pendingConfig = null
            pendingLocalGeneration = null
            pendingPreviousConfig = null
            pendingPreviousLocalGeneration = null
            registrationUsable = true
        }
        return enabled
    }

    // discard the currently staged generation only
    override fun discard(configGeneration: ConfigGeneration) {
        // ignore a superseded generation already removed during replacement
        if (!staged.containsKey(configGeneration)) {
            return
        }
        platform.removeAll()
        staged.clear()
        platform.setReceiversEnabled(false)
        // restore only when discarding a failed replacement
        if (pendingConfig?.configGeneration == configGeneration) {
            pendingConfig = null
            pendingLocalGeneration = null
            restorePrevious()
        // branch on the current state
        } else {
            registeredConfig = null
            registeredLocalGeneration = null
            pendingPreviousConfig = null
            pendingPreviousLocalGeneration = null
            registrationUsable = false
        }
    }

    // converge stop even after process replacement
    fun discardAll(): Boolean {
        val removed = platform.removeAll()
        staged.clear()
        registeredConfig = null
        registeredLocalGeneration = null
        pendingConfig = null
        pendingLocalGeneration = null
        pendingPreviousConfig = null
        pendingPreviousLocalGeneration = null
        registrationUsable = false
        val disabled = platform.setReceiversEnabled(false)
        return removed && disabled
    }

    // expose truthful complete-registration health
    override fun hasUsableRegistration(): Boolean = registrationUsable

    // restore a verified prior generation after replacement failure
    private fun restorePrevious(): Boolean {
        val previous = pendingPreviousConfig
        val previousLocalGeneration = pendingPreviousLocalGeneration
        pendingPreviousConfig = null
        pendingPreviousLocalGeneration = null
        pendingConfig = null
        pendingLocalGeneration = null
        staged.clear()
        // remain disabled when no prior generation is known
        if (previous == null || previousLocalGeneration == null) {
            registeredConfig = null
            registeredLocalGeneration = null
            registrationUsable = false
            platform.setReceiversEnabled(false)
            return false
        }
        val restored = platform.add(previous, previousLocalGeneration) && platform.setReceiversEnabled(true)
        // expose only a complete restored generation
        if (restored) {
            registeredConfig = previous
            registeredLocalGeneration = previousLocalGeneration
            staged[previous.configGeneration] = previous.regions
            registrationUsable = true
            return true
        }
        platform.removeAll()
        platform.setReceiversEnabled(false)
        registeredConfig = null
        registeredLocalGeneration = null
        registrationUsable = false
        return false
    }
}

// define the native contract
internal class AutomaticAndroidRegionStagerV1(
    private val registration: AutomaticOwnedRegionRegistrationV1,
    private val eligible: () -> Boolean,
) :
    TerminalRegionGenerationStager,
    AutomaticLocalGenerationRegionStagerV1,
    TerminalRegionRegistrationHealthV1 {
    // bind the production platform and eligibility gates
    constructor(context: Context) : this(
        AutomaticOwnedRegionRegistrationV1(AutomaticAndroidOwnedRegionPlatformV1(context)),
        {
            BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED &&
                AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) &&
                AutomaticAndroidPermissionsV1.hasRequiredLocation(context)
        },
    )

    // stage one eligible complete generation
    override fun stage(config: AutomaticTerminalConfigGeneration): Boolean {
        return stage(config, LocalWorkGeneration(0))
    }

    // stage production request ids under the exact local work generation
    override fun stage(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean {
        // keep ordinary builds and unsupported devices inert
        if (!eligible()) {
            return false
        }
        return registration.stage(config, localWorkGeneration)
    }

    // return the exact staged public terminal set
    override fun stagedTerminalIds(configGeneration: ConfigGeneration): Set<String> =
        registration.stagedTerminalIds(configGeneration)

    // expose receivers only after registration
    override fun commit(configGeneration: ConfigGeneration): Boolean = registration.commit(configGeneration)

    // discard one staged generation
    override fun discard(configGeneration: ConfigGeneration) = registration.discard(configGeneration)

    // converge every owned generation across process lifetimes
    fun discardAll(): Boolean = registration.discardAll()

    // expose the production registration's complete health
    override fun hasUsableRegistration(): Boolean = registration.hasUsableRegistration()
}

// define the native contract
internal class AutomaticAndroidOwnedRegionPlatformV1(private val context: Context) : AutomaticOwnedRegionPlatformV1 {
    private val client = LocationServices.getGeofencingClient(context)

    // add one complete generation under the stable pending intent
    @SuppressLint("MissingPermission")
    override fun add(config: AutomaticTerminalConfigGeneration): Boolean {
        return add(config, LocalWorkGeneration(0))
    }

    // add one complete generation with generation-bound request ids
    @SuppressLint("MissingPermission")
    override fun add(config: AutomaticTerminalConfigGeneration, localWorkGeneration: LocalWorkGeneration): Boolean {
        // reject runtime permission loss before the platform call
        if (!AutomaticAndroidPermissionsV1.hasRequiredLocation(context)) {
            return false
        }
        // run the bounded callback
        val geofences = config.regions.map { region ->
            Geofence.Builder()
                .setRequestId(
                    AutomaticGeofenceRequestIdV1.encode(
                        AutomaticGeofenceCallbackV1(
                            region.terminalId,
                            region.configGeneration,
                            localWorkGeneration,
                            AutomaticGeofenceTransitionV1.ENTER,
                        ),
                    ),
                )
                .setCircularRegion(
                    region.latitudeE7 / 10_000_000.0,
                    region.longitudeE7 / 10_000_000.0,
                    region.radiusMillimeters / 1_000.0f,
                )
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .build()
        }
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(0)
            .addGeofences(geofences)
            .build()
        return try {
            Tasks.await(
                client.addGeofences(request, pendingIntent()),
                AUTOMATIC_LOCATION_TIMEOUT_SECONDS_V1,
                TimeUnit.SECONDS,
            )
            true
        // fail closed on the error
        } catch (_: Exception) {
            removeAll()
            false
        }
    }

    // remove every fixed-pending-intent registration
    override fun removeAll(): Boolean = try {
        Tasks.await(client.removeGeofences(pendingIntent()), AUTOMATIC_LOCATION_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // enable only the explicitly targeted receivers
    override fun setReceiversEnabled(enabled: Boolean): Boolean = try {
        val state = if (enabled) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        // branch on the current state
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        // update both passive entry points together
        for (receiver in listOf(AutomaticGeofenceReceiverV1::class.java, AutomaticBootReceiverV1::class.java)) {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, receiver),
                state,
                PackageManager.DONT_KILL_APP,
            )
        }
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // build one explicit non-exported receiver target
    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, AutomaticGeofenceReceiverV1::class.java)
            .setAction(AUTOMATIC_GEOFENCE_ACTION_V1)
            .setPackage(context.packageName)
        return PendingIntent.getBroadcast(
            context,
            1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }
}

// define the native contract
internal object AutomaticAndroidPermissionsV1 {
    // classify the exact automatic location gate without starting work
    fun decision(context: Context): AutomaticLocationPermissionDecisionV1 =
        AutomaticLocationPermissionDecisionV1.evaluate(
            coarseGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED,
            fineGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED,
            backgroundGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
        )

    // require fine foreground and android-q background access
    @TargetApi(Build.VERSION_CODES.Q)
    fun hasRequiredLocation(context: Context): Boolean = decision(context).stopTrigger == null
}

// define the native contract
internal data class AutomaticLocationPermissionDecisionV1(
    val health: AutomaticPermissionHealthV1,
    val stopTrigger: AutomaticStopTriggerV1?,
) {
    // define the native companion
    companion object {
        // distinguish denial background revocation and approximate-only access
        fun evaluate(
            coarseGranted: Boolean,
            fineGranted: Boolean,
            backgroundGranted: Boolean,
        ): AutomaticLocationPermissionDecisionV1 {
            // treat approximate-only access as an explicit accuracy downgrade
            if (coarseGranted && !fineGranted) {
                return AutomaticLocationPermissionDecisionV1(
                    AutomaticPermissionHealthV1.LIMITED_ACCURACY,
                    AutomaticStopTriggerV1.ACCURACY_DOWNGRADED,
                )
            }
            // treat missing foreground or background authority as revocation
            if (!fineGranted || !backgroundGranted) {
                return AutomaticLocationPermissionDecisionV1(
                    AutomaticPermissionHealthV1.DENIED,
                    AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED,
                )
            }
            return AutomaticLocationPermissionDecisionV1(AutomaticPermissionHealthV1.AUTHORIZED, null)
        }
    }

    // apply one durable stop before callback consumption
    fun enforce(coordinator: AutomaticCheckinPolicyCoordinatorV1): Boolean {
        coordinator.updatePermission(health)
        val trigger = stopTrigger
        // preserve active work only when every permission gate remains available
        if (trigger == null) {
            return true
        }
        coordinator.knownStop(trigger)
        return false
    }
}

// define the native contract
internal class AutomaticAndroidHttpTransportV1 : AutomaticNativeHttpTransportV1 {
    @Volatile
    private var activeConnection: HttpURLConnection? = null

    // execute one direct https request without redirects
    @Synchronized
    override fun execute(request: AutomaticNativeHttpRequestV1): AutomaticNativeHttpResponseV1? {
        val uri = try {
            URI(request.url)
        // fail closed on the error
        } catch (_: Exception) {
            return null
        }
        // require one direct production https origin
        if (
            uri.scheme?.lowercase() != "https" ||
            uri.userInfo != null ||
            uri.rawQuery != null ||
            uri.rawFragment != null
        ) {
            return null
        }
        val connection = try {
            URL(request.url).openConnection() as HttpURLConnection
        // fail closed on the error
        } catch (_: Exception) {
            return null
        }
        activeConnection = connection
        return try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = AUTOMATIC_HTTP_TIMEOUT_MS_V1
            connection.readTimeout = AUTOMATIC_HTTP_TIMEOUT_MS_V1
            connection.requestMethod = request.method
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${request.bearerToken.toString(Charsets.US_ASCII)}")
            connection.setRequestProperty("Cache-Control", "no-store")
            // write only candidate requests
            if (request.body != null) {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(request.body.size)
                connection.setRequestProperty("Content-Type", "application/json")
                // run the bounded callback
                connection.outputStream.use { output -> output.write(request.body) }
            }
            val statusCode = connection.responseCode
            val stream = if (statusCode >= 400) connection.errorStream else connection.inputStream
            val body = readBounded(stream, AUTOMATIC_HTTP_MAX_RESPONSE_BYTES_V1) ?: return null
            AutomaticNativeHttpResponseV1(
                statusCode = statusCode,
                requestedUrl = request.url,
                resolvedUrl = connection.url.toString(),
                wasRedirected = statusCode in 300..399 || connection.url.toString() != request.url,
                body = body,
            )
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            connection.disconnect()
            activeConnection = null
        }
    }

    // cancel the current cancellable connection
    override fun cancelAll(): Boolean {
        activeConnection?.disconnect()
        activeConnection = null
        return true
    }

    // read one bounded response body
    private fun readBounded(input: java.io.InputStream?, maximumBytes: Int): ByteArray? {
        val stream = input ?: return null
        // run the bounded callback
        return stream.use { source ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(4_096)
            // read until eof or the fixed bound
            while (true) {
                val count = source.read(buffer)
                // finish at eof
                if (count < 0) {
                    break
                }
                // reject oversized responses before accumulation
                if (output.size() + count > maximumBytes) {
                    return null
                }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }
}

// define the native contract
internal object AutomaticCreditSignalHubV1 {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    // register one detail-free bridge listener
    fun add(listener: () -> Unit) {
        listeners += listener
    }

    // remove one detail-free bridge listener
    fun remove(listener: () -> Unit) {
        listeners -= listener
    }

    // dispatch without candidate or entity data
    fun dispatch() {
        // notify every active bridge instance
        for (listener in listeners) {
            listener()
        }
    }
}

// define the native contract
internal class AutomaticAndroidCreditedSignalV1(private val context: Context) : AutomaticCreditedSignalV1 {
    // post one generic notification and detail-free bridge signal
    override fun credited() {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // create one non-sensitive notification channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    AUTOMATIC_NOTIFICATION_CHANNEL_V1,
                    "Leaderboard check-ins",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ),
            )
        }
        val notification = NotificationCompat.Builder(context, AUTOMATIC_NOTIFICATION_CHANNEL_V1)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Ferry FYI")
            .setContentText("A leaderboard check-in was verified.")
            .setAutoCancel(true)
            .build()
        // notification denial never disables detection
        try {
            NotificationManagerCompat.from(context).notify(AUTOMATIC_NOTIFICATION_ID_V1, notification)
        // fail closed on the error
        } catch (_: SecurityException) {
            Unit
        }
        AutomaticCreditSignalHubV1.dispatch()
    }
}

// define the native contract
internal class AutomaticUploadSchedulerV1(
    private val context: Context,
    private val latch: AutomaticUploadScheduleLatchV1,
) {
    // schedule one unique zero-data network wake
    fun schedule(): Boolean = try {
        val request = AutomaticZeroDataWorkRequestFactoryV1.create()
        val operation = WorkManager.getInstance(context).enqueueUniqueWork(
            AUTOMATIC_UPLOAD_WORK_V1,
            AUTOMATIC_UPLOAD_EXISTING_WORK_POLICY_V1,
            request,
        )
        operation.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // cancel only the owned zero-data work name
    fun cancel(): Boolean = try {
        val operation = WorkManager.getInstance(context).cancelUniqueWork(AUTOMATIC_UPLOAD_WORK_V1)
        operation.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        latch.clear()
    // fail closed on the error
    } catch (_: Exception) {
        false
    }
}

// guarantee one successor when a running wake observed the queue before storage
internal val AUTOMATIC_UPLOAD_EXISTING_WORK_POLICY_V1 = ExistingWorkPolicy.REPLACE

// define the native contract
internal object AutomaticZeroDataWorkRequestFactoryV1 {
    // create one network-constrained request with empty input
    fun create(): OneTimeWorkRequest {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        return OneTimeWorkRequest.Builder(AutomaticCandidateUploadWorkerV1::class.java)
            .setInputData(Data.EMPTY)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build()
    }

    // reject all work input keys without inspecting values
    fun isZeroData(data: Data): Boolean = data.keyValueMap.isEmpty()
}

// define the native contract
internal class AutomaticAndroidRuntimeV1 private constructor(private val context: Context) {
    private val secureDirectory = File(context.noBackupFilesDir, "leaderboard-automatic/v1").apply { mkdirs() }
    private val bindingStore = AutomaticInstallationBindingStoreV1(secureDirectory)
    private val credentialStore = AutomaticCredentialStoreV1(
        secureDirectory,
        bindingStore,
        AutomaticAndroidKeystoreAeadV1.credential(),
    )
    private val subjectBindingStore = AutomaticSubjectBindingStoreV1(
        secureDirectory,
        bindingStore,
    )
    private val cleanupPendingStore = AutomaticCleanupPendingStoreV1(
        secureDirectory,
        AutomaticAndroidKeystoreAeadV1.cleanup(),
    )
    private val parameterStore = AutomaticNativeParametersStoreV1(secureDirectory)
    private val publicConfigStore = AutomaticPublicTerminalConfigStoreV1(
        secureDirectory,
        AUTOMATIC_MAX_REGION_COUNT_V1,
    )
    private val stateStore = AutomaticNativeRuntimeStateStoreV1(secureDirectory)
    private val trustedClock = AutomaticTrustedClock(
        wallClockMs = System::currentTimeMillis,
        monotonicClockMs = SystemClock::elapsedRealtime,
        bootIdentity = ::bootIdentity,
        anchorStore = AutomaticNoBackupTrustedTimeAnchorStoreV1(secureDirectory),
    )
    private val queue = AutomaticEncryptedCandidateQueueV1(
        directory = File(secureDirectory, "candidates"),
        bindingStore = bindingStore,
        aead = AutomaticAndroidKeystoreAeadV1.queue(),
        evaluateExpiry = trustedClock::evaluateExpiry,
        // run the bounded callback
        maxPendingCandidates = {
            stateStore.read()?.configGeneration?.let(parameterStore::read)?.maxPendingCandidates ?: 0
        },
    )
    private val callbackInbox = AutomaticEncryptedGeofenceCallbackInboxV1(
        directory = File(secureDirectory, "callbacks"),
        bindingStore = bindingStore,
        aead = AutomaticAndroidKeystoreAeadV1.callback(),
    )
    private val regionStager = AutomaticAndroidRegionStagerV1(context)
    private val uploadScheduleLatch = AutomaticUploadScheduleLatchV1(secureDirectory)
    private val scheduler = AutomaticUploadSchedulerV1(context, uploadScheduleLatch)
    private val transport = AutomaticAndroidHttpTransportV1()
    private val revoker = AutomaticBestEffortEnrollmentRevokerV1(transport)
    private val configActivator = AutomaticTerminalConfigActivator(
        stager = regionStager,
        maxOwnedRegionCount = AUTOMATIC_MAX_REGION_COUNT_V1,
        initialLocalWorkGeneration = stateStore.read()?.localWorkGeneration ?: LocalWorkGeneration(0),
    )
    private val stopPort = object : AutomaticStopPortV1 {
        // unregister every owned region
        override fun unregisterRegions(): Boolean {
            val regionsRemoved = regionStager.discardAll()
            val configsRemoved = publicConfigStore.clear()
            val callbacksRemoved = callbackInbox.clear(deleteKey = true)
            return regionsRemoved && configsRemoved && callbacksRemoved
        }

        // cancel only owned work
        override fun cancelScheduledWork(): Boolean {
            val uploadCancelled = scheduler.cancel()
            val lifecycleCancelled = cancelDurableLifecycleWork()
            return uploadCancelled && lifecycleCancelled
        }

        // cancel only owned requests
        override fun cancelNetworkRequests(): Boolean = transport.cancelAll()
    }
    private val coordinator = AutomaticCheckinPolicyCoordinatorV1(
        sdkInt = Build.VERSION.SDK_INT,
        stateStore = stateStore,
        configActivator = configActivator,
        queue = queue,
        credentialStore = credentialStore,
        bindingStore = bindingStore,
        stopPort = stopPort,
    )
    private val reconciler = AutomaticNativeReconcilerV1(
        credentialStore = credentialStore,
        transport = transport,
        trustedClock = trustedClock,
        parametersStore = parameterStore,
        coordinator = coordinator,
        publicConfigStore = publicConfigStore,
    )
    private val uploader = AutomaticCandidateUploaderV1(
        queue = queue,
        credentialStore = credentialStore,
        trustedNowMs = trustedClock::trustedNowMs,
        transport = transport,
        coordinator = coordinator,
        creditedSignal = AutomaticAndroidCreditedSignalV1(context),
    )
    private val geofenceCallbackDrainGate = AutomaticGeofenceCallbackDrainGateV1()
    private val random = SecureRandom()

    // prepare one no-backup installation enrollment nonce
    fun prepareEnrollment(): String? {
        // keep disabled or unsupported platforms out of enrollment material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            return null
        }
        // invalidate prior ownership before exposing a new transaction nonce
        if (!subjectBindingStore.clear()) {
            return null
        }
        return bindingStore.beginEnrollmentBootstrap()
    }

    // install one validated server bootstrap credential
    fun installCredential(credential: AutomaticCredentialV1): Boolean {
        // keep production behavior off until the explicit release gate
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            credential.wipe()
            return false
        }
        val validator = AutomaticNativeEndpointValidator(AUTOMATIC_PRODUCTION_ORIGIN_V1)
        // accept only the compiled production origin and exact paths
        if (!validator.validate(credential.urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)) {
            credential.wipe()
            return false
        }
        val bootstrap = bindingStore.consumeEnrollmentBootstrap()
        // require one prior native bootstrap from this installation
        if (bootstrap == null) {
            credential.wipe()
            return false
        }
        return try {
            val replaced = coordinator.replaceEnrollment(credential.serverPolicyGeneration)
            val oldCredentialCleared = credentialStore.clear()
            // persist only after old work and identity are unusable
            if (!replaced || !oldCredentialCleared || !credentialStore.replace(credential, bootstrap)) {
                coordinator.knownStop(AutomaticStopTriggerV1.IDENTITY_LOST)
                return false
            }
            true
        // release protected state
        } finally {
            bootstrap.wipe()
            credential.wipe()
        }
    }

    // bind one transient auth subject to the installed credential
    fun bindIdentity(subject: String): Boolean {
        // keep inert platforms free of subject material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return false
        }
        val credential = credentialStore.read() ?: return false
        // release protected state
        return try {
            subjectBindingStore.bind(subject, credential.enrollmentId)
        // release protected state
        } finally {
            credential.wipe()
        }
    }

    // check one transient auth subject against the device-only proof
    fun checkIdentity(subject: String): AutomaticSubjectBindingCheckV1 {
        // keep inert platforms free of subject material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return AutomaticSubjectBindingCheckV1(bound = false, matches = false)
        }
        val credential = credentialStore.read()
        // distinguish corrupt binding material from a clean installation
        if (credential == null) {
            return subjectBindingStore.check(subject, "")
        }
        // release protected state
        return try {
            subjectBindingStore.check(subject, credential.enrollmentId)
        // release protected state
        } finally {
            credential.wipe()
        }
    }

    // stage one subject-bound cleanup obligation before identity purge
    fun stageEnrollmentCleanup(subject: String): Boolean {
        // keep inert platforms free of subject material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return false
        }
        return cleanupPendingStore.stage(subject)
    }

    // check one cleanup obligation without exposing its proof
    fun checkEnrollmentCleanup(subject: String): AutomaticCleanupPendingCheckV1 {
        // keep inert platforms free of subject material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return AutomaticCleanupPendingCheckV1(matches = false, pending = false, valid = true)
        }
        return cleanupPendingStore.check(subject)
    }

    // clear only one exactly matched cleanup obligation
    fun clearEnrollmentCleanup(subject: String): Boolean {
        // keep inert platforms free of subject material
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return false
        }
        return cleanupPendingStore.clear(subject)
    }

    // reconcile force-stop reboot foreground and first-unlock opportunities
    @Synchronized
    fun reconcileLifecycle(): AutomaticReconciliationOutcomeV1 {
        // keep all default builds inert
        if (!BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED) {
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        // reject pre-android-q automatic behavior
        if (!AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)) {
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        // fail closed before first unlock
        if (!isUserUnlocked()) {
            coordinator.markMonitorHealth(AutomaticMonitorHealthV1.FIRST_UNLOCK_REQUIRED)
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        val pendingAuthority = AutomaticPendingCandidateStopRecoveryV1.replay(queue, coordinator)
        // replay candidate stop authority before any other cleanup or native work
        if (pendingAuthority != null) {
            return pendingAuthority
        }
        // replay failed local stop effects before any credential or network access
        if (!coordinator.retryPendingStopEffects()) {
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        val durableStatus = coordinator.status()
        // never re-enable a logically stopped enrollment without explicit replacement
        if (
            durableStatus.monitorHealth in setOf(
                AutomaticMonitorHealthV1.STOPPED,
                AutomaticMonitorHealthV1.POLICY_DISABLED,
            )
        ) {
            return AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
        }
        val expiryStop = AutomaticCredentialExpiryGateV1.stopIfExpired(
            credentialStore,
            trustedClock.trustedNowMs(),
            coordinator,
        )
        // stop an empty-queue enrollment at inclusive trusted expiry before network
        if (expiryStop != null) {
            return expiryStop
        }
        val permissionDecision = AutomaticAndroidPermissionsV1.decision(context)
        // stop known enrolled work under the exact permission or accuracy denial
        if (permissionDecision.stopTrigger != null) {
            val credential = credentialStore.read()
            // purge only when an enrollment actually exists
            if (credential != null) {
                credential.wipe()
                permissionDecision.enforce(coordinator)
                return AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
            }
            coordinator.updatePermission(permissionDecision.health)
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        permissionDecision.enforce(coordinator)
        // converge cleanup before policy or config work
        if (!queue.retryRequiredCleanup()) {
            coordinator.recordOutcome("cleanup_required")
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        val status = reconciler.reconcileStatus()
        // stop after an authoritative denial
        if (status == AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED) {
            return status
        }
        val config = reconciler.reconcileConfig()
        // never expose uploader or callback work without a usable configuration
        if (!AutomaticLifecycleWorkGateV1.canSchedule(coordinator.status())) {
            return config
        }
        // recover uploader work only after status/config refresh establishes trusted time
        if (
            config != AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED &&
            !AutomaticDurableUploadScheduleRecoveryV1.reconcile(
                queue.pendingCount(),
                uploadScheduleLatch,
                scheduler::schedule,
            )
        ) {
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        // recover any encrypted callback handoff after process or enqueue failure
        if (callbackInbox.pendingCount() > 0 && !scheduleGeofenceWork()) {
            return AutomaticReconciliationOutcomeV1.RETRYABLE
        }
        return config
    }

    // persist one callback and hand it to durable workmanager execution
    fun enqueueGeofenceCallback(callback: AutomaticGeofenceCallbackV1): Boolean {
        val admitted = AutomaticGeofenceCallbackAdmissionV1.enqueue(
            callback,
            queue,
            coordinator,
            callbackInbox,
        )
        // expose work only after generation-bound durable admission
        if (!admitted) {
            return false
        }
        return scheduleGeofenceWork()
    }

    // process one durable callback outside broadcastreceiver lifetime
    fun processNextGeofenceCallback(): AutomaticUploadRunOutcomeV1 =
        geofenceCallbackDrainGate.run(::processNextGeofenceCallbackLocked)

    // drain one callback only while holding the process execution gate
    private fun processNextGeofenceCallbackLocked(): AutomaticUploadRunOutcomeV1 {
        val pendingAuthority = AutomaticPendingCandidateStopRecoveryV1.replay(queue, coordinator)
        // apply stop authority before encrypted callback selection or capture
        if (pendingAuthority != null) {
            return if (pendingAuthority == AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED) {
                AutomaticUploadRunOutcomeV1.SUCCESS
            // branch on the current state
            } else {
                AutomaticUploadRunOutcomeV1.RETRY
            }
        }
        val stored = callbackInbox.next()
        // recover a prepared candidate whose callback deletion already committed
        if (stored == null) {
            // retain prepared work while any callback ownership remains unresolved
            if (callbackInbox.pendingCount() > 0) {
                return AutomaticUploadRunOutcomeV1.RETRY
            }
            val recovered = recoverOrphanedPreparedCandidates()
            return if (!recovered || callbackInbox.pendingCount() > 0) {
                AutomaticUploadRunOutcomeV1.RETRY
            // branch on the current state
            } else {
                AutomaticUploadRunOutcomeV1.SUCCESS
            }
        }
        val status = coordinator.status()
        // discard callbacks superseded by a later configuration or local stop
        if (!status.configurationUsable || status.configGeneration != stored.callback.configGeneration) {
            return if (callbackInbox.delete(stored.recordKey)) {
                AutomaticUploadRunOutcomeV1.SUCCESS
            // branch on the current state
            } else {
                AutomaticUploadRunOutcomeV1.RETRY
            }
        }
        // retain the callback before first unlock or a fresh same-boot anchor
        if (!isUserUnlocked() || trustedClock.trustedNowMs() == null) {
            reconcileLifecycle()
            // wait for the next durable execution when the gate remains unavailable
            if (!isUserUnlocked() || trustedClock.trustedNowMs() == null) {
                return AutomaticUploadRunOutcomeV1.RETRY
            }
        }
        val outcome = if (stored.recordKey in queue.preparedRecordKeys()) {
            AutomaticQueueMutationOutcome.STORED
        // branch on the current state
        } else {
            handleGeofence(
                callback = stored.callback,
                durableCandidateId = stored.recordKey,
                // run the bounded callback
                storeCandidate = { queued -> queue.prepare(stored.recordKey, queued) },
                makeUploadVisible = false,
            )
        }
        // complete one-shot callbacks that definitively produced no candidate
        if (outcome != AutomaticQueueMutationOutcome.STORED) {
            return if (stored.recordKey !in queue.preparedRecordKeys() && callbackInbox.delete(stored.recordKey)) {
                AutomaticUploadRunOutcomeV1.SUCCESS
            // branch on the current state
            } else {
                AutomaticUploadRunOutcomeV1.RETRY
            }
        }
        // delete callback ownership before exposing its single queue ciphertext
        if (!callbackInbox.delete(stored.recordKey)) {
            return AutomaticUploadRunOutcomeV1.RETRY
        }
        // branch on the current state
        if (!queue.promotePrepared(stored.recordKey) || !uploadScheduleLatch.markRequired() || !scheduler.schedule()) {
            return AutomaticUploadRunOutcomeV1.RETRY
        }
        return if (callbackInbox.pendingCount() > 0) {
            AutomaticUploadRunOutcomeV1.RETRY
        // branch on the current state
        } else {
            AutomaticUploadRunOutcomeV1.SUCCESS
        }
    }

    // enqueue one zero-data lifecycle reconciliation wake
    fun enqueueLifecycleReconciliation(): Boolean = try {
        val request = OneTimeWorkRequest.Builder(AutomaticLifecycleReconciliationWorkerV1::class.java)
            .setInputData(Data.EMPTY)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build()
        val operation = WorkManager.getInstance(context).enqueueUniqueWork(
            AUTOMATIC_RECONCILE_WORK_V1,
            ExistingWorkPolicy.REPLACE,
            request,
        )
        operation.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // enqueue one zero-data durable callback worker
    private fun scheduleGeofenceWork(): Boolean = try {
        val request = OneTimeWorkRequest.Builder(AutomaticGeofenceCallbackWorkerV1::class.java)
            .setInputData(Data.EMPTY)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .build()
        val operation = WorkManager.getInstance(context).enqueueUniqueWork(
            AUTOMATIC_GEOFENCE_WORK_V1,
            AUTOMATIC_GEOFENCE_EXISTING_WORK_POLICY_V1,
            request,
        )
        operation.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // cancel every owned durable lifecycle work name
    private fun cancelDurableLifecycleWork(): Boolean = try {
        val geofence = WorkManager.getInstance(context).cancelUniqueWork(AUTOMATIC_GEOFENCE_WORK_V1)
        val reconcile = WorkManager.getInstance(context).cancelUniqueWork(AUTOMATIC_RECONCILE_WORK_V1)
        geofence.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        reconcile.result.get(AUTOMATIC_WORK_ENQUEUE_TIMEOUT_SECONDS_V1, TimeUnit.SECONDS)
        true
    // fail closed on the error
    } catch (_: Exception) {
        false
    }

    // create at most one encrypted candidate for one valid callback
    fun handleGeofence(
        callback: AutomaticGeofenceCallbackV1,
        durableCandidateId: String? = null,
        storeCandidate: (AutomaticQueuedCandidateV1) -> AutomaticQueueMutationOutcome = queue::enqueue,
        makeUploadVisible: Boolean = true,
    ): AutomaticQueueMutationOutcome {
        // require current production eligibility and unlocked secure storage
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !isUserUnlocked()
        ) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        // reject a late os callback before restore network or location work
        if (!coordinator.accepts(callback.localWorkGeneration)) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        val permissionDecision = AutomaticAndroidPermissionsV1.decision(context)
        // enforce permission truth before cold region restoration can misclassify failure
        val status = AutomaticGeofencePermissionRecoveryV1.currentStatus(
            callback = callback,
            permissionDecision = permissionDecision,
            coordinator = coordinator,
            configActivator = configActivator,
            // run the bounded callback
            restore = {
                AutomaticPersistedTerminalConfigRecoveryV1.restore(
                    callback.configGeneration,
                    publicConfigStore,
                    coordinator,
                )
            },
            // run the bounded callback
            reconcile = { reconcileLifecycle() },
        ) ?: return AutomaticQueueMutationOutcome.BLOCKED
        // block before location or candidate construction after reboot
        if (!AutomaticGeofenceTrustedTimeGateV1.canAcquireFix(trustedClock.trustedNowMs())) {
            return AutomaticQueueMutationOutcome.BLOCKED
        }
        val callbackLocalGeneration = callback.localWorkGeneration
        val fix = requestOneFix() ?: return AutomaticQueueMutationOutcome.BLOCKED
        // run the bounded callback
        val candidateId = durableCandidateId ?: run {
            val candidateIdBytes = ByteArray(16).also(random::nextBytes)
            val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(candidateIdBytes)
            candidateIdBytes.fill(0)
            encoded
        }
        return AutomaticGeofenceCandidateCommitV1.commit(
            callback = callback,
            callbackLocalGeneration = callbackLocalGeneration,
            fix = fix,
            candidateId = candidateId,
            coordinator = coordinator,
            configActivator = configActivator,
            queue = queue,
            // run the bounded callback
            parameters = {
                coordinator.status().configGeneration?.let(parameterStore::read)
            },
            // run the bounded callback
            permissionAvailable = { AutomaticAndroidPermissionsV1.hasRequiredLocation(context) },
            scheduleUpload = scheduler::schedule,
            markScheduleRequired = uploadScheduleLatch::markRequired,
            storeCandidate = storeCandidate,
            makeUploadVisible = makeUploadVisible,
        )
    }

    // promote prepared candidates left after callback deletion and process death
    private fun recoverOrphanedPreparedCandidates(): Boolean {
        var recovered = true
        // promote every prepared ciphertext whose callback ownership is absent
        for (recordKey in queue.preparedRecordKeys()) {
            // branch on the current state
            if (!queue.promotePrepared(recordKey)) {
                recovered = false
            }
        }
        // schedule only after every recoverable promotion attempt
        if (queue.pendingCount() > 0 && (!uploadScheduleLatch.markRequired() || !scheduler.schedule())) {
            recovered = false
        }
        return recovered
    }

    // process one workmanager zero-data wake
    fun uploadOnce(): AutomaticUploadRunResultV1 = uploader.runOnce()

    // acknowledge that workmanager started the owned zero-data wake
    fun markUploadWorkRunning(): Boolean = uploadScheduleLatch.clear()

    // apply one local stop before controllable identity teardown
    fun disableAndPurge(trigger: AutomaticStopTriggerV1): Boolean {
        val shouldRevoke = trigger in setOf(
            AutomaticStopTriggerV1.IDENTITY_LOST,
            AutomaticStopTriggerV1.PROFILE_OPTED_OUT,
            AutomaticStopTriggerV1.LOCAL_DISABLE,
            AutomaticStopTriggerV1.ENROLLMENT_REVOKED,
            AutomaticStopTriggerV1.ACCOUNT_DELETED,
        )
        val credential = if (shouldRevoke) credentialStore.read() else null
        // invalidate and purge locally before any best-effort network result
        val ownerBindingPurged = subjectBindingStore.clear()
        val purged = coordinator.knownStop(trigger)
        // attempt server revocation only with the already isolated credential copy
        if (credential != null) {
            // attempt the protected operation
            try {
                revoker.revoke(credential)
            // release protected state
            } finally {
                credential.wipe()
            }
        }
        return ownerBindingPurged && purged
    }

    // stop all active work after one authoritative play-services geofence error
    fun handleGeofenceServiceError(): Boolean = coordinator.knownStop(AutomaticStopTriggerV1.GEOFENCE_UNAVAILABLE)

    // expose only aggregate native status
    fun status(): AutomaticNativeRuntimeStatusV1 = coordinator.status()

    // expose only aggregate pending count
    fun pendingCount(): Int = queue.pendingCount()

    // bucket credential expiry without exposing exact lifecycle time
    fun credentialExpiryBucket(): String {
        val credential = credentialStore.read() ?: return "unavailable"
        return try {
            val now = trustedClock.trustedNowMs() ?: return "unavailable"
            val remaining = credential.expiresAtMs - now
            // classify one fixed credential window
            when {
                remaining <= 0L -> "expired"
                remaining < TimeUnit.DAYS.toMillis(1L) -> "less_than_1_day"
                remaining < TimeUnit.DAYS.toMillis(7L) -> "less_than_7_days"
                // branch on the current state
                else -> "seven_days_or_more"
            }
        // release protected state
        } finally {
            credential.wipe()
        }
    }

    // request one bounded fresh location fix
    @SuppressLint("MissingPermission")
    private fun requestOneFix(): AutomaticLocationFixV1? {
        // stop without touching location when permission is absent
        if (!AutomaticAndroidPermissionsV1.hasRequiredLocation(context)) {
            coordinator.knownStop(AutomaticStopTriggerV1.BACKGROUND_PERMISSION_REVOKED)
            return null
        }
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancellation = CancellationTokenSource()
        return try {
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0L)
                .setDurationMillis(TimeUnit.SECONDS.toMillis(AUTOMATIC_LOCATION_TIMEOUT_SECONDS_V1))
                .build()
            val location = Tasks.await(
                client.getCurrentLocation(request, cancellation.token),
                AUTOMATIC_LOCATION_TIMEOUT_SECONDS_V1,
                TimeUnit.SECONDS,
            ) ?: return null
            val observedElapsedMs = TimeUnit.NANOSECONDS.toMillis(location.elapsedRealtimeNanos)
            val ageMs = SystemClock.elapsedRealtime() - observedElapsedMs
            // require one current precise finite fix
            if (
                ageMs !in 0..AUTOMATIC_LOCATION_MAX_AGE_MS_V1 ||
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
            AutomaticLocationFixV1(
                latitudeE7 = (location.latitude * 10_000_000.0).toInt(),
                longitudeE7 = (location.longitude * 10_000_000.0).toInt(),
                accuracyMillimeters = (location.accuracy * 1_000.0).toLong(),
                capturedAtMs = trustedClock.capturedAtMs() ?: return null,
            )
        // fail closed on the error
        } catch (_: Exception) {
            null
        // release protected state
        } finally {
            cancellation.cancel()
        }
    }

    // require credential-encrypted storage availability
    private fun isUserUnlocked(): Boolean =
        (context.getSystemService(Context.USER_SERVICE) as UserManager).isUserUnlocked

    // read one per-boot linux identity
    private fun bootIdentity(): String = try {
        File("/proc/sys/kernel/random/boot_id").readText().trim()
    // fail closed on the error
    } catch (_: Exception) {
        ""
    }

    // define the native companion
    companion object {
        @Volatile
        private var instance: AutomaticAndroidRuntimeV1? = null

        // return one process runtime
        fun get(context: Context): AutomaticAndroidRuntimeV1 = instance ?: synchronized(this) {
            // run the bounded callback
            instance ?: AutomaticAndroidRuntimeV1(context.applicationContext).also { created -> instance = created }
        }

        // inspect only pre-existing state that requires lifecycle convergence
        fun hasReconciliationMaterial(context: Context): Boolean {
            val directory = File(context.noBackupFilesDir, "leaderboard-automatic/v1")
            // avoid creating any clean-install automatic directory
            if (!directory.isDirectory) {
                return false
            }
            return listOf(
                "credential-v1.bin",
                "runtime-state-v1.bin",
                "runtime-pending-stop-v1.bin",
                "subject-binding-v1.bin",
                "cleanup-pending-v1.bin",
            // run the bounded callback
            ).any { name -> File(directory, name).exists() } ||
                File(directory, "candidates").listFiles().orEmpty().isNotEmpty() ||
                File(directory, "callbacks").listFiles().orEmpty().isNotEmpty()
        }
    }
}

// append a successor without cancelling an in-flight one-shot location request
internal val AUTOMATIC_GEOFENCE_EXISTING_WORK_POLICY_V1 = ExistingWorkPolicy.APPEND_OR_REPLACE

// define the native contract
internal class AutomaticGeofenceCallbackDrainGateV1 {
    // serialize callback selection through location and ownership completion
    @Synchronized
    fun <T> run(operation: () -> T): T = operation()
}

// define the native contract
internal object AutomaticGeofenceCallbackAdmissionV1 {
    // linearize authority replay and inbox persistence with generation mutation
    fun enqueue(
        callback: AutomaticGeofenceCallbackV1,
        queue: AutomaticEncryptedCandidateQueueV1,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
        callbackInbox: AutomaticEncryptedGeofenceCallbackInboxV1,
    ): Boolean = coordinator.mutateIfCurrent(callback.localWorkGeneration) {
        val pendingAuthority = AutomaticPendingCandidateStopRecoveryV1.replay(queue, coordinator)
        // suppress all callback material while stop recovery applies or retries
        if (pendingAuthority != null) {
            return@mutateIfCurrent false
        }
        callbackInbox.enqueue(callback)
    } == AutomaticGenerationMutationResultV1.APPLIED
}

// define the native contract
internal object AutomaticGeofencePermissionRecoveryV1 {
    // enforce exact permission state before cold config or region restoration
    fun currentStatus(
        callback: AutomaticGeofenceCallbackV1,
        permissionDecision: AutomaticLocationPermissionDecisionV1,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
        configActivator: AutomaticTerminalConfigActivator,
        restore: () -> Unit,
        reconcile: () -> Unit,
    ): AutomaticNativeRuntimeStatusV1? {
        // preserve the exact permission stop cause before any registration failure
        if (!permissionDecision.enforce(coordinator)) {
            return null
        }
        return AutomaticGeofenceLifecycleRecoveryV1.currentStatus(
            callback,
            coordinator,
            configActivator,
            restore,
            reconcile,
        )
    }
}

// define the native contract
internal object AutomaticCredentialExpiryGateV1 {
    // apply one inclusive trusted identity expiry before network
    fun stopIfExpired(
        credentialStore: AutomaticCredentialStoreV1,
        trustedNowMs: Long?,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
    ): AutomaticReconciliationOutcomeV1? {
        val credential = credentialStore.read() ?: return null
        val expired = try {
            trustedNowMs != null && trustedNowMs >= credential.expiresAtMs
        // release protected state
        } finally {
            credential.wipe()
        }
        // continue normally before trusted expiry
        if (!expired) {
            return null
        }
        return if (coordinator.knownStop(AutomaticStopTriggerV1.ENROLLMENT_EXPIRED)) {
            AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
        // branch on the current state
        } else {
            AutomaticReconciliationOutcomeV1.RETRYABLE
        }
    }
}

// define the native contract
internal object AutomaticLifecycleWorkGateV1 {
    // schedule native work only under one committed usable configuration
    fun canSchedule(status: AutomaticNativeRuntimeStatusV1): Boolean =
        status.configurationUsable && status.monitorHealth == AutomaticMonitorHealthV1.HEALTHY
}

// define the native contract
internal object AutomaticPendingCandidateStopRecoveryV1 {
    // replay one durable candidate denial before any native lifecycle work
    fun replay(
        queue: AutomaticEncryptedCandidateQueueV1,
        coordinator: AutomaticCheckinPolicyCoordinatorV1,
    ): AutomaticReconciliationOutcomeV1? {
        // continue only when the physical authority file is absent
        if (!queue.hasPendingStopAuthority()) {
            return null
        }
        val authority = queue.pendingStopAuthority()
        // quarantine unreadable authority instead of treating it as absent
        if (authority == null) {
            val stopped = coordinator.knownStop(AutomaticStopTriggerV1.IDENTITY_LOST)
            val cleared = stopped && queue.clearStopAuthority()
            return if (cleared) {
                AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
            // branch on the current state
            } else {
                AutomaticReconciliationOutcomeV1.RETRYABLE
            }
        }
        // branch on the fixed outcome
        return when (coordinator.applyFinalStopAuthority(authority)) {
            // handle the fixed branch
            AutomaticStopAuthorityResultV1.STALE -> {
                // discard only authority superseded by a newer local generation
                if (queue.discardStopAuthority(authority) && queue.retryRequiredCleanup()) {
                    null
                // branch on the current state
                } else {
                    AutomaticReconciliationOutcomeV1.RETRYABLE
                }
            }
            // handle the fixed branch
            AutomaticStopAuthorityResultV1.APPLIED -> {
                val cleaned = queue.retryRequiredCleanup()
                val cleared = cleaned && queue.clearStopAuthority()
                // block until stop effects and ciphertext deletion both converge
                if (cleared) {
                    AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED
                // branch on the current state
                } else {
                    queue.markCleanupRequired()
                    AutomaticReconciliationOutcomeV1.RETRYABLE
                }
            }
            // handle the fixed branch
            AutomaticStopAuthorityResultV1.FAILED -> {
                queue.markCleanupRequired()
                AutomaticReconciliationOutcomeV1.RETRYABLE
            }
        }
    }
}

// define the native contract
internal data class AutomaticLocationFixV1(
    val latitudeE7: Int,
    val longitudeE7: Int,
    val accuracyMillimeters: Long,
    val capturedAtMs: Long,
)

// define the native contract
internal class AutomaticCandidateUploadWorkerV1(
    appContext: Context,
    workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
    // process one zero-data work wake
    override fun doWork(): Result {
        // reject any accidental job metadata
        if (!AutomaticZeroDataWorkRequestFactoryV1.isZeroData(inputData)) {
            return Result.failure()
        }
        // keep stale work inert on default or unsupported installs
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            return Result.success()
        }
        val runtime = AutomaticAndroidRuntimeV1.get(applicationContext)
        // clear only after the owned worker is actually running
        if (!runtime.markUploadWorkRunning()) {
            return Result.retry()
        }
        return AutomaticCandidateWorkResultPolicyV1.resultFor(runtime.uploadOnce().outcome)
    }
}

// define the native contract
internal class AutomaticGeofenceCallbackWorkerV1(
    appContext: Context,
    workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
    // process one encrypted callback handoff with no work input data
    override fun doWork(): Result {
        // reject any accidental callback data in workmanager storage
        if (!AutomaticZeroDataWorkRequestFactoryV1.isZeroData(inputData)) {
            return Result.failure()
        }
        // keep stale work inert on default or unsupported installs
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            return Result.success()
        }
        return AutomaticCandidateWorkResultPolicyV1.resultFor(
            AutomaticAndroidRuntimeV1.get(applicationContext).processNextGeofenceCallback(),
        )
    }
}

// define the native contract
internal class AutomaticLifecycleReconciliationWorkerV1(
    appContext: Context,
    workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
    // reconcile lifecycle state outside broadcastreceiver lifetime
    override fun doWork(): Result {
        // reject any accidental lifecycle data in workmanager storage
        if (!AutomaticZeroDataWorkRequestFactoryV1.isZeroData(inputData)) {
            return Result.failure()
        }
        // keep stale work inert on default or unsupported installs
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT)
        ) {
            return Result.success()
        }
        // branch on the fixed outcome
        return when (AutomaticAndroidRuntimeV1.get(applicationContext).reconcileLifecycle()) {
            AutomaticReconciliationOutcomeV1.APPLIED,
            AutomaticReconciliationOutcomeV1.DISABLED_AND_PURGED,
            -> Result.success()
            AutomaticReconciliationOutcomeV1.RETRYABLE -> Result.retry()
        }
    }
}

// define the native contract
internal object AutomaticCandidateWorkResultPolicyV1 {
    // map uploader state to workmanager convergence behavior
    fun resultFor(outcome: AutomaticUploadRunOutcomeV1): ListenableWorker.Result {
        // retry only network ambiguity or durable cleanup
        return when (outcome) {
            AutomaticUploadRunOutcomeV1.SUCCESS -> ListenableWorker.Result.success()
            AutomaticUploadRunOutcomeV1.RETRY,
            AutomaticUploadRunOutcomeV1.CLEANUP_RETRY,
            -> ListenableWorker.Result.retry()
            AutomaticUploadRunOutcomeV1.BLOCKED -> ListenableWorker.Result.failure()
        }
    }
}

// define the native contract
internal interface AutomaticGeofenceReceiverPortV1 {
    // persist one validated callback for durable processing
    fun enqueue(callback: AutomaticGeofenceCallbackV1): Boolean

    // stop all owned work after one platform geofence error
    fun stopForPlatformError(): Boolean
}

// define the native contract
internal class AutomaticAndroidGeofenceReceiverPortV1(context: Context) : AutomaticGeofenceReceiverPortV1 {
    private val runtime = AutomaticAndroidRuntimeV1.get(context)

    // hand one callback to the encrypted inbox
    override fun enqueue(callback: AutomaticGeofenceCallbackV1): Boolean = runtime.enqueueGeofenceCallback(callback)

    // converge one play-services error through durable stop policy
    override fun stopForPlatformError(): Boolean = runtime.handleGeofenceServiceError()
}

// define the native contract
internal class AutomaticGeofenceReceiverV1(
    private val portFactory: (Context) -> AutomaticGeofenceReceiverPortV1 = ::AutomaticAndroidGeofenceReceiverPortV1,
) : BroadcastReceiver() {
    // accept only one legitimate owned transition
    override fun onReceive(context: Context, intent: Intent) {
        // reject disabled unsupported or forged actions
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            intent.action != AUTOMATIC_GEOFENCE_ACTION_V1
        ) {
            return
        }
        val event = GeofencingEvent.fromIntent(intent) ?: return
        // converge owned work instead of ignoring a play-services failure
        if (event.hasError()) {
            portFactory(context).stopForPlatformError()
            return
        }
        // require one successful enter or exit callback
        if (
            event.geofenceTransition !in setOf(
                Geofence.GEOFENCE_TRANSITION_ENTER,
                Geofence.GEOFENCE_TRANSITION_EXIT,
            ) ||
            event.triggeringGeofences?.size != 1
        ) {
            return
        }
        val parsedCallback = AutomaticGeofenceRequestIdV1.parse(event.triggeringGeofences!!.single().requestId) ?: return
        val transition = if (event.geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER) {
            AutomaticGeofenceTransitionV1.ENTER
        // branch on the current state
        } else {
            AutomaticGeofenceTransitionV1.EXIT
        }
        val callback = parsedCallback.copy(transition = transition)
        // persist and enqueue only bounded receiver-safe work
        portFactory(context).enqueue(callback)
    }
}

// define the native contract
internal class AutomaticBootReceiverV1 : BroadcastReceiver() {
    // reconcile only explicit boot package and unlock opportunities
    override fun onReceive(context: Context, intent: Intent) {
        // reject all default-off and forged lifecycle actions
        if (
            !BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED ||
            !AutomaticAndroidEligibilityV1.isSupported(Build.VERSION.SDK_INT) ||
            !AutomaticAndroidRuntimeV1.hasReconciliationMaterial(context) ||
            intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
                Intent.ACTION_USER_UNLOCKED,
            )
        ) {
            return
        }
        // hand long policy and region work to durable workmanager execution
        AutomaticAndroidRuntimeV1.get(context).enqueueLifecycleReconciliation()
    }
}
