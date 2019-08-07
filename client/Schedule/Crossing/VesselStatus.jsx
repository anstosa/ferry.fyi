import {DateTime} from 'luxon';
import {degreesToHeading} from '../../lib/compass';
import {knotsToMph} from '../../lib/speed';
import {locationToUrl} from '../../lib/maps';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class VesselStatus extends Component {
    static propTypes = {
        className: PropTypes.string,
        vessel: PropTypes.object.isRequired,
        time: PropTypes.object.isRequired,
    };

    render = () => {
        const {className, vessel, time} = this.props;
        const {
            dockedTime,
            isAtDock,
            location,
            heading,
            speed,
            vesselwatch,
        } = vessel;

        let statusText;
        let detailText;
        if (isAtDock) {
            statusText = 'Docked';
            if (dockedTime) {
                const delta = DateTime.fromSeconds(dockedTime).diff(time);
                const deltaMins = delta.as('minutes');
                const units = deltaMins === 1 ? 'min' : 'mins';
                detailText = `${deltaMins} ${units} ago`;
            }
        } else {
            statusText = 'Sailing';
            detailText = (
                <a
                    className="link"
                    href={vesselwatch || locationToUrl(location)}
                >
                    {knotsToMph(speed)}mph {degreesToHeading(heading)}
                </a>
            );
        }

        return (
            <span className={clsx('text-sm', className)}>
                <span>{statusText}</span>
                {detailText && (
                    <>
                        {' · '}
                        <span>{detailText}</span>
                    </>
                )}
            </span>
        );
    };
}
