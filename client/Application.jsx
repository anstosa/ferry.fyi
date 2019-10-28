import './app.scss';
import {BrowserRouter, Redirect, Route} from 'react-router-dom';
import {Settings} from 'luxon';
import {ToastContainer} from 'react-toastify';
import _ from 'lodash';
import Analytics from './lib/Analytics';
import React, {Component} from 'react';
import Schedule from './Schedule/Schedule';
import Splash from './Splash';

Settings.defaultZoneName = 'America/Los_Angeles';

export default class Application extends Component {
    state = {
        isLoading: false,
        route: null,
    };

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
        const terminalSlug = _.get(localStorage, 'terminalSlug');
        const mateSlug = _.get(localStorage, 'mateSlug');
        let defaultRoute = '/clinton';
        if (terminalSlug) {
            defaultRoute = `/${terminalSlug}/${mateSlug}`;
        }
        return (
            <BrowserRouter>
                <Analytics>
                    <Route
                        path="/:terminalSlug/:mateSlug?"
                        component={Schedule}
                    />
                    <Route
                        path="/"
                        exact
                        render={() => (
                            <Redirect to={{pathname: defaultRoute}} />
                        )}
                    />
                    {isLoading && <Splash />}
                </Analytics>
            </BrowserRouter>
        );
    };
}
