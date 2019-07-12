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
        const {capacity = {}, hasPassed} = crossing;
        const {departureDelta = 0, isCancelled = false} = capacity;
        const delta = Duration.fromObject({seconds: departureDelta});
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        const deltaMins = _.round(delta.as('minutes'));
        const diff = scheduledTime.diff(time);

        let statusText;
        let statusClass = hasPassed ? 'font-default' : 'font-medium';
        let scheduled;
        if (capacity) {
            if (isCancelled) {
                scheduled = `${scheduledTime.toFormat('h:mm a')}`;
                statusText = 'Cancelled';
                statusClass = clsx(
                    statusClass,
                    'text-red-dark font-bold uppercase'
                );
            } else if (Math.abs(deltaMins) < 4) {
                statusText = 'On time';
                statusClass = clsx(
                    statusClass,
                    !hasPassed && 'text-green-dark'
                );
                if (Math.abs(diff.as('hours')) < 1) {
                    scheduled = `${scheduledTime.toFormat('h:mm a')}`;
                }
            } else {
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
