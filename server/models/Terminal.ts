import {
  Bulletin,
  Terminal as TerminalClass,
  TerminalInfo,
  TerminalLocation,
  WaitTime,
} from "shared/contracts/terminals";
import { CacheableModel } from "./CacheableModel";
import { Camera } from "~/models/Camera";
import { isKeyof } from "shared/lib/objects";
import { isNull } from "shared/lib/identity";
import { Route } from "~/models/Route";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";

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
    if (!isNull(index) && isKeyof(TERMINAL_DATA_OVERRIDES, index)) {
      Object.assign(this, TERMINAL_DATA_OVERRIDES[index]);
    }
    super.save();
  }

  serialize({ withoutMates }: Record<string, true> = {}): TerminalClass {
    return CacheableModel.serialize(
      {
        abbreviation: this.abbreviation,
        bulletins: this.bulletins,
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
