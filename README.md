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

## Setting up dev environment

1. Install [postgres](https://www.postgresql.org/)
   1. Create a database named `ferryfyi` (`CREATE DATABASE ferryfyi;`)
2. `git clone git@github.com:anstosa/ferry.fyi.git`
3. `cd ferry.fyi`
4. `yarn`
5. `cp .envrc.sample .envrc` and fill out `.envrc` file (use [`direnv`](https://direnv.net/) or similar to populate variables)
6. `yarn db:migrate` to initialize database

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
2. Run `adb connect <WSA ip>`
3. Run `npm run start:android` to load app into WSA

## Credits

Thank you to [![BrowserStack](https://user-images.githubusercontent.com/568242/60857158-6ad96100-a1be-11e9-9cdf-aa5872f2f6c5.png)](http://browserstack.com/) for providing free cross-browser testing.
