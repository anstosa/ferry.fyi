import '@babel/polyfill';
import App from './App';
import React from 'react';
import ReactDOM from 'react-dom';

window.addEventListener('error', window.onerror);
window.addEventListener('unhandledrejection', (error) => {
    window.onerror(error.reason.message);
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
    const root = document.querySelector('#root');
    const app = React.createElement(App);
    ReactDOM.render(app, root);
});
