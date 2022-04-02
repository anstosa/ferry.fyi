import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";
import { Configuration as DevServerConfiguration } from "webpack-dev-server";
import { ESBuildMinifyPlugin } from "esbuild-loader";
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
import SentryPlugin from "@sentry/webpack-plugin";
import StyleLintPlugin from "stylelint-webpack-plugin";
import tailwindConfig from "../tailwind.config.js";
import TsConfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import webpack, {
  Configuration as BaseConfiguration,
  DefinePlugin,
} from "webpack";
import WebpackShellPlugin from "webpack-shell-plugin-next";
import WorkboxPlugin from "workbox-webpack-plugin";

type Configuration = BaseConfiguration & DevServerConfiguration;

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

console.info("#### ENVIRONMENT VARIABLES ####");
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
const isProduction = process.env.NODE_ENV === Mode.production;

const ENABLE_SIZE_DEBUG =
  Boolean(process.env.ENABLE_SIZE_DEBUG === "FALSE") ?? false;
const ENABLE_MINIMIZE = Boolean(process.env.MINIMIZE === "TRUE") ?? true;
const ENABLE_SOURCE_MAPS =
  Boolean(process.env.ENABLE_SOURCE_MAPS === "TRUE") ?? isDevelopment;

process.traceDeprecation = true;

if (!process.env.BASE_URL) {
  throw new Error("Must set BASE_URL");
}
const environmentPlugin = new webpack.EnvironmentPlugin({
  AUTH0_CLIENT_AUDIENCE: undefined,
  AUTH0_CLIENT_ID: undefined,
  AUTH0_CLIENT_REDIRECT: undefined,
  AUTH0_DOMAIN: undefined,
  BASE_URL: undefined,
  FIREBASE_API_KEY: undefined,
  FIREBASE_APP_ID: undefined,
  FIREBASE_PROJECT_ID: undefined,
  FIREBASE_SENDER_ID: undefined,
  FIREBASE_VAPID_KEY: undefined,
  GOOGLE_ANALYTICS: null,
  GTM_CONTAINER_ID: null,
  LOG_LEVEL: "INFO",
  MAPBOX_ACCESS_TOKEN: undefined,
  NODE_ENV: "development",
  SENTRY_DSN: null,
});

const config: Configuration = {
  // don't allow any errors in production
  bail: isProduction,
  mode: isDevelopment ? Mode.development : Mode.production,
  cache: {
    type: "filesystem",
    buildDependencies: { config: [__filename] },
    cacheDirectory: path.resolve(__dirname, "../.cache"),
    name: `${process.env.BUILD_CACHE}-${__filename}-${process.env.NODE_ENV}`,
  },
  context: __dirname,
  entry: "index.tsx",
  experiments: {
    backCompat: true,
  },
  output: {
    path: path.resolve(__dirname, "../dist/client"),
    filename: "[name].[chunkhash].js",
    publicPath: `/`,
  },
  devtool: ENABLE_SOURCE_MAPS ? "eval-cheap-module-source-map" : "source-map",
  devServer: {
    historyApiFallback: true,
    hot: true,
    host: "0.0.0.0",
    client: {
      overlay: false,
    },
    port: 3000,
    static: path.resolve(__dirname),
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
    minimize: ENABLE_MINIMIZE && isProduction,
    minimizer: [
      new ESBuildMinifyPlugin({ target: "ES2015" }),
      new CssMinimizerPlugin(),
    ],
    splitChunks: {
      chunks: "all",
      name: false,
    },
  },
  plugins: [
    ...(isProduction
      ? [
          new SentryPlugin({
            include: path.resolve(__dirname, "../dist/client"),
            ignoreFile: ".sentrycliignore",
            ignore: ["node_modules", "webpack.config.ts"],
            project: "ferry-fyi",
            org: "ferry-fyi",
            release: `ferry-fyi@${JSON.stringify(
              process.env.HEROKU_RELEASE_VERSION || "DEVELOPMENT"
            )}`,
          }),
        ]
      : []),
    ...(process.env.CACHE_NAME === "android"
      ? [
          new WebpackShellPlugin({
            onBuildEnd: {
              scripts: ["npx cap sync"],
              blocking: true,
            },
          }),
        ]
      : []),
    ...(ENABLE_SIZE_DEBUG
      ? [
          new BundleAnalyzerPlugin({
            analyzerMode: isDevelopment ? "server" : "static",
          }),
        ]
      : []),
    new FaviconsPlugin({
      logo: path.resolve(__dirname, "static/images/icon.png"),
      cache: true,
      mode: "webapp",
      favicons: {
        appName: NAME,
        appDescription: DESCRIPTION,
        developerName: "Ansel Santosa",
        developerURL: "https://santosa.dev",
        background: COLOR,
        theme_color: COLOR,
        logging: true,
        icons: {
          android: isProduction,
          appleIcon: isProduction,
          appleStartup: isProduction,
          favicons: true,
          windows: isProduction,
          yandex: isProduction,
        },
        shortcuts: [
          {
            name: "Schedule",
            description: "View the schedule",
            url: "/",
            icon: path.resolve(
              __dirname,
              "static/images/icons/solid/calendar-alt.svg"
            ),
          },
          {
            name: "Tickets",
            description: "View saved tickets",
            url: "/tickets",
            icon: path.resolve(
              __dirname,
              "static/images/icons/solid/barcode-alt.svg"
            ),
          },
        ],
      },
      manifest: path.resolve(__dirname, "manifest.json"),
    } as any),
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
    new DefinePlugin({
      "process.env.COMMITHASH": JSON.stringify(
        process.env.HEROKU_RELEASE_VERSION || "DEVELOPMENT"
      ),
    }),
    environmentPlugin,
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
      ],
    }) as any,
    new EslintPlugin({
      files: ["**/*.(ts|tsx)", "../shared/**/*.(ts|tsx)"],
      exclude: ["node_modules"],
    }),
    new WorkboxPlugin.InjectManifest({
      swSrc: "service-worker.ts",
      swDest: "service-worker.js",
      webpackCompilationPlugins: [environmentPlugin],
    }),
    ...(isDevelopment
      ? [
          new LiveReloadPlugin({
            appendScriptTag: true,
          }),
        ]
      : []),
  ],
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
        exclude: /node_modules/,
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
        exclude: /node_modules/,
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
        exclude: /node_modules/,
        use: [
          { loader: "style-loader" },
          { loader: "css-loader", options: { modules: true } },
        ],
      },
      {
        test: /\.(sa|sc)ss$/,
        include: [path.resolve(__dirname)],
        exclude: /node_modules/,
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
        exclude: /node_modules/,
        use: {
          loader: "esbuild-loader",
          options: {
            loader: "tsx",
            target: "ES2015",
          },
        },
      },
    ],
  },
};

module.exports = config;
