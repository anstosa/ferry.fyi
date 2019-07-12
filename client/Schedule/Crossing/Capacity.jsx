import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

const RESERVATIONS_BASE_URL =
    'https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/SailingSchedule.aspx?VRSTermId=';

const LEFT_EDGE = 65;
const RIGHT_EDGE = 90;
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

    allowsReservations = () => {
        return _.get(
            this.props,
            ['crossing', 'capacity', 'hasReservations'],
            false
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

    willFitRight = () => {
        const percent = this.state.percentFull / 100;
        const totalWidth = window.innerWidth;
        const width = percent * totalWidth;
        const remainder = totalWidth - width;
        return remainder >= CAPACITY_WIDTH + RIGHT_EDGE;
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
                    className="text-xs link text-wsf-green"
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
                <span className="text-xs text-gray-600">Standby Only</span>
            );
        }
        return reservationsText;
    };

    renderSpace = () => {
        const {spaceLeft, percentFull} = this.state;
        const {crossing} = this.props;
        const {hasPassed} = crossing;

        let spaceText = (
            <>
                <i className="fas fa-car mr-1 text-darken-400" />
                {spaceLeft} spaces left
            </>
        );
        let spaceClass = clsx('text-xs whitespace-no-wrap');
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
        return <span className={spaceClass}>{spaceText}</span>;
    };

    renderStatus = () => {
        const {percentFull} = this.state;
        if (percentFull === 0) {
            return null;
        }
        return (
            <div
                className={clsx(
                    'flex flex-col pt-4',
                    this.willFitRight() ? 'items-start' : 'items-end'
                )}
            >
                {this.renderSpace()}
                {this.renderReservations()}
            </div>
        );
    };

    render = () => {
        if (!this.hasData()) {
            return null;
        }
        const {percentFull} = this.state;

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
