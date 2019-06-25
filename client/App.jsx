import './app.scss';
import {createBrowserHistory} from 'history';
import {Helmet} from 'react-helmet';
import {Redirect, Route, Router} from 'react-router-dom';
import {ToastContainer} from 'react-toastify';
import React, {Component} from 'react';
import Schedule from './Schedule';
import Splash from './Splash';

const TITLE = 'Ferry FYI';
const DESCRIPTION = 'A better WSF tracker';
const IMAGE = '';

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
        return (
            <Router history={this.history}>
                <Helmet>
                    <meta charSet="utf-8" />
                    <title>Ferry FYI</title>
                    <link rel="canonical" href={process.env.BASE_URL} />

                    <meta name="twitter:card" content="summary_large_image" />
                    <meta name="twitter:site" content="@FerryFYI" />
                    <meta name="twitter:title" content={TITLE} />
                    <meta name="twitter:description" content={DESCRIPTION} />
                    <meta name="twitter:image" content={IMAGE} />

                    <meta property="og:url" content={process.env.BASE_URL} />
                    <meta property="og:type" content="website" />
                    <meta property="og:title" content={TITLE} />
                    <meta property="og:description" content={DESCRIPTION} />
                    <meta property="og:image" content={IMAGE} />

                    <meta itemProp="name" content={TITLE} />
                    <meta itemProp="description" content={DESCRIPTION} />
                    <meta itemProp="image" content={IMAGE} />
                </Helmet>
                <Route path="/:slug" component={Schedule} />
                <Route
                    path="/"
                    exact
                    render={() => <Redirect to={{pathname: '/clinton'}} />}
                />
                {isLoading && <Splash />}
            </Router>
        );
    };
}
