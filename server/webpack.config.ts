import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import nodeExternals from "webpack-node-externals";
import path from "path";
import TsConfigPathsPlugin from "tsconfig-paths-webpack-plugin";

module.exports = {
  mode: "production",
  context: __dirname,
  cache: { type: "filesystem" },
  entry: "server.ts",
  externals: [nodeExternals()],
  output: {
    path: path.resolve(__dirname, "../dist/server"),
    filename: "server.js",
  },
  target: "node",
  watchOptions: {
    ignored: "../dist/.*",
  },
  plugins: [new ForkTsCheckerWebpackPlugin()],
  resolve: {
    symlinks: false,
    extensions: [".js", ".ts", ".json"],
    plugins: [
      new TsConfigPathsPlugin({
        configFile: path.resolve(__dirname, "tsconfig.json"),
      }),
    ],
  },
  module: {
    rules: [
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
