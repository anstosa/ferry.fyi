import Foundation

// define the native contract
enum AutomaticNativeEndpointKind: CaseIterable {
    case config
    case status
    case candidates
    case enrollment

    // return one fixed path
    var path: String {
        // select the endpoint contract
        switch self {
        case .config:
            return "/api/leaderboards/native/config"
        case .status:
            return "/api/leaderboards/native/status"
        case .candidates:
            return "/api/leaderboards/native/candidates"
        case .enrollment:
            return "/api/leaderboards/native/enrollment"
        }
    }
}

// define the native contract
enum AutomaticEndpointSource {
    case trustedServerConfig
    case javascriptOrUserOverride
}

// define the native contract
struct AutomaticNativeEndpointUrls: Equatable {
    let config: String
    let status: String
    let candidates: String
    let enrollment: String

    // select one fixed endpoint
    func url(for kind: AutomaticNativeEndpointKind) -> String {
        // select the endpoint contract
        switch kind {
        case .config:
            return config
        case .status:
            return status
        case .candidates:
            return candidates
        case .enrollment:
            return enrollment
        }
    }
}

// define the native contract
final class AutomaticNativeEndpointValidator {
    private let trustedOrigin: String?

    // parse one production origin
    init(expectedOrigin: String) {
        trustedOrigin = Self.parseTrustedOrigin(expectedOrigin)
    }

    // validate the complete trusted endpoint set
    func validate(_ urls: AutomaticNativeEndpointUrls, source: AutomaticEndpointSource) -> Bool {
        // reject bridge or user configuration
        if source != .trustedServerConfig || trustedOrigin == nil {
            return false
        }

        // validate every fixed path
        for kind in AutomaticNativeEndpointKind.allCases {
            // branch on the current state
            if !isExactEndpoint(urls.url(for: kind), kind: kind) {
                return false
            }
        }

        return true
    }

    // reject redirects and response-url substitution
    func acceptsResponse(
        kind: AutomaticNativeEndpointKind,
        requestedURL: String,
        resolvedURL: String,
        wasRedirected: Bool
    ) -> Bool {
        // require one unchanged trusted url
        if wasRedirected || requestedURL != resolvedURL {
            return false
        }

        return isExactEndpoint(requestedURL, kind: kind)
    }

    // validate one exact endpoint
    private func isExactEndpoint(_ value: String, kind: AutomaticNativeEndpointKind) -> Bool {
        // branch on the current state
        guard let trustedOrigin,
              let endpoint = URLComponents(string: value) else {
            return false
        }

        // reject credentials, query, fragment, and wrong paths
        if endpoint.scheme?.lowercased() != "https" ||
            endpoint.user != nil ||
            endpoint.password != nil ||
            endpoint.query != nil ||
            endpoint.fragment != nil ||
            endpoint.percentEncodedPath != kind.path {
            return false
        }

        return Self.normalizedOrigin(endpoint) == trustedOrigin
    }

    // parse one origin without endpoint data
    private static func parseTrustedOrigin(_ value: String) -> String? {
        // branch on the current state
        guard let origin = URLComponents(string: value) else {
            return nil
        }

        // require an origin without endpoint data
        if origin.scheme?.lowercased() != "https" ||
            origin.user != nil ||
            origin.password != nil ||
            origin.query != nil ||
            origin.fragment != nil ||
            !(origin.percentEncodedPath.isEmpty || origin.percentEncodedPath == "/") {
            return nil
        }

        return normalizedOrigin(origin)
    }

    // normalize url origin semantics
    private static func normalizedOrigin(_ components: URLComponents) -> String? {
        // branch on the current state
        guard let host = components.host?.lowercased() else {
            return nil
        }

        let port = components.port ?? 443

        // reject invalid production ports
        if port < 1 || port > 65_535 {
            return nil
        }

        return "https://\(host):\(port)"
    }
}
