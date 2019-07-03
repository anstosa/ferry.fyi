import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Cameras extends Component {
    static propTypes = {
        terminal: PropTypes.object,
    };

    renderCamera = (camera, index, cameras) => {
        const {id, title, image, spacesToNext, location, owner} = camera;
        const isFirst = index === 0;
        let totalToBooth = 0;
        const mapsUrl = `https://www.google.com/maps/search/${location.latitude},${location.longitude}`;
        _.find(cameras, (candidate) => {
            totalToBooth += candidate.spacesToNext;
            return candidate === camera;
        });
        return (
            <li
                className={clsx(
                    'flex flex-col',
                    'relative',
                    !isFirst && 'pt-8'
                )}
                key={id}
            >
                <img
                    src={image.url}
                    className={clsx(
                        'w-full',
                        owner.name && 'border border-black'
                    )}
                />
                <span className="font-bold text-lg mt-2">
                    <a
                        href={mapsUrl}
                        target="_blank"
                        className="link"
                        rel="noopener noreferrer"
                    >
                        {title}
                    </a>
                    {totalToBooth > 0 && (
                        <span className={clsx('ml-4 font-normal text-sm')}>
                            <i className={clsx('fas fa-car mr-2')} />
                            {totalToBooth} to tollbooth
                        </span>
                    )}
                    {totalToBooth === 0 && (
                        <span className={clsx('ml-4 font-normal text-sm')}>
                            <i className={clsx('fas fa-parking mr-2')} />
                            Past tollbooth
                        </span>
                    )}
                </span>
                {isFirst && (
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
                        'absolute bottom-0 left-0 -ml-12 -mb-2 z-10',
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
                            'absolute top-0 left-0 -ml-12 mt-32 z-10',
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

    render = () => {
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
}
