/******************************************************************************
 * TERMINALS
 *
 * https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html#tabterminalsailingspace
 ******************************************************************************/

interface TerminalGISResponse {
  ZoomLevel: number;
  Latitude?: number;
  Longitude?: number;
}

interface TerminalTransitLinkReponse {
  LinkURL: string;
  LinkName: string;
  SortSeq?: number;
}

interface TerminalWaitReponse {
  RouteID?: number;
  RouteName?: string;
  WaitTimeNotes: string;
  WaitTimeLastUpdated?: string;
}

interface TerminalVisitorLinkResponse {
  LinkURL: string;
  LinkName: string;
  SortSeq?: number;
}

interface TerminalBulletinResponse {
  BulletinTitle: string;
  BulletinText: string;
  BulletinSortSeq: number;
  BulletinLastUpdated?: string;
  BulletinLastUpdatedSortable?: string;
}

interface TerminalVerboseResponse {
  TerminalID: number;
  TerminalSubjectID: number;
  RegionID: number;
  TerminalName: string;
  TerminalAbbrev: string;
  SortSeq: number;
  OverheadPassengerLoading: boolean;
  Elevator: boolean;
  WaitingRoom: boolean;
  FoodService: boolean;
  Restroom: boolean;
  Latitude?: number;
  Longitude?: number;
  AddressLineOne?: string;
  AddressLineTwo?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  Country?: string;
  MapLink?: string;
  Directions?: string;
  DispGISZoomLoc: TerminalGISResponse[];
  ParkingInfo?: string;
  ParkingShuttleInfo?: string;
  AirportInfo?: string;
  AirportShuttleInfo?: string;
  MotorcycleInfo?: string;
  TruckInfo?: string;
  BikeInfo?: string;
  TrainInfo?: string;
  TaxiInfo?: string;
  HovInfo?: string;
  TransitLinks: TerminalTransitLinkReponse[];
  WaitTimes: TerminalWaitReponse[];
  AdditionalInfo?: string;
  LostAndFoundInfo?: string;
  SecurityInfo?: string;
  ConstructionInfo?: string;
  FoodServiceInfo?: string;
  AdaInfo?: string;
  FareDiscountInfo?: string;
  TallySystemInfo?: string;
  ChamberOfCommerce?: {
    LinkURL: string;
    LinkName: string;
    SortSeq?: number;
  };
  FacInfo?: string;
  ResourceStatus?: string;
  TypeDesc?: string;
  REALTIME_SHUTOFF_FLAG: boolean;
  REALTIME_SHUTOFF_MESSAGE?: string;
  VisitorLinks: TerminalVisitorLinkResponse[];
  Bulletins: TerminalBulletinResponse[];
  IsNoFareCollected?: boolean;
  NoFareCollectedMsg?: string;
  RealtimeIntroMsg?: string;
}

interface ArrivalSpaceResponse {
  TerminalID: number;
  TerminalName: string;
  VesselID: number;
  VesselName: string;
  DisplayReservableSpace: boolean;
  ReservableSpaceCount?: number;
  ReservableSpaceHexColor?: string;
  DisplayDriveUpSpace: boolean;
  DriveUpSpaceCount?: number;
  DriveUpSpaceHexColor?: string;
  MaxSpaceCount: number;
  ArrivalTerminalIDs: number[];
}

interface DepartureSpaceResponse {
  Departure: string;
  IsCancelled: boolean;
  VesselID: number;
  MaxSpaceCount: number;
  SpaceForArrivalTerminals: ArrivalSpaceResponse[];
}

interface SpaceResponse {
  TerminalID: number;
  TerminalSubjectID: number;
  RegionID: number;
  TerminalName: string;
  TerminalAbbrev: string;
  SortSeq: number;
  DepartingSpaces: DepartureSpaceResponse[];
  IsNoFareCollected?: boolean;
  NoFareCollectedMsg?: string;
}

/******************************************************************************
 * SCHEDULES
 *
 * https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html#tabterminalsailingspace
 ******************************************************************************/

enum LoadingRules {
  PASSENGER = 1,
  VEHICLE = 2,
  BOTH = 3,
}

enum Seasons {
  SPRING = 0,
  SUMMER = 1,
  FALL = 2,
  WINTER = 3,
}

interface TerminalScheduleTimeResponse {
  DepartingTime: string;
  ArrivingTime: string | null;
  LoadingRule: LoadingRules;
  VesselID: number;
  VesselName: string;
  VesselHandicapAccessible: boolean;
  Routes: number[];
  AnnotationIndexes: number[];
}

interface TerminalScheduleResponse {
  DepartingTerminalID: number;
  DepartingTerminalName: string;
  ArrivingTerminalID: number;
  ArrivingTerminalName: string;
  SailingNotes: string;
  Annotations: string[];
  AnnotationsIVR: string[];
  Times: TerminalScheduleTimeResponse[];
}

// https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html#tabscheduletoday
interface ScheduleTodayResponse {
  ScheduleID: number;
  ScheduleName: string;
  ScheduleSeason: Seasons;
  SchedulePDFUrl: string;
  ScheduleStart: string;
  ScheduleEnd: string;
  AllRoutes: number[];
  TerminalCombos: TerminalScheduleResponse[];
}

// https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html#tabterminalsandmates
interface MatesResponse {
  DepartingTerminalID: number;
  DepartingDescription: string;
  ArrivingTerminalID: number;
  ArrivingDescription: string;
}

// https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html#tabalerts
interface AlertResponse {
  BulletinID: number;
  BulletinFlag: boolean;
  CommunicationFlag: boolean;
  PublishDate?: string;
  AlertDescription?: string;
  DisruptionDescription?: string;
  AlertFullTitle: string;
  AlertFullText: string;
  IVRText?: string;
}

// https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html#tabroutedetails
interface RouteResponse {
  RouteID: number;
  RouteAbbrev: string;
  Description: string;
  RegionID: number;
  VesselWatchID: number;
  ReservationFlag: boolean;
  InternationalFlag: boolean;
  PassengerOnlyFlag: boolean;
  CrossingTime?: string;
  AdaNotes?: string;
  GeneralRouteNotes?: string;
  SeasonalRouteNotes?: string;
  Alerts: AlertResponse[];
}

/******************************************************************************
 * VESSELS
 *
 * https://www.wsdot.wa.gov/ferries/api/vessels/documentation/rest.html#tabvesselverbose
 ******************************************************************************/

enum Manager {
  WSF = 1,
  KCM = 2,
}

interface VesselsLocationResponse {
  VesselID: number;
  VesselName: string;
  Mmsi?: number;
  DepartingTerminalID: number;
  DepartingTerminalName: string;
  DepartingTerminalAbbrev: string;
  ArrivingTerminalID?: number;
  ArrivingTerminalName?: string;
  ArrivingTerminalAbbrev?: string;
  Latitude: number;
  Longitude: number;
  Speed: number;
  Heading: number;
  InService: boolean;
  AtDock: boolean;
  LeftDock?: string;
  Eta?: string;
  EtaBasis?: string;
  ScheduledDeparture?: string;
  OpRouteAbbrev: string[];
  VesselPositionNum?: number;
  SortSeq: number;
  ManagedBy: Manager;
  TimeStamp: string;
}

enum VesselStatus {
  IN_SERVICE = 1,
  IN_MAINTENANCE = 2,
  OUT_OF_SERVICE = 3,
}

interface VesselsVerboseResponse {
  VesselID: number;
  VesselSubjectID: number;
  VesselName: string;
  VesselAbbrev: string;
  Class: {
    ClassID: number;
    ClassSubjectID: number;
    SortSeq?: number;
    DrawingImg: string;
    SilhouetteImg: string;
    PublicDisplayName: string;
  };
  Status: VesselStatus;
  OwnedByWSF: boolean;
  CarDeckRestroom: boolean;
  CarDeckShelter: boolean;
  Elevator: boolean;
  ADAAccessible: boolean;
  MainCabinGalley: boolean;
  MainCabinRestroom: boolean;
  PublicWifi: boolean;
  ADAInfo?: string;
  AdditionalInfo?: string;
  VesselNameDesc: string;
  VesselHistory?: string;
  Beam: string;
  CityBuilt: string;
  SpeedInKnots?: number;
  Draft: string;
  EngineCount?: number;
  Horsepower?: number;
  Length: string;
  MaxPassengerCount?: number;
  PassengerOnly: boolean;
  FastFerry: boolean;
  PropulsionInfo: string;
  TallDeckClearance?: number;
  RegDeckSpace?: number;
  TallDeckSpace?: number;
  Tonnage?: number;
  Displacement?: number;
  YearBuilt?: number;
  YearRebuilt?: number;
  VesselDrawingImg?: string;
  SolasCertified: boolean;
  MaxPassengerCountForInternational?: number;
}

/******************************************************************************
 * CAMERAS
 *
 * https://www.wsdot.com/ferries/vesselwatch/Cameras.ashx
 ******************************************************************************/

interface CameraReponse {
  TerminalID: number;
  FerryCamera: {
    CamID: number;
    Lat: number;
    Lon: number;
    Title: string;
    ImgURL: string;
    ImgWidth: number;
    ImgHeight: number;
    CamOwner: string | null;
    OwnerURL: string | null;
    IsActive: boolean;
  };
}

interface CamerasResponse {
  FeedName: string;
  AppUrl: string;
  Timestamp: string;
  FeedContentList: CameraResponse[];
}
