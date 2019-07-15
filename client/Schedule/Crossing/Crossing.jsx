import _ from 'lodash';
import Capacity from './Capacity';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import Status from './Status';
import Time from './Time';
import VesselStatus from './VesselStatus';
import VesselTag from '../../components/VesselTag';

export default class Crossing extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
        isExpanded: PropTypes.bool.isRequired,
        onExpand: PropTypes.func.isRequired,
        route: PropTypes.object.isRequired,
        schedule: PropTypes.arrayOf(PropTypes.object).isRequired,
        setElement: PropTypes.func.isRequired,
        time: PropTypes.object.isRequired,
    };

    renderHeader = () => {
        const {crossing, onExpand, setElement, time} = this.props;
        const isNext =
            crossing === _.find(this.props.schedule, {hasPassed: false});

        return (
            <div
                className={clsx(
                    'relative p-4 h-20',
                    'flex justify-between',
                    'cursor-pointer'
                )}
                ref={setElement}
                onClick={() => onExpand(crossing)}
            >
                <Capacity crossing={crossing} />
                <div className="flex flex-col justify-between items-start z-0">
                    <div className="flex-grow" />
                    <Status className="" crossing={crossing} time={time} />
                </div>
                <Time crossing={crossing} time={time} isNext={isNext} />
            </div>
        );
    };

    renderDetails = () => {
        const {crossing, isExpanded, time, route} = this.props;
        const {vessel} = crossing;
        if (!isExpanded) {
            return null;
        }
        return (
            <>
                <div
                    className={clsx(
                        'w-full h-1',
                        'border-t border-dashed border-gray-medium'
                    )}
                />
                <div className={clsx('p-4', 'flex', 'text-sm')}>
                    <div
                        className={clsx(
                            'flex-grow pr-4',
                            'border-r border-dashed border-gray-medium'
                        )}
                    >
                        <div className="flex items-center">
                            <VesselTag vessel={vessel} />
                            <VesselStatus
                                className="flex-glow ml-4"
                                vessel={vessel}
                                time={time}
                            />
                        </div>
                    </div>
                    {route && (
                        <div className={clsx('flex-grow', 'pl-4')}>
                            Crossing: {route.crossingTime}mins
                        </div>
                    )}
                </div>
            </>
        );
    };

    render = () => {
        const {crossing} = this.props;
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
                    'border-b border-gray-medium',
                    background,
                    'flex flex-col'
                )}
            >
                {this.renderHeader()}
                {this.renderDetails()}
            </li>
        );
    };
}
