// dotenv config has to happen before other imports
// because some of them rely on environment variables (like ./config/passport)
import { config } from "dotenv";
import path from "path";
config({ path: path.join(__dirname, "../.env") });

/* eslint-disable @typescript-eslint/no-var-requires */
const DotenvPlugin = require("dotenv-webpack");
const LiveReloadPlugin = require("webpack-livereload-plugin");
const RobotstxtPlugin = require("robotstxt-webpack-plugin");
const WebappPlugin = require("webapp-webpack-plugin");
/* eslint-enable @typescript-eslint/no-var-requires */

import HtmlPlugin from "html-webpack-plugin";
import merge from "webpack-merge";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import StyleLintPlugin from "stylelint-webpack-plugin";
import webpack from "webpack";
import WorkboxPlugin from "workbox-webpack-plugin";

const NAME = "Ferry FYI";
const TITLE = `${NAME} - Seattle Area Ferry Schedule and Tracker`;
const DESCRIPTION =
  "A ferry schedule and tracker for the greater Seattle area.";
const COLOR = "#016f52"; // sync with client/tailwind.config.js

enum Mode {
  development = "development",
  production = "production",
  none = "none",
}

const commonConfig = merge([
  {
    entry: "./client/index.tsx",
    output: {
      path: path.resolve(__dirname, "../dist/client"),
      filename: "client.js",
      publicPath: "/",
    },
    plugins: [
      new WebappPlugin({
        logo: "./client/images/icon.png",
        favicons: {
          appName: NAME,
          appDescription: DESCRIPTION,
          developerName: "Ansel Santosa",
          developerURL: "https://santosa.dev",
          background: COLOR,
          theme_color: COLOR,
        },
      }),
      new RobotstxtPlugin({
        policy: [
          {
            userAgent: "*",
            disallow: "",
          },
        ],
        host: process.env.BASE_URL,
      }),
      new HtmlPlugin({
        description: DESCRIPTION,
        template: "./client/index.html",
        title: TITLE,
        url: process.env.BASE_URL,
        color: COLOR,
      }),
      new WorkboxPlugin.InjectManifest({
        swSrc: "./client/service-worker.ts",
      }),
      new StyleLintPlugin(),
      new MiniCssExtractPlugin({
        filename: "[name].css",
        chunkFilename: "[id].css",
      }),
    ],
    resolve: {
      extensions: [".css", ".scss", ".js", ".jsx", ".ts", ".tsx"],
    },
    module: {
      rules: [
        {
          test: /\.(ttf|jpe?g|gif|svg|png|otf|woff|woff2|eot)$/,
          loader: "file-loader?name=[name].[ext]",
        },
        {
          test: /\.css$/,
          use: [
            { loader: "style-loader" },
            { loader: "css-loader", options: { modules: true } },
          ],
        },
        {
          test: /\.(sa|sc)ss$/,
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
              options: {
                hmr: process.env.NODE_ENV === Mode.development,
              },
            },
            { loader: "css-loader", options: { importLoaders: 1 } },
            "postcss-loader",
            "sass-loader",
          ],
        },
        {
          enforce: "pre",
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "ts-loader",
        },
        {
          enforce: "pre",
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "eslint-loader",
          options: {
            failOnError: true,
          },
        },
      ],
    },
  },
]);

const productionConfig = merge([
  {
    plugins: [
      new webpack.EnvironmentPlugin([
        "BASE_URL",
        "GOOGLE_ANALYTICS",
        "LOG_LEVEL",
        "NODE_ENV",
      ]),
    ],
  },
]);

const developmentConfig = merge([
  {
    devtool: "inline-source-map",
    watchOptions: {
      ignored: "../dist/.*",
    },
    plugins: [
      new DotenvPlugin(),
      new LiveReloadPlugin({
        appendScriptTag: true,
      }),
    ],
  },
]);

module.exports = (mode: Mode | undefined) => {
  if (mode === Mode.production) {
    return merge(commonConfig, productionConfig, { mode });
  } else {
    return merge(commonConfig, developmentConfig, { mode });
  }
};
