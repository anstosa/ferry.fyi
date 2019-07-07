import {DateTime, Duration} from 'luxon';
import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Status extends Component {
    static propTypes = {
        className: PropTypes.string,
        crossing: PropTypes.object.isRequired,
        time: PropTypes.object.isRequired,
    };

    render = () => {
        const {className, crossing, time} = this.props;
        const {capacity = {}} = crossing;
        const {departureDelta = 0, isCancelled = false} = capacity;
        const delta = Duration.fromObject({seconds: departureDelta});
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        const deltaMins = _.round(delta.as('minutes'));
        const diff = scheduledTime.diff(time);

        let statusText;
        let statusClass;
        let scheduled;
        if (capacity) {
            if (isCancelled) {
                statusText = 'Cancelled';
                statusClass = clsx(
                    statusClass,
                    'text-red-700 font-bold uppercase'
                );
            } else if (Math.abs(deltaMins) < 4) {
                statusText = 'On time';
                statusClass = clsx(statusClass, 'text-green-600');
                if (Math.abs(diff.as('hours')) < 1) {
                    scheduled = `${scheduledTime.toFormat('h:mm a')}`;
                }
            } else {
                const units = deltaMins === 1 ? 'min' : 'mins';
                const direction = deltaMins < 0 ? 'ahead' : 'behind';
                const color =
                    deltaMins < 10 ? 'text-orange-500' : 'text-red-700';
                statusText = `${deltaMins} ${units} ${direction}`;
                statusClass = clsx(statusClass, color);
                scheduled = `Scheduled ${scheduledTime.toFormat('h:mm a')}`;
            }
        }

        return (
            <span className={clsx(className, 'text-sm')}>
                {scheduled ? `${scheduled} · ` : ''}
                <span className={statusClass}>{statusText}</span>
            </span>
        );
    };
}
