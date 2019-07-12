import {DateTime} from 'luxon';
import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

const ALERT_FILTER = new RegExp(
    `(${[
        'boat',
        'cancelled',
        'emergency',
        'medical',
        'police',
        'tide',
        'traffic',
        'wait',
        'without traffic',
    ].join('|')})`,
    'i'
);

function getAlertTime(bulletin, now = DateTime.local()) {
    const time = DateTime.fromSeconds(bulletin.date);
    const diff = time.diff(now);
    let result;
    if (Math.abs(diff.as('hours')) < 1) {
        const mins = _.round(Math.abs(diff.as('minutes')));
        result = `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (time.hasSame(now, 'day')) {
        result = time.toFormat('h:mm a');
    } else {
        result = _.capitalize(time.toRelativeCalendar());
    }
    return result;
}

export function getLastAlertTime(terminal) {
    const bulletin = _.first(getBulletins(terminal));
    return getAlertTime(bulletin);
}

export function getBulletins(terminal) {
    const bulletins = _.filter(terminal.bulletins, ({title}) =>
        ALERT_FILTER.test(title)
    );
    return _.reverse(_.sortBy(bulletins, 'date'));
}

export default class Alerts extends Component {
    static propTypes = {
        terminal: PropTypes.object,
        time: PropTypes.object.isRequired,
    };

    renderAlert = (bulletin) => {
        const {time} = this.props;
        const {title, description} = bulletin;
        const filteredDescription = description
            .replace(/<script>.*<\/script>/, '')
            .replace(/\s*style=".*"\s*/g, '')
            .replace(/<p>/g, '<p class="my-2">')
            .replace(/<ul>/g, '<ul class="list-disc pl-4">');
        return (
            <li className="flex flex-col pb-8 relative" key={title}>
                <span className="text text-lighten-700 text-bold mb-1">
                    {getAlertTime(bulletin, time)}
                </span>
                <span className="font-medium text-lg mb-2">{title}</span>
                <div
                    className="text-sm"
                    dangerouslySetInnerHTML={{__html: filteredDescription}}
                />
            </li>
        );
    };

    render = () => {
        const {terminal} = this.props;
        return (
            <div className="flex-grow overflow-y-scroll scrolling-touch">
                <ul className={clsx('px-8 py-4 relative')}>
                    {_.map(getBulletins(terminal), this.renderAlert)}
                </ul>
            </div>
        );
    };
}
