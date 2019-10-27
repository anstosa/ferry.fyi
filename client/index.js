import '@babel/polyfill';
import {Workbox} from 'workbox-window';
import App from './App';
import React from 'react';
import ReactDOM from 'react-dom';

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
    const renderAll = () => {
        ReactDOM.render(app, root);
    };
    window.addEventListener('online', renderAll);
    window.addEventListener('offline', renderAll);
    renderAll();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const workbox = new Workbox('/service-worker.js');

        workbox.addEventListener('installed', (event) => {
            if (event.isUpdate) {
                window.location.reload();
            }
        });

        workbox.register();
    });
}
