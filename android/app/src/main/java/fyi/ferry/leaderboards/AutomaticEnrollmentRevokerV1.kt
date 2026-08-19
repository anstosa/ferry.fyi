package fyi.ferry.leaderboards

// define the native contract
internal class AutomaticBestEffortEnrollmentRevokerV1(
    private val transport: AutomaticNativeHttpTransportV1,
) {
    // attempt one strict self-revoke without weakening local purge
    fun revoke(credential: AutomaticCredentialV1): Boolean {
        val origin = credential.urls.canonicalOrigin() ?: return false
        val validator = AutomaticNativeEndpointValidator(origin)
        // require the complete trusted endpoint set before using the token
        if (!validator.validate(credential.urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)) {
            return false
        }
        val token = credential.bearerToken.copyOf()
        val response = try {
            transport.execute(
                AutomaticNativeHttpRequestV1(
                    method = "DELETE",
                    url = credential.urls.enrollment,
                    bearerToken = token,
                    body = null,
                ),
            )
        // release protected state
        } finally {
            token.fill(0)
        } ?: return false
        return try {
            response.statusCode == 200 &&
                validator.acceptsResponse(
                    AutomaticNativeEndpointKind.ENROLLMENT,
                    response.requestedUrl,
                    response.resolvedUrl,
                    response.wasRedirected,
                ) &&
                AutomaticNativeProtocolParserV1.parseRevoke(response.body) != null
        // release protected state
        } finally {
            // wipe every revoke response path
            response.body.fill(0)
        }
    }
}
