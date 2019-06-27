import {DateTime} from 'luxon';
import _ from 'lodash';

export const wsfDateToTimestamp = (wsfDate) => {
    if (!wsfDate) {
        return null;
    }
    const match = wsfDate.match(/\/Date\((\d+)-\d+\)\//);
    if (!match) {
        return null;
    }
    return _.round(match[1] / 1000);
};

export const getToday = () => DateTime.local().toFormat('yyyy-MM-dd');
