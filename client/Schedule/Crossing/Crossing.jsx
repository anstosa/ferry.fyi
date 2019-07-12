import _ from 'lodash';
import Capacity from './Capacity';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import Status from './Status';
import Time from './Time';

export default class Crossing extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
        schedule: PropTypes.arrayOf(PropTypes.object).isRequired,
        setElement: PropTypes.func.isRequired,
        time: PropTypes.object.isRequired,
    };

    render = () => {
        const {crossing, setElement, time} = this.props;
        const {hasPassed} = crossing;
        const isNext =
            crossing === _.find(this.props.schedule, {hasPassed: false});

        let background;
        if (hasPassed) {
            background = 'bg-gray-light';
        } else if (isNext) {
            background = 'bg-blue-lightest';
        } else {
            background = 'bg-white';
        }

        return (
            <li
                className={clsx(
                    'relative p-4 h-20',
                    'border-b border-gray-medium',
                    background,
                    'flex justify-between'
                )}
                ref={setElement}
            >
                <Capacity crossing={crossing} />
                <div className="flex flex-col justify-between items-start z-0">
                    <div className="flex-grow" />
                    <Status className="" crossing={crossing} time={time} />
                </div>
                <Time crossing={crossing} time={time} isNext={isNext} />
            </li>
        );
    };
}
