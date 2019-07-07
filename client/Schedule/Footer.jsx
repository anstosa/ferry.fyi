import {isOnline} from '../lib/api';
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
            <footer
                className={clsx(
                    'fixed top-full inset-x z-10',
                    'bg-wsf-green text-white',
                    'w-full h-screen shadow-lg',
                    'flex justify-center',
                    'animate',
                    !isOpen && '-mt-16'
                )}
                style={isOpen ? {marginTop: '-100vh'} : {}}
            >
                <div className={clsx('w-full max-w-6xl', 'flex flex-col')}>
                    {content}
                </div>
            </footer>
        );
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
                        this.setState({isOpen: false, tab: null});
                        ReactGA.event({
                            category: 'Navigation',
                            action: 'Close Cameras',
                        });
                    } else {
                        this.setState({isOpen: true, tab: TAB_CAMERAS});
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
                        this.setState({isOpen: false, tab: null});
                        ReactGA.event({
                            category: 'Navigation',
                            action: 'Close Alerts',
                        });
                    } else {
                        this.setState({isOpen: true, tab: TAB_ALERTS});
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
                <div className="h-16 w-full" />
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
