package fyi.ferry;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.PluginMethod;

/**
 * An Android-only, opt-in proof surface for the background-location permission lifecycle.
 *
 * <p>It intentionally never creates a location client, starts a service, records coordinates,
 * or awards any product credit. The only data exposed through the bridge is permission and
 * lifecycle state suitable for a manual feasibility test.</p>
 */
@CapacitorPlugin(
    name = "BackgroundLocationFeasibility",
    permissions = {
        @Permission(
            alias = "foregroundLocation",
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }
        )
    }
)
public class BackgroundLocationFeasibilityPlugin extends Plugin {
    private static final String TAG = "BgLocationFeasibility";
    private static final String DISABLED_MESSAGE = "Background-location feasibility is disabled for this build.";

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status("status_requested"));
    }

    /** Requests foreground location only; background access is changed by Android Settings. */
    @PluginMethod
    public void requestForegroundLocationPermission(PluginCall call) {
        if (!requireEnabled(call, "foreground_permission_requested")) {
            return;
        }

        requestPermissionForAlias("foregroundLocation", call, "foregroundLocationPermissionResult");
    }

    /**
     * Opens app settings after foreground access has been granted. Android owns the background
     * permission UI, especially on Android 11+, so this plugin does not try to bypass it.
     */
    @PluginMethod
    public void openBackgroundLocationSettings(PluginCall call) {
        if (!requireEnabled(call, "background_settings_requested")) {
            return;
        }
        if (!hasForegroundLocationPermission()) {
            call.reject("Grant foreground location before opening background-location settings.", "FOREGROUND_PERMISSION_REQUIRED");
            emit("background_settings_blocked");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(status("background_permission_not_required"));
            return;
        }

        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        startActivityForResult(call, intent, "backgroundLocationSettingsResult");
        emit("background_settings_opened");
    }

    @PermissionCallback
    private void foregroundLocationPermissionResult(PluginCall call) {
        call.resolve(status("foreground_permission_result"));
        emit("foreground_permission_result");
    }

    @ActivityCallback
    private void backgroundLocationSettingsResult(PluginCall call, ActivityResult result) {
        call.resolve(status("background_settings_result"));
        emit("background_settings_result");
    }

    @Override
    protected void handleOnResume() {
        if (BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED) {
            emit("app_resumed");
        }
    }

    private boolean requireEnabled(PluginCall call, String event) {
        if (BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED) {
            emit(event);
            return true;
        }

        Log.i(TAG, event + " ignored: feasibility flag is disabled");
        call.unavailable(DISABLED_MESSAGE);
        return false;
    }

    private boolean hasForegroundLocationPermission() {
        return hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION) || hasPermission(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject status(String event) {
        JSObject result = new JSObject();
        result.put("enabled", BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED);
        result.put("event", event);
        result.put("foregroundLocationGranted", hasForegroundLocationPermission());
        result.put(
            "backgroundLocationGranted",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        );
        result.put("backgroundPermissionRequired", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        result.put("coordinatesCollected", false);
        result.put("coordinatesPersisted", false);
        result.put("creditAwarded", false);
        return result;
    }

    private void emit(String event) {
        JSObject payload = status(event);
        Log.i(TAG, event + " enabled=" + BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED);
        notifyListeners("backgroundLocationFeasibility", payload, true);
    }
}
