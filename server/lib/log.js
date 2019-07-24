import {DateTime} from 'luxon';
import _ from 'lodash';
import colors from 'colors/safe';

colors.setTheme({
    debug: 'blue',
    error: 'red',
    info: 'green',
    warn: 'yellow',
});

function print(wrapper, ...messages) {
    const now = DateTime.local();
    process.stdout.write(`${now.toFormat('MMM d yyyy HH:mm')}  `);
    _.each(messages, (message) => {
        process.stdout.write(wrapper(message));
    });
    process.stdout.write('\n');
}

export const info = (...messages) => print(colors.info, ...messages);
export const warn = (...messages) => print(colors.warn, ...messages);
export const error = (...messages) => print(colors.error, ...messages);
export const debug = (...messages) => {
    if (!process.env.DEBUG) {
        return;
    }
    print(colors.debug, ...messages);
};
