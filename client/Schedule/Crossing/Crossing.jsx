import _ from 'lodash';
import Capacity from './Capacity';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import Status from './Status';
import Time from './Time';
import VesselTag from '../../components/VesselTag';

export default class Crossing extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
        schedule: PropTypes.arrayOf(PropTypes.object).isRequired,
        setElement: PropTypes.func.isRequired,
        time: PropTypes.object.isRequired,
    };

    render = () => {
        const {crossing, setElement, time} = this.props;
        const {hasPassed, vessel} = crossing;
        const isNext =
            crossing === _.find(this.props.schedule, {hasPassed: false});

        return (
            <li
                className={clsx(
                    'relative py-4 px-2',
                    'border-b border-gray-500',
                    hasPassed && 'bg-gray-300',
                    isNext && 'bg-green-200',
                    'flex justify-between'
                )}
                ref={setElement}
            >
                <Capacity crossing={crossing} />
                <div className="flex flex-col justify-between items-start z-0">
                    <VesselTag vessel={vessel} />
                    <Status className="mt-4" crossing={crossing} time={time} />
                </div>
                <Time crossing={crossing} time={time} />
            </li>
        );
    };
}
