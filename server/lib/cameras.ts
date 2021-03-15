import { Camera } from "shared/models/cameras";

const CAMERAS_BY_TERMINAL_ID: Record<number, Camera[]> = {
  1: [
    {
      id: 9047,
      location: { latitude: 48.505975, longitude: -122.679048 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/anacortes/terminal/anaterm.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9048,
      location: { latitude: 48.503437, longitude: -122.679509 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/anacortes/holding/anahold.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9049,
      location: { latitude: 48.501976, longitude: -122.679337 },
      title: "Terminal Rd",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/anacortes/road/anaroad.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  3: [
    {
      id: 9040,
      location: { latitude: 47.62314, longitude: -122.5112 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Bainbridge/Bainbridge.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9477,
      location: { latitude: 47.624849, longitude: -122.514133 },
      title: "Winslow Way North",
      image: {
        url: "https://images.wsdot.wa.gov/orflow/305vc00021.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9476,
      location: { latitude: 47.624849, longitude: -122.514133 },
      title: "Winslow Way South",
      image: {
        url: "https://images.wsdot.wa.gov/orflow/305vc00022.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9478,
      location: { latitude: 47.635773, longitude: -122.515529 },
      title: "High School Rd North",
      image: {
        url: "https://images.wsdot.wa.gov/orflow/305vc00028.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9479,
      location: { latitude: 47.635773, longitude: -122.515529 },
      title: "High School Rd South",
      image: {
        url: "https://images.wsdot.wa.gov/orflow/305vc00029.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  4: [
    {
      id: 9037,
      location: { latitude: 47.56265, longitude: -122.62535 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/bremerton/holding/holding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  5: [
    {
      id: 9173,
      location: { latitude: 47.974689, longitude: -122.352236 },
      title: "Dock",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/clinton/boothdock.jpg",
        width: 480,
        height: 352,
      },
      owner: {
        name: "WhidbeyTelecom",
        url: "https://www.whidbeytel.com/ferrycams/",
      },
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 0,
    },
    {
      id: 9166,
      location: { latitude: 47.974546, longitude: -122.352017 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/clinton/terminal/clinton.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 1,
    },
    {
      id: 9172,
      location: { latitude: 47.974711, longitude: -122.352462 },
      title: "Uphill",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/clinton/boothhill.jpg",
        width: 480,
        height: 352,
      },
      owner: {
        name: "Whidbey.com",
        url: "https://www.whidbeytel.com/ferrycams/",
      },
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 2,
    },
    {
      id: 9174,
      location: { latitude: 47.979695, longitude: -122.357644 },
      title: "E SR 525",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/clinton/clinteast.jpg",
        width: 480,
        height: 352,
      },
      owner: {
        name: "WhidbeyTelecom",
        url: "https://www.whidbeytel.com/ferrycams/",
      },
      isActive: true,
      feetToNext: 2290,
      spacesToNext: 100,
      orderFromTerminal: 3,
    },
    {
      id: 9175,
      location: { latitude: 47.979681, longitude: -122.357429 },
      title: "W SR 525",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/clinton/clintwest.jpg",
        width: 467,
        height: 360,
      },
      owner: {
        name: "Whidbey.com",
        url: "https://www.whidbeytel.com/ferrycams/",
      },
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 4,
    },
  ],
  7: [
    {
      id: 9035,
      location: { latitude: 47.60285, longitude: -122.3382 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/colman/BainHold/BainHold.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9794,
      location: { latitude: 47.602025, longitude: -122.337854 },
      title: "Overflow Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/colman/SeattleHold.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  8: [
    {
      id: 9156,
      location: { latitude: 47.792528, longitude: -122.369853 },
      title: "VMS Sign",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/edmonds/104vms_wts.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9159,
      location: { latitude: 47.802634, longitude: -122.383115 },
      title: "Underpass",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/edmonds/104underpass.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9160,
      location: { latitude: 47.802634, longitude: -122.383115 },
      title: "Pine",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/edmonds/104pine.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9155,
      location: { latitude: 47.810405, longitude: -122.383062 },
      title: "W Dayton St",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/edmonds/104dayton.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9157,
      location: { latitude: 47.811747, longitude: -122.382174 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/edmonds/holding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  9: [
    {
      id: 9038,
      location: { latitude: 47.5232, longitude: -122.39359 },
      title: "Holding",
      image: {
        url:
          "https://images.wsdot.wa.gov/wsf/fauntleroy/terminal/fauntleroy.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9402,
      location: { latitude: 47.52263, longitude: -122.392938 },
      title: "Way looking North",
      image: {
        url:
          "https://images.wsdot.wa.gov/wsf/fauntleroy/terminal/fauntterminal.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9403,
      location: { latitude: 47.524794, longitude: -122.392652 },
      title: "St looking North",
      image: {
        url:
          "https://images.wsdot.wa.gov/wsf/fauntleroy/terminal/faunttrenton.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9377,
      location: { latitude: 47.526718, longitude: -122.392883 },
      title: "Way and Cloverdale St.",
      image: {
        url:
          "https://www.seattle.gov/trafficcams/images/Fauntleroy_SW_Cloverdale_NS.jpg",
        width: 352,
        height: 240,
      },
      owner: {
        name: "City of Seattle",
        url: "http://web6.seattle.gov/travelers/",
      },
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9404,
      location: { latitude: 47.530459, longitude: -122.392633 },
      title: "Park looking North",
      image: {
        url:
          "https://images.wsdot.wa.gov/wsf/fauntleroy/terminal/fauntlincoln.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  10: [
    {
      id: 1233,
      location: { latitude: 48.5351, longitude: -123.0066 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/fridayharbor/friholding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  11: [
    {
      id: 9169,
      location: { latitude: 48.160022, longitude: -122.673974 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Keystone/terminal/keyterm.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9170,
      location: { latitude: 48.160022, longitude: -122.673974 },
      title: "Street",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Keystone/Street/keyStreet.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  12: [
    {
      id: 9813,
      location: { latitude: 47.797035, longitude: -122.496861 },
      title: "Washington Blvd",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/kingston/washington.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9151,
      location: { latitude: 47.797124, longitude: -122.495519 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/kingston/terminal/kingston.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9154,
      location: { latitude: 47.807814, longitude: -122.516675 },
      title: "Barber",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/kingston/barber/barber.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9152,
      location: { latitude: 47.80941, longitude: -122.52564 },
      title: "Sign East",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/kingston/fse/fse.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9153,
      location: { latitude: 47.80941, longitude: -122.52564 },
      title: "Sign West",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/kingston/fsw/fsw.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  13: [
    {
      id: 9693,
      location: { latitude: 48.569902, longitude: -122.883807 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/lopez/holding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9692,
      location: { latitude: 48.56895, longitude: -122.884565 },
      title: "Approach",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/lopez/approach.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  14: [
    {
      id: 9165,
      location: { latitude: 47.948244, longitude: -122.302963 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Mukilteo/Terminal/mukterm.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 1,
    },
    {
      id: 9394,
      location: { latitude: 47.9448, longitude: -122.3043 },
      title: "5th St - North",
      image: {
        url: "https://images.wsdot.wa.gov/nw/525vc00820.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: 1550,
      spacesToNext: 70,
      orderFromTerminal: 2,
    },
    {
      id: 9728,
      location: { latitude: 47.944761, longitude: -122.304373 },
      title: "5th St - South",
      image: {
        url: "https://images.wsdot.wa.gov/nw/525vc00819.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 3,
    },
    {
      id: 9161,
      location: { latitude: 47.933594, longitude: -122.306442 },
      title: "Clover Ln",
      image: {
        url: "https://images.wsdot.wa.gov/nw/525vc00740.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: 4080,
      spacesToNext: 185,
      orderFromTerminal: 0,
    },
    {
      id: 9162,
      location: { latitude: 47.928391, longitude: -122.300497 },
      title: "76th - North",
      image: {
        url: "https://images.wsdot.wa.gov/nw/525vc00695.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: 2360,
      spacesToNext: 107,
      orderFromTerminal: 0,
    },
    {
      id: 9163,
      location: { latitude: 47.928391, longitude: -122.300497 },
      title: "76th - South",
      image: {
        url: "https://images.wsdot.wa.gov/nw/525vc00694.jpg",
        width: 335,
        height: 249,
      },
      owner: null,
      isActive: true,
      feetToNext: 0,
      spacesToNext: 0,
      orderFromTerminal: 0,
    },
  ],
  15: [
    {
      id: 9688,
      location: { latitude: 48.598694, longitude: -122.945556 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/orcas/holding.jpg",
        width: 351,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9689,
      location: { latitude: 48.598694, longitude: -122.945556 },
      title: "Booth",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/orcas/booth.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  16: [
    {
      id: 9742,
      location: { latitude: 47.30365, longitude: -122.514751 },
      title: "Booth",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/PointDefiance/PtDefBooth.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9741,
      location: { latitude: 47.303365, longitude: -122.514782 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/PointDefiance/PtDefHolding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  17: [
    {
      id: 9167,
      location: { latitude: 48.112086, longitude: -122.760466 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/PortTownsend/terminal/ptterm.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9168,
      location: { latitude: 48.112086, longitude: -122.760466 },
      title: "Street",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/PortTownsend/Street/ptStreet.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  20: [
    {
      id: 9039,
      location: { latitude: 47.51189, longitude: -122.4973 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/southworth/holding.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9391,
      location: { latitude: 47.51189, longitude: -122.4973 },
      title: "Terminal",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/southworth/terminal.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  21: [
    {
      id: 9045,
      location: { latitude: 47.332941, longitude: -122.506968 },
      title: "Holding",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Tahlequah/holding/holding.jpg",
        width: 320,
        height: 250,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9046,
      location: { latitude: 47.333079, longitude: -122.506957 },
      title: "SW Tahlequah Rd",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/Tahlequah/VMSSign/VMSSign.jpg",
        width: 320,
        height: 250,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
  22: [
    {
      id: 9717,
      location: { latitude: 47.510459, longitude: -122.463852 },
      title: "Holding (South)",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/vashon/HoldingSouth.jpg",
        width: 352,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9044,
      location: { latitude: 47.505512, longitude: -122.461681 },
      title: "Hwy & 112th (South)",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/vashon/VSHvc00003.jpg",
        width: 320,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9043,
      location: { latitude: 47.505682, longitude: -122.46173 },
      title: "Hwy & 112th (North)",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/vashon/VSHvc00004.jpg",
        width: 320,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9042,
      location: { latitude: 47.507367, longitude: -122.46284 },
      title: "Hwy & Bunker (South)",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/vashon/VSHvc00002.jpg",
        width: 320,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
    {
      id: 9041,
      location: { latitude: 47.507541, longitude: -122.46291 },
      title: "Hwy & Bunker (North)",
      image: {
        url: "https://images.wsdot.wa.gov/wsf/vashon/VSHvc00001.jpg",
        width: 320,
        height: 261,
      },
      owner: null,
      isActive: true,
      feetToNext: null,
      spacesToNext: null,
      orderFromTerminal: 0,
    },
  ],
};

export const getCameras = (terminalId: number): Camera[] =>
  CAMERAS_BY_TERMINAL_ID[terminalId];
