import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";
import { TailwindConfig } from "tailwindcss/tailwind-config";
import CopyPlugin from "copy-webpack-plugin";
import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import EslintPlugin from "eslint-webpack-plugin";
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

const { theme } = resolveConfig(tailwindConfig as unknown as TailwindConfig);

const colors = theme.colors as any;

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

console.info("#### Environment Variables ####");
console.dir({
  BASE_URL: process.env.BASE_URL,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_CLIENT_AUDIENCE: process.env.AUTH0_CLIENT_AUDIENCE,
  AUTH0_CLIENT_REDIRECT: process.env.AUTH0_CLIENT_REDIRECT,
});
console.info("###############################");
console.log();

const isDevelopment = process.env.NODE_ENV === Mode.development;

if (!process.env.BASE_URL) {
  throw new Error("Must set BASE_URL");
}

module.exports = {
  // don't allow any errors in production
  bail: !isDevelopment,
  mode: isDevelopment ? Mode.development : Mode.production,
  context: __dirname,
  cache: { type: "filesystem" },
  entry: "index.tsx",
  output: {
    path: path.resolve(__dirname, "../dist/client"),
    filename: "[name].[chunkhash].js",
    publicPath: `/`,
  },
  devtool: isDevelopment ? "eval-cheap-module-source-map" : false,
  devServer: {
    historyApiFallback: true,
    hot: true,
    host: "0.0.0.0",
    port: 3000,
    devMiddleware: {
      publicPath: process.env.ROOT_URL,
    },
    proxy: {
      context: [
        // API
        "/api",
        // social auth endpoints
        "/auth",
      ],
      target: `http://localhost:${process.env.PORT}/`,
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
      logo: "static/images/icon.png",
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
      GTM_CONTAINER_ID: process.env.GTM_CONTAINER_ID,
      description: DESCRIPTION,
      template: "static/index.html",
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
    new webpack.EnvironmentPlugin({
      GTM_CONTAINER_ID: null,
      BASE_URL: undefined,
      MAPBOX_ACCESS_TOKEN: undefined,
      GOOGLE_ANALYTICS: null,
      LOG_LEVEL: "INFO",
      NODE_ENV: "development",
      AUTH0_DOMAIN: undefined,
      AUTH0_CLIENT_ID: undefined,
      AUTH0_CLIENT_AUDIENCE: undefined,
      AUTH0_CLIENT_REDIRECT: undefined,
      SENTRY_DSN: null,
    }),
    new CopyPlugin({
      patterns: [
        {
          from: "static/images/icon_maskable.png",
          to: path.resolve(__dirname, "../dist/client/assets/"),
        },
        {
          from: "static/images/icon_monochrome.png",
          to: path.resolve(__dirname, "../dist/client/assets/"),
        },
        {
          from: "assetlinks.json",
          to: path.resolve(__dirname, "../dist/client/.well-known/"),
        },
      ],
    }),
    new EslintPlugin({
      files: ["**/*.(ts|tsx)", "../shared/**/*.(ts|tsx)"],
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
        test: /\.(ttf|jpg|jpeg|gif|png|otf|woff|woff2|eot)$/,
        include: [path.resolve(__dirname)],
        use: {
          loader: "file-loader",
          options: {
            name: "[name].[ext]",
          },
        },
      },
      {
        test: /\.svg$/,
        include: [path.resolve(__dirname)],
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
        include: [path.resolve(__dirname)],
        use: [
          { loader: "style-loader" },
          { loader: "css-loader", options: { modules: true } },
        ],
      },
      {
        test: /\.(sa|sc)ss$/,
        include: [path.resolve(__dirname)],
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
        test: /\.(ts|tsx)$/,
        include: [
          path.resolve(__dirname),
          path.resolve(__dirname, "../shared"),
        ],
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
      },
    ],
  },
};
