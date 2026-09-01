# ferry.fyi

A better tracker for the Washington State Ferry System

An alternative to the WSDOT mobile app. With Ferry FYI, you get:

✨ Polished, modern UI with dark mode support

🔮 Forecasted sailing fullness

⌚ More accurate delay reporting

📢 Filtered WSF bulletins

📷 Traffic cameras: ordered, tagged, and enhanced

⛴️ Supports all WSF routes

🗺️ Shortcuts to VesselWatch

🎫 Link to reserve sailings

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Git LFS](https://git-lfs.com/)

## Setting up dev environment

1. Install [postgres](https://www.postgresql.org/)
   1. Create a database named `ferryfyi` (`CREATE DATABASE ferryfyi;`)
2. `git clone git@github.com:anstosa/ferry.fyi.git`
3. `cd ferry.fyi`
4. `git lfs install && git lfs pull`
5. `yarn`
6. `cp .envrc.sample .envrc` and fill out `.envrc` file (use [`direnv`](https://direnv.net/) or similar to populate variables)
7. `yarn db:migrate` to initialize database

## Local container stack

For a prod-like local Docker Compose setup with the app, detector runtime, Postgres, and automatic database migrations, see [Local container development](docs/local-container-development.md).

Run the full containerized development stack with `yarn dev:up`.

## Production hosting

Ferry FYI runs on AWS ECS Fargate with PostgreSQL on Amazon RDS. Production
images are built and deployed by `.github/workflows/deploy-aws.yml`; runtime
configuration is stored in AWS Secrets Manager and exposed through the ECS task
definition.

## Running locally

`yarn` installs the repository pre-commit hook automatically. It type-checks
app changes, synchronizes Capacitor artifacts after native dependency or
configuration changes, and compiles Android resources for native edits.

1. Run `yarn client`
2. Run `yarn server` (in another terminal)
3. Go to http://localhost:4040

## Android testing

From WSL, `yarn start:android` uses the Windows Android SDK and emulator when it
is installed, avoiding WSL graphics issues. It waits for Android itself to finish
booting, builds the APK in WSL, then installs and opens it through Windows ADB.
It uses the first configured AVD by default; set `ANDROID_AVD_NAME` to select a
specific emulator. Without a Windows SDK, it falls back to the Linux emulator.

Physical device

1. Plug device into Windows via compatible cable
2. Run `adb tcpip 5555` on Windows
3. Run `adb connect <phone ip>:5555` in WSL
4. Run `adb reverse tcp:4040 tcp:4040` in WSL
5. Run `npm run start:android` to load app onto phone

WSA

1. Install WSA
2. Enable Developer Mode in WSA Settings
3. Open any WSA app
4. Run `adb connect <WSA ip from settings page>`
5. Run `npm run start:android` to load app into WSA or run app from Android Studio

## Android Release

Use the **Publish apps** GitHub Action with platform `android` and the release
version, or push an `android-v*` tag. It starts from a clean checkout, installs
dependencies, builds the production web bundle, runs `cap sync android`, signs
the App Bundle, and uploads it to Play internal testing. No local build, sync,
or version-code command is required before committing.

## iOS development and release

The iOS target is generated from the same Capacitor app as Android and requires macOS, Xcode, and an Apple Developer account for device builds and App Store distribution.

1. Install dependencies with `yarn` on a Mac.
2. Set `AUTH0_IOS_CLIENT_ID` to the dedicated Auth0 iOS application, set `AUTH0_CLIENT_REDIRECT` to `fyi.ferry://callback`, and add that URL to the Auth0 application's allowed callback and logout URLs. Keep only the Auth0 database connection enabled for the iOS application; the web application retains Google for the `/ios` account-migration flow.
3. Run `yarn open:ios`, select the **App** target in Xcode, and choose the Apple Developer signing team. Keep the bundle identifier as `fyi.ferry` unless the registered App ID requires a different one.
4. Run `yarn ios` to build, sync, and launch on a selected simulator or connected iPhone. The iPhone must grant camera and location access for ticket scanning and nearby-terminal features.
5. For a release, use **Publish apps** with platform `ios` and the release version, or push an `ios-v*` tag. The workflow builds, synchronizes, signs, and uploads the TestFlight archive from a clean checkout.

`yarn build:ios` builds the production web bundle with an iOS-specific cache name and synchronizes it into the Xcode project. Run it again after changing web code or Capacitor plugins. The generated project targets iOS 15 and later.

For automated TestFlight uploads, configure the GitHub Actions credentials in [iOS TestFlight release automation](docs/ios-testflight-automation.md), then push an `ios-v*` tag or run **Publish apps** manually.

## Credits

Thank you to [![BrowserStack](https://user-images.githubusercontent.com/568242/60857158-6ad96100-a1be-11e9-9cdf-aa5872f2f6c5.png)](http://browserstack.com/) for providing free cross-browser testing.

Weather data and forecasts are provided by [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Ferry FYI uses and summarizes this data for capacity forecasts.
