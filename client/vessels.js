import {get} from './lib/api';
import _ from 'lodash';

const API_VESSELS = '/vessels';
const getApiVessel = (id) => `/vessels/${id}`;

let hasAll = false;
const vesselCache = {};

// get vessel data by id
// loads from cache if possible
export async function getVessel(id) {
    if (_.has(vesselCache, id)) {
        return vesselCache[id];
    }
    const terminal = await get(getApiVessel(id));
    vesselCache[id] = terminal;
    return terminal;
}

export async function getVessels() {
    if (hasAll) {
        return _.sortBy(_.map(vesselCache), 'name');
    }
    _.assign(vesselCache, await get(API_VESSELS));
    hasAll = true;
    return _.sortBy(_.map(vesselCache), 'name');
}
