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
import * as log from './log';
import {DateTime} from 'luxon';
import {getCameras} from './wsf-cameras';
import {getToday, wsfDateToTimestamp} from './date';
import {Op} from './db';
import _ from 'lodash';
import Crossing from '../models/crossing';
import request from 'request-promise';
import sync from 'aigle';

sync.mixin(_);

const TERMINAL_DATA_OVERRIDES = {
    5: {
        location: {
            link:
                'https://www.google.com/maps/place/Clinton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086',
        },
    },
    13: {
        location: {
            link:
                'https://www.google.com/maps/place/Lopez+Ferry+Landing/@48.5706056,-122.9007289,14z/data=!4m8!1m2!2m1!1slopez+island+ferry+terminal!3m4!1s0x548581184141c77d:0xb95765067fe72167!8m2!3d48.5706056!4d-122.8834068',
        },
    },
    15: {
        location: {
            link:
                'https://www.google.com/maps/place/Orcas+Island+Ferry+Terminal/@48.597361,-122.9458067,17z/data=!3m1!4b1!4m5!3m4!1s0x548587ff7781be87:0xb6eeeac287820785!8m2!3d48.597361!4d-122.9436127',
        },
    },
    17: {
        location: {
            link:
                'https://www.google.com/maps/place/Port+Townsend+Terminal/@48.1121633,-122.7627137,17z/data=!3m1!4b1!4m5!3m4!1s0x548fedcf67a53163:0xd61a6301e962de31!8m2!3d48.1121633!4d-122.7605197',
        },
    },
    18: {
        location: {
            link:
                'https://www.google.com/maps/place/https://www.google.com/maps/place/Shaw+Island+Terminal/@48.584393,-122.9321401,17z/data=!3m1!4b1!4m5!3m4!1s0x548587290b11c709:0xb4bf5a7be8d73b0d!8m2!3d48.584393!4d-122.9299461linton+Ferry+Terminal/@47.9750653,-122.3514909,18.57z/data=!4m8!1m2!2m1!1sclinton+ferry!3m4!1s0x0:0xfc1a9b74eba33fab!8m2!3d47.9751021!4d-122.350086',
        },
    },
};

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
const updateProgress = {
    /* eslint-disable no-empty-function */
    schedule: new Promise(() => {}),
    vessels: new Promise(() => {}),
    terminals: new Promise(() => {}),
    /* eslint-enable no-empty-function */
};
let matesByTerminalId = {};
const vesselsById = {};
const capacityByTerminal = {};
const terminalsById = {};

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
const getMates = async () => {
    await updateProgress.schedule;
    return matesByTerminalId;
};

export const getSchedule = async (departingId, arrivingId) => {
    const response = await request(apiScheduleToday(departingId, arrivingId), {
        json: true,
    });
    const now = DateTime.local();
    const schedule = _.first(response.TerminalCombos);
    const seenVessels = [];
    return Promise.all(
        _.map(schedule.Times, async (departure) => {
            const time = wsfDateToTimestamp(departure.DepartingTime);
            const vesselId = departure.VesselID;
            const isFirstOfVessel = !_.includes(seenVessels, vesselId);
            const vessel = await getVessel(vesselId, isFirstOfVessel);
            const capacity = _.get(capacityByTerminal, [
                departingId,
                arrivingId,
                time,
            ]);
            let departureTime;
            if (_.get(capacity, 'departureDelta')) {
                departureTime = DateTime.fromSeconds(time).plus({
                    seconds: capacity.departureDelta,
                });
            } else {
                departureTime = DateTime.fromSeconds(time);
            }
            const hasPassed = departureTime < now;
            if (isFirstOfVessel) {
                seenVessels.push(vesselId);
            }
            return {
                allowsPassengers: _.includes([1, 3], departure.LoadingRule),
                allowsVehicles: _.includes([2, 3], departure.LoadingRule),
                capacity,
                hasPassed,
                time,
                vessel,
            };
        })
    );
};

export const getVessels = async () => {
    await updateProgress.vesels;
    return vesselsById;
};

// fetches a vessel from the cache (waiting if an update is in progress)
export const getVessel = async (id, resetDelay = false) => {
    await updateProgress.vesels;
    const vessel = _.get(vesselsById, id);
    if (resetDelay) {
        return _.merge(_.cloneDeep(vessel), {departureDelta: null});
    } else {
        return vessel;
    }
};

export const getTerminals = async () => {
    await updateProgress.terminals;
    return terminalsById;
};

// fetches a terminal from the cache (waiting if an update is in progress)
export const getTerminal = async (id) => {
    await updateProgress.terminals;
    return _.get(terminalsById, id);
};

async function updateSchedule() {
    log.debugging('Schedule...');

    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_SCHEDULE_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.schedule) {
        log.debug('✔ (no change)');
    }
    cacheFlushDates.schedule = cacheFlushDate;

    const mates = await request(apiScheduleMates(), {json: true});
    matesByTerminalId = {};
    _.each(mates, (mate) => {
        const id = mate.DepartingTerminalID;
        const mateId = mate.ArrivingTerminalID;
        addMate(id, mateId);
    });

    matesByTerminalId = {};
    _.each(mates, (mate) => {
        const id = mate.DepartingTerminalID;
        const mateId = mate.ArrivingTerminalID;
        addMate(id, mateId);
    });
    log.debug('✔ (updated)');
}

async function updateVessels() {
    log.debugging('Vessels...');

    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_VESSELS_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.vessels) {
        log.debug('✔ (no change)');
    }
    cacheFlushDates.vessels = cacheFlushDate;

    const vessels = await request(API_VESSELS_VERBOSE, {json: true});
    _.each(vessels, (vessel) => {
        const {VesselID: id} = vessel;
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
            name: vessel.VesselName,
            passengerCapacity: vessel.MaxPassengerCount,
            speed: vessel.SpeedInKnots,
            tallVehicleCapacity: vessel.TallDeckSpace,
            vehicleCapacity: vessel.RegDeckSpace + vessel.TallDeckSpace,
            weight: vessel.Tonnage,
            yearBuilt: vessel.YearBuilt,
            yearRebuilt: vessel.YearRebuilt,
        });
    });
    log.debug('✔ (updated)');
}

export const updateTerminals = async () => {
    log.debugging('Terminals...');

    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_TERMINALS_CACHE, {json: true})
    );
    if (cacheFlushDate === cacheFlushDates.terminals) {
        log.debug('✔ (no change)');
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

    log.debug('✔ (updated)');
};

// set cache with all long-lived data from API
export const updateCache = async () => {
    log.debug('Updating cache:');
    log.startIndent();
    updateProgress.schedule = updateSchedule();
    await updateProgress.schedule;
    updateProgress.vessels = updateVessels();
    await updateProgress.vessels;
    updateProgress.terminals = updateTerminals();
    await updateProgress.terminals;
    log.endIndent();
};

export async function backfillCrossings() {
    const yesterday = _.round(
        DateTime.local()
            .minus({days: 1})
            .toSeconds()
    );
    const crossings = await Crossing.findAll({
        where: {departureTime: {[Op.gt]: yesterday}},
    });
    _.each(crossings, (crossing) => {
        _.setWith(
            capacityByTerminal,
            [crossing.departureId, crossing.arrivalId, crossing.departureTime],
            crossing,
            Object
        );
    });
}

async function recordTiming() {
    log.debugging('Updating timings...');
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
    log.debug('✔');
}

async function recordCapacity() {
    log.debugging('Updating capacities...');
    const terminals = await request(API_TERMINALS_SPACE, {json: true});
    _.each(terminals, (terminal) => {
        _.each(terminal.DepartingSpaces, (departure) => {
            _.each(departure.SpaceForArrivalTerminals, async (capacity) => {
                const vessel = _.get(vesselsById, departure.VesselID, {});
                const model = {
                    arrivalId: capacity.TerminalID,
                    departureId: terminal.TerminalID,
                    departureDelta: _.get(vessel, 'departureDelta', null),
                    departureTime: wsfDateToTimestamp(departure.Departure),
                    driveUpCapacity: capacity.DriveUpSpaceCount,
                    hasDriveUp: capacity.DisplayDriveUpSpace,
                    hasReservations: capacity.DisplayReservableSpace,
                    isCancelled: departure.IsCancelled,
                    reservableCapacity: capacity.ReservableSpaceCount,
                    totalCapacity: capacity.MaxSpaceCount,
                };
                _.setWith(
                    capacityByTerminal,
                    [model.departureId, model.arrivalId, model.departureTime],
                    Crossing.build(model),
                    Object
                );
                const {arrivalId, departureId, departureTime} = model;
                const where = {arrivalId, departureId, departureTime};
                const instance = await Crossing.findOne({where});
                if (instance) {
                    await instance.update(model);
                } else {
                    await Crossing.create(model);
                }
            });
        });
    });
    log.debug('✔');
}

export const updateCrossings = async () => {
    log.debug('Updating crossings:');
    log.startIndent();
    await recordTiming();
    await recordCapacity();
    log.endIndent();
};
