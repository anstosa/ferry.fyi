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
        this.setState({mate: null, schedule: null, terminal: null});
        const terminal = await getTerminal(slug);
        const mate = _.first(terminal.mates);
        this.setState({mate, terminal});
        await this.updateSchedule();
    };

    setMate = async (mate) => {
        this.setState({mate, schedule: null});
        await this.updateSchedule();
    };

    updateSchedule = async () => {
        const {terminal, mate} = this.state;
        const schedule = await getSchedule(terminal, mate);
        this.setState({schedule});
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
        const sailings = _.map(schedule, this.renderCrossing);
        return <ul>{sailings}</ul>;
    };

    renderCrossing = (crossing) => {
        const time = DateTime.fromSeconds(crossing.time);
        const isNext =
            crossing === _.find(this.state.schedule, {hasPassed: false});
        const diff = time.diffNow();
        let percentFull = 0;
        let spaceLeft = 0;
        if (crossing.capacity) {
            const {
                driveUpCapacity = 0,
                reservableCapacity = 0,
                totalCapacity,
            } = crossing.capacity;
            spaceLeft = driveUpCapacity + reservableCapacity;
            percentFull = ((totalCapacity - spaceLeft) / totalCapacity) * 100;
        }

        let majorTime;
        let minorTime;
        if (Math.abs(diff.as('hours')) < 1) {
            majorTime = (
                <>
                    {_.round(Math.abs(diff.as('minutes')))}
                    <br />
                    <span className="text-sm">
                        mins {crossing.hasPassed && 'ago'}
                    </span>
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
                    'relative h-32 p-4',
                    'border-b border-gray-500',
                    crossing.hasPassed && 'opacity-50',
                    isNext && 'bg-green-200',
                    'flex justify-between'
                )}
                key={crossing.time}
                ref={(element) => {
                    if (crossing.hasPassed) {
                        this.lastPassed = element;
                    }
                }}
            >
                <div
                    className={clsx(
                        'absolute w-0 top-0 left-0 h-full',
                        'bg-darken-500'
                    )}
                    style={{width: `${percentFull}%`}}
                >
                    <span className={clsx('absolute top-0 right-0 m-4')}>
                        {spaceLeft} cars left
                    </span>
                </div>
                <div />
                <div className="flex flex-col text-center">
                    <span
                        className={clsx(
                            'flex-grow text-2xl font-bold leading-none',
                            'flex flex-col justify-center'
                        )}
                    >
                        {majorTime}
                    </span>
                    <span className="text-sm text-gray-700">{minorTime}</span>
                </div>
            </li>
        );
    };

    render = () => {
        const {mate, terminal, schedule} = this.state;
        const {match} = this.props;
        if (!terminal || !mate || !schedule) {
            return <Splash />;
        }
        return (
            <>
                <Header
                    match={match}
                    terminal={terminal}
                    mate={mate}
                    setMate={this.setMate}
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
