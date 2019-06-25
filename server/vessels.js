// Library for https://www.wsdot.wa.gov/ferries/api/vessels/documentation/rest.html
// We wrap this API in order to orchestrate caching, proxy XML into a useful format,
// and filter/rename the fields

// imports
const _ = require('lodash');
const request = require('request-promise');
const {wsfDateToTimestamp} = require('./lib/date');

// constants
const API_BASE_URL = 'https://www.wsdot.wa.gov/ferries/api/vessels/rest';
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;
const API_CACHE = `${API_BASE_URL}/cacheflushdate`;
const API_VERBOSE = `${API_BASE_URL}/vesselverbose${API_ACCESS}`;
const API_LOCATIONS = `${API_BASE_URL}/vessellocations${API_ACCESS}`;

let lastCacheFlushDate = null;
const vesselsById = {};
let updatePromise = Promise.resolve();

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

module.exports.getVessels = async () => {
    await updatePromise;
    return vesselsById;
};

// fetches a vessel from the cache (waiting if an update is in progress)
module.exports.getVessel = async (id) => {
    await updatePromise;
    return _.get(vesselsById, id);
};

// set cache with all long-lived vessel data from API
const updateCache = () =>
    new Promise(async (resolve) => {
        console.log('Updating vessel cache...');
        const vessels = await request(API_VERBOSE, {json: true});
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
        console.log('Vessel cache updated.');
        resolve();
    });

async function checkCacheAndPurge() {
    const cacheFlushDate = wsfDateToTimestamp(
        await request(API_CACHE, {json: true})
    );
    if (cacheFlushDate !== lastCacheFlushDate) {
        updatePromise = updateCache();
    }
    lastCacheFlushDate = cacheFlushDate;
}

setInterval(checkCacheAndPurge, 30 * 1000);

async function updateLocation() {
    const vessels = await request(API_LOCATIONS, {json: true});
    _.each(vessels, (vessel) => {
        const {VesselID: id} = vessel;
        assignVessel(id, {
            arrivingTerminalId: vessel.ArrivingTerminalID,
            departingTerminalId: vessel.DepartingTerminalID,
            heading: vessel.Heading,
            isAtDock: vessel.AtDock,
            location: {
                latitude: vessel.Latitude,
                longitude: vessel.Longitude,
            },
            mmsi: vessel.Mmsi,
            speed: vessel.Speed,
            info: {
                ...vesselsById[id].info,
                crossing: vessel.EtaBasis,
            },
        });
    });
}

setInterval(updateLocation, 5 * 1000);

// initialize cache
updatePromise = updateCache();
