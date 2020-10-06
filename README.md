# ferry.fyi

A better tracker for the Washington State Ferry System

## Setting up dev environment

1. Install [postgres](https://www.postgresql.org/)
    1. Create a database named `ferryfyi` (`CREATE DATABASE ferryfyi;`)
2. `git clone git@github.com:anstosa/ferry.fyi.git`
3. `cd ferry.fyi`
4. `npm install`
5. `cp .env.sample .env` and fill out `.env` file
6. `npm run migrate` to initialize database


## Running locally

1. `npm run client`
2. (in another terminal) `npm run server`
4. http://localhost:4040

## Credits

Thank you to [![BookStack](https://user-images.githubusercontent.com/568242/60857158-6ad96100-a1be-11e9-9cdf-aa5872f2f6c5.png)](http://browserstack.com/) for providing free cross-browser testing.
