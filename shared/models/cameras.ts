export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface CameraImage {
  url: string;
  width: number;
  height: number;
}

export interface Camera {
  id: number;
  location: MapPoint;
  title: string;
  image: CameraImage;
  owner: { name: string; url: string } | null;
  isActive: boolean;
  feetToNext: number | null;
  spacesToNext: number | null;
  orderFromTerminal: number;
}
