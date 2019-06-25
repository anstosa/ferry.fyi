// Library for https://www.wsdot.wa.gov/ferries/api/schedule/documentation/rest.html
// We wrap this API in order to orchestrate caching, proxy XML into a useful format,
// and filter/rename the fields

// imports
const _ = require('lodash');
const request = require('request-promise');
const {getToday, wsfDateToTimestamp} = require('./lib/date');
const {getVessel} = require('./vessels');

// constants
const API_BASE_URL = 'https://www.wsdot.wa.gov/ferries/api/schedule/rest';
const API_TERMINAL_URL = 'https://www.wsdot.wa.gov/ferries/api/terminals/rest';
const API_VESSEL_URL = 'https://www.wsdot.wa.gov/ferries/api/vessels/rest';
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;
const API_SPACE = `${API_TERMINAL_URL}/terminalsailingspace${API_ACCESS}`;
const API_CACHE = `${API_BASE_URL}/cacheflushdate`;
const API_LOCATIONS = `${API_VESSEL_URL}/vessellocations${API_ACCESS}`;
const getApiMates = () =>
    `${API_BASE_URL}/terminalsandmates/${getToday()}${API_ACCESS}`;
const getApiToday = (departingId, arrivingId) =>
    `${API_BASE_URL}/scheduletoday/` +
    `${departingId}/${arrivingId}/false${API_ACCESS}`;

let lastCacheFlushDate = null;
let matesByTerminalId = {};
let updatePromise = Promise.resolve();
const capacityByTerminal = {};
const timingByTerminal = {};

// safely initialize a mates object
function initMates(id) {
    if (!_.has(matesByTerminalId, id)) {
        matesByTerminalId[id] = [];
    }
}

function flushMates() {
    matesByTerminalId = {};
}

function addMate(id, mateId) {
    initMates(id);
    matesByTerminalId[id].push(mateId);
}

// fetches mates from the cache (waiting if an update is in progress)
module.exports.getMates = async () => {
    await updatePromise;
    return matesByTerminalId;
};

// set cache with all long-lived terminal data from API
const updateCache = () =>
    new Promise(async (resolve) => {
        console.log('Updating schedule cache...');
        const mates = await request(getApiMates(), {json: true});
        flushMates();
        _.each(mates, (mate) => {
            const id = mate.DepartingTerminalID;
            const mateId = mate.ArrivingTerminalID;
            addMate(id, mateId);
        });
        console.log('Schedule cache updated.');
        resolve();
    });

module.exports.getSchedule = async (departingId, arrivingId) => {
    const response = await request(getApiToday(departingId, arrivingId), {
        json: true,
    });
    const schedule = _.first(response.TerminalCombos);
    return Promise.all(
        _.map(schedule.Times, async (departure) => {
            const time = wsfDateToTimestamp(departure.DepartingTime);
            return {
                allowsPassengers: _.includes([1, 3], departure.LoadingRule),
                allowsVehicles: _.includes([2, 3], departure.LoadingRule),
                capacity: _.get(capacityByTerminal, [
                    departingId,
                    arrivingId,
                    time,
                ]),
                time,
                timing: _.get(timingByTerminal, [
                    departingId,
                    arrivingId,
                    time,
                ]),
                vessel: await getVessel(departure.VesselID),
            };
        })
    );
};

async function checkAndPurgeCache() {
    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_CACHE, {json: true})
    );
    if (cacheFlushDate !== lastCacheFlushDate) {
        updatePromise = updateCache();
    }
    lastCacheFlushDate = cacheFlushDate;
}
setInterval(checkAndPurgeCache, 30 * 1000);

async function recordCapacity() {
    const terminals = await request(API_SPACE, {json: true});
    _.each(terminals, (terminal) => {
        _.each(terminal.DepartingSpaces, (departure) => {
            _.each(departure.SpaceForArrivalTerminals, (capacity) => {
                const time = wsfDateToTimestamp(departure.Departure);
                _.setWith(
                    capacityByTerminal,
                    [terminal.TerminalID, capacity.TerminalID, time],
                    {
                        driveUpCapacity: capacity.DriveUpSpaceCount,
                        hasDriveUp: capacity.DisplayDriveUpSpace,
                        hasReservations: capacity.DisplayReservableSpace,
                        isCancelled: departure.IsCancelled,
                        reservableCapacity: capacity.ReservableSpaceCount,
                    },
                    Object
                );
            });
        });
    });
}
setInterval(recordCapacity, 5 * 1000);

async function recordTiming() {
    const vessels = await request(API_LOCATIONS, {json: true});
    _.each(vessels, (vessel) => {
        const departedTime = wsfDateToTimestamp(vessel.LeftDock);
        const departureTime = wsfDateToTimestamp(vessel.ScheduledDeparture);
        const estimatedArrivalTime = wsfDateToTimestamp(vessel.Eta);
        let departedDelta;
        if (departureTime) {
            departedDelta = departedTime - departureTime;
        }
        _.setWith(
            timingByTerminal,
            [
                vessel.DepartingTerminalID,
                vessel.ArrivingTerminalID,
                departureTime,
            ],
            {
                departedTime,
                departedDelta,
                estimatedArrivalTime,
            },
            Object
        );
    });
    console.log(timingByTerminal);
}
setInterval(recordTiming, 5 * 1000);

// initialize cache
updatePromise = updateCache();
