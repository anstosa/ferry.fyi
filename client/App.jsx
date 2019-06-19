import './app.scss';
import {createBrowserHistory} from 'history';
import {Redirect, Route, Router} from 'react-router-dom';
import {ToastContainer} from 'react-toastify';
import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class App extends Component {
    static propTypes = {
        basename: PropTypes.string,
        children: PropTypes.node,
    };

    constructor(props) {
        super(props);
        const {basename} = props;
        this.history = createBrowserHistory({basename});
    }

    render = () => (
        <Router history={this.history}>
            <Route
                path="/:url*"
                exact
                strict
                render={(props) => (
                    <Redirect to={`${props.location.pathname}/`} />
                )}
            />
            <div
                className="
                    application h-full
                    flex justify-center
                "
            >
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
                Hello World
            </div>
        </Router>
    );
}
