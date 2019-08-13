/**
 * Library for WSF APIs:
 * * https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html
 * * https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html
 * * https://www.wsdot.wa.gov/ferries/api/vessels/documentation/rest.html
 *
 * We wrap these APIs in order to orchestrate caching, proxy XML into a useful
 * format, and filter/rename the fields
 */

// imports
import {DateTime} from 'luxon';
import {getCameras} from './wsf-cameras';
import {getToday, wsfDateToTimestamp} from './date';
import {Op} from './db';
import _ from 'lodash';
import Crossing from '../models/crossing';
import logger from 'heroku-logger';
import request from 'request-promise';
import sync from 'aigle';

sync.mixin(_);

const TERMINAL_DATA_OVERRIDES = {
    1: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
    },
    3: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi',
    },
    4: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi',
    },
    5: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=mukcl',
        location: {
            link:
                'https://www.google.com/maps/place/Clinton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086',
        },
    },
    7: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=seabi',
    },
    8: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=edking',
    },
    9: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs',
    },
    10: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
    },
    11: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptkey',
    },
    12: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=edking',
    },
    13: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
        location: {
            link:
                'https://www.google.com/maps/place/Lopez+Ferry+Landing/@48.5706056,-122.9007289,14z/data=!4m8!1m2!2m1!1slopez+island+ferry+terminal!3m4!1s0x548581184141c77d:0xb95765067fe72167!8m2!3d48.5706056!4d-122.8834068',
        },
    },
    14: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=mukcl',
    },
    15: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
        location: {
            link:
                'https://www.google.com/maps/place/Orcas+Island+Ferry+Terminal/@48.597361,-122.9458067,17z/data=!3m1!4b1!4m5!3m4!1s0x548587ff7781be87:0xb6eeeac287820785!8m2!3d48.597361!4d-122.9436127',
        },
    },
    16: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptdtal',
    },
    17: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptkey',
        location: {
            link:
                'https://www.google.com/maps/place/Port+Townsend+Terminal/@48.1121633,-122.7627137,17z/data=!3m1!4b1!4m5!3m4!1s0x548fedcf67a53163:0xd61a6301e962de31!8m2!3d48.1121633!4d-122.7605197',
        },
    },
    18: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
        location: {
            link:
                'https://www.google.com/maps/place/https://www.google.com/maps/place/Shaw+Island+Terminal/@48.584393,-122.9321401,17z/data=!3m1!4b1!4m5!3m4!1s0x548587290b11c709:0xb4bf5a7be8d73b0d!8m2!3d48.584393!4d-122.9299461linton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086',
        },
    },
    19: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=anasjsid',
    },
    20: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs',
    },
    21: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=ptdtal',
    },
    22: {
        vesselwatch:
            'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=fvs',
    },
};
const VESSELWATCH_BASE =
    'https://www.wsdot.com/ferries/vesselwatch/default.aspx?view=';

const ESTIMATE_COMPOSITE_WEEKS = 4;

// API paths
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;

const API_SCHEDULE = 'https://www.wsdot.wa.gov/ferries/api/schedule/rest';
const API_SCHEDULE_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const apiScheduleMates = () =>
    `${API_SCHEDULE}/terminalsandmates/${getToday()}${API_ACCESS}`;
const apiScheduleRoute = (departingId, arrivingId) =>
    `${API_SCHEDULE}/routedetails/` +
    `${getToday()}/${departingId}/${arrivingId}${API_ACCESS}`;
const apiScheduleToday = (departingId, arrivingId) =>
    `${API_SCHEDULE}/scheduletoday/` +
    `${departingId}/${arrivingId}/false${API_ACCESS}`;

const API_VESSELS = 'https://www.wsdot.wa.gov/ferries/api/vessels/rest';
const API_VESSELS_CACHE = `${API_VESSELS}/cacheflushdate`;
const API_VESSELS_LOCATIONS = `${API_VESSELS}/vessellocations${API_ACCESS}`;
const API_VESSELS_VERBOSE = `${API_VESSELS}/vesselverbose${API_ACCESS}`;

const API_TERMINALS = 'https://www.wsdot.wa.gov/ferries/api/terminals/rest';
const API_TERMINALS_CACHE = `${API_TERMINALS}/cacheflushdate`;
const API_TERMINALS_SPACE = `${API_TERMINALS}/terminalsailingspace${API_ACCESS}`;
const API_TERMINALS_VERBOSE = `${API_TERMINALS}/terminalverbose${API_ACCESS}`;

// local state
const cacheFlushDates = {
    schedule: null,
    vessels: null,
    terminals: null,
};

let matesByTerminalId = {};
const vesselsById = {};
const estimates = {};
const terminalsById = {};
const scheduleByTerminal = {};

// safely initialize a mates object
function initMates(id) {
    if (!_.has(matesByTerminalId, id)) {
        matesByTerminalId[id] = [];
    }
}

function addMate(id, mateId) {
    initMates(id);
    matesByTerminalId[id].push(mateId);
}

// safely initialize a vessel object
function initVessel(id) {
    if (!_.has(vesselsById, id)) {
        vesselsById[id] = {};
    }
}

// merge the given data into the vessel cache
function assignVessel(id, data) {
    initVessel(id);
    _.assign(vesselsById[id], data);
}

// safely initialize a terminal object
function initTerminal(id) {
    if (!_.has(terminalsById, id)) {
        terminalsById[id] = {};
    }
}

// merge the given data into the terminal cache
function assignTerminal(id, data) {
    initTerminal(id);
    _.assign(terminalsById[id], data);
    _.merge(terminalsById[id], TERMINAL_DATA_OVERRIDES[id]);
}

// fetches mates from the cache (waiting if an update is in progress)
const getMates = () => {
    return matesByTerminalId;
};

// fetches a vessel from the cache (waiting if an update is in progress)
const getVessel = (id, resetDelay = false) => {
    const vessel = _.get(vesselsById, id);
    if (resetDelay) {
        return _.merge(_.cloneDeep(vessel), {departureDelta: null});
    } else {
        return vessel;
    }
};

function hasPassed(capacity) {
    if (!capacity) {
        return;
    }
    const {departureTime} = capacity;
    let estimatedTime = DateTime.fromSeconds(departureTime);
    if (_.get(capacity, 'departureDelta')) {
        estimatedTime = estimatedTime.plus({
            seconds: capacity.departureDelta,
        });
    }
    const now = DateTime.local();
    const hasPassed = estimatedTime < now;
    return hasPassed;
}

async function backfillCrossings() {
    const yesterday = _.round(
        DateTime.local()
            .minus({days: 1})
            .toSeconds()
    );
    const crossings = await Crossing.findAll({
        where: {departureTime: {[Op.gt]: yesterday}},
    });
    _.each(crossings, (capacity) => {
        const crossing = _.get(scheduleByTerminal, [
            capacity.departureId,
            capacity.arrivalId,
            capacity.departureTime,
        ]);
        if (crossing) {
            crossing.capacity = capacity;
        }
    });
}

// "Weekly Unique Identifier"
// Accepts a timestamp from a scheduled sailing
// Generates a key for use in comparing a sailing slot across weeks.
function getWuid(departureTime) {
    return DateTime.fromSeconds(departureTime).toFormat('CCC-HH-mm');
}

async function buildEstimates(departureId, arrivalId, schedule) {
    const startTime = DateTime.fromSeconds(_.first(schedule).time)
        .minus({weeks: ESTIMATE_COMPOSITE_WEEKS})
        .toSeconds();
    const crossings = await Crossing.findAll({
        where: {
            departureId,
            arrivalId,
            departureTime: {[Op.gte]: startTime},
        },
    });
    _.each(schedule, (crossing) => {
        const {wuid} = crossing;
        const estimate = {};
        _.times(ESTIMATE_COMPOSITE_WEEKS, (index) => {
            const departureTime = DateTime.fromSeconds(crossing.time)
                .minus({weeks: index + 1})
                .toSeconds();
            const previousCrossing = _.find(crossings, {departureTime});
            const capacity = _.pick(previousCrossing, [
                'driveUpCapacity',
                'reservableCapacity',
            ]);
            _.mergeWith(estimate, capacity, (value, source) =>
                _.concat(value, source)
            );
        });
        _.each(estimate, (records, key) => {
            estimate[key] = _.round(_.mean(_.filter(records))) || null;
        });
        _.setWith(estimates, [departureId, arrivalId, wuid], estimate, Object);
    });
}

async function updateSchedule() {
    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_SCHEDULE_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.schedule) {
        logger.info('Skipped Schedule API Update');
        return;
    } else {
        logger.info('Started Schedule API Update');
    }
    cacheFlushDates.schedule = cacheFlushDate;
    logger.info('Started Mates Update');
    const mates = await request(apiScheduleMates(), {json: true});
    matesByTerminalId = {};
    _.each(mates, (mate) => {
        const id = mate.DepartingTerminalID;
        const mateId = mate.ArrivingTerminalID;
        addMate(id, mateId);
    });
    logger.info('Completed Mates Update');
    logger.info('Started Schedule Update');
    await sync.eachSeries(matesByTerminalId, (mates, terminalId) =>
        sync.eachSeries(mates, async (mateId) => {
            const response = await request(
                apiScheduleToday(terminalId, mateId),
                {
                    json: true,
                }
            );
            const scheduleData = _.first(response.TerminalCombos);
            const seenVessels = [];

            const schedule = await Promise.all(
                _.map(scheduleData.Times, async (departure) => {
                    const time = wsfDateToTimestamp(departure.DepartingTime);
                    const departureTime = DateTime.fromSeconds(time);
                    const hasPassed = departureTime < DateTime.local();
                    const vesselId = departure.VesselID;
                    const isFirstOfVessel = !_.includes(seenVessels, vesselId);
                    const vessel = await getVessel(vesselId, isFirstOfVessel);
                    if (isFirstOfVessel) {
                        seenVessels.push(vesselId);
                    }
                    return {
                        allowsPassengers: _.includes(
                            [1, 3],
                            departure.LoadingRule
                        ),
                        allowsVehicles: _.includes(
                            [2, 3],
                            departure.LoadingRule
                        ),
                        hasPassed,
                        wuid: getWuid(time),
                        time,
                        vessel,
                    };
                })
            );
            _.setWith(
                scheduleByTerminal,
                [terminalId, mateId],
                _.keyBy(schedule, 'time'),
                Object
            );
            await buildEstimates(terminalId, mateId, schedule);
        })
    );
    logger.info('Completed Schedule Update');
    logger.info('Completed Schedule API Update');
    await backfillCrossings();
}

async function updateVessels() {
    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_VESSELS_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.vessels) {
        logger.info('Skipped Vessel Update');
        return;
    } else {
        logger.info('Started Vessel Update');
    }
    cacheFlushDates.vessels = cacheFlushDate;

    const vessels = await request(API_VESSELS_VERBOSE, {json: true});
    _.each(vessels, (vessel) => {
        const {VesselID: id} = vessel;
        const name = vessel.VesselName;
        assignVessel(id, {
            abbreviation: vessel.VesselAbbrev,
            beam: vessel.Beam,
            classId: vessel.Class.ClassID,
            hasCarDeckRestroom: vessel.CarDeckRestroom,
            hasElevator: vessel.Elevator,
            hasGalley: vessel.MainCabinGalley,
            hasRestroom: vessel.CarDeckRestroom || vessel.MainCabinRestroom,
            hasWiFi: vessel.PublicWifi,
            horsepower: vessel.Horsepower,
            id,
            inMaintenance: vessel.status === 2,
            inService: vessel.status === 1,
            info: {
                ada: vessel.ADAInfo,
            },
            isAdaAccessible: vessel.ADAAccessible,
            length: vessel.Length,
            maxClearance: vessel.TallDeckClearance,
            name,
            passengerCapacity: vessel.MaxPassengerCount,
            speed: vessel.SpeedInKnots,
            tallVehicleCapacity: vessel.TallDeckSpace,
            vesselwatch: `${VESSELWATCH_BASE}${name}`,
            vehicleCapacity: vessel.RegDeckSpace + vessel.TallDeckSpace,
            weight: vessel.Tonnage,
            yearBuilt: vessel.YearBuilt,
            yearRebuilt: vessel.YearRebuilt,
        });
    });
    logger.info('Completed Vessel Update');
}

export const updateTerminals = async () => {
    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_TERMINALS_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.terminals) {
        logger.info('Skipped Terminal Update');
        return;
    } else {
        logger.info('Started Terminal Update');
    }
    cacheFlushDates.terminals = cacheFlushDate;

    const terminals = await request(API_TERMINALS_VERBOSE, {json: true});
    _.each(terminals, (terminal) => {
        const {TerminalID: id} = terminal;
        assignTerminal(id, {
            abbreviation: terminal.TerminalAbbrev,
            bulletins: _.map(terminal.Bulletins, (bulletin) => ({
                title: bulletin.BulletinTitle,
                description: bulletin.BulletinText,
                date: wsfDateToTimestamp(bulletin.BulletinLastUpdated),
            })),
            cameras: getCameras(id),
            hasElevator: terminal.Elevator,
            hasOverheadLoading: terminal.OverheadPassengerLoading,
            hasRestroom: terminal.Restroom,
            hasWaitingRoom: terminal.WaitingRoom,
            hasFood: terminal.FoodService,
            id,
            info: {
                ada: terminal.AdaInfo,
                airport: terminal.AirportInfo + terminal.AirportShuttleInfo,
                bicycle: terminal.BikeInfo,
                construction: terminal.ConstructionInfo,
                food: terminal.FoodServiceInfo,
                lost: terminal.LostAndFoundInfo,
                motorcycle: terminal.MotorcycleInfo,
                parking: terminal.ParkingInfo + terminal.ParkingShuttleInfo,
                security: terminal.SecurityInfo,
                train: terminal.TrainInfo,
                truck: terminal.TruckInfo,
            },
            location: {
                link: terminal.MapLink,
                latitude: terminal.Latitude,
                longitude: terminal.Longitude,
                address: {
                    line1: terminal.AddressLineOne,
                    line2: terminal.AddressLineTwo,
                    city: terminal.City,
                    state: terminal.State,
                    zip: terminal.ZipCode,
                },
            },
            name: terminal.TerminalName,
            waitTimes: _.map(terminal.WaitTimes, (waitTime) => ({
                title: waitTime.RouteName,
                description: waitTime.WaitTimeNotes,
                time: wsfDateToTimestamp(waitTime.WaitTimeLastUpdated),
            })),
        });
    });
    const matesByTerminalId = await getMates();
    await sync.eachSeries(matesByTerminalId, async (mates, id) => {
        const matesWithRoute = [];
        await sync.eachSeries(mates, async (mateId) => {
            const mate = _.cloneDeep(_.omit(terminalsById[mateId], 'mates'));
            const route = _.first(
                await request(apiScheduleRoute(id, mateId), {
                    json: true,
                })
            );
            mate.route = {
                id: route.RouteID,
                abbreviation: route.RouteAbbrev,
                description: route.Description,
                crossingTime: _.toNumber(route.CrossingTime),
            };
            matesWithRoute.push(mate);
        });
        assignTerminal(id, {mates: matesWithRoute});
    });

    logger.info('Completed Terminal Update');
};

// set cache with all long-lived data from API
export const updateLong = async () => {
    await updateVessels();
    await updateSchedule();
    await updateTerminals();
    return {
        vesselsById,
        scheduleByTerminal,
        terminalsById,
    };
};

async function updateTiming() {
    logger.info('Started Timing Update');
    const vessels = await request(API_VESSELS_LOCATIONS, {json: true});
    _.each(vessels, (vessel) => {
        const {VesselID: id} = vessel;
        const departedTime = wsfDateToTimestamp(vessel.LeftDock);
        const departureTime = wsfDateToTimestamp(vessel.ScheduledDeparture);
        const estimatedArrivalTime = wsfDateToTimestamp(vessel.Eta);
        let departureDelta;
        if (departureTime && departedTime) {
            departureDelta = departedTime - departureTime;
        } else {
            departureDelta = _.get(vesselsById, [id, 'departureDelta']);
        }
        const isAtDock = vessel.AtDock;
        const previousVessel = _.get(vesselsById, id);
        let dockedTime = null;
        if (isAtDock && !previousVessel.isAtDock) {
            dockedTime = DateTime.local();
        }
        assignVessel(id, {
            arrivingTerminalId: vessel.ArrivingTerminalID,
            departingTerminalId: vessel.DepartingTerminalID,
            departedTime,
            departureDelta,
            dockedTime,
            estimatedArrivalTime,
            heading: vessel.Heading,
            id,
            isAtDock: vessel.AtDock,
            location: {
                latitude: vessel.Latitude,
                longitude: vessel.Longitude,
            },
            mmsi: vessel.Mmsi,
            speed: vessel.Speed,
            info: {
                ..._.get(vesselsById[id], 'info', {}),
                crossing: vessel.EtaBasis,
            },
        });
    });
    const now = DateTime.local();
    await sync.eachSeries(scheduleByTerminal, (mates) =>
        sync.eachSeries(mates, (schedule) => {
            const seenVessels = [];
            return sync.eachSeries(schedule, async (crossing) => {
                const vesselId = crossing.vessel.id;
                const isFirstOfVessel = !_.includes(seenVessels, vesselId);
                const vessel = await getVessel(vesselId, isFirstOfVessel);
                if (isFirstOfVessel) {
                    seenVessels.push(vesselId);
                }
                crossing.vessel = vessel;
                const {capacity, time} = crossing;
                if (capacity) {
                    crossing.hasPassed = hasPassed(capacity);
                } else {
                    crossing.hasPassed = DateTime.fromSeconds(time) < now;
                }
            });
        })
    );
    logger.info('Completed Timing Update');
}

function getPreviousCapacity(departureId, arrivalId, departureTime) {
    const schedule = _.get(scheduleByTerminal, [departureId, arrivalId]);
    const departureTimes = _.sortBy(_.keys(schedule));
    const departureIndex = _.indexOf(departureTimes, departureTime);
    if (departureIndex === 0) {
        return null;
    } else {
        const previousDepartureTime = departureTimes[departureIndex - 1];
        const previousCapacity = _.get(
            schedule,
            [previousDepartureTime, 'capacity'],
            null
        );
        return previousCapacity;
    }
}

function isEmpty(capacity) {
    const {driveUpCapacity, reservableCapacity, totalCapacity} = capacity;
    return driveUpCapacity + reservableCapacity === totalCapacity;
}

function isFull(capacity) {
    const {driveUpCapacity, reservableCapacity} = capacity;
    return driveUpCapacity === 0 && reservableCapacity === 0;
}

async function updateCapacity() {
    logger.info('Started Capacity Update');
    const terminals = await request(API_TERMINALS_SPACE, {json: true});
    await sync.eachSeries(terminals, async (terminal) => {
        await sync.eachSeries(terminal.DepartingSpaces, async (departure) => {
            await sync.eachSeries(
                departure.SpaceForArrivalTerminals,
                async (spaceData) => {
                    const vessel = _.get(vesselsById, departure.VesselID, {});
                    const departureTime = wsfDateToTimestamp(
                        departure.Departure
                    );
                    const arrivalId = spaceData.TerminalID;
                    const departureId = terminal.TerminalID;
                    const model = {
                        arrivalId,
                        departureId,
                        departureDelta: _.get(vessel, 'departureDelta', null),
                        departureTime,
                        driveUpCapacity: spaceData.DriveUpSpaceCount,
                        hasDriveUp: spaceData.DisplayDriveUpSpace,
                        hasReservations: spaceData.DisplayReservableSpace,
                        isCancelled: departure.IsCancelled,
                        reservableCapacity: spaceData.ReservableSpaceCount,
                        totalCapacity: spaceData.MaxSpaceCount,
                    };
                    const where = {arrivalId, departureId, departureTime};
                    const [capacity, wasCreated] = await Crossing.findOrCreate({
                        where,
                        defaults: model,
                    });
                    if (!wasCreated) {
                        await capacity.update(model);
                    }
                    const crossing = _.get(scheduleByTerminal, [
                        departureId,
                        arrivalId,
                        departureTime,
                    ]);
                    if (crossing) {
                        crossing.capacity = capacity;
                    }

                    // Because of how WSF reports data, if the previous run is running so
                    // behind, it's scheduled to leave after the next run was scheduled,
                    // they'll stop reporting real-time data against it. So if the next run not
                    // empty, report the previous run as full.
                    const previousCapacity = await getPreviousCapacity(
                        departureId,
                        arrivalId,
                        departureTime
                    );
                    if (
                        previousCapacity &&
                        !hasPassed(previousCapacity) &&
                        !isFull(previousCapacity) &&
                        !isEmpty(capacity)
                    ) {
                        await previousCapacity.update({
                            driveUpCapacity: 0,
                            reservableCapacity: 0,
                        });
                    }
                }
            );
        });
    });
    logger.info('Completed Capacity Update');
}

function updateEstimates() {
    _.each(scheduleByTerminal, (mates, departureId) =>
        _.each(mates, (schedule, mateId) =>
            _.each(schedule, (crossing) => {
                const estimate = _.get(estimates, [
                    departureId,
                    mateId,
                    getWuid(crossing.time),
                ]);
                crossing.estimate = estimate;
            })
        )
    );
    logger.info('Updated Estimates');
}

export const updateShort = async () => {
    await updateTiming();
    await updateCapacity();
    updateEstimates();
    return {scheduleByTerminal};
};
