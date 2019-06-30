import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class VesselTag extends Component {
    static propTypes = {
        vessel: PropTypes.object.isRequired,
    };

    render = () => {
        const {abbreviation} = this.props.vessel;
        return (
            <div
                className={clsx(
                    'font-bold text-2xs text-white',
                    'bg-gray-600 rounded p-1'
                )}
            >
                {abbreviation}
            </div>
        );
    };
}
