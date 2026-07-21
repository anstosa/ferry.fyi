import React, { ReactElement } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "../components/Page";
import { SeoHelmet } from "../components/SeoHelmet";

// privacy policy page
export const PrivacyPolicy = (): ReactElement => (
  <Page contentClassName="mx-auto w-full max-w-2xl" title="Privacy Policy">
    <SeoHelmet seo={getSeoMetadata("/privacy")} />

    <p className="mt-4 text-sm">Last updated: July 12, 2026</p>
    <p className="mt-4">
      Ferry FYI provides Washington State Ferries schedules, service
      information, traffic cameras, ticket tools, and optional alerts. This
      policy explains how Ferry FYI collects, uses, and shares information when
      you use the website or mobile app.
    </p>

    <h2 className="font-bold text-lg mt-8">Information we collect</h2>
    <h3 className="font-bold mt-4">Information you provide</h3>
    <p className="mt-2">
      You can use most of Ferry FYI without an account. If you sign in, our
      authentication provider processes your account information, such as your
      name, email address, and account identifier. We store the account
      identifier with the settings you choose in Ferry FYI, including alert
      rules, saved terminals, notification tokens, and saved ticket information.
    </p>
    <h3 className="font-bold mt-4">Location</h3>
    <p className="mt-2">
      With your permission, Ferry FYI accesses your precise location to show
      nearby terminals and route information. Location is used on your device
      for these features and is not saved in your Ferry FYI account settings.
      You can deny or revoke location access in your browser or device settings.
    </p>
    <h3 className="font-bold mt-4">Usage and diagnostic information</h3>
    <p className="mt-2">
      We use Google Analytics to understand aggregate use of Ferry FYI and
      Sentry to diagnose errors and improve reliability. These services may
      receive information such as pages viewed, device and browser details, IP
      address, and error details. Ferry FYI also uses local storage and cached
      data to remember app preferences and support offline use.
    </p>
    <h3 className="font-bold mt-4">
      Third-party map and notification services
    </h3>
    <p className="mt-2">
      Mapbox provides map tiles. Firebase Cloud Messaging provides optional web
      push notifications. When you use these features, the relevant provider may
      process technical information needed to provide the service, including a
      device or notification token.
    </p>

    <h2 className="font-bold text-lg mt-8">How we use information</h2>
    <p className="mt-2">We use information to:</p>
    <ul className="list-disc pl-6 mt-2 space-y-1">
      <li>provide schedules, route information, maps, and ticket features;</li>
      <li>save account settings and deliver alerts you request;</li>
      <li>secure the service, troubleshoot errors, and prevent abuse; and</li>
      <li>understand and improve Ferry FYI.</li>
    </ul>

    <h2 className="font-bold text-lg mt-8">How we share information</h2>
    <p className="mt-2">
      We share information only with service providers that help operate Ferry
      FYI, including Auth0 for authentication, Google for analytics and
      notifications, Sentry for error monitoring, and Mapbox for maps. We may
      also disclose information when required by law or to protect Ferry FYI,
      its users, or the public. We do not sell personal information or use it
      for targeted advertising.
    </p>

    <h2 className="font-bold text-lg mt-8">Your choices and retention</h2>
    <p className="mt-2">
      You may use Ferry FYI without signing in, decline location and
      notification permissions, and control cookies or local storage through
      your browser or device settings. We retain account settings for as long as
      your account is active or as needed to provide Ferry FYI. To request
      access to or deletion of account information, email us at{" "}
      <a className="link" href="mailto:dev@ferry.fyi">
        dev@ferry.fyi
      </a>
      .
    </p>

    <h2 className="font-bold text-lg mt-8">Security and children</h2>
    <p className="mt-2">
      We use reasonable safeguards to protect information, but no internet
      service can guarantee absolute security. Ferry FYI is not directed to
      children under 13, and we do not knowingly collect personal information
      from children under 13.
    </p>

    <h2 className="font-bold text-lg mt-8">Changes and contact</h2>
    <p className="mt-2">
      We may update this policy as Ferry FYI changes. We will post the updated
      policy on this page and revise the date above. For privacy questions,
      contact{" "}
      <a className="link" href="mailto:dev@ferry.fyi">
        dev@ferry.fyi
      </a>
      .
    </p>
  </Page>
);
