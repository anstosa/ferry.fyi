package fyi.ferry

import com.getcapacitor.PluginMethod
import org.junit.Assert.assertEquals
import org.junit.Test

// define the production bridge surface
class AutomaticLeaderboardCheckinsPluginV1Test {
    // expose only the fixed platform-neutral enrollment contract
    @Test
    fun exposesExactPluginMethods() {
        // select only callable bridge methods
        val methods = AutomaticLeaderboardCheckinsPluginV1::class.java.declaredMethods
            .filter { method -> method.getAnnotation(PluginMethod::class.java) != null }
            .map { method -> method.name }
            .toSet()

        assertEquals(
            setOf(
                "bindIdentity",
                "checkEnrollmentCleanup",
                "checkIdentity",
                "clearEnrollmentCleanup",
                "disableAndPurge",
                "getCapability",
                "getEnrollmentBootstrap",
                "getStatus",
                "installCredential",
                "openAutomaticCheckinSettings",
                "reconcile",
                "requestBackgroundLocationPermission",
                "requestForegroundLocationPermission",
                "stageEnrollmentCleanup",
            ),
            methods,
        )
    }
}
