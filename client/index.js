import '@babel/polyfill';
import {post} from './lib/api';
import App from './App';
import React from 'react';
import ReactDOM from 'react-dom';

function onError(error) {
    post('/error', {error});
}

window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', (error) => {
    onError(error.reason.message);
});

/**
 * @description Fires callback exactly once, after the document is loaded.
 */

const whenReady = (callback) => {
    if (document.readyState !== 'loading') {
        callback();
        return;
    }

    const handleContentLoaded = () => {
        callback();
        document.removeEventListener('DOMContentLoaded', handleContentLoaded);
    };

    document.addEventListener('DOMContentLoaded', handleContentLoaded);
};

whenReady(() => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = React.createElement(App);
    ReactDOM.render(app, root);
});
