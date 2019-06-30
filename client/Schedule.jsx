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

    state = {terminal: null, mate: null, schedule: [], isUpdating: false};

    componentDidMount = () => {
        const {match} = this.props;
        this.setTerminal(match.params.slug);
        this.checkScroll();
        this.scheduleTick = setInterval(this.updateSchedule, 10 * 1000);
    };

    componentWillUnmount = () => {
        clearInterval(this.scheduleTick);
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
        this.setState({isUpdating: true});
        const schedule = await getSchedule(terminal, mate);
        if (!this.state.schedule) {
            this.hasScrolled = false;
        }
        this.setState({isUpdating: false, schedule});
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
        let spaceText = `${spaceLeft} cars left`;
        let spaceClass = 'text-xs whitespace-no-wrap';
        if (spaceLeft === 0) {
            spaceText = 'Boat full';
            if (!crossing.hasPassed) {
                spaceClass = clsx(spaceClass, 'font-bold text-red-700');
            }
        } else if (percentFull > 70) {
            if (!crossing.hasPassed) {
                spaceClass = clsx(spaceClass, 'font-medium text-orange-600');
            }
        }

        let majorTime;
        let minorTime;
        if (Math.abs(diff.as('hours')) < 1) {
            const mins = _.round(Math.abs(diff.as('minutes')));
            majorTime = mins;
            minorTime = `min${mins > 1 ? 's' : ''}${
                crossing.hasPassed ? ' ago' : ''
            }`;
        } else {
            majorTime = time.toFormat('h:mm');
            minorTime = time.toFormat('a');
        }

        return (
            <li
                className={clsx(
                    'relative h-20 py-4 px-2',
                    'border-b border-gray-500',
                    crossing.hasPassed && 'bg-gray-300',
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
                {percentFull > 0 && (
                    <div
                        className={clsx(
                            'absolute w-0 top-0 left-0 h-full',
                            'bg-darken-200'
                        )}
                        style={{width: `${percentFull}%`}}
                    >
                        {percentFull < 80 && (
                            <span
                                className={clsx(
                                    spaceClass,
                                    'absolute top-0 m-4',
                                    percentFull <= 30 && 'left-full',
                                    percentFull > 30 && 'right-0'
                                )}
                            >
                                {spaceText}
                            </span>
                        )}
                    </div>
                )}
                {percentFull >= 80 && (
                    <span
                        className={clsx(spaceClass, 'absolute top-0 m-4')}
                        style={{right: '20%'}}
                    >
                        {spaceText}
                    </span>
                )}
                <div />
                <div className="flex flex-col text-center w-20">
                    <span
                        className={clsx(
                            'flex-grow text-2xl font-bold leading-none',
                            'flex flex-col justify-center',
                            crossing.hasPassed && 'text-gray-600'
                        )}
                    >
                        {majorTime}
                    </span>
                    <span
                        className={clsx(
                            'text-sm font-bold',
                            crossing.hasPassed && 'text-gray-600'
                        )}
                    >
                        {minorTime}
                    </span>
                </div>
            </li>
        );
    };

    render = () => {
        const {isUpdating, mate, terminal, schedule} = this.state;
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
                    reload={this.updateSchedule}
                    isReloading={isUpdating}
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
