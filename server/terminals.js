// Library for https://www.wsdot.wa.gov/ferries/api/terminals/documentation/rest.html
// We wrap this API in order to orchestrate caching, proxy XML into a useful format,
// and filter/rename the fields

// imports
const _ = require('lodash');
const request = require('request-promise');
const {wsfDateToTimestamp} = require('./lib/date');
const {getMates} = require('./schedule');

// constants
const API_BASE_URL = 'https://www.wsdot.wa.gov/ferries/api/terminals/rest';
const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;
const API_CACHE = `${API_BASE_URL}/cacheflushdate`;
const API_VERBOSE = `${API_BASE_URL}/terminalverbose${API_ACCESS}`;
let lastCacheFlushDate = null;
const terminalsById = {};
let updatePromise = Promise.resolve();

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

module.exports.getTerminals = async () => {
    await updatePromise;
    return terminalsById;
};

// fetches a terminal from the cache (waiting if an update is in progress)
module.exports.getTerminal = async (id) => {
    await updatePromise;
    return _.get(terminalsById, id);
};

// set cache with all long-lived terminal data from API
const updateCache = () =>
    new Promise(async (resolve) => {
        console.log('Updating terminal cache...');
        const terminals = await request(API_VERBOSE, {json: true});
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
        console.log('Terminal cache updated.');
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

// initialize cache
updatePromise = updateCache();
