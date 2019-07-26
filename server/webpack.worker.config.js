const nodeExternals = require('webpack-node-externals');
const merge = require('webpack-merge');
const path = require('path');

const commonConfig = merge([
    {
        target: 'node',
        externals: [nodeExternals()],
        entry: './server/worker.js',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'worker.js',
        },
    },
]);

const productionConfig = merge([{}]);

const developmentConfig = merge([{}]);

module.exports = (mode) => {
    if (mode === 'production') {
        return merge(commonConfig, productionConfig, {mode});
    } else {
        return merge(commonConfig, developmentConfig, {mode});
    }
};
