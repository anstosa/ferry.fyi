import CoreLocation
import Foundation

/// Opt-in foundation for evaluating background-location permissions during Gate A.
///
/// This type deliberately never starts a location service and never receives or
/// persists coordinates. It only owns the permission/lifecycle boundary needed
/// for a future, separately approved feasibility experiment.
final class GateABackgroundLocationFeasibility: NSObject {
    static let shared = GateABackgroundLocationFeasibility()

    private static let enabledInfoPlistKey = "GateABackgroundLocationFeasibilityEnabled"

    private var locationManager: CLLocationManager?

    private var isEnabled: Bool {
        Bundle.main.object(forInfoDictionaryKey: Self.enabledInfoPlistKey) as? Bool ?? false
    }

    /// Installs the permission delegate only when the committed feature flag is enabled.
    /// This method does not request authorization or start any location updates.
    func configureIfEnabled() {
        guard isEnabled, locationManager == nil else { return }

        let manager = CLLocationManager()
        manager.delegate = self
        locationManager = manager
    }

    /// The only permission entry point for a future Gate A experiment.
    /// It is intentionally not called from application lifecycle methods.
    @discardableResult
    func requestBackgroundAuthorizationIfEnabled() -> Bool {
        guard isEnabled else { return false }

        configureIfEnabled()
        guard let locationManager else { return false }

        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestAlwaysAuthorization()
            return true
        }

        return false
    }

    /// Records no user data and does not start or resume background location work.
    func applicationDidEnterBackground() {
        guard isEnabled else { return }
    }

    /// Records no user data and does not start or resume background location work.
    func applicationWillEnterForeground() {
        guard isEnabled else { return }
    }
}

extension GateABackgroundLocationFeasibility: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // Authorization changes are intentionally not persisted, credited, or sent anywhere.
        // Do not add location-update delegate methods here without a separate privacy review.
    }
}
