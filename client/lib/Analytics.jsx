import {Component} from 'react';
import {PropTypes} from 'prop-types';
import {withRouter} from 'react-router';
import ReactGA from 'react-ga';

ReactGA.initialize(process.env.GOOGLE_ANALYTICS);

class Analytics extends Component {
    static propTypes = {
        children: PropTypes.node,
        history: PropTypes.object.isRequired,
    };

    componentDidMount() {
        this.sendPageView(this.props.history.location);
        this.props.history.listen(this.sendPageView);
    }

    sendPageView(location) {
        ReactGA.set({page: location.pathname});
        ReactGA.pageview(location.pathname);
    }

    render() {
        return this.props.children;
    }
}

const AnalyticsWithRouter = withRouter(Analytics);
export default AnalyticsWithRouter;
