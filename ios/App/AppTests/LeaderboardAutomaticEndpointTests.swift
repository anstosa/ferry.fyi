import XCTest
@testable import Ferry_FYI

// define the native contract
final class AutomaticNativeEndpointValidatorTests: XCTestCase {
    private let validator = AutomaticNativeEndpointValidator(expectedOrigin: "https://ferry.fyi")
    private let validURLs = AutomaticNativeEndpointUrls(
        config: "https://ferry.fyi/api/leaderboards/native/config",
        status: "https://ferry.fyi/api/leaderboards/native/status",
        candidates: "https://ferry.fyi/api/leaderboards/native/candidates",
        enrollment: "https://ferry.fyi/api/leaderboards/native/enrollment"
    )

    // accept only the server-owned endpoint set
    func testTrustedExactEndpointsAreAccepted() {
        XCTAssertTrue(validator.validate(validURLs, source: .trustedServerConfig))
    }

    // reject non-https and wrong origins
    func testTransportAndOriginChangesAreRejected() {
        XCTAssertFalse(validator.validate(
            AutomaticNativeEndpointUrls(
                config: "http://ferry.fyi/api/leaderboards/native/config",
                status: validURLs.status,
                candidates: validURLs.candidates,
                enrollment: validURLs.enrollment
            ),
            source: .trustedServerConfig
        ))
        XCTAssertFalse(validator.validate(
            AutomaticNativeEndpointUrls(
                config: validURLs.config,
                status: "https://evil.example/api/leaderboards/native/status",
                candidates: validURLs.candidates,
                enrollment: validURLs.enrollment
            ),
            source: .trustedServerConfig
        ))
    }

    // reject url data outside the fixed paths
    func testCredentialsQueriesFragmentsAndPathsAreRejected() {
        let invalidURLs = [
            "https://user@ferry.fyi/api/leaderboards/native/config",
            "https://ferry.fyi/api/leaderboards/native/config?source=js",
            "https://ferry.fyi/api/leaderboards/native/config#fragment",
            "https://ferry.fyi/api/leaderboards/native/status",
        ]

        // reject every invalid config url
        for configURL in invalidURLs {
            XCTAssertFalse(validator.validate(
                AutomaticNativeEndpointUrls(
                    config: configURL,
                    status: validURLs.status,
                    candidates: validURLs.candidates,
                    enrollment: validURLs.enrollment
                ),
                source: .trustedServerConfig
            ))
        }
    }

    // reject javascript and user overrides
    func testBridgeOverrideSourceIsRejected() {
        XCTAssertFalse(validator.validate(validURLs, source: .javascriptOrUserOverride))
    }

    // reject any redirect or final-url substitution
    func testRedirectTargetSubstitutionIsRejected() {
        XCTAssertFalse(validator.acceptsResponse(
            kind: .config,
            requestedURL: validURLs.config,
            resolvedURL: "https://evil.example/api/leaderboards/native/config",
            wasRedirected: true
        ))
        XCTAssertFalse(validator.acceptsResponse(
            kind: .config,
            requestedURL: validURLs.config,
            resolvedURL: validURLs.config,
            wasRedirected: true
        ))
        XCTAssertTrue(validator.acceptsResponse(
            kind: .config,
            requestedURL: validURLs.config,
            resolvedURL: validURLs.config,
            wasRedirected: false
        ))
    }
}
