import { convert } from "html-to-text";
import { DateTime } from "luxon";
import {
  Bulletin as BulletinClass,
  Level,
  SortedLevels,
} from "shared/contracts/bulletins";

import { auth0 } from "~/lib/auth0";
import { sendPush } from "~/lib/push";

import { CacheableModel } from "./CacheableModel";
import { Terminal } from "./Terminal";

const startupTime = DateTime.now().toUnixInteger();
const ROUTE_MATCH = /^([\w/]+)\s*-\s*/;

type BulletinInput = Omit<
  BulletinClass,
  "bodyText" | "level" | "routePrefix"
> & {
  bodyText?: string;
};

export class Bulletin extends CacheableModel implements BulletinClass {
  static cacheKey = "bulletins";
  static index = "id";

  level!: Level;
  rawTitle!: string;
  date!: number;
  bodyHTML!: string;
  bodyText!: string;
  id!: string;
  terminalId!: string;
  title!: string;
  url?: string;

  constructor(data: BulletinInput) {
    const id = Bulletin.generateIndex(data);
    const bodyText =
      data.bodyText || convert(data.bodyHTML, { wordwrap: false });
    const title = Bulletin.normalizeTitle(data.title);
    const level = Bulletin.getLevel(data);
    super({ ...data, bodyText, id, level, title });
    this.rawTitle = data.title;
    this.sendPushes();
  }

  async sendPushes(): Promise<void> {
    if (this.date < startupTime) {
      // don't send pushes for old bulletins
      return;
    }

    if (this.level !== Level.HIGH) {
      // don't send pushes for less important bulletins
      return;
    }
    const users = await auth0.users.list({ search_engine: "v3" });
    // auth0 user page
    for await (const user of users) {
      const subscribedTerminals = user.app_metadata?.subscribedTerminals;
      const token = user.app_metadata?.fcmToken;
      // subscription metadata guard
      if (!Array.isArray(subscribedTerminals)) {
        continue;
      }
      if (!subscribedTerminals.includes(this.terminalId)) {
        // user not subscribed to this terminal
        continue;
      }
      if (typeof token !== "string") {
        // user does not have an FCM Token saved
        console.warn("Subscribed user without FCM Token", user.user_id);
        continue;
      }
      sendPush({
        token,
        data: {
          title: `${
            this.routePrefix === "All" ? "" : `[${this.routePrefix}] `
          }${this.title}`,
          body: this.bodyText,
          date: String(this.date),
          ...(this.url ? { url: this.url } : {}),
          terminalId: this.terminalId,
          userId: user.user_id ?? "",
        },
      });
    }
  }

  static getLevel({ title }: BulletinInput): Level {
    if (/survey|call center/i.test(title)) {
      return Level.LOW;
    } else if (/restoom|elevator|parking|website/.test(title)) {
      return Level.INFO;
    } else {
      return Level.HIGH;
    }
  }

  static sort = (bulletins: Bulletin[]): Bulletin[] =>
    bulletins.sort((a, b) => {
      if (a.level === b.level) {
        return b.date - a.date;
      }
      return SortedLevels.indexOf(b.level) - SortedLevels.indexOf(a.level);
    });

  get routePrefix(): string {
    const rawRouteMatch = this.rawTitle.match(ROUTE_MATCH);
    if (rawRouteMatch) {
      const [, rawRoute] = rawRouteMatch;
      const route = rawRoute
        // remove whitespace
        .replace(/\s/g, "")
        // split segments
        .split("/")
        // normalize abbreviations
        .map((alias) => Terminal.getByAlias(alias)?.abbreviation)
        // remove empty segments
        .filter(Boolean)
        // re-join segments
        .join("/");
      return route;
    } else {
      return "All";
    }
  }

  static normalizeTitle = (title: string): string => {
    const rawRouteMatch = title.match(ROUTE_MATCH);
    if (rawRouteMatch) {
      const withoutRoute = title.replace(ROUTE_MATCH, "");
      const withoutType = withoutRoute.replace(/^\w+\s*-\s*/, "");
      return withoutType;
    } else {
      return title;
    }
  };

  static generateIndex = (data: BulletinInput): string =>
    `${data.date}-${data.title}`;

  serialize(): BulletinClass {
    return CacheableModel.serialize({
      bodyHTML: this.bodyHTML,
      bodyText: this.bodyText,
      date: this.date,
      level: this.level,
      routePrefix: this.routePrefix,
      terminalId: this.terminalId,
      title: this.title,
      ...(this.url && { url: this.url }),
    });
  }
}
