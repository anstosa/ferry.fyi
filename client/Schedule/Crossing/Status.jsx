import {DateTime, Duration} from 'luxon';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Status extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
    };

    render = () => {
        const {crossing} = this.props;
        const {capacity = {}} = crossing;
        const {departureDelta = 0, isCancelled = false} = capacity;
        const delta = Duration.fromObject({seconds: departureDelta});
        const scheduledTime = DateTime.fromSeconds(crossing.time);

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
            } else if (Math.abs(departureDelta) < 1 * 60 * 1000) {
                statusText = 'On time';
                statusClass = clsx(statusClass, 'text-green-600');
            } else {
                const direction = departureDelta < 0 ? 'ahead' : 'behind';
                statusText = `${delta.as('minutes')} ${direction}`;
                statusClass = clsx(statusClass, 'text-red-700');
                scheduled = `Scheduled ${scheduledTime.toFormat('h:mm a')} `;
            }
        }

        return (
            <span className="text-sm ">
                {scheduled ? `${scheduled} · ` : ''}
                <span className={statusClass}>{statusText}</span>
            </span>
        );
    };
}
