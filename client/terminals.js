import {get} from './lib/api';
import _ from 'lodash';

const TERMINAL_ID_BY_SLUG = {
    anacortes: 1,
    bainbridge: 3,
    bainbridgeisland: 3,
    brenerton: 4,
    clinton: 5,
    coupeville: 11,
    edmonds: 8,
    fauntleroy: 9,
    friday: 10,
    fridayharbor: 10,
    kingston: 12,
    lopez: 13,
    lopezisland: 13,
    mukilteo: 14,
    orcas: 15,
    orcasisland: 15,
    defiance: 16,
    pointdefiance: 16,
    townsend: 17,
    porttownsend: 17,
    seattle: 7,
    shaw: 18,
    shawisland: 18,
    sidney: 19,
    sidneybc: 19,
    southworth: 20,
    tahlequah: 21,
    vashon: 22,
    vashonisland: 22,
};

const API_TERMINALS = '/terminals';
const getApiTerminal = (id) => `/terminals/${id}`;

let hasAll = false;
const terminalCache = {};

export const getSlug = (targetId) =>
    _.findKey(TERMINAL_ID_BY_SLUG, (id) => id === targetId);

// get terminal data by slug or id
// loads from cache if possible
export async function getTerminal(slug) {
    let id;
    if (_.isString(slug)) {
        id = TERMINAL_ID_BY_SLUG[slug];
    } else {
        id = slug;
    }
    if (_.has(terminalCache, id)) {
        return terminalCache[id];
    }
    const terminal = await get(getApiTerminal(id));
    terminalCache[id] = terminal;
    return terminal;
}

export async function getTerminals() {
    if (hasAll) {
        return _.sortBy(_.map(terminalCache), 'name');
    }
    _.assign(terminalCache, await get(API_TERMINALS));
    hasAll = true;
    return _.sortBy(_.map(terminalCache), 'name');
}
