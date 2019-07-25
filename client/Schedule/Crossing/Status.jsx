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
        const {capacity, hasPassed} = crossing;
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        const formattedScheduledTime = `${scheduledTime.toFormat('h:mm a')}`;

        let statusText;
        let statusClass = hasPassed ? 'font-default' : 'font-medium';
        let scheduled;

        if (capacity && !_.isNull(capacity.departureDelta)) {
            const {departureDelta, isCancelled = false} = capacity;
            const delta = Duration.fromObject({seconds: departureDelta});
            const deltaMins = _.round(delta.as('minutes'));
            const estimatedTime = scheduledTime.plus(delta);
            const diff = estimatedTime.diff(time);
            if (isCancelled) {
                scheduled = `${scheduledTime.toFormat('h:mm a')}`;
                statusText = 'Cancelled';
                statusClass = clsx(
                    statusClass,
                    'text-red-dark font-bold uppercase'
                );
            } else if (Math.abs(deltaMins) >= 4) {
                const units = deltaMins === 1 ? 'min' : 'mins';
                const direction = deltaMins < 0 ? 'ahead' : 'behind';
                const color =
                    deltaMins < 10 ? 'text-yellow-dark' : 'text-red-dark';
                statusText = `${deltaMins} ${units} ${direction}`;
                statusClass = clsx(
                    statusClass,
                    !hasPassed && color,
                    'font-bold'
                );
                scheduled = `Scheduled ${formattedScheduledTime}`;
            } else {
                statusText = 'On time';
                statusClass = clsx(
                    statusClass,
                    !hasPassed && 'text-green-dark'
                );
                if (Math.abs(diff.as('hours')) < 1) {
                    scheduled = `Scheduled ${formattedScheduledTime}`;
                }
            }
        } else {
            const diff = scheduledTime.diff(time);
            statusClass = 'font-bold text-yellow-dark';
            statusText = 'Punctuality Unknown';
            if (Math.abs(diff.as('hours')) < 1) {
                scheduled = formattedScheduledTime;
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
