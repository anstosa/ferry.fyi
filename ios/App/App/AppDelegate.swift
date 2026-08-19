import UIKit
import Capacitor

@UIApplicationMain
// define the native contract
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // initialize native diagnostics inertly
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
#if DEBUG
        // load only an explicit physical diagnostic input
        GateABackgroundLocationFeasibility.shared.prepareDiagnosticHarnessAtLaunch()
#endif
        // keep gate a default-off
        GateABackgroundLocationFeasibility.shared.configureIfEnabled(launchOptions: launchOptions)
        // keep the production runtime zero-work while default-off
        if AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            AutomaticLeaderboardIOSRuntime.shared.configureIfEnabled()
        }
#if DEBUG
        // advance one bounded diagnostic setup
        GateABackgroundLocationFeasibility.shared.reconcileDiagnosticHarnessIfEnabled()
#endif
        return true
    }

    // handle the native operation
    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    // reconcile native background state
    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
        GateABackgroundLocationFeasibility.shared.applicationDidEnterBackground()
        // avoid constructing a disabled production runtime
        if AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            AutomaticLeaderboardIOSRuntime.shared.applicationDidEnterBackground()
        }
    }

    // reconcile native foreground state
    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
        GateABackgroundLocationFeasibility.shared.applicationWillEnterForeground()
        // avoid constructing a disabled production runtime
        if AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            AutomaticLeaderboardIOSRuntime.shared.applicationWillEnterForeground()
        }
    }

    // reconcile only after protected data becomes available
    func applicationProtectedDataDidBecomeAvailable(_ application: UIApplication) {
        // reconcile protected data only for an enabled build
        if AutomaticLeaderboardIOSRuntime.isBuildEnabled {
            AutomaticLeaderboardIOSRuntime.shared.protectedDataDidBecomeAvailable()
        }
    }

    // advance debug permission transitions
    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
#if DEBUG
        // reconcile after a permission transition
        GateABackgroundLocationFeasibility.shared.reconcileDiagnosticHarnessIfEnabled()
#endif
    }

    // handle the native operation
    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // handle the native operation
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // handle the native operation
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
