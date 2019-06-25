const _ = require('lodash');
const {DateTime} = require('luxon');

module.exports.wsfDateToTimestamp = (wsfDate) => {
    if (!wsfDate) {
        return null;
    }
    const match = wsfDate.match(/\/Date\((\d+)-\d+\)\//);
    if (!match) {
        return null;
    }
    return _.round(match[1] / 1000);
};

module.exports.getToday = () => DateTime.local().toFormat('yyyy-MM-dd');
