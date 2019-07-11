require('dotenv').config();
const DotenvPlugin = require('dotenv-webpack');
const HtmlPlugin = require('html-webpack-plugin');
const LiveReloadPlugin = require('webpack-livereload-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const RobotstxtPlugin = require('robotstxt-webpack-plugin');
const StyleLintPlugin = require('stylelint-webpack-plugin');
const WebappPlugin = require('webapp-webpack-plugin');
const WorkboxPlugin = require('workbox-webpack-plugin');
const merge = require('webpack-merge');
const path = require('path');
const webpack = require('webpack');

const TITLE = 'Ferry FYI - Schedule and Tracker for the Greater Seattle Area';
const DESCRIPTION =
    'A ferry schedule and tracker for the greater Seattle area.';
const COLOR = '#00735a';

const commonConfig = merge([
    {
        entry: './client/index.js',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'client.js',
            publicPath: '/',
        },
        plugins: [
            new WebappPlugin({
                logo: './client/images/icon.png',
                favicons: {
                    appName: TITLE,
                    appDescription: DESCRIPTION,
                    developerName: 'Ansel Santosa',
                    developerURL: 'https://santosa.dev',
                    background: COLOR,
                    theme_color: COLOR,
                },
            }),
            new RobotstxtPlugin({
                policy: [
                    {
                        userAgent: '*',
                        disallow: '',
                    },
                ],
                host: process.env.BASE_URL,
            }),
            new HtmlPlugin({
                description: DESCRIPTION,
                template: './client/index.html',
                title: TITLE,
                url: process.env.BASE_URL,
                color: COLOR,
            }),
            new WorkboxPlugin.InjectManifest({
                swSrc: './client/service-worker.js',
            }),
            new StyleLintPlugin(),
            new MiniCssExtractPlugin({
                filename: '[name].css',
                chunkFilename: '[id].css',
            }),
        ],
        resolve: {
            extensions: ['.css', '.scss', '.js', '.jsx'],
        },
        module: {
            rules: [
                {
                    test: /\.(ttf|jpe?g|gif|svg|png|otf|woff|woff2|eot)$/,
                    loader: 'file-loader?name=[name].[ext]',
                },
                {
                    test: /\.css$/,
                    use: [
                        {loader: 'style-loader'},
                        {loader: 'css-loader', options: {modules: true}},
                    ],
                },
                {
                    test: /\.(sa|sc)ss$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader,
                            options: {
                                hmr: process.env.NODE_ENV === 'development',
                            },
                        },
                        {loader: 'css-loader', options: {importLoaders: 1}},
                        'postcss-loader',
                        'sass-loader',
                    ],
                },
                {
                    enforce: 'pre',
                    test: /\.jsx?$/,
                    exclude: /node_modules/,
                    loader: 'eslint-loader',
                    options: {
                        failOnError: true,
                    },
                },
                {
                    test: /\.jsx?$/,
                    exclude: /node_modules/,
                    loader: 'babel-loader',
                },
            ],
        },
    },
]);

const productionConfig = merge([
    {
        plugins: [
            new webpack.EnvironmentPlugin([
                'BASE_URL',
                'DEBUG',
                'GOOGLE_ANALYTICS',
            ]),
        ],
    },
]);

const developmentConfig = merge([
    {
        devtool: 'inline-source-map',
        watchOptions: {
            ignored: './**/dist/.*',
        },
        plugins: [
            new DotenvPlugin(),
            new LiveReloadPlugin({
                appendScriptTag: true,
            }),
        ],
    },
]);

module.exports = (mode) => {
    if (mode === 'production') {
        return merge(commonConfig, productionConfig, {mode});
    } else {
        return merge(commonConfig, developmentConfig, {mode});
    }
};
