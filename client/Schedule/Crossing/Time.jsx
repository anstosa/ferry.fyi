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
        const scheduledTime = DateTime.fromSeconds(crossing.time);
        const estimatedTime = scheduledTime.plus(delta);
        const diff = estimatedTime.diffNow();

        let majorTime;
        let minorTime;
        if (Math.abs(diff.as('hours')) < 1) {
            const mins = _.round(Math.abs(diff.as('minutes')));
            majorTime = mins + _.round(delta.as('minutes'));
            minorTime = `min${mins > 1 ? 's' : ''}${hasPassed ? ' ago' : ''}`;
        } else {
            majorTime = estimatedTime.toFormat('h:mm');
            minorTime = estimatedTime.toFormat('a');
        }
        return (
            <div className="flex flex-col text-center w-20 z-0">
                <span
                    className={clsx(
                        'flex-grow text-2xl font-bold leading-none',
                        'flex flex-col justify-center',
                        hasPassed && 'text-gray-600'
                    )}
                >
                    {majorTime}
                </span>
                <span
                    className={clsx(
                        'text-sm font-bold',
                        hasPassed && 'text-gray-600'
                    )}
                >
                    {minorTime}
                </span>
            </div>
        );
    };
}
