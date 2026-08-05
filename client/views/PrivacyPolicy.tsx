import React, { ReactElement } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "../components/Page";
import { SeoHelmet } from "../components/SeoHelmet";

// privacy policy page
export const PrivacyPolicy = (): ReactElement => (
  <Page title="Privacy Policy">
    <SeoHelmet seo={getSeoMetadata("/privacy")} />

    <p className="mt-4 text-sm">
      Last updated: <time dateTime="2026-08-05">August 5, 2026</time>
    </p>
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
      For signed-in users, the latest successful details for a saved ticket may
      also be cached with the account so the same lookup does not need to be
      repeated on each device.
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
    <h3 className="font-bold mt-4">Advertising interactions</h3>
    <p className="mt-2">
      Ferry FYI may display advertisements selected from the route, terminal, or
      page you are viewing. We may measure aggregate campaign activity such as
      whether an advertisement was viewable and whether its website, directions,
      call, or offer link was selected. We do not use account information,
      precise location, saved tickets, notification settings, or activity across
      other websites to select advertisements.
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
      <li>secure the service, troubleshoot errors, and prevent abuse;</li>
      <li>understand and improve Ferry FYI; and</li>
      <li>
        display contextual advertisements and measure their aggregate
        performance.
      </li>
    </ul>

    <h2 className="font-bold text-lg mt-8">How we share information</h2>
    <p className="mt-2">
      We share personal information only with service providers that help
      operate Ferry FYI, including Auth0 for authentication, Google for
      analytics and notifications, Sentry for error monitoring, and Mapbox for
      maps. We may also disclose information when required by law or to protect
      Ferry FYI, its users, or the public. Advertisers may receive aggregate
      campaign reports, such as total viewable opportunities, served ads,
      viewable impressions, and link selections. We do not provide advertisers
      with personal information or individual browsing histories. We do not sell
      personal information or use it for targeted advertising.
    </p>
    <p className="mt-2">
      A viewable opportunity means the intended ad position remained visible for
      one continuous second, whether or not an ad was active. A viewable
      impression means at least half of an actual advertisement remained visible
      for one continuous second. Ferry FYI stores these measurements as daily
      totals. Short-lived anonymous validation tokens suppress duplicate counts
      and expire automatically; they are not account, visitor, or session
      histories. Campaign reports are informational and do not represent unique
      people, audited fraud-free traffic, or billable delivery.
    </p>

    <h2 className="font-bold text-lg mt-8">
      Advertising and sponsorship policy
    </h2>
    <p className="mt-2">
      Advertisements are labeled &quot;Advertisement&quot; and visually
      separated from schedules, alerts, forecasts, camera images, fares, and
      other Ferry FYI content. Advertising does not influence ferry data,
      editorial decisions, forecasts, or the order in which service information
      appears. An advertisement does not imply endorsement by Ferry FYI,
      Washington State Ferries, or the Washington State Department of
      Transportation.
    </p>
    <p className="mt-2">
      Ferry FYI does not place advertisements on saved-ticket or barcode
      screens, account and sign-in screens, service alerts, or push
      notifications. Ferry FYI does not accept advertisements that:
    </p>
    <ul className="list-disc pl-6 mt-2 space-y-1">
      <li>promote illegal products, services, or conduct;</li>
      <li>
        contain deceptive claims, impersonation, malware, or misleading links;
      </li>
      <li>
        promote discrimination, hate, harassment, exploitation, or sexually
        explicit content;
      </li>
      <li>
        promote tobacco, vaping, recreational drugs, weapons, gambling, or
        unsafe alcohol use;
      </li>
      <li>
        advocate for or against a political candidate, party, ballot measure, or
        election outcome;
      </li>
      <li>
        promote predatory lending, financial schemes, or unsubstantiated health
        claims; or
      </li>
      <li>
        resemble official ferry alerts, safety instructions, schedules, or
        controls in a way that could confuse riders.
      </li>
    </ul>
    <p className="mt-2">
      Ferry FYI reviews advertisements before publication and may reject, pause,
      or remove an advertisement that conflicts with this policy, creates a
      safety or trust concern, or receives substantiated complaints.
    </p>

    <h2 className="font-bold text-lg mt-8">Your choices and retention</h2>
    <p className="mt-2">
      You may use Ferry FYI without signing in, decline location and
      notification permissions, and control cookies or local storage through
      your browser or device settings. We retain account settings and cached
      details for tickets you save for as long as your account is active or as
      needed to provide Ferry FYI. Removing a ticket removes its account-scoped
      cached details, and deleting Ferry FYI account data removes all such
      cached ticket details. To request access to or deletion of account
      information, email us at{" "}
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
