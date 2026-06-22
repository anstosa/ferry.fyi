import {
  Camera as CameraClass,
  CameraImage,
  MapPoint,
} from "shared/contracts/cameras";
import CAMERA_DATA_OVERRIDES from "shared/data/cameras.json";
import { isNull } from "shared/lib/identity";
import { isKeyOf, values } from "shared/lib/objects";

import { CacheableModel } from "./CacheableModel";

export class Camera extends CacheableModel implements CameraClass {
  static cacheKey = "cameras";
  static index = "id";

  carsToBoat!: number | null;
  id!: string;
  image!: CameraImage;
  isActive!: boolean;
  location!: MapPoint;
  orderFromTerminal!: number;
  owner!: { name: string; url: string } | null;
  terminalId!: string;
  title!: string;

  static getByTerminalId(targetTerminalId: string): Camera[] {
    return values(Camera.getAll()).filter(
      ({ terminalId }) => terminalId === targetTerminalId
    );
  }

  // sort cameras for display
  static sortByTerminalDisplayOrder(cameras: Camera[]): Camera[] {
    // compare display order
    return cameras.sort((left, right) => {
      const leftIsDock = Camera.isDockCamera(left);
      const rightIsDock = Camera.isDockCamera(right);

      // dock priority
      if (leftIsDock !== rightIsDock) {
        return leftIsDock ? -1 : 1;
      }

      // explicit order
      if (left.orderFromTerminal !== right.orderFromTerminal) {
        return left.orderFromTerminal - right.orderFromTerminal;
      }

      return left.title.localeCompare(right.title);
    });
  }

  // detect dock views
  private static isDockCamera({ title }: Pick<CameraClass, "title">): boolean {
    return /\bdock\b/i.test(title);
  }

  save(): void {
    // merge in any data overrides
    const index = this.getIndex();
    if (!isNull(index) && isKeyOf(CAMERA_DATA_OVERRIDES, index)) {
      Object.assign(this, CAMERA_DATA_OVERRIDES[index]);
    }
    super.save();
  }

  serialize(): CameraClass {
    return CacheableModel.serialize({
      carsToBoat: this.carsToBoat,
      id: this.id,
      image: this.image,
      isActive: this.isActive,
      location: this.location,
      orderFromTerminal: this.orderFromTerminal,
      owner: this.owner,
      terminalId: this.terminalId,
      title: this.title,
    });
  }
}
