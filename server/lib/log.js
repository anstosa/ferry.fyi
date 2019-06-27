import {DateTime} from 'luxon';
import _ from 'lodash';
import colors from 'colors/safe';

colors.setTheme({
    debug: 'blue',
    error: 'red',
    info: 'green',
    warn: 'yellow',
});

let indent = 0;
let hasLineStarted = false;

function print(wrapper, isLine, ...messages) {
    if (hasLineStarted) {
        hasLineStarted = true;
    } else {
        const now = DateTime.local();
        process.stdout.write(`${now.toFormat('MMM d yyyy HH:mm')}  `);
        _.times(indent, () => process.stdout.write('  '));
    }
    _.each(messages, (message) => {
        process.stdout.write(wrapper(message));
    });
    if (isLine) {
        process.stdout.write('\n');
        hasLineStarted = false;
    }
}

export const startIndent = () => (indent += 1);
export const endIndent = () => (indent -= 1);

export const info = (...messages) => print(colors.info, true, ...messages);
export const warn = (...messages) => print(colors.warn, true, ...messages);
export const error = (...messages) => print(colors.error, true, ...messages);
export const debug = (...messages) => {
    if (!process.env.DEBUG) {
        return;
    }
    print(colors.debug, true, ...messages);
};
export const informing = (...messages) =>
    print(colors.info, false, ...messages);
export const warning = (...messages) => print(colors.warn, false, ...messages);
export const erroring = (...messages) =>
    print(colors.error, false, ...messages);
export const debugging = (...messages) => {
    if (!process.env.DEBUG) {
        return;
    }
    print(colors.debug, false, ...messages);
};
