import {DateTime, Duration} from 'luxon';
import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Time extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
        time: PropTypes.object.isRequired,
        isNext: PropTypes.bool.isRequired,
    };

    render = () => {
        const {crossing, isNext, time} = this.props;
        const {capacity = {}, hasPassed} = crossing;
        const {departureDelta = 0, isCancelled} = capacity;
        const delta = Duration.fromObject({seconds: departureDelta});
        let deltaMins = _.round(delta.as('minutes'));
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        let estimatedTime = scheduledTime.plus(delta);
        const diff = estimatedTime.diff(time);
        if (Math.abs(deltaMins) <= 2) {
            deltaMins = 0;
            estimatedTime = scheduledTime;
        }

        let majorTime;
        let minorTime;
        if (isCancelled) {
            majorTime = '--';
            minorTime = '';
        } else if (Math.abs(diff.as('hours')) < 1) {
            const mins = _.round(Math.abs(diff.as('minutes')));
            majorTime = mins;
            minorTime = `min${mins > 1 ? 's' : ''}${hasPassed ? ' ago' : ''}`;
        } else {
            majorTime = estimatedTime.toFormat('h:mm');
            minorTime = estimatedTime.toFormat('a');
        }

        let color = 'text-black';
        if (isCancelled) {
            color = 'text-red-dark';
        } else if (hasPassed) {
            color = 'text-gray-dark';
        } else if (deltaMins >= 10) {
            color = 'text-red-dark';
        } else if (deltaMins >= 4) {
            color = 'text-yellow-dark';
        }

        let weight;
        if (hasPassed) {
            weight = 'font-default';
        } else if (isNext) {
            weight = 'font-bold';
        } else {
            weight = 'font-medium';
        }
        return (
            <div
                className={clsx(
                    'flex flex-col',
                    'text-center w-16 z-0',
                    color,
                    weight
                )}
            >
                <span
                    className={clsx(
                        'flex-grow text-2xl leading-none',
                        'flex flex-col justify-center'
                    )}
                >
                    {majorTime}
                </span>
                <span className={clsx('text-sm')}>{minorTime}</span>
            </div>
        );
    };
}
