import {isOnline} from '../lib/api';
import _ from 'lodash';
import Alerts, {getBulletins, getLastAlertTime} from './Alerts';
import Cameras from './Cameras';
import clsx from 'clsx';
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
        return (
            <div className="flex">
                {showCameras && this.renderToggleCameras()}
                {showAlerts && this.renderToggleAlerts()}
            </div>
        );
    };

    renderToggleCameras = () => {
        const {isOpen} = this.state;
        if (!isOnline()) {
            return null;
        }
        return (
            <div
                className={clsx(
                    'relative h-16 p-4',
                    'flex items-center flex-shrink-0 justify-start',
                    'cursor-pointer'
                )}
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
                Cameras
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
                {isOpen ? 'Alerts' : getLastAlertTime(terminal, time)}
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
        const {isOpen, tab} = this.state;
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
                        {showCameras && <Cameras terminal={terminal} />}
                        {showAlerts && (
                            <Alerts terminal={terminal} time={time} />
                        )}
                    </>
                )}
            </>
        );
    };
}
