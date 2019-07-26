import _ from 'lodash';
import logger from 'heroku-logger';

let cache = {};

export const ingestCache = (updates) => {
    cache = {...cache, ...updates};
    logger.info(`Ingested cache keys: ${_.keys(updates)}`);
};

export const getSchedule = (departingId, arrivingId) => {
    const schedule = _.get(cache, [
        'scheduleByTerminal',
        departingId,
        arrivingId,
    ]);
    return _.sortBy(_.map(schedule), 'time');
};

export const getVessels = () => {
    return _.get(cache, 'vesselsById');
};

// fetches a vessel from the cache (waiting if an update is in progress)
export const getVessel = (id) => {
    return _.get(cache, ['vesselsById', id]);
};

export const getTerminals = () => {
    return _.get(cache, 'terminalsById');
};

// fetches a terminal from the cache (waiting if an update is in progress)
export const getTerminal = (id) => {
    return _.get(cache, ['terminalsById', id]);
};
