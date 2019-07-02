import {get} from './lib/api';
import _ from 'lodash';

const TERMINAL_ALIASES = {
    ana: 1,
    bbi: 3,
    bre: 4,
    cli: 5,
    cou: 11,
    cpv: 11,
    edm: 8,
    fau: 9,
    fdh: 10,
    frh: 10,
    fri: 10,
    fhb: 10,
    key: 11,
    kin: 12,
    lop: 13,
    lpz: 13,
    muk: 14,
    orc: 15,
    ori: 15,
    p52: 7,
    poi: 16,
    por: 17,
    pot: 17,
    ptd: 16,
    sdy: 19,
    sea: 7,
    sha: 18,
    shi: 18,
    sid: 19,
    sou: 20,
    sth: 20,
    tah: 21,
    vai: 22,
    vas: 22,
    vsh: 22,
    bainbridgeisland: 3,
    fridayharbor: 10,
    lopezisland: 13,
    orcasisland: 15,
    pointdefiance: 16,
    porttownsend: 17,
    sidneybc: 19,
    vashonisland: 22,
    shawisland: 18,
};

const CANONICAL_TERMINALS = {
    anacortes: 1,
    bainbridge: 3,
    bremerton: 4,
    clinton: 5,
    coupeville: 11,
    defiance: 16,
    edmonds: 8,
    fauntleroy: 9,
    friday: 10,
    kingston: 12,
    lopez: 13,
    mukilteo: 14,
    orcas: 15,
    seattle: 7,
    shaw: 18,
    sidney: 19,
    southworth: 20,
    tahlequah: 21,
    townsend: 17,
    vashon: 22,
};

const TERMINAL_ID_BY_SLUG = {
    ...CANONICAL_TERMINALS,
    ...TERMINAL_ALIASES,
};

const API_TERMINALS = '/terminals';
const getApiTerminal = (id) => `/terminals/${id}`;

let hasAll = false;
const terminalCache = {};

export const getSlug = (targetId) =>
    _.findKey(CANONICAL_TERMINALS, (id) => id === targetId);

// get terminal data by slug or id
// loads from cache if possible
export async function getTerminal(slug) {
    let id;
    if (_.isString(slug)) {
        id = TERMINAL_ID_BY_SLUG[_.toLower(slug)];
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
