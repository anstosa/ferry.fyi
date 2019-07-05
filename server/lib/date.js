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

// "today" is a tricky concept. WSF's "day" ends around 3am
export const getToday = () => {
    let date = DateTime.local();
    if (date.hour < 3) {
        date = date.minus({days: 1});
    }
    return date.toFormat('yyyy-MM-dd');
};
