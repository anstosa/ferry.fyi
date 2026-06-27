const DELAY_ALERT_MATCH =
  /\b(delay|delayed|delays|late|behind schedule|running behind)\b/i;

interface DelayBulletinInput {
  bodyHTML?: string;
  bodyText?: string;
  title: string;
}

// delay alert detection
export const isDelayBulletin = ({
  bodyHTML = "",
  bodyText = "",
  title,
}: DelayBulletinInput): boolean => {
  const searchableText = `${title} ${bodyText} ${bodyHTML}`;
  return DELAY_ALERT_MATCH.test(searchableText);
};
