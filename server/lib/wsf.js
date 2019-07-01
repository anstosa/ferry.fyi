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
import {getToday, wsfDateToTimestamp} from './date';
import {Op} from './db';
import _ from 'lodash';
import Crossing from '../models/crossing';
import request from 'request-promise';

// API paths
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;

const API_SCHEDULE = 'https://www.wsdot.wa.gov/ferries/api/schedule/rest';
const API_SCHEDULE_CACHE = `${API_SCHEDULE}/cacheflushdate`;
const apiScheduleMates = () =>
    `${API_SCHEDULE}/terminalsandmates/${getToday()}${API_ACCESS}`;
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
    return Promise.all(
        _.map(schedule.Times, async (departure) => {
            const time = wsfDateToTimestamp(departure.DepartingTime);
            const hasPassed = DateTime.fromSeconds(time) < now;
            return {
                allowsPassengers: _.includes([1, 3], departure.LoadingRule),
                allowsVehicles: _.includes([2, 3], departure.LoadingRule),
                capacity: _.get(capacityByTerminal, [
                    departingId,
                    arrivingId,
                    time,
                ]),
                hasPassed,
                time,
                vessel: await getVessel(departure.VesselID),
            };
        })
    );
};

export const getVessels = async () => {
    await updateProgress.vesels;
    return vesselsById;
};

// fetches a vessel from the cache (waiting if an update is in progress)
export const getVessel = async (id) => {
    await updateProgress.vesels;
    return _.get(vesselsById, id);
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
    _.each(matesByTerminalId, (mates, id) => {
        assignTerminal(id, {
            mates: _.map(mates, (mateId) =>
                _.omit(terminalsById[mateId], 'mates')
            ),
        });
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
        assignVessel(id, {
            arrivingTerminalId: vessel.ArrivingTerminalID,
            departingTerminalId: vessel.DepartingTerminalID,
            departedTime,
            departureDelta,
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
                const model = {
                    arrivalId: capacity.TerminalID,
                    departureId: terminal.TerminalID,
                    departureDelta: _.get(
                        vesselsById,
                        [departure.VesselID, 'departureDelta'],
                        null
                    ),
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
