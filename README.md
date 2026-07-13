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
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli#install-the-heroku-cli)

## Setting up dev environment

1. Install [postgres](https://www.postgresql.org/)
   1. Create a database named `ferryfyi` (`CREATE DATABASE ferryfyi;`)
2. `git clone git@github.com:anstosa/ferry.fyi.git`
3. `cd ferry.fyi`
4. `yarn`
5. `cp .envrc.sample .envrc` and fill out `.envrc` file (use [`direnv`](https://direnv.net/) or similar to populate variables)
6. `yarn db:migrate` to initialize database

## Local container stack

For a prod-like local Docker Compose setup with the app, detector runtime, and Postgres, see [Local container development](docs/local-container-development.md).

## Running locally

1. Run `yarn client`
2. Run `yarn server` (in another terminal)
3. Go to http://localhost:4040

## Android testing

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

1. Run frontend build `yarn build:android`
2. Update `versionCode` and `versionName` in `android/app/build.gradle`
3. Launch Android Studio `studio`
4. Install all the updates
5. Click **Sync Project with Gradle Files**
6. **Build > Rebuild Project**
7. **Build > Generate Signed Bundle(s) / APK(s)**
8. Select **Signed App Bundle**
9. Enter key store passwords
10. Select **Release**
11. Open Google Play Console
12. Upload to **Internal testing > Create new release**
13. Enter Release Notes
14. **Save**
15. **Review Release**
16. **Start rollout to Internal testing**
17. TEST IT
18. **Internal testing > {new version} > Promote > Production**
19. **Review Release**
20. **Start rollout to Production**

## iOS development and release

The iOS target is generated from the same Capacitor app as Android and requires macOS, Xcode, and an Apple Developer account for device builds and App Store distribution.

1. Install dependencies with `yarn` on a Mac.
2. Set `AUTH0_CLIENT_REDIRECT` to `fyi.ferry://callback` for the native build and add that URL to the Auth0 application's allowed callback and logout URLs.
3. Run `yarn open:ios`, select the **App** target in Xcode, and choose the Apple Developer signing team. Keep the bundle identifier as `fyi.ferry` unless the registered App ID requires a different one.
4. Run `yarn ios` to build, sync, and launch on a selected simulator or connected iPhone. The iPhone must grant camera and location access for ticket scanning and nearby-terminal features.
5. For a release, increment **Version** and **Build** in the App target's **General** settings, then use **Product > Archive** and upload the validated archive through Xcode's Organizer or Transporter.

`yarn build:ios` builds the production web bundle with an iOS-specific cache name and synchronizes it into the Xcode project. Run it again after changing web code or Capacitor plugins. The generated project targets iOS 15 and later.

For automated TestFlight uploads, configure the GitHub Actions credentials in [iOS TestFlight release automation](docs/ios-testflight-automation.md), then push an `ios-v*` tag or run **Publish iOS TestFlight** manually.

## Credits

Thank you to [![BrowserStack](https://user-images.githubusercontent.com/568242/60857158-6ad96100-a1be-11e9-9cdf-aa5872f2f6c5.png)](http://browserstack.com/) for providing free cross-browser testing.

Weather data and forecasts are provided by [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Ferry FYI uses and summarizes this data for capacity forecasts.
