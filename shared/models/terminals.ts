import { Camera } from "./cameras";

export interface Bulletin {
  title: string;
  description: string;
  date: number;
}

interface WaitTime {
  title?: string;
  description: string;
  time: number;
}

export interface Route {
  id: number;
  abbreviation: string;
  description: string;
  crossingTime: number;
}

export interface Terminal {
  abbreviation: string;
  bulletins: Bulletin[];
  cameras: Camera[];
  hasElevator: boolean;
  hasOverheadLoading: boolean;
  hasRestroom: boolean;
  hasWaitingRoom: boolean;
  hasFood: boolean;
  id: number;
  info: {
    ada?: string;
    airport?: string;
    bicycle?: string;
    construction?: string;
    food?: string;
    lost?: string;
    motorcycle?: string;
    parking?: string;
    security?: string;
    train?: string;
    truck?: string;
  };
  location: {
    link?: string;
    latitude?: number;
    longitude?: number;
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  name: string;
  waitTimes: WaitTime[];
  mates?: Terminal[];
  route?: Route;
  vesselwatch?: string;
}
