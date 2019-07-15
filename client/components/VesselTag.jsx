import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class VesselTag extends Component {
    static propTypes = {
        vessel: PropTypes.object.isRequired,
        isAbbreviation: PropTypes.bool,
    };

    render = () => {
        const {isAbbreviation, vessel} = this.props;
        const {abbreviation, name} = vessel;
        return (
            <div
                className={clsx(
                    'font-bold text-2xs text-white',
                    'bg-gray-dark rounded p-1'
                )}
            >
                <i className="fas fa-ship mr-1" />
                {isAbbreviation ? abbreviation : name}
            </div>
        );
    };
}
