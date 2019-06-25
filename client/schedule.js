import {get} from './lib/api';

const getApiSchedule = (departingId, arrivingId) =>
    `/schedule/${departingId}/${arrivingId}`;

export function getSchedule(terminal, mate) {
    return get(getApiSchedule(terminal.id, mate.id));
}
