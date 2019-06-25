import {DateTime} from 'luxon';
import {getSchedule} from './schedule';
import {getTerminal} from './terminals';
import {Helmet} from 'react-helmet';
import _ from 'lodash';
import clsx from 'clsx';
import Header from './Header';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import scrollIntoView from 'scroll-into-view';
import Splash from './Splash';

export default class Schedule extends Component {
    static propTypes = {
        match: PropTypes.object.isRequired,
    };

    hasScrolled = false;

    state = {terminal: null, mate: null, schedule: []};

    componentDidMount = () => {
        const {match} = this.props;
        this.setTerminal(match.params.slug);
        this.checkScroll();
    };

    componentDidUpdate(prevProps) {
        const {match} = this.props;
        const {slug} = match.params;
        if (slug !== prevProps.match.params.slug) {
            this.setTerminal(slug);
        }
        this.checkScroll();
    }

    checkScroll = () => {
        if (!this.hasScrolled && this.lastPassed) {
            scrollIntoView(this.lastPassed);
            this.hasScrolled = true;
        }
    };

    setTerminal = async (slug) => {
        const terminal = await getTerminal(slug);
        const mate = _.first(terminal.mates);
        const schedule = await getSchedule(terminal, mate);
        this.setState({mate, schedule, terminal});
    };

    renderMeta = () => {
        const {terminal} = this.state;
        if (!terminal) {
            return null;
        }
        const {match} = this.props;
        const {slug} = match.params;
        const url = `${process.env.BASE_URL}/${slug}`;
        const title = `${_.capitalize(terminal.name)} Ferry FYI`;
        return (
            <Helmet>
                <meta charSet="utf-8" />
                <title>Ferry FYI</title>
                <link rel="canonical" href={url} />

                <meta name="twitter:title" content={title} />

                <meta property="og:url" content={url} />
                <meta property="og:title" content={title} />

                <meta itemProp="name" content={title} />
            </Helmet>
        );
    };

    renderSchedule = () => {
        const {schedule} = this.state;
        if (!schedule) {
            return;
        }
        const sailings = _.map(schedule, this.renderSailing);
        return <ul>{sailings}</ul>;
    };

    renderSailing = (sailing) => {
        const time = DateTime.fromSeconds(sailing.time);
        const hasPassed = DateTime.local() > time;
        const diff = time.diffNow();

        let majorTime;
        let minorTime;
        if (Math.abs(diff.as('hours')) < 1) {
            majorTime = (
                <>
                    {_.round(Math.abs(diff.as('minutes')))}
                    <br />
                    mins {hasPassed && 'ago'}
                </>
            );
            minorTime = time.toFormat('hh:mm a');
        } else {
            majorTime = time.toFormat('hh:mm');
            minorTime = time.toFormat('a');
        }

        return (
            <li
                className={clsx(
                    'h-32 p-4',
                    'border-b border-gray-500',
                    hasPassed && 'opacity-50',
                    'flex justify-between'
                )}
                key={sailing.time}
                ref={(element) => {
                    if (hasPassed) {
                        this.lastPassed = element;
                    }
                }}
            >
                <span>{sailing.vessel.name}</span>
                <div className="flex flex-col text-center">
                    <span className="flex-grow text-2xl font-bold">
                        {majorTime}
                    </span>
                    <span className="text-sm font-bold">{minorTime}</span>
                </div>
            </li>
        );
    };

    render = () => {
        const {mate, terminal} = this.state;
        const {match} = this.props;
        if (!terminal || !mate) {
            return <Splash />;
        }
        return (
            <>
                <Header
                    match={match}
                    terminal={terminal}
                    mate={mate}
                    setMate={(newMate) => this.setState({mate: newMate})}
                />
                <article className={clsx('w-full', 'flex-grow flex flex-col')}>
                    <div className="w-full max-w-6xl">
                        {this.renderSchedule()}
                    </div>
                </article>
            </>
        );
    };
}
