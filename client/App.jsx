import './app.scss';
import {createBrowserHistory} from 'history';
import {Redirect, Route, Router} from 'react-router-dom';
import {ToastContainer} from 'react-toastify';
import _ from 'lodash';
import React, {Component} from 'react';
import Schedule from './Schedule/Schedule';
import Splash from './Splash';

export default class App extends Component {
    state = {
        isLoading: false,
        route: null,
    };

    constructor(props) {
        super(props);
        this.history = createBrowserHistory();
    }

    renderToast = () => (
        <ToastContainer
            toastClassName="rounded py-4 px-6"
            position="top-right"
            autoClose={7000}
            hideProgressBar={false}
            newestOnTop={true}
            closeOnClick
            rtl={false}
            pauseOnVisibilityChange
            draggable
            pauseOnHover
        />
    );

    render = () => {
        const {isLoading} = this.state;
        const defaultRoute = _.get(localStorage, 'savedSlug', 'clinton');
        return (
            <Router history={this.history}>
                <Route path="/:slug" component={Schedule} />
                <Route
                    path="/"
                    exact
                    render={() => (
                        <Redirect to={{pathname: `/${defaultRoute}`}} />
                    )}
                />
                {isLoading && <Splash />}
            </Router>
        );
    };
}
