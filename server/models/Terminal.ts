import {
  Terminal as TerminalClass,
  TerminalInfo,
  TerminalLocation,
  WaitTime,
} from "shared/contracts/terminals";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";
import { isNull } from "shared/lib/identity";
import { isKeyOf, values } from "shared/lib/objects";

import { Camera } from "~/models/Camera";
import { Route } from "~/models/Route";

import { Bulletin, BulletinInput } from "./Bulletin";
import { CacheableModel } from "./CacheableModel";

export class Terminal extends CacheableModel implements TerminalClass {
  static cacheKey = "terminals";
  static index = "id";

  abbreviation!: string;
  aliases!: string[];
  bulletins!: Bulletin[];
  cameras!: Camera[];
  hasElevator!: boolean;
  hasFood!: boolean;
  hasOverheadLoading!: boolean;
  hasRestroom!: boolean;
  hasWaitingRoom!: boolean;
  id!: string;
  info!: TerminalInfo;
  location!: TerminalLocation;
  mates!: Terminal[];
  name!: string;
  popularity!: number;
  routes!: Record<string, Route>;
  slug!: string;
  vesselWatchUrl!: string;
  terminalUrl!: string;
  waitTimes!: WaitTime[];

  save(): void {
    // merge in any data overrides
    const index = this.getIndex();
    if (!isNull(index) && isKeyOf(TERMINAL_DATA_OVERRIDES, index)) {
      Object.assign(this, TERMINAL_DATA_OVERRIDES[index]);
    }
    super.save();
  }

  static getByAlias = (alias: string): Terminal | null => {
    for (const terminal of values(this.getAll())) {
      if (terminal.aliases.includes(alias.toLowerCase())) {
        return terminal;
      }
    }
    return null;
  };

  serialize({ withoutMates }: Record<string, true> = {}): TerminalClass {
    const bulletins = (this.bulletins as Array<Bulletin | BulletinInput>)
      .map((bulletin) =>
        bulletin instanceof Bulletin
          ? { bulletin, ignoreAll: bulletin.ignoreAll }
          : {
              bulletin: Bulletin.serializeInput(bulletin),
              ignoreAll: Bulletin.normalizeInput(bulletin).ignoreAll,
            }
      )
      .filter(({ ignoreAll }) => !ignoreAll)
      .map(({ bulletin }) => bulletin);
    return CacheableModel.serialize(
      {
        abbreviation: this.abbreviation,
        bulletins,
        cameras: this.cameras,
        hasElevator: this.hasElevator,
        hasOverheadLoading: this.hasOverheadLoading,
        hasRestroom: this.hasRestroom,
        hasWaitingRoom: this.hasWaitingRoom,
        hasFood: this.hasFood,
        id: this.id,
        info: this.info,
        location: this.location,
        name: this.name,
        waitTimes: this.waitTimes,
        ...(withoutMates ? {} : { mates: this.mates }),
        popularity: this.popularity,
        routes: this.routes,
        vesselWatchUrl: this.vesselWatchUrl,
        terminalUrl: this.terminalUrl,
      },
      { withoutMates: true }
    );
  }
}
