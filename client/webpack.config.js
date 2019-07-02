require('dotenv').config();
const DotenvPlugin = require('dotenv-webpack');
const HtmlPlugin = require('html-webpack-plugin');
const LiveReloadPlugin = require('webpack-livereload-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const StyleLintPlugin = require('stylelint-webpack-plugin');
const merge = require('webpack-merge');
const path = require('path');

const TITLE = 'Ferry FYI';
const DESCRIPTION = 'A better tracker for the Washington State Ferry system';

const commonConfig = merge([
    {
        entry: './client/index.js',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'client.js',
            publicPath: '/',
        },
        plugins: [
            new DotenvPlugin(),
            new HtmlPlugin({
                description: DESCRIPTION,
                template: './client/index.html',
                title: TITLE,
                url: process.env.BASE_URL,
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

const productionConfig = merge([{}]);

const developmentConfig = merge([
    {
        devtool: 'inline-source-map',
        plugins: [new LiveReloadPlugin({appendScriptTag: true})],
    },
]);

module.exports = (mode) => {
    if (mode === 'production') {
        return merge(commonConfig, productionConfig, {mode});
    } else {
        return merge(commonConfig, developmentConfig, {mode});
    }
};
