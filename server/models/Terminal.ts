import {
  Bulletin,
  Terminal as TerminalClass,
  TerminalInfo,
  TerminalLocation,
  WaitTime,
} from "shared/models/terminals";
import { CacheableModel } from "./CacheableModel";
import { Camera } from "shared/models/cameras";
import { isKeyof } from "shared/lib/objects";
import { isNull } from "shared/lib/identity";
import { Route } from "shared/models/routes";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";

export class Terminal extends CacheableModel implements TerminalClass {
  static cacheKey = "terminals";
  static index = "id";

  abbreviation!: string;
  bulletins!: Bulletin[];
  cameras!: Camera[];
  hasElevator!: boolean;
  hasOverheadLoading!: boolean;
  hasRestroom!: boolean;
  hasWaitingRoom!: boolean;
  hasFood!: boolean;
  id!: string;
  info!: TerminalInfo;
  location!: TerminalLocation;
  name!: string;
  waitTimes!: WaitTime[];
  mates!: Terminal[];
  route!: Route;
  vesselwatch!: string;

  save = (): void => {
    // merge in any data overrides
    const index = this.getIndex();
    if (!isNull(index) && isKeyof(TERMINAL_DATA_OVERRIDES, index)) {
      Object.assign(this, TERMINAL_DATA_OVERRIDES[index]);
    }
    super.save();
  };

  serialize = (): TerminalClass => ({
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
    mates: this.mates,
    route: this.route,
    vesselwatch: this.vesselwatch,
  });
}
