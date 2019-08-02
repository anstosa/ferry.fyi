import {isOnline} from '../lib/api';
import _ from 'lodash';
import Alerts, {getBulletins, getLastAlertTime} from './Alerts';
import Cameras from './Cameras';
import clsx from 'clsx';
import DateTime from 'luxon/src/datetime';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import ReactGA from 'react-ga';

const TAB_CAMERAS = 'cameras';
const TAB_ALERTS = 'alerts';

export default class Footer extends Component {
    static propTypes = {
        onChange: PropTypes.func,
        terminal: PropTypes.object,
        time: PropTypes.object.isRequired,
    };

    state = {
        cameraTime: DateTime.local().toSeconds(),
        isOpen: false,
        tab: null,
    };

    wrapFooter = (content) => {
        const {isOpen} = this.state;
        return (
            <div
                className={clsx(
                    'fixed top-0 inset-x z-10',
                    'bg-green-dark text-white',
                    'w-full shadow-up-lg',
                    'flex justify-center',
                    'animate',
                    'pr-safe-right pl-safe-left mb-safe-bottom'
                )}
                style={{
                    height: window.innerHeight,
                    top: isOpen ? '0' : 'calc(100% - 4rem)',
                }}
            >
                <div
                    className={clsx(
                        'w-full max-w-6xl',
                        'flex flex-col',
                        'pt-safe-top pb-safe-bottom'
                    )}
                >
                    {content}
                </div>
            </div>
        );
    };

    setOpen = (isOpen, tab = null) => {
        const {onChange} = this.props;
        this.setState({isOpen, tab});
        if (_.isFunction(onChange)) {
            onChange(isOpen);
        }
    };

    renderToggle = () => {
        const {isOpen, tab} = this.state;
        const showCameras = !isOpen || tab === TAB_CAMERAS;
        const showAlerts = !isOpen || tab === TAB_ALERTS;
        const alertsPlaceholder = !showAlerts && !isOpen;
        const camerasPlaceholder = !showCameras && !isOpen;
        const showMap = !isOpen;
        return (
            <div className="flex">
                {showCameras && this.renderToggleCameras()}
                {camerasPlaceholder && <div className="flex-grow" />}
                {showMap && this.renderMapLink()}
                {showAlerts && this.renderToggleAlerts()}
                {alertsPlaceholder && <div className="flex-grow" />}
            </div>
        );
    };

    renderMapLink = () => {
        const {vesselwatch} = this.props.terminal;
        if (!vesselwatch) {
            return null;
        }
        return (
            <a className="h-16 py-4 flex items-center" href={vesselwatch}>
                <i className="fas fa-lg fa-map-marked" />
            </a>
        );
    };

    renderToggleCameras = () => {
        const {isOpen, isReloading} = this.state;
        if (!isOnline()) {
            return null;
        }
        return (
            <div
                className={clsx(
                    'relative h-16 p-4',
                    'flex items-center justify-start',
                    'cursor-pointer',
                    'flex-grow flex-no-wrap min-w-0'
                )}
            >
                <div
                    className="flex-grow flex items-center flex-no-wrap min-w-0"
                    onClick={() => {
                        if (isOpen) {
                            this.setOpen(false);
                            ReactGA.event({
                                category: 'Navigation',
                                action: 'Close Cameras',
                            });
                        } else {
                            this.setOpen(true, TAB_CAMERAS);
                            ReactGA.event({
                                category: 'Navigation',
                                action: 'Open Cameras',
                            });
                        }
                    }}
                >
                    <i
                        className={clsx(
                            'fas fa-lg mr-4',
                            isOpen ? 'fa-chevron-down' : 'fa-video'
                        )}
                    />
                    <span className="truncate">Cameras</span>
                </div>
                {isOpen && (
                    <i
                        className={clsx(
                            'fas fa-redo fa-lg fa-spin cursor-pointer',
                            !isReloading && 'fa-spin-pause'
                        )}
                        onClick={() => {
                            this.setState({
                                cameraTime: DateTime.local().toSeconds(),
                                isReloading: true,
                            });
                            setTimeout(
                                () => this.setState({isReloading: false}),
                                1 * 1000
                            );
                        }}
                    />
                )}
            </div>
        );
    };

    renderToggleAlerts = () => {
        const {isOpen} = this.state;
        const {terminal, time} = this.props;
        if (!getBulletins(terminal).length) {
            return null;
        }
        return (
            <div
                className={clsx(
                    'relative h-16 p-4',
                    'flex items-center flex-grow justify-end',
                    'flex-no-wrap min-w-0',
                    'cursor-pointer'
                )}
                onClick={() => {
                    if (isOpen) {
                        this.setOpen(false);
                        ReactGA.event({
                            category: 'Navigation',
                            action: 'Close Alerts',
                        });
                    } else {
                        this.setOpen(true, TAB_ALERTS);
                        ReactGA.event({
                            category: 'Navigation',
                            action: 'Open Alerts',
                        });
                    }
                }}
            >
                <span className="truncate">
                    {isOpen ? 'Alerts' : getLastAlertTime(terminal, time)}
                </span>
                <i
                    className={clsx(
                        'fas fa-lg ml-4',
                        isOpen ? 'fa-chevron-down' : 'fa-exclamation-triangle'
                    )}
                />
            </div>
        );
    };

    render = () => {
        const {cameraTime, isOpen, tab} = this.state;
        const {terminal, time} = this.props;
        const showCameras = isOpen && tab === TAB_CAMERAS;
        const showAlerts = isOpen && tab === TAB_ALERTS;
        return (
            <>
                <div className="h-16 w-full mb" />
                <div
                    className={clsx(
                        'fixed bottom-0 inset-x-0 z-10',
                        'h-safe-bottom',
                        'bg-green-dark'
                    )}
                />
                {this.wrapFooter(
                    <>
                        {this.renderToggle()}
                        {showCameras && (
                            <Cameras
                                terminal={terminal}
                                cameraTime={cameraTime}
                            />
                        )}
                        {showAlerts && (
                            <Alerts terminal={terminal} time={time} />
                        )}
                    </>
                )}
            </>
        );
    };
}
