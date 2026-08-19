package fyi.ferry.leaderboards

import java.net.URI

// define the native contract
internal enum class AutomaticNativeEndpointKind(val path: String) {
    CONFIG("/api/leaderboards/native/config"),
    STATUS("/api/leaderboards/native/status"),
    CANDIDATES("/api/leaderboards/native/candidates"),
    ENROLLMENT("/api/leaderboards/native/enrollment"),
}

// define the native contract
internal enum class AutomaticEndpointSource {
    TRUSTED_SERVER_CONFIG,
    JAVASCRIPT_OR_USER_OVERRIDE,
}

// define the native contract
internal data class AutomaticNativeEndpointUrls(
    val config: String,
    val status: String,
    val candidates: String,
    val enrollment: String,
) {
    // select one fixed endpoint
    fun url(kind: AutomaticNativeEndpointKind): String = when (kind) {
        AutomaticNativeEndpointKind.CONFIG -> config
        AutomaticNativeEndpointKind.STATUS -> status
        AutomaticNativeEndpointKind.CANDIDATES -> candidates
        AutomaticNativeEndpointKind.ENROLLMENT -> enrollment
    }
}

// define the native contract
internal class AutomaticNativeEndpointValidator(expectedOrigin: String) {
    private val trustedOrigin = parseTrustedOrigin(expectedOrigin)

    // validate the complete trusted endpoint set
    fun validate(urls: AutomaticNativeEndpointUrls, source: AutomaticEndpointSource): Boolean {
        // reject bridge or user configuration
        if (source != AutomaticEndpointSource.TRUSTED_SERVER_CONFIG || trustedOrigin == null) {
            return false
        }

        // validate every fixed path
        for (kind in AutomaticNativeEndpointKind.entries) {
            // branch on the current state
            if (!isExactEndpoint(urls.url(kind), kind)) {
                return false
            }
        }

        return true
    }

    // reject redirects and response-url substitution
    fun acceptsResponse(
        kind: AutomaticNativeEndpointKind,
        requestedUrl: String,
        resolvedUrl: String,
        wasRedirected: Boolean,
    ): Boolean {
        // require one unchanged trusted url
        if (wasRedirected || requestedUrl != resolvedUrl) {
            return false
        }

        return isExactEndpoint(requestedUrl, kind)
    }

    // validate one exact endpoint
    private fun isExactEndpoint(value: String, kind: AutomaticNativeEndpointKind): Boolean {
        val origin = trustedOrigin ?: return false
        val endpoint = parseUri(value) ?: return false

        // reject credentials, query, fragment, and wrong paths
        if (
            endpoint.scheme?.lowercase() != "https" ||
            endpoint.userInfo != null ||
            endpoint.rawQuery != null ||
            endpoint.rawFragment != null ||
            endpoint.rawPath != kind.path
        ) {
            return false
        }

        return normalizedOrigin(endpoint) == origin
    }

    // define the native companion
    companion object {
        // parse one production origin
        private fun parseTrustedOrigin(value: String): String? {
            val origin = parseUri(value) ?: return null

            // require an origin without endpoint data
            if (
                origin.scheme?.lowercase() != "https" ||
                origin.userInfo != null ||
                origin.rawQuery != null ||
                origin.rawFragment != null ||
                origin.rawPath !in listOf("", "/")
            ) {
                return null
            }

            return normalizedOrigin(origin)
        }

        // parse without throwing
        private fun parseUri(value: String): URI? = try {
            URI(value)
        // fail closed on the error
        } catch (_: Exception) {
            null
        }

        // normalize url origin semantics
        private fun normalizedOrigin(uri: URI): String? {
            val host = uri.host?.lowercase() ?: return null
            val port = if (uri.port == -1) 443 else uri.port

            // reject invalid production ports
            if (port !in 1..65_535) {
                return null
            }

            return "https://$host:$port"
        }
    }
}
