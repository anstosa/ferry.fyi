# Dependency maintenance

Review these constraints when upgrading dependencies. Exact Yarn resolutions in
`package.json` are deliberate security or compatibility choices, not permanent
replacements for upstream maintenance. The maintenance owner is responsible for
rechecking them with each dependency upgrade.

## Supported release lines

- Node 24.15 or later on the Node 24 line matches the runtime and jsdom requirements.
- ESLint 9 matches `eslint-plugin-react`'s declared peer support.
- TypeScript 6.0 matches `typescript-eslint`'s `<6.1` peer constraint.
- Tailwind 3 retains the existing SCSS, `@apply`, and `resolveConfig` integration;
  moving to Tailwind 4 requires a separate migration.
- `@sentry/react` 10.69.0 matches the exact `@sentry/capacitor` 4.4.0 peer.
- AGP 8, Android SDK 36, and AndroidX Core 1.18 retain the current Capacitor build
  compatibility. `playServicesLocationVersion` in `android/variables.gradle`
  controls the app and Capacitor geolocation plugin together.

## Transitive override inventory

| Resolution family                                            | Owning dependency edges                                                                      | Reason and validation surface                                                                                                                | Removal condition                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Babel async helpers/plugins 7.29.7, traverse/runtime 7.29.10 | Babel 7 tooling used by React, Vite, and Workbox                                             | Keep the updated Babel 7 implementation together without introducing Babel 8; validate lint and web/native builds                            | Upstream packages require the selected or a newer compatible patched Babel 7 release                                  |
| `uuid` 11.1.1                                                | `sequelize`, `gaxios`, `teeny-request`, `xcode`                                              | Retain the patched CommonJS-capable line; validate database suites, server builds, Capacitor sync, and Xcode project parsing/UUID generation | Every remaining edge supports a patched version in its own requested range without losing CommonJS compatibility      |
| `@grpc/grpc-js` 1.14.6                                       | Google Cloud clients through `google-gax` and storage/Firebase dependencies                  | Select the patched 1.14 line even where a parent requests an older minor; validate server and Firebase-related suites/builds                 | Upstream ranges admit a patched release and the clean lockfile no longer needs the override                           |
| `postcss-selector-parser` 7.1.7                              | Tailwind, PostCSS plugins, Stylelint, and Stylelint SCSS                                     | Select the patched 7.x parser across the CSS toolchain; validate all lint, stylesheet builds, URI regressions, and CSS budgets               | Upstream parents require patched native lines, including 6.1.5 for 6.x consumers and 7.1.6 or later for 7.x consumers |
| `favicons/sharp` 0.35.5                                      | Favicons/PWA image generation                                                                | Keep the selected image processor compatible with icon generation; validate PWA artifacts and web/native builds                              | Favicons requires the selected or a newer compatible patched Sharp release                                            |
| `workbox-build/ajv` 8.20.0                                   | Workbox service-worker generation                                                            | Keep the selected validator on the supported Ajv 8 line; validate PWA generation and artifact smokes                                         | Workbox requires the selected or a newer compatible patched Ajv release                                               |
| `semver` 6.3.1                                               | Babel compilation targets, preset-env, polyfill-corejs2, and helper-define-polyfill-provider | Retain the patched major expected by the Babel 7 callers; validate installation and builds                                                   | Parent minimums include the patched 6.x release, or those edges disappear                                             |
| `core-js-compat/semver` 7.8.5                                | Any remaining core-js-compat semver edge                                                     | Retain the selected 7.x release without changing Babel callers that still require 6.x; validate installation and builds                      | The resolved graph no longer contains this edge, or its upstream minimum includes the patched release                 |

Security references: [uuid advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq),
[grpc-js advisory](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j),
and [selector-parser advisory](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf).
The uuid advisory also affects 12.0.0 and 13.0.0; do not treat every version above
11.1.1 as patched. [uuid 12 removes CommonJS support](https://github.com/uuidjs/uuid/blob/main/CHANGELOG.md).

Before retiring a resolution, inspect `yarn why <package>`, update the owning
dependency, regenerate the lockfile through Yarn, and run the applicable checks
above plus `yarn type-check`, `yarn lint`, `yarn test`, `yarn build`, and
`yarn audit`. Do not remove security floors merely to silence range warnings.

## Remaining platform and security limits

As of 2026-10-22, four high-severity audit paths remain in development tools:
`node-forge` through `@capgo/cli`, and `braces` through Nodemon and Stylelint.
The [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
and [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) list no
published patched versions. Recheck upstream releases during the next upgrade;
do not claim the dependency tree is vulnerability-free.

Capacitor sync can update the iOS manifest on Linux, but native iOS compilation
and Swift package resolution require macOS/Xcode. Validate those in the existing
macOS workflow before an iOS release; never hand-edit generated resolved packages.
