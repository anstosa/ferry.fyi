import type { TerminalInfo, WaitTime } from "shared/contracts/terminals";

// convert provider html at the browser boundary, retaining useful link destinations
const getPlainText = (html?: string | null): string => {
  // live WSF fields can be null despite the optional string contract
  if (typeof html !== "string") {
    return "";
  }
  // anonymous server data is already plain text and must not require a browser parser
  if (typeof DOMParser === "undefined" || !/<\/?[a-z][^>]*>/i.test(html)) {
    return html;
  }
  const document = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>/gi, "$&\n"),
    "text/html"
  );
  // omit non-content provider markup
  document
    .querySelectorAll("script, style")
    .forEach((element) => element.remove());
  // preserve parking and transport urls without inserting executable markup
  document.querySelectorAll("a[href]").forEach((link) => {
    const href = (link.getAttribute("href") ?? "").trim();
    // retain public web destinations only
    if (/^https?:\/\//i.test(href) && link.textContent?.trim() !== href) {
      link.append(` (${href})`);
    }
  });
  return document.body.textContent?.trim() ?? "";
};

// share provider text conversion between the live page and its lazy-module fallback
export const getPlainTerminalContent = ({
  info,
  waitTimes,
}: {
  info?: TerminalInfo;
  waitTimes?: readonly WaitTime[];
}): { info?: TerminalInfo; waitTimes?: WaitTime[] } => ({
  info: info
    ? Object.fromEntries(
        // preserve section keys while removing non-content markup
        Object.entries(info).map(([key, value]) => [key, getPlainText(value)])
      )
    : undefined,
  waitTimes: waitTimes?.map((wait) => ({
    // retain original timestamps and titles rather than inventing freshness
    ...wait,
    description: getPlainText(wait.description),
  })),
});
