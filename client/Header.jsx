import {getSlug, getTerminals} from './terminals';
import {Link} from 'react-router-dom';
import _ from 'lodash';
import clsx from 'clsx';
import Menu from './Menu';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class Header extends Component {
    static propTypes = {
        isReloading: PropTypes.bool.isRequired,
        match: PropTypes.object.isRequired,
        mate: PropTypes.object,
        reload: PropTypes.func.isRequired,
        setRoute: PropTypes.func.isRequired,
        terminal: PropTypes.object,
    };

    state = {
        isMenuOpen: false,
        isTerminalOpen: false,
        isMateOpen: false,
        isSwapHovering: false,
        terminals: [],
    };

    componentDidMount = async () => {
        const terminals = await getTerminals();
        this.setState({terminals});
    };

    wrapHeader = (content) => (
        <header
            className={clsx(
                'fixed top-0 inset-x z-10',
                'bg-wsf-green text-white',
                'w-full shadow-lg h-16',
                'flex justify-center'
            )}
        >
            <div className={clsx('w-full max-w-6xl p-4', 'flex items-center')}>
                {content}
            </div>
        </header>
    );

    renderDropdown = (terminals, key, onSelect) => {
        const terminal = _.first(terminals);
        if (terminals.length === 1) {
            return terminal.name;
        }
        const options = _.without(terminals, terminal);
        const isOpen = this.state[key];
        return (
            <div className="relative cursor-pointer">
                <div onClick={() => this.setState({[key]: !isOpen})}>
                    <span>{terminal.name}</span>
                    <i
                        className={clsx(
                            `fas fa-caret-${isOpen ? 'up' : 'down'}`,
                            'ml-2'
                        )}
                    />
                </div>
                {isOpen && (
                    <ul
                        className={clsx(
                            'absolute top-full left-0',
                            'bg-wsf-green shadow-lg',
                            '-ml-4 py-2',
                            'max-h-halfscreen overflow-y-auto'
                        )}
                    >
                        {_.map(options, (option) => (
                            <li key={option.id}>
                                <Link
                                    className={clsx(
                                        'whitespace-no-wrap',
                                        'block cursor-pointer',
                                        'px-4 py-2',
                                        'hover:bg-lighten-500'
                                    )}
                                    to={`/${getSlug(option.id)}`}
                                    onClick={(event) => onSelect(event, option)}
                                >
                                    {option.name}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    renderTerminal = () => {
        const {terminal} = this.props;
        const {terminals} = this.state;
        return this.renderDropdown(
            [terminal, ..._.without(terminals, terminal)],
            'isTerminalOpen',
            () => this.setState({isTerminalOpen: false})
        );
    };

    renderSwap = () => {
        const {mate} = this.props;
        const {isSwapHovering} = this.state;
        if (!mate) {
            return null;
        }
        return (
            <Link
                className="mx-2 w-8 text-center"
                to={`/${getSlug(mate.id)}`}
                onMouseEnter={() => this.setState({isSwapHovering: true})}
                onMouseLeave={() => this.setState({isSwapHovering: false})}
            >
                {isSwapHovering && <i className="fas fa-exchange-alt" />}
                {!isSwapHovering && <i className="fas fa-arrow-right" />}
            </Link>
        );
    };

    renderMate = () => {
        const {mate, setRoute, terminal} = this.props;
        if (!mate) {
            return null;
        }
        const {mates} = terminal;
        return this.renderDropdown(
            [mate, ..._.without(mates, mate)],
            'isMateOpen',
            (event, option) => {
                event.preventDefault();
                this.setState({isMateOpen: false});
                setRoute(getSlug(terminal.id), option);
            }
        );
    };

    renderMenuToggle = () => (
        <i
            className="fas fa-bars fa-lg mr-4 cursor-pointer"
            onClick={() => this.setState({isMenuOpen: true})}
        />
    );

    renderReload = () => {
        const {isReloading, reload} = this.props;
        return (
            <i
                className={clsx(
                    'fas fa-redo fa-lg fa-spin cursor-pointer',
                    !isReloading && 'fa-spin-pause'
                )}
                onClick={() => {
                    if (!isReloading) {
                        reload();
                    }
                }}
            />
        );
    };

    renderSpacer = () => <div className="flex-grow" />;

    render = () => {
        const {isMenuOpen} = this.state;
        const {terminal} = this.props;
        if (!terminal) {
            return this.wrapHeader('Ferry FYI');
        }
        return (
            <>
                <div className="h-16 w-full" />
                <Menu
                    isOpen={isMenuOpen}
                    onClose={() => this.setState({isMenuOpen: false})}
                />
                {this.wrapHeader(
                    <div className="flex w-full items-center">
                        {this.renderMenuToggle()}
                        {this.renderTerminal()}
                        {this.renderSwap()}
                        {this.renderMate()}
                        {this.renderSpacer()}
                        {this.renderReload()}
                    </div>
                )}
            </>
        );
    };
}
