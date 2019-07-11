import clsx from 'clsx';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Menu extends Component {
    static propTypes = {
        isOpen: PropTypes.bool.isRequired,
        onClose: PropTypes.func.isRequired,
    };

    state = {
        iOs: false,
        android: false,
    };

    renderStepIcon = (className) => (
        <i className={clsx(className, 'mx-2 w-4 text-center')} />
    );

    renderInstall = () => {
        const {android, iOs} = this.state;
        const isInstalled = window.matchMedia('(display-mode: standalone)')
            .matches;
        if (isInstalled) {
            return null;
        } else {
            return (
                <>
                    <h2 className="font-medium text-lg mt-8">Install App</h2>
                    <div className="mt-2">
                        Want to install Ferry FYI as an app on your homescreen?
                        {!iOs && !android && (
                            <div className="flex mt-4">
                                <button
                                    className={clsx(
                                        'button button-invert',
                                        'flex-grow'
                                    )}
                                    onClick={() => this.setState({iOs: true})}
                                >
                                    <i className="button-icon fab fa-lg fa-apple" />
                                    <span className="button-label">iOS</span>
                                </button>
                                <button
                                    className={clsx(
                                        'button button-invert',
                                        'flex-grow ml-4'
                                    )}
                                    onClick={() =>
                                        this.setState({android: true})
                                    }
                                >
                                    <i className="button-icon fab fa-lg fa-android" />
                                    <span className="button-label">
                                        Android
                                    </span>
                                </button>
                            </div>
                        )}
                        {iOs && (
                            <ol className="my-2 list-decimal list-inside">
                                <li>
                                    {this.renderStepIcon('fab fa-safari')}
                                    Safari
                                </li>
                                <li>
                                    {this.renderStepIcon(
                                        'fal fa-external-link'
                                    )}
                                    Share
                                </li>
                                <li>
                                    {this.renderStepIcon('fal fa-plus-square')}
                                    Add to Home Screen
                                </li>
                            </ol>
                        )}
                        {android && (
                            <ol className="my-2 list-decimal list-inside">
                                <li>
                                    {this.renderStepIcon('fab fa-chrome')}
                                    Chrome
                                </li>
                                <li>
                                    {this.renderStepIcon('fas fa-ellipsis-v')}
                                    Menu
                                </li>
                                <li>
                                    {this.renderStepIcon('inline-block')}
                                    Add to Home Screen
                                </li>
                            </ol>
                        )}
                    </div>
                </>
            );
        }
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
                    <div
                        className={clsx(
                            'overflow-y-scroll scrolling-touch',
                            'flex-grow flex flex-col'
                        )}
                    >
                        <p className="mt-4">
                            A ferry schedule and tracker for the greater Seattle
                            area. Supports all{' '}
                            <a
                                className="link"
                                href="https://www.wsdot.wa.gov/ferries/"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                WSF
                            </a>{' '}
                            routes.
                        </p>
                        {this.renderInstall()}
                        <h2 className="font-medium text-lg mt-8">Feedback</h2>
                        <p className="mt-2">
                            See something wrong? Want to request a feature?{' '}
                            <a
                                className="link"
                                href="https://github.com/anstosa/ferry.fyi/issues"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                File a ticket on GitHub
                            </a>{' '}
                            or{' '}
                            <a
                                className="link"
                                href="mailto:dev@ferry.fyi"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                email dev@ferry.fyi
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
                        <p className="mb-4 text-xs text-right mt-8">
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
                </div>
            </>
        );
    };
}
