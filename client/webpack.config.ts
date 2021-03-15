// dotenv config has to happen before other imports
// because some of them rely on environment variables (like ./config/passport)
import { config } from "dotenv";
import path from "path";
config({ path: path.join(__dirname, "../.env.local") });

import { filter } from "lodash";
import DotenvPlugin from "dotenv-webpack";
import FaviconsPlugin from "favicons-webpack-plugin";
import HtmlPlugin from "html-webpack-plugin";
import LiveReloadPlugin from "webpack-livereload-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import StyleLintPlugin from "stylelint-webpack-plugin";
import TsConfigPathsPlugin from "tsconfig-paths-webpack-plugin";
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

const isDevelopment = process.env.NODE_ENV === Mode.development;

module.exports = {
  mode: isDevelopment ? Mode.development : Mode.production,
  entry: "./client/index.tsx",
  output: {
    path: path.resolve(__dirname, "../dist/client"),
    filename: "client.js",
    publicPath: "/",
  },
  devtool: "inline-source-map",
  watchOptions: {
    ignored: "../dist/.*",
  },
  plugins: filter([
    new FaviconsPlugin({
      logo: "./client/images/icon.png",
      mode: "webapp",
      favicons: {
        appName: NAME,
        appDescription: DESCRIPTION,
        developerName: "Ansel Santosa",
        developerURL: "https://santosa.dev",
        background: COLOR,
        theme_color: COLOR,
      },
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
    new StyleLintPlugin({
      files: "(client|server)/**/*.(s(c|a)ss|css)",
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
      chunkFilename: "[id].css",
    }),
    new webpack.EnvironmentPlugin([
      "BASE_URL",
      "GOOGLE_ANALYTICS",
      "LOG_LEVEL",
      "NODE_ENV",
    ]),
    ...(isDevelopment
      ? [
          new DotenvPlugin({
            path: path.resolve(__dirname, "../.env.local"),
          }),
          new LiveReloadPlugin({
            appendScriptTag: true,
          }),
        ]
      : []),
  ]),
  resolve: {
    extensions: [".css", ".scss", ".js", ".jsx", ".ts", ".tsx"],
    plugins: [
      new TsConfigPathsPlugin({
        configFile: path.resolve(__dirname, "tsconfig.json"),
      }),
    ],
  },
  module: {
    rules: [
      {
        test: /\.(ttf|jpe?g|gif|svg|png|otf|woff|woff2|eot)$/,
        use: {
          loader: "file-loader",
          options: {
            name: "[name].[ext]",
          },
        },
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
};
