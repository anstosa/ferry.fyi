import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

const RESERVATIONS_BASE_URL =
    'https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=';

const LEFT_EDGE = 65;
const RIGHT_EDGE = 90;
const CAPACITY_WIDTH = 100;

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
        const percentFull = _.min([
            ((totalCapacity - spaceLeft) / totalCapacity) * 100,
            100,
        ]);
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

    isLeftEdge = () => {
        const percent = this.state.percentFull / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        return width <= LEFT_EDGE;
    };

    willFitLeft = () => {
        const percent = this.state.percentFull / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        return width >= CAPACITY_WIDTH + LEFT_EDGE;
    };

    isRightEdge = () => {
        const percent = this.state.percentFull / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        const remainder = totalWidth - width;
        return remainder <= RIGHT_EDGE;
    };

    isMiddleZone = () => !this.isLeftEdge() && !this.isRightEdge();

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

        let spaceText = (
            <>
                <i className="fas fa-car mr-1 text-darken-400" />
                {spaceLeft} cars left
            </>
        );
        let spaceClass = clsx(
            'text-xs whitespace-no-wrap',
            'absolute top-0 mt-5'
        );
        if (this.isFull()) {
            spaceText = (
                <>
                    <i className="fas fa-do-not-enter mr-1 text-darken-400" />
                    Boat full
                </>
            );
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
                        'bg-darken-100'
                    )}
                    style={{width: `${percentFull}%`}}
                >
                    {this.isMiddleZone() && (
                        <span
                            className={clsx(
                                spaceClass,
                                this.willFitLeft()
                                    ? 'right-0 mr-4'
                                    : 'left-full ml-4'
                            )}
                        >
                            {spaceText}
                        </span>
                    )}
                </div>
                {this.isLeftEdge() && (
                    <span
                        className={clsx(spaceClass)}
                        style={{left: LEFT_EDGE}}
                    >
                        {spaceText}
                    </span>
                )}
                {this.isRightEdge() && (
                    <span
                        className={clsx(spaceClass)}
                        style={{right: RIGHT_EDGE}}
                    >
                        {spaceText}
                    </span>
                )}
            </>
        );
    };
}
