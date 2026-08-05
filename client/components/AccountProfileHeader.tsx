import React, { type ReactElement } from "react";

interface ProfileDetailProps {
  label: string;
  value?: string | null;
}

interface Props {
  accountId: string | null;
  email: string | null;
  locale: string | null;
  name: string;
  nickname: string | null;
  provider: string | null;
  updatedAt: string | null;
  username: string | null;
}

// first-and-last initials fallback
const getProfileInitials = (name: string): string => {
  const nameParts = name.trim().split(/\s+/);
  const firstInitial = nameParts[0]?.charAt(0) ?? "";
  const lastInitial =
    nameParts.length > 1 ? (nameParts.at(-1)?.charAt(0) ?? "") : "";

  return `${firstInitial}${lastInitial}`.toUpperCase();
};

const ProfileDetail = ({
  label,
  value,
}: ProfileDetailProps): ReactElement | null => {
  if (!value) {
    return null;
  }
  return (
    <div className="min-w-0 bg-black/10 px-5 py-4 sm:px-6">
      <dt className="text-2xs font-bold uppercase tracking-wider text-white/80">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 break-words font-medium text-white">
        {value}
      </dd>
    </div>
  );
};

/** Account identity summary and session action displayed at the top of Account. */
export const AccountProfileHeader = ({
  accountId,
  email,
  locale,
  name,
  nickname,
  provider,
  updatedAt,
  username,
}: Props): ReactElement => (
  <section
    aria-labelledby="account-profile-name"
    className="overflow-hidden rounded-2xl border border-green-dark/20 bg-gradient-to-br from-green-dark via-green-dark to-blue-dark shadow-lg dark:border-white/10"
  >
    <header className="p-5 sm:p-6">
      <div className="flex min-w-0 items-start gap-4 sm:items-center">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-2xl font-black text-white shadow-inner sm:h-16 sm:w-16"
        >
          {getProfileInitials(name)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-white/80">
            Profile
          </p>
          <h2
            className="mt-1 break-words text-2xl font-black leading-tight text-white sm:text-3xl"
            id="account-profile-name"
          >
            {name}
          </h2>
          {email && (
            <p className="mt-1 break-all text-sm font-medium text-white/80">
              {email}
            </p>
          )}
        </div>
      </div>
    </header>
    <dl className="grid gap-px bg-white/15 sm:grid-cols-2 lg:grid-cols-3">
      <ProfileDetail label="Account ID" value={accountId} />
      <ProfileDetail label="Nickname" value={nickname} />
      <ProfileDetail label="Username" value={username} />
      <ProfileDetail label="Language" value={locale} />
      <ProfileDetail label="Logged in with" value={provider} />
      <ProfileDetail label="Updated" value={updatedAt} />
    </dl>
  </section>
);
