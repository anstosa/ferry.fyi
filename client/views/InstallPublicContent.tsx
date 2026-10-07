import React, { type ReactElement, type ReactNode } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import { trackProductEvent } from "~/lib/analytics";
import { APPLE_APP_STORE_URL, GOOGLE_PLAY_URL } from "~/lib/appInstall";

interface InstallPublicContentProps {
  action?: ReactNode;
  icon?: ReactNode;
  message?: string;
  statusTitle?: string;
}

// record one apple-store intent
const trackAppleStoreOpen = (): void => {
  trackProductEvent("install_store_opened", { store: "apple" });
};

// record one google-store intent
const trackGoogleStoreOpen = (): void => {
  trackProductEvent("install_store_opened", { store: "google" });
};

// render install choices without platform detection
export const InstallPublicContent = ({
  action,
  icon,
  message = "Install Ferry FYI for quick access to schedules, alerts, tickets, and trip tools.",
  statusTitle = "Install Ferry FYI",
}: InstallPublicContentProps): ReactElement => (
  <>
    <section className="mx-auto mt-8 max-w-xl rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-blue-dark sm:p-10">
      {icon}
      <h2 className="mt-5 text-2xl font-bold text-blue-dark dark:text-white">
        {statusTitle}
      </h2>
      <p className="mt-3 leading-relaxed">{message}</p>
      {action}
    </section>

    <section className="mx-auto mt-8 max-w-3xl">
      <h2 className="text-xl font-bold">Choose where to use Ferry FYI</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl bg-white p-5 shadow-sm dark:bg-blue-dark">
          <h3 className="font-bold">Web app</h3>
          <p className="mt-2 text-sm leading-relaxed">
            Use Ferry FYI in any modern browser. Supported desktop browsers can
            also offer an install option for home-screen or app-launcher access.
          </p>
          <a className="link mt-3 inline-flex" href="/">
            Open the web app
          </a>
        </article>
        <article className="rounded-2xl bg-white p-5 shadow-sm dark:bg-blue-dark">
          <h3 className="font-bold">iPhone and iPad</h3>
          <p className="mt-2 text-sm leading-relaxed">
            Install the native iOS version from Apple&apos;s App Store.
          </p>
          <a
            className="link mt-3 inline-flex"
            href={APPLE_APP_STORE_URL}
            onClick={trackAppleStoreOpen}
            rel="noopener noreferrer"
            target="_blank"
          >
            View Ferry FYI in the App Store
          </a>
        </article>
        <article className="rounded-2xl bg-white p-5 shadow-sm dark:bg-blue-dark">
          <h3 className="font-bold">Android</h3>
          <p className="mt-2 text-sm leading-relaxed">
            Install the native Android version from Google Play.
          </p>
          <a
            className="link mt-3 inline-flex"
            href={GOOGLE_PLAY_URL}
            onClick={trackGoogleStoreOpen}
            rel="noopener noreferrer"
            target="_blank"
          >
            View Ferry FYI on Google Play
          </a>
        </article>
      </div>
    </section>
  </>
);

// render the complete universal install page
export const InstallPublicPage = (): ReactElement => (
  <Page publicTitle="Install">
    <SeoHelmet seo={getSeoMetadata("/install")} />
    <InstallPublicContent
      action={
        <a className="button button-primary mt-6 inline-flex" href="/">
          Use Ferry FYI on the web
        </a>
      }
    />
  </Page>
);
