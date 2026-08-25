import React, { type ReactElement } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";

/** Ferry FYI service and subscription terms. */
export const Terms = (): ReactElement => (
  <Page title="Terms of Service">
    <SeoHelmet seo={getSeoMetadata("/terms")} />
    <p className="mt-4 text-sm">
      Last updated: <time dateTime="2026-08-24">August 24, 2026</time>
    </p>
    <p className="mt-4">
      Ferry FYI is an independent trip-planning service and is not operated by
      Washington State Ferries or WSDOT. Schedules, alerts, capacity estimates,
      traffic, weather, tide, and location-based results can be delayed,
      incomplete, or inaccurate. Confirm safety-critical and time-sensitive
      information with official sources.
    </p>
    <h2 className="mt-8 text-lg font-bold">Supporter subscriptions</h2>
    <p className="mt-2">
      Ferry FYI Supporter is an optional auto-renewing subscription. The price,
      billing interval, currency, and any applicable tax are shown before
      purchase by the website, App Store, or Google Play. The subscription
      renews until cancelled through the provider that processed the purchase.
      Cancellation normally stops the next renewal while access continues
      through the paid period, subject to provider and local-law rules.
    </p>
    <p className="mt-2">
      Supporter removes Ferry FYI advertisements while you are signed in by
      default and lets you optionally show a cosmetic Supporter badge on public
      leaderboards. You may voluntarily turn advertisements back on from the
      Account page and turn them off again at any time while subscribed. Core
      ferry information, alerts, tickets, and manual check-ins remain free.
      Automatic check-ins are not currently included.
    </p>
    <p className="mt-2">
      Purchases are linked to the Ferry FYI account used at checkout. Do not
      share accounts. Deleting the account does not cancel an App Store, Google
      Play, or web subscription; cancel it first or retain access to the billing
      provider. Restore behavior can require the original Ferry FYI account.
    </p>
    <h2 className="mt-8 text-lg font-bold">Acceptable use</h2>
    <p className="mt-2">
      Do not misuse Ferry FYI, interfere with service operation, automate
      purchases or account actions, evade access controls, or use leaderboard
      features deceptively. Ferry FYI may limit or suspend abusive activity.
    </p>
    <h2 className="mt-8 text-lg font-bold">Availability and liability</h2>
    <p className="mt-2">
      Ferry FYI is provided as available without a guarantee of uninterrupted
      service or ferry boarding. To the extent allowed by law, Ferry FYI is not
      liable for indirect or consequential loss caused by reliance on the app.
      These terms do not limit rights that cannot legally be waived.
    </p>
    <h2 className="mt-8 text-lg font-bold">Contact</h2>
    <p className="mt-2">
      Questions about these terms or a subscription can be sent to{" "}
      <a className="link" href="mailto:dev@ferry.fyi">
        dev@ferry.fyi
      </a>
      .
    </p>
  </Page>
);
