import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

const RESERVATIONS_BASE_URL =
    'https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=';

const LEFT_EDGE = 13;
const RIGHT_EDGE = 85;
const CAPACITY_WIDTH = 125;

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

    getEstimateLeft() {
        const {estimate} = this.props.crossing;
        if (!estimate) {
            return null;
        }
        const {driveUpCapacity = 0, reservableCapacity = 0} = estimate;
        const estimateLeft = driveUpCapacity + reservableCapacity;
        return estimateLeft;
    }

    getEstimateFull() {
        const estimateLeft = this.getEstimateLeft();
        if (_.isNull(estimateLeft)) {
            return null;
        }
        const {capacity} = this.props.crossing;
        const totalCapacity = _.get(
            capacity,
            'totalCapacity',
            this.getVesselCapacity()
        );
        const estimateFull = _.min([
            ((totalCapacity - estimateLeft) / totalCapacity) * 100,
            100,
        ]);
        return estimateFull;
    }

    getVesselCapacity() {
        const {vessel} = this.props.crossing;
        return vessel.vehicleCapacity - vessel.tallVehicleCapacity;
    }

    updateCrossing = () => {
        let spaceLeft = null;
        let percentFull = null;

        const {capacity} = this.props.crossing;
        if (capacity) {
            const {
                driveUpCapacity = 0,
                reservableCapacity = 0,
                totalCapacity,
            } = capacity;

            spaceLeft = driveUpCapacity + reservableCapacity;
            percentFull = _.min([
                ((totalCapacity - spaceLeft) / totalCapacity) * 100,
                100,
            ]);
        }

        const estimateLeft = this.getEstimateLeft();
        const estimateFull = this.getEstimateFull();
        this.setState({spaceLeft, percentFull, estimateLeft, estimateFull});
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

    allowsReservations = () => {
        return _.get(
            this.props,
            ['crossing', 'capacity', 'hasReservations'],
            false
        );
    };

    isLeftEdge = () => {
        const {capacity} = this.props.crossing;
        const {estimateFull, percentFull} = this.state;
        const fullness =
            capacity && percentFull > 0 ? percentFull : estimateFull;
        const percent = fullness / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        return width <= LEFT_EDGE;
    };

    willFitLeft = () => {
        const {capacity} = this.props.crossing;
        const {estimateFull, percentFull} = this.state;
        const fullness =
            capacity && percentFull > 0 ? percentFull : estimateFull;
        const percent = fullness / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        return width >= CAPACITY_WIDTH + LEFT_EDGE;
    };

    willFitRight = () => {
        const {capacity} = this.props.crossing;
        const {estimateFull, percentFull} = this.state;
        const fullness =
            capacity && percentFull > 0 ? percentFull : estimateFull;
        const percent = fullness / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        const remainder = totalWidth - width;
        return remainder >= CAPACITY_WIDTH + RIGHT_EDGE;
    };

    isRightEdge = () => {
        const {capacity} = this.props.crossing;
        const {estimateFull, percentFull} = this.state;
        const fullness =
            capacity && percentFull > 0 ? percentFull : estimateFull;
        const percent = fullness / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        const remainder = totalWidth - width;
        return remainder <= RIGHT_EDGE;
    };

    isMiddleZone = () => !this.isLeftEdge() && !this.isRightEdge();

    isEmpty = () => {
        const {capacity} = this.props.crossing;
        const {estimateFull, percentFull} = this.state;
        const fullness =
            capacity && percentFull > 0 ? percentFull : estimateFull;
        return fullness === 0;
    };

    isFull = () => {
        const {capacity} = this.props.crossing;
        const {estimateLeft, spaceLeft, percentFull} = this.state;
        const spaces = capacity && percentFull > 0 ? spaceLeft : estimateLeft;
        return spaces <= 0;
    };

    renderSpaceDetail = () => {
        let reservationsText = null;
        const {percentFull} = this.state;
        const {capacity, estimate} = this.props.crossing;
        const departureId = _.get(
            this.props,
            ['crossing', 'capacity', 'departureId'],
            null
        );
        if (capacity && percentFull > 0) {
            if (this.hasAvailableReservations()) {
                reservationsText = (
                    <a
                        className="text-xs link text-green-dark"
                        href={RESERVATIONS_BASE_URL + departureId}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        <i className="fas fa-external-link-square mr-1" />
                        Reserve
                    </a>
                );
            } else if (this.allowsReservations()) {
                reservationsText = (
                    <span className="text-xs text-gray-dark">Standby Only</span>
                );
            }
        } else if (estimate) {
            reservationsText = (
                <span className="text-xs text-blue-light italic">Forecast</span>
            );
        }
        return reservationsText;
    };

    renderSpace = () => {
        const {estimateLeft, spaceLeft, percentFull} = this.state;
        const {crossing} = this.props;
        const {capacity, estimate, hasPassed} = crossing;

        let spaceText;
        let spaceClass = clsx('text-xs whitespace-no-wrap');
        if (capacity && percentFull > 0) {
            spaceText = (
                <>
                    <i className="fas fa-car mr-1" />
                    {spaceLeft} spaces left
                </>
            );
            if (this.isFull()) {
                spaceText = (
                    <>
                        <i className="fas fa-do-not-enter mr-1" />
                        Boat full
                    </>
                );
                if (!hasPassed) {
                    spaceClass = clsx(spaceClass, 'font-bold text-red-dark');
                }
            } else if (percentFull > 80) {
                if (!hasPassed) {
                    spaceClass = clsx(
                        spaceClass,
                        'font-medium text-yellow-dark'
                    );
                }
            }
        } else if (estimate) {
            spaceClass = clsx(spaceClass, 'text-gray-medium');
            spaceText = (
                <>
                    {estimateLeft > 0
                        ? `${estimateLeft} spaces left`
                        : 'Boat full'}
                </>
            );
        } else {
            return null;
        }
        return <span className={spaceClass}>{spaceText}</span>;
    };

    renderStatus = () => {
        const {capacity, estimate} = this.props.crossing;
        if (!capacity && !estimate) {
            return null;
        }
        return (
            <div
                className={clsx(
                    'flex flex-col pt-3',
                    this.willFitRight() ? 'items-start' : 'items-end'
                )}
            >
                {this.renderSpace()}
                {this.renderSpaceDetail()}
            </div>
        );
    };

    render = () => {
        const {estimateFull, percentFull} = this.state;
        const {hasPassed} = this.props.crossing;
        const showCapacity = Boolean(percentFull);
        const showEstimate = Boolean(
            estimateFull && estimateFull > percentFull && !hasPassed
        );
        if (!showCapacity && !showEstimate) {
            return null;
        }

        return (
            <>
                {showCapacity && (
                    <div
                        className={clsx(
                            'absolute w-0 top-0 left-0 h-full',
                            hasPassed ? 'bg-darken-lower' : 'bg-blue-light'
                        )}
                        style={{width: `${percentFull}%`}}
                    >
                        {this.isMiddleZone() && (
                            <span
                                className={clsx(
                                    'absolute top-0',
                                    this.willFitRight()
                                        ? 'left-full ml-4'
                                        : 'right-0 mr-4'
                                )}
                            >
                                {this.renderStatus()}
                            </span>
                        )}
                    </div>
                )}
                {showEstimate && (
                    <div
                        className={clsx(
                            'absolute w-1 top-0 h-full',
                            'bg-prediction-gradient',
                            'border-darken-lower',
                            'border-r-4 border-r-dashed'
                        )}
                        style={{
                            left: `${percentFull || 0}%`,
                            width: `${estimateFull - percentFull}%`,
                        }}
                    >
                        {!showCapacity && this.isMiddleZone() && (
                            <span
                                className={clsx(
                                    'absolute top-0',
                                    this.willFitRight()
                                        ? 'left-full ml-4'
                                        : 'right-0 mr-4'
                                )}
                            >
                                {this.renderStatus()}
                            </span>
                        )}
                    </div>
                )}
                {this.isLeftEdge() && (
                    <span className="absolute top-0" style={{left: LEFT_EDGE}}>
                        {this.renderStatus()}
                    </span>
                )}
                {this.isRightEdge() && (
                    <span
                        className="absolute top-0"
                        style={{right: RIGHT_EDGE}}
                    >
                        {this.renderStatus()}
                    </span>
                )}
            </>
        );
    };
}
