# iOS account migration

Ferry FYI keeps Google login on web and Android while the dedicated iOS Auth0
application offers email and password login. Existing Google users can add that
login at `https://ferry.fyi/ios` without changing the Auth0 subject that owns
their saved Ferry FYI data.

## Security boundary

The migration never accepts an email or Auth0 subject as proof of account
ownership. It requires all of the following:

1. A fresh Google authentication through the web Auth0 client.
2. A verified email on the Google identity.
3. Creation of an Auth0 database identity with the same server-derived email.
   The browser sends the password directly to Auth0's
   `/dbconnections/signup` endpoint; Ferry FYI never receives it.
4. A separate fresh authentication with the new database identity.
5. Matching verified emails in the access-token profile and both Auth0
   Management API profiles.

The server links the database identity as secondary under the existing Google
primary identity. This preserves the existing `google-oauth2|...` subject and
therefore preserves account settings, saved tickets, alerts, and leaderboard
state keyed to that subject.

The link endpoint is authenticated, rate-limited as a sensitive lookup, marked
`no-store`, and accepts only the secondary access token. It does not expose a
public email-to-provider lookup.

## Auth0 configuration

- Web application: enable `google-oauth2` and
  `Username-Password-Authentication`.
- iOS application: enable only `Username-Password-Authentication`.
- Web callback and logout URLs: retain the Ferry FYI web callback URLs.
- iOS callback and logout URLs: include `fyi.ferry://callback`.
- Ferry FYI server M2M application: grant `read:users`, `update:users`, and
  `delete:users` on the Auth0 Management API. The deletion scope supports the
  in-app permanent account-deletion flow.
- Database connection: allow signups from the web application and keep email
  verification enabled.

The current tenant has one Auth0 database connection. The Management API link
request therefore identifies the secondary account by `provider` and `user_id`
after the server has verified its connection name. If another Auth0 database
connection is added, also configure and send its Auth0 `connection_id` so the
link request remains unambiguous.

`AUTH0_IOS_CLIENT_ID` selects the dedicated iOS application during local and
GitHub Actions iOS builds. The deployed web service must continue using the web
client ID so `/ios` can force Google authentication.

## Login-failure handoff limitation

Invalid database credentials are handled on Auth0's hosted Universal Login
page. An Auth0 Post-Login Action does not run for a failed login, and Ferry FYI
must not look up an unauthenticated email to decide whether a Google account
exists because that would enable account enumeration.

The iOS app therefore exposes the same generic **Move Google account** entry to
all signed-out iOS users. A link directly on Auth0's password screen requires
Universal Login prompt partials, which in turn require an Auth0 custom domain
and custom page template. If those tenant features are enabled later, add a
static link to `https://ferry.fyi/ios` for every password-login user; do not
condition it on the entered email or error response.
