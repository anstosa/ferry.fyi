const DELAY_ALERT_MATCH =
  /\b(delay|delayed|delays|late|behind schedule|running behind)\b/i;
const RUNNING_LATE_MATCH = /\brunning\b.*\blate\b/i;
const SAILING_CONTEXT_MATCH =
  /\b(arrival|arrivals|boat|departure|departures|ferry|sailing|sailings|service|vessel)\b/i;
const SENTENCE_SPLIT_MATCH = /[.!?\n]+/;
const TIDAL_CANCELLATION_MATCH = /\b(cancell?ed|cancell?ations?|cancel)\b/i;
const TIDE_CONTEXT_MATCH = /\bextreme low tide|low tide|tidal|tide\b/i;
const WAIT_NUMBER_HOURS_MATCH = /^[^\d]*(\d+) (Hour|Hr) Wait.*$/i;
const WAIT_SPELL_HOURS_MATCH =
  /^.*(one|two|three|four|five|six)( 1\/2){0,1} (Hour|Hr) Wait.*$/i;
const WAIT_MINUTES_MATCH = /^[^\d]*(\d+) (Minute|Min) Wait.*$/i;

interface BulletinInput {
  bodyHTML?: string;
  bodyText?: string;
  title: string;
}

// strip html tags
const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, " ");

// searchable chunks
const getSearchableChunks = ({
  bodyHTML = "",
  bodyText = "",
  title,
}: BulletinInput): string[] => {
  const combinedText = `${title}. ${bodyText}. ${stripHtml(bodyHTML)}`;
  return combinedText
    .split(SENTENCE_SPLIT_MATCH)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
};

// delay alert detection
export const isDelayBulletin = (bulletin: BulletinInput): boolean => {
  return getSearchableChunks(bulletin).some((chunk) => {
    // direct vessel status
    if (RUNNING_LATE_MATCH.test(chunk)) {
      return true;
    }
    return DELAY_ALERT_MATCH.test(chunk) && SAILING_CONTEXT_MATCH.test(chunk);
  });
};

// tidal cancellation alert detection
export const isTidalCancellationBulletin = (
  bulletin: BulletinInput
): boolean => {
  return getSearchableChunks(bulletin).some((chunk) => {
    return (
      TIDAL_CANCELLATION_MATCH.test(chunk) && TIDE_CONTEXT_MATCH.test(chunk)
    );
  });
};

// wait bulletin detection
export const isWaitTimeBulletin = (bulletin: BulletinInput): boolean => {
  return getSearchableChunks(bulletin).some((chunk) => {
    return (
      WAIT_NUMBER_HOURS_MATCH.test(chunk) ||
      WAIT_SPELL_HOURS_MATCH.test(chunk) ||
      WAIT_MINUTES_MATCH.test(chunk)
    );
  });
};

// app-managed alert detection
export const isSuppressedBulletin = (bulletin: BulletinInput): boolean => {
  return isDelayBulletin(bulletin) || isTidalCancellationBulletin(bulletin);
};
