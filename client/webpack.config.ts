import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";
import { createProxyMiddleware } from "http-proxy-middleware";
import { TailwindConfig } from "tailwindcss/tailwind-config";
import CopyPlugin from "copy-webpack-plugin";
import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import FaviconsPlugin from "favicons-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import HtmlPlugin from "html-webpack-plugin";
import LiveReloadPlugin from "webpack-livereload-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import path from "path";
import resolveConfig from "tailwindcss/resolveConfig";
import StyleLintPlugin from "stylelint-webpack-plugin";
import tailwindConfig from "../tailwind.config.js";
import TerserPlugin from "terser-webpack-plugin";
import TsConfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import webpack from "webpack";
import WorkboxPlugin from "workbox-webpack-plugin";

const {
  theme: { colors },
} = resolveConfig(tailwindConfig as unknown as TailwindConfig);

// Sync with server.ts
const NAME = "Ferry FYI";
const TITLE = `${NAME} - Seattle Area Ferry Schedule and Tracker`;

const DESCRIPTION =
  "A ferry schedule and tracker for the greater Seattle area.";
const COLOR = colors?.green.dark;

enum Mode {
  development = "development",
  production = "production",
  none = "none",
}

const isDevelopment = process.env.NODE_ENV === Mode.development;

if (!process.env.BASE_URL) {
  throw new Error("Must set BASE_URL");
}

module.exports = {
  // don't allow any errors in production
  bail: !isDevelopment,
  mode: isDevelopment ? Mode.development : Mode.production,
  context: __dirname,
  // cache: { type: "filesystem" },
  entry: "index.tsx",
  output: {
    path: path.resolve(__dirname, "../dist/client"),
    filename: "[name].[chunkhash].js",
    publicPath: `${process.env.BASE_URL}/`,
  },
  devtool: isDevelopment ? "eval-source-map" : false,
  devServer: {
    historyApiFallback: true,
    hot: true,
    port: 3000,
    devMiddleware: {
      publicPath: process.env.ROOT_URL,
    },
    onBeforeSetupMiddleware({ app }: any): void {
      app.use(
        createProxyMiddleware(
          [
            // API
            "/api",
            // social auth endpoints
            "/auth",
          ],
          {
            target: `http://localhost:${process.env.PORT}/`,
          }
        )
      );
    },
  },
  optimization: {
    runtimeChunk: true,
    minimize: !isDevelopment,
    minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
    splitChunks: {
      chunks: "all",
      name: false,
    },
  },
  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: isDevelopment ? "server" : "static",
    }),
    new FaviconsPlugin({
      logo: "images/icon.png",
      mode: "webapp",
      favicons: {
        appName: NAME,
        appDescription: DESCRIPTION,
        developerName: "Ansel Santosa",
        developerURL: "https://santosa.dev",
        background: COLOR,
        theme_color: COLOR,
      },
      manifest: path.resolve(__dirname, "manifest.json"),
    }),
    new ForkTsCheckerWebpackPlugin(),
    new HtmlPlugin({
      AW_TAG_ID: process.env.AW_TAG_ID,
      description: DESCRIPTION,
      template: "index.html",
      title: TITLE,
      url: process.env.BASE_URL,
      color: COLOR,
    }),
    new StyleLintPlugin({
      files: "**/*.(s(c|a)ss|css)",
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
      chunkFilename: "[id].css",
    }),
    new webpack.EnvironmentPlugin([
      "AW_TAG_ID",
      "BASE_URL",
      "MAPBOX_ACCESS_TOKEN",
      "GOOGLE_ANALYTICS",
      "LOG_LEVEL",
      "NODE_ENV",
    ]),
    new CopyPlugin({
      patterns: [
        {
          from: "images/icon_maskable.png",
          to: path.resolve(__dirname, "../dist/client/assets/"),
        },
        {
          from: "images/icon_monochrome.png",
          to: path.resolve(__dirname, "../dist/client/assets/"),
        },
        {
          from: "assetlinks.json",
          to: path.resolve(__dirname, "../dist/client/.well-known/"),
        },
      ],
    }),
    ...(isDevelopment
      ? [
          new LiveReloadPlugin({
            appendScriptTag: true,
          }),
        ]
      : [
          new WorkboxPlugin.InjectManifest({
            swSrc: "service-worker.ts",
          }),
        ]),
  ].filter(Boolean),
  resolve: {
    symlinks: false,
    extensions: [".css", ".scss", ".js", ".ts", ".tsx"],
    plugins: [
      new TsConfigPathsPlugin({
        configFile: path.resolve(__dirname, "tsconfig.json"),
      }),
    ],
  },
  module: {
    rules: [
      {
        test: /\.(ttf|jpe?g|gif|png|otf|woff|woff2|eot)$/,
        use: {
          loader: "file-loader",
          options: {
            name: "[name].[ext]",
          },
        },
      },
      {
        test: /\.svg$/,
        use: [
          {
            loader: "@svgr/webpack",
            options: {
              icon: true,
              svgProps: { fill: "currentColor", className: "inline-block" },
            },
          },
        ],
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
        include: [__dirname, path.resolve(__dirname, "../shared")],
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
      },
      {
        enforce: "pre",
        test: /\.tsx?$/,
        include: [__dirname, path.resolve(__dirname, "../shared")],
        loader: "eslint-loader",
        options: {
          failOnError: true,
        },
      },
    ],
  },
};
