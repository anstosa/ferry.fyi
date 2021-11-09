import { CacheableModel } from "./CacheableModel";
import {
  Camera as CameraClass,
  CameraImage,
  MapPoint,
} from "shared/models/cameras";
import { isKeyof, values } from "shared/lib/objects";
import { isNull } from "shared/lib/identity";
import CAMERA_DATA_OVERRIDES from "shared/data/cameras.json";

export class Camera extends CacheableModel implements CameraClass {
  static cacheKey = "cameras";
  static index = "id";

  feetToNext!: number | null;
  id!: string;
  image!: CameraImage;
  isActive!: boolean;
  location!: MapPoint;
  orderFromTerminal!: number;
  owner!: { name: string; url: string } | null;
  spacesToNext!: number | null;
  terminalId!: string;
  title!: string;

  static getByTerminalId(targetTerminalId: string): Camera[] {
    return values(Camera.getAll()).filter(
      ({ terminalId }) => terminalId === targetTerminalId
    );
  }

  save(): void {
    // merge in any data overrides
    const index = this.getIndex();
    if (!isNull(index) && isKeyof(CAMERA_DATA_OVERRIDES, index)) {
      Object.assign(this, CAMERA_DATA_OVERRIDES[index]);
    }
    super.save();
  }

  serialize(): CameraClass {
    return CacheableModel.serialize({
      feetToNext: this.feetToNext,
      id: this.id,
      image: this.image,
      isActive: this.isActive,
      location: this.location,
      orderFromTerminal: this.orderFromTerminal,
      owner: this.owner,
      spacesToNext: this.spacesToNext,
      terminalId: this.terminalId,
      title: this.title,
    });
  }
}
