import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

const RESERVATIONS_BASE_URL =
    'https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=';

export default class Capacity extends Component {
    static propTypes = {
        crossing: PropTypes.object.isRequired,
    };

    state = {
        percentFull: null,
        spaceLeft: null,
    };

    componentDidMount() {
        this.updateCrossing();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.crossing !== this.props.crossing) {
            this.updateCrossing();
        }
    }

    updateCrossing = () => {
        const {capacity} = _.get(this.props, ['crossing']);
        if (!capacity) {
            this.setState({percentFull: null, spaceLeft: null});
            return;
        }
        const {
            driveUpCapacity = 0,
            reservableCapacity = 0,
            totalCapacity,
        } = capacity;

        const spaceLeft = driveUpCapacity + reservableCapacity;
        const percentFull = ((totalCapacity - spaceLeft) / totalCapacity) * 100;
        this.setState({spaceLeft, percentFull});
    };

    hasAvailableReservations = () => {
        return (
            _.get(
                this.props,
                ['crossing', 'capacity', 'reservableCapacity'],
                0
            ) > 0
        );
    };

    isLeftZone = () => this.state.percentFull <= 30;

    isRightZone = () => this.state.percentFull >= 80;

    isMiddleZone = () => !this.isLeftZone() && !this.isRightZone();

    isEmpty = () => this.state.percentFull === 0;

    isFull = () => this.state.spaceLeft <= 0;

    hasData = () => {
        const {spaceLeft, percentFull} = this.state;
        return !_.isNull(spaceLeft) && !_.isNull(percentFull);
    };

    renderReservations = () => {
        let reservationsText = null;
        const departureId = _.get(this.props, [
            'crossing',
            'capacity',
            'departureId',
        ]);
        if (this.hasAvailableReservations()) {
            reservationsText = (
                <a
                    className="link"
                    href={RESERVATIONS_BASE_URL + departureId}
                    target="_blank"
                    rel="noreferrer noopener"
                >
                    Reservations Available!
                </a>
            );
        }
        return reservationsText;
    };

    render = () => {
        if (!this.hasData()) {
            return null;
        }
        const {spaceLeft, percentFull} = this.state;
        const {crossing} = this.props;
        const {hasPassed} = crossing;

        let spaceText = `${spaceLeft} cars left`;
        let spaceClass = clsx(
            'text-xs whitespace-no-wrap',
            'absolute top-0 m-4'
        );
        if (this.isFull()) {
            spaceText = 'Boat full';
            if (!hasPassed) {
                spaceClass = clsx(spaceClass, 'font-bold text-red-700');
            }
        } else if (percentFull > 80) {
            if (!hasPassed) {
                spaceClass = clsx(spaceClass, 'font-medium text-orange-600');
            }
        }

        return (
            <>
                <div
                    className={clsx(
                        'absolute w-0 top-0 left-0 h-full',
                        'bg-darken-200'
                    )}
                    style={{width: `${percentFull}%`}}
                >
                    {this.isMiddleZone() && (
                        <span
                            className={clsx(
                                spaceClass,
                                percentFull <= 30 && 'left-full',
                                percentFull > 30 && 'right-0'
                            )}
                        >
                            {spaceText}
                        </span>
                    )}
                </div>
                {this.isLeftZone() && (
                    <span className={clsx(spaceClass)} style={{left: '10%'}}>
                        {spaceText}
                    </span>
                )}
                {this.isRightZone() && (
                    <span className={clsx(spaceClass)} style={{right: '20%'}}>
                        {spaceText}
                    </span>
                )}
            </>
        );
    };
}
