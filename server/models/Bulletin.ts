import { convert } from "html-to-text";
import { DateTime } from "luxon";
import { Op, UniqueConstraintError } from "sequelize";
import {
  Bulletin as BulletinClass,
  Level,
  SortedLevels,
} from "shared/contracts/bulletins";
import { isSuppressedBulletin, isWaitTimeBulletin } from "shared/lib/bulletins";

import { sendPush } from "~/lib/push";
import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";

import { CacheableModel } from "./CacheableModel";
import { PersistedBulletin } from "./PersistedBulletin";
import { Terminal } from "./Terminal";

const startupTime = DateTime.now().toUnixInteger();
const ROUTE_MATCH = /^([\w/]+)\s*-\s*/;

interface NormalizedBulletinInput extends BulletinInput {
  bodyText: string;
  id: string;
  ignoreAll: boolean;
  level: Level;
  title: string;
}

export type BulletinInput = Omit<
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
  ignoreAll!: boolean;
  terminalId!: string;
  title!: string;
  url?: string;

  constructor(data: BulletinInput) {
    const normalizedData = Bulletin.normalizeInput(data);
    super(normalizedData);
    this.rawTitle = data.title;
    this.sendPushes();
  }

  // normalize bulletin input
  static normalizeInput(data: BulletinInput): NormalizedBulletinInput {
    const id = Bulletin.generateIndex(data);
    const bodyText =
      data.bodyText || convert(data.bodyHTML, { wordwrap: false });
    const title = Bulletin.normalizeTitle(data.title);
    const level = Bulletin.getLevel(data);
    const ignoreAll = isSuppressedBulletin({ ...data, bodyText, title });
    return { ...data, bodyText, id, ignoreAll, level, title };
  }

  // get or update cached bulletin
  static getOrUpdate(index: string, data: BulletinInput): [Bulletin, boolean] {
    const [bulletin, wasCreated] = Bulletin.getOrCreate(index, data);
    // existing bulletin guard
    if (!wasCreated) {
      bulletin.update(Bulletin.normalizeInput(data));
      bulletin.rawTitle = data.title;
      bulletin.save();
    }
    return [bulletin, wasCreated];
  }

  // persist active bulletin
  async persistActive(seenAt: number): Promise<void> {
    const existingBulletin = await PersistedBulletin.findByPk(this.id);
    const data = {
      bodyHTML: this.bodyHTML,
      bodyText: this.bodyText,
      date: this.date,
      ignoreAll: this.ignoreAll,
      inactiveAt: null,
      lastSeenAt: seenAt,
      level: this.level,
      rawTitle: this.rawTitle,
      terminalId: this.terminalId,
      title: this.title,
      url: this.url ?? null,
    };
    // existing row guard
    if (existingBulletin) {
      await existingBulletin.update(data);
      return;
    }
    // create new row first
    try {
      await PersistedBulletin.create({
        ...data,
        firstSeenAt: seenAt,
        id: this.id,
      });
    } catch (error) {
      // duplicate insert race
      if (error instanceof UniqueConstraintError) {
        await PersistedBulletin.update(data, { where: { id: this.id } });
        return;
      }
      throw error;
    }
  }

  // mark missing terminal bulletins inactive
  static async markInactiveForTerminal(
    terminalId: string,
    activeIds: string[],
    inactiveAt: number
  ): Promise<void> {
    const idFilter =
      activeIds.length > 0 ? { id: { [Op.notIn]: activeIds } } : {};
    await PersistedBulletin.update(
      { inactiveAt },
      {
        where: {
          ...idFilter,
          inactiveAt: null,
          terminalId,
        },
      }
    );
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
    if (this.ignoreAll) {
      // app-managed alerts
      return;
    }
    const messages = await getSubscribedTerminalPushMessages({
      channel: isWaitTimeBulletin(this) ? "wait-times" : "service-alerts",
      data: {
        title: `${
          this.routePrefix === "All" ? "" : `[${this.routePrefix}] `
        }${this.title}`,
        body: this.bodyText,
        date: String(this.date),
        ...(this.url ? { url: this.url } : {}),
        terminalId: this.terminalId,
      },
      terminalIds: [this.terminalId],
    });
    // push queue
    for (const message of messages) {
      sendPush(message);
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

  static getRoutePrefix = (rawTitle: string): string => {
    const rawRouteMatch = rawTitle.match(ROUTE_MATCH);
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
  };

  get routePrefix(): string {
    return Bulletin.getRoutePrefix(this.rawTitle);
  }

  /** Serialize bundled seed data that has not yet been refreshed from WSF. */
  static serializeInput = (data: BulletinInput): BulletinClass => {
    const normalized = Bulletin.normalizeInput(data);
    return {
      bodyHTML: normalized.bodyHTML,
      bodyText: normalized.bodyText,
      date: normalized.date,
      level: normalized.level,
      routePrefix: Bulletin.getRoutePrefix(data.title),
      terminalId: normalized.terminalId,
      title: normalized.title,
      ...(normalized.url && { url: normalized.url }),
    };
  };

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
    `${data.terminalId}-${data.date}-${data.title}`;

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
