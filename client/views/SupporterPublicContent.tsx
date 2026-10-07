import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { getSeoMetadata } from "shared/lib/seo";

import { AuthPageShell } from "~/components/AuthPageShell";
import { SeoHelmet } from "~/components/SeoHelmet";

// render public supporter terms without account state
export const SupporterPublicContent = (): ReactElement => (
  <div className="mt-7 text-left">
    <h2 className="text-xl font-black text-green-dark dark:text-green-light">
      Supporter benefits
    </h2>
    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold leading-relaxed">
      <li>No Ferry FYI advertisements while signed in by default</li>
      <li>Optional Supporter badge on public leaderboards</li>
      <li>
        Helps fund schedules, alerts, forecasts, cameras, and ticket tools
      </li>
    </ul>
    <p className="mt-4 text-sm leading-relaxed">
      Core ferry information, tickets, alerts, and manual check-ins remain free.
      Supporters can voluntarily turn advertisements back on from the Account
      page and turn them off again while subscribed.
    </p>

    <h2 className="mt-7 text-xl font-black text-green-dark dark:text-green-light">
      Billing and account access
    </h2>
    <p className="mt-3 text-sm leading-relaxed">
      Monthly and yearly Supporter subscriptions renew automatically until
      canceled. The price, billing interval, currency, and any applicable tax
      are shown by the website, App Store, or Google Play before purchase.
    </p>
    <p className="mt-3 text-sm leading-relaxed">
      Manage or cancel with the provider that processed the purchase. Restoring
      access can require the original Ferry FYI account and, for store
      purchases, the original Apple or Google account. Access normally continues
      through the paid period after cancellation. Deleting a Ferry FYI account
      does not cancel billing with a subscription provider.
    </p>
    <p className="mt-3 text-sm leading-relaxed">
      Review the{" "}
      <Link className="link" to="/terms">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link className="link" to="/privacy">
        Privacy Policy
      </Link>
      .
    </p>
  </div>
);

// render the complete universal supporter page
export const SupporterPublicPage = (): ReactElement => (
  <>
    <SeoHelmet seo={getSeoMetadata("/supporter")} />
    <AuthPageShell
      description="Enjoy Ferry FYI without advertisements and help keep reliable ferry tools available to every rider."
      title="Support an independent ferry app"
      titleId="supporter-title"
    >
      <SupporterPublicContent />
    </AuthPageShell>
  </>
);
