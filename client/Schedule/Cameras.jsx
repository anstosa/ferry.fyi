import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Cameras extends Component {
    static propTypes = {
        terminal: PropTypes.object,
    };

    state = {
        isOpen: false,
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
        const {isOpen} = this.state;
        return (
            <div
                className={clsx(
                    'relative h-16 p-4',
                    'flex items-center flex-shrink-0'
                )}
                onClick={() => this.setState({isOpen: !isOpen})}
            >
                <i
                    className={clsx(
                        'fas fa-lg mr-4',
                        isOpen ? 'fa-chevron-down' : 'fa-chevron-up'
                    )}
                />
                Cameras
            </div>
        );
    };

    renderCamera = (camera, index, cameras) => {
        const {id, title, image, spacesToNext, owner} = camera;
        const isLast = index === cameras.length - 1;
        const isFirst = index === 0;
        let totalToBooth = 0;
        _.find(cameras, (candidate) => {
            totalToBooth += candidate.spacesToNext;
            return candidate === camera;
        });
        return (
            <li className="flex flex-col pb-8 relative" key={id}>
                <span className="font-bold text-lg mb-2">
                    {title}
                    {spacesToNext > 0 && (
                        <span className={clsx('ml-4 font-normal text-sm')}>
                            <i className={clsx('fas fa-car mr-2')} />
                            {totalToBooth} to tollbooth
                        </span>
                    )}
                </span>
                <img
                    src={image.url}
                    className={clsx(
                        'w-full',
                        owner.name && 'border border-black'
                    )}
                />
                {isLast && (
                    <div
                        className={clsx(
                            'bg-wsf-green',
                            'w-12 h-full',
                            'absolute bottom-0 left-0 -ml-12 z-10'
                        )}
                    />
                )}
                <div
                    className={clsx(
                        'bg-wsf-green text-lighten-500',
                        'w-12 py-2',
                        'absolute top-0 left-0 -ml-12 -mt-2 z-10',
                        'text-center'
                    )}
                >
                    <i className={clsx('fas fa-lg fa-map-marker ml-1')} />
                </div>
                {spacesToNext > 0 && (
                    <div
                        className={clsx(
                            'bg-wsf-green',
                            'w-12 py-1',
                            'absolute top-0 left-0 -ml-12 -mt-1/2 z-10',
                            'text-center'
                        )}
                    >
                        <div className="flex flex-col ml-1">
                            <i className={clsx('fas fa-car')} />
                            <span className="text-sm">{spacesToNext}</span>
                        </div>
                    </div>
                )}
            </li>
        );
    };

    renderCameras = () => {
        const {
            terminal: {cameras},
        } = this.props;
        return (
            <div className="flex-grow overflow-y-auto">
                <ul className={clsx('my-4 pl-12 relative')}>
                    <div
                        className={clsx(
                            'bg-wsf-green',
                            'border-l-4 border-dotted border-lighten-500',
                            'w-1 h-full',
                            'absolute inset-y-0 left-0 ml-6'
                        )}
                    />
                    {_.map(cameras, this.renderCamera)}
                </ul>
            </div>
        );
    };

    render = () => {
        const {
            terminal: {cameras},
        } = this.props;
        if (!cameras) {
            return null;
        }
        return (
            <>
                <div className="h-16 w-full" />
                {this.wrapFooter(
                    <>
                        {this.renderToggle()}
                        {this.renderCameras()}
                    </>
                )}
            </>
        );
    };
}
