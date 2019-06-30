import {getSlug, getTerminals} from './terminals';
import {Link} from 'react-router-dom';
import _ from 'lodash';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Menu extends Component {
    static propTypes = {
        isOpen: PropTypes.bool.isRequired,
        onClose: PropTypes.func.isRequired,
    };

    render = () => {
        const {isOpen, onClose} = this.props;
        return (
            <>
                <div
                    className={clsx(
                        'fixed inset-0',
                        'animate',
                        isOpen ? 'z-20' : 'z-bottom pointer-events-none',
                        isOpen ? 'bg-darken-300' : 'bg-transparent'
                    )}
                    onClick={onClose}
                />
                <div
                    className={clsx(
                        'animate',
                        'flex flex-col',
                        'bg-wsf-green text-white shadow-lg',
                        'w-full h-screen max-w-xs px-4',
                        'fixed top-0 left-0 z-20',
                        isOpen ? 'ml-0' : '-ml-96'
                    )}
                >
                    <div
                        className={clsx(
                            'h-16 w-full py-4',
                            'text-2xl',
                            'flex items-center'
                        )}
                    >
                        <i className="fas fa-ship mr-4" />
                        <h1 className="font-bold">Ferry FYI</h1>
                        <div className="flex-grow" />
                        <i
                            className={clsx(
                                'fas fa-chevron-left text-md',
                                'cursor-pointer'
                            )}
                            onClick={onClose}
                        />
                    </div>
                    <p className="mt-4">
                        A better tracker for{' '}
                        <a
                            className="link"
                            href="https://www.wsdot.wa.gov/ferries/"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            the Washington State Ferry system
                        </a>
                        .
                    </p>
                    <h2 className="font-medium text-lg mt-8">Feedback</h2>
                    <p className="mt-2">
                        See something wrong? Want to request a feature? Email{' '}
                        <a
                            className="link"
                            href="mailto:dev@ferry.fyi"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            dev@ferry.fyi
                        </a>
                        .
                    </p>
                    <p className="mt-4">
                        Are you a software engineer?{' '}
                        <a
                            className="link"
                            href="https://github.com/anstosa/ferry.fyi"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Contribute on GitHub
                        </a>
                        .
                    </p>
                    <h2 className="font-medium text-lg mt-8">Support</h2>
                    <p className="mt-2">
                        If Ferry FYI is useful to you please consider making{' '}
                        <a
                            className="link"
                            href="https://ballydidean.farm/donate"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            a tax-deductible donation to Ballydídean Farm
                            Sanctuary
                        </a>{' '}
                        to support animal welfare on Whidbey Island.
                    </p>
                    <div className="flex-grow" />
                    <p className="mb-4 text-xs text-right">
                        By{' '}
                        <a
                            className="link"
                            href="https://ansel.santosa.family"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Ansel Santosa
                        </a>{' '}
                        on Whidbey Island
                    </p>
                </div>
            </>
        );
    };
}
