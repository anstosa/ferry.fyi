export const DETAIL_TABS = ["sailing", "forecast", "vessel"] as const;

export type DetailTab = (typeof DETAIL_TABS)[number];

interface SailingDeepLinkInput {
  currentUrl: string;
  date: string;
  sailingTime: number;
  tab: DetailTab;
}

// detail tab guard
export const isDetailTab = (input?: string): input is DetailTab =>
  DETAIL_TABS.includes(input as DetailTab);

// sailing detail link
export const getSailingDeepLink = ({
  currentUrl,
  date,
  sailingTime,
  tab,
}: SailingDeepLinkInput): string => {
  const url = new URL(currentUrl);
  url.searchParams.set("date", date);
  url.searchParams.set("sailing", String(sailingTime));
  url.searchParams.set("tab", tab);
  return url.toString();
};
