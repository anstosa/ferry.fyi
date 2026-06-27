const DELAY_ALERT_MATCH =
  /\b(delay|delayed|delays|late|behind schedule|running behind)\b/i;
const RUNNING_LATE_MATCH = /\brunning\b.*\blate\b/i;
const SAILING_CONTEXT_MATCH =
  /\b(arrival|arrivals|boat|departure|departures|ferry|sailing|sailings|service|vessel)\b/i;
const SENTENCE_SPLIT_MATCH = /[.!?\n]+/;

interface DelayBulletinInput {
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
}: DelayBulletinInput): string[] => {
  const combinedText = `${title}. ${bodyText}. ${stripHtml(bodyHTML)}`;
  return combinedText
    .split(SENTENCE_SPLIT_MATCH)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
};

// delay alert detection
export const isDelayBulletin = (bulletin: DelayBulletinInput): boolean => {
  return getSearchableChunks(bulletin).some((chunk) => {
    // direct vessel status
    if (RUNNING_LATE_MATCH.test(chunk)) {
      return true;
    }
    return DELAY_ALERT_MATCH.test(chunk) && SAILING_CONTEXT_MATCH.test(chunk);
  });
};
