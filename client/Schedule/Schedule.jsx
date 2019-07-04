import {getSchedule} from '../schedule';
import {getSlug, getTerminal} from '../terminals';
import {withRouter} from 'react-router';
import _ from 'lodash';
import clsx from 'clsx';
import Crossing from './Crossing/Crossing';
import Footer from './Footer';
import Header from '../Header';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import scrollIntoView from 'scroll-into-view';
import Splash from '../Splash';

class Schedule extends Component {
    static propTypes = {
        history: PropTypes.object.isRequired,
        location: PropTypes.object.isRequired,
        match: PropTypes.object.isRequired,
    };

    hasScrolled = false;

    currentCrossing = null;

    state = {terminal: null, mate: null, schedule: [], isUpdating: false};

    componentDidMount = () => {
        const {match} = this.props;
        const {terminalSlug, mateSlug} = match.params;
        this.setRoute(terminalSlug, mateSlug);
        this.checkScroll();
        this.scheduleTick = setInterval(this.updateSchedule, 10 * 1000);
    };

    componentWillUnmount = () => {
        clearInterval(this.scheduleTick);
    };

    componentDidUpdate(prevProps, prevState) {
        const {schedule} = this.state;
        const {match} = this.props;
        const {terminalSlug, mateSlug} = match.params;
        if (terminalSlug !== prevProps.match.params.terminalSlug) {
            this.setRoute(terminalSlug, mateSlug);
        }
        this.checkScroll();
    }

    checkScroll = () => {
        if (!this.hasScrolled && this.currentCrossing) {
            scrollIntoView(this.currentCrossing, {align: {top: 0.3}});
            this.hasScrolled = true;
        }
    };

    setRoute = async (terminalSlug, mateSlug) => {
        const {history, location} = this.props;
        this.setState({mate: null, schedule: null, terminal: null});
        this.hasScrolled = false;
        this.currentCrossing = null;
        const terminal = await getTerminal(terminalSlug);
        let mate;
        if (_.isObject(mateSlug)) {
            mate = mateSlug;
        } else if (_.isString(mateSlug)) {
            mate = await getTerminal(mateSlug);
        }
        if (!mate || !_.find(terminal.mates, {id: mate.id})) {
            mate = _.first(terminal.mates);
        }

        terminalSlug = getSlug(terminal.id);
        localStorage.terminalSlug = terminalSlug;
        mateSlug = getSlug(mate.id);
        localStorage.mateSlug = mateSlug;

        let path;
        if (terminal.mates.length === 1) {
            path = `/${terminalSlug}`;
        } else {
            path = `/${terminalSlug}/${mateSlug}`;
        }
        if (location.pathname !== path) {
            history.push(path);
        }
        this.setState({terminal, mate});
        await this.updateSchedule();
    };

    updateSchedule = async () => {
        const {terminal, mate} = this.state;
        if (!terminal || !mate) {
            return;
        }
        this.setState({isUpdating: true});
        const schedule = await getSchedule(terminal, mate);
        this.setState({isUpdating: false, schedule});
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
                    if (!this.currentCrossing && !crossing.hasPassed) {
                        this.currentCrossing = element;
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
                <Header
                    match={match}
                    terminal={terminal}
                    mate={mate}
                    setRoute={this.setRoute}
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
                <Footer terminal={terminal} />
            </>
        );
    };
}

const ScheduleWithRouter = withRouter(Schedule);
export default ScheduleWithRouter;
