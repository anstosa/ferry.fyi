import {getSchedule} from '../schedule';
import {getTerminal} from '../terminals';
import {Helmet} from 'react-helmet';
import _ from 'lodash';
import Cameras from './Cameras';
import clsx from 'clsx';
import Crossing from './Crossing/Crossing';
import Header from '../Header';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import scrollIntoView from 'scroll-into-view';
import Splash from '../Splash';

export default class Schedule extends Component {
    static propTypes = {
        match: PropTypes.object.isRequired,
    };

    hasScrolled = false;

    state = {terminal: null, mate: null, schedule: [], isUpdating: false};

    componentDidMount = () => {
        const {match} = this.props;
        const {slug} = match.params;
        this.setTerminal(slug);
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
        localStorage.savedSlug = slug;
        const terminal = await getTerminal(slug);
        const savedMateId = _.get(localStorage, 'savedMateId');
        let mate;
        if (
            _.isUndefined(savedMateId) ||
            !_.find(terminal.mates, {id: _.toInteger(savedMateId)})
        ) {
            mate = _.first(terminal.mates);
        } else {
            mate = await getTerminal(_.toInteger(savedMateId));
        }
        this.setState({mate, terminal});
        await this.updateSchedule();
    };

    setMate = async (mate) => {
        this.setState({mate, schedule: null});
        localStorage.savedMateId = mate.id;
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
        const sailings = _.map(schedule, (crossing) => (
            <Crossing
                crossing={crossing}
                key={crossing.time}
                schedule={schedule}
                setElement={(element) => {
                    if (crossing.hasPassed) {
                        this.lastPassed = element;
                    }
                }}
            />
        ));
        return <ul>{sailings}</ul>;
    };

    render = () => {
        const {isUpdating, mate, terminal, schedule} = this.state;
        const {match} = this.props;
        if (!terminal || !mate || !schedule) {
            return <Splash />;
        }
        return (
            <>
                {this.renderMeta()}
                <Header
                    match={match}
                    terminal={terminal}
                    mate={mate}
                    setMate={this.setMate}
                    reload={this.updateSchedule}
                    isReloading={isUpdating}
                />
                <article
                    className={clsx(
                        'w-full',
                        'flex-grow',
                        'flex flex-col items-center'
                    )}
                >
                    <div
                        className={clsx(
                            'w-full max-w-6xl',
                            'lg:border-l lg:border-r border-gray-500'
                        )}
                    >
                        {this.renderSchedule()}
                    </div>
                </article>
                <Cameras terminal={terminal} />
            </>
        );
    };
}
