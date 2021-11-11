import EmailIcon from "~/images/icons/solid/envelope.svg";
import GitHubIcon from "~/images/icons/brands/github.svg";
import React, { ReactElement } from "react";

export const FeedbackContent = (): ReactElement => (
  <>
    <h2 className="font-bold text-lg mt-8">Feedback</h2>
    <p className="mt-2">See something wrong? Want to request a feature?</p>
    <div className="flex mt-4">
      <a
        className="button button-invert flex-grow"
        href="https://github.com/anstosa/ferry.fyi/issues"
        target="_blank"
        rel="noopener noreferrer"
      >
        <GitHubIcon className="inline-block button-icon text-2xl" />
        <span className="button-label">File a Ticket</span>
      </a>
      <a
        className="button flex-grow ml-4 dark:border-white dark:text-white"
        href="mailto:dev@ferry.fyi"
        target="_blank"
        rel="noopener noreferrer"
      >
        <EmailIcon className="inline-block button-icon text-2xl" />
        <span className="button-label">Email Me</span>
      </a>
    </div>
  </>
);
