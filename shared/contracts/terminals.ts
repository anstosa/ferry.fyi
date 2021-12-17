import { Camera } from "./cameras";
import { Route } from "./routes";

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface Bulletin {
  title: string;
  description: string;
  date: number;
}

export interface WaitTime {
  title?: string;
  description: string;
  time: number;
}

export interface TerminalInfo {
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
}

export interface TerminalLocation {
  link?: string;
  latitude: number;
  longitude: number;
  address: Address;
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
  id: string;
  info: TerminalInfo;
  location: TerminalLocation;
  name: string;
  waitTimes: WaitTime[];
  mates?: Terminal[];
  popularity: number;
  routes?: Record<string, Route>;
  vesselWatchUrl?: string;
  terminalUrl?: string;
}
