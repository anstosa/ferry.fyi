import {DateTime, Duration} from 'luxon';
import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Time extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
    };

    render = () => {
        const {crossing} = this.props;
        const {capacity = {}, hasPassed} = crossing;
        const {departureDelta = 0} = capacity;
        const delta = Duration.fromObject({seconds: departureDelta});
        let deltaMins = _.round(delta.as('minutes'));
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        let estimatedTime = scheduledTime.plus(delta);
        const diff = estimatedTime.diffNow();
        if (Math.abs(deltaMins) <= 2) {
            deltaMins = 0;
            estimatedTime = scheduledTime;
        }

        let majorTime;
        let minorTime;
        if (Math.abs(diff.as('hours')) < 1) {
            const mins = _.round(Math.abs(diff.as('minutes')));
            majorTime = mins + deltaMins;
            minorTime = `min${mins > 1 ? 's' : ''}${hasPassed ? ' ago' : ''}`;
        } else {
            majorTime = estimatedTime.toFormat('h:mm');
            minorTime = estimatedTime.toFormat('a');
        }
        let color = 'text-black';
        if (hasPassed) {
            color = 'text-gray-600';
        } else if (deltaMins >= 10) {
            color = 'text-red-700';
        } else if (deltaMins >= 4) {
            color = 'text-orange-500';
        }
        return (
            <div
                className={clsx('flex flex-col', 'text-center w-20 z-0', color)}
            >
                <span
                    className={clsx(
                        'flex-grow text-2xl font-bold leading-none',
                        'flex flex-col justify-center'
                    )}
                >
                    {majorTime}
                </span>
                <span className={clsx('text-sm font-bold')}>{minorTime}</span>
            </div>
        );
    };
}
