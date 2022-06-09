const { SubresourceIntegrityPlugin } = require("webpack-subresource-integrity");
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const expect = require("expect");
const deps = require('./package.json').dependencies;

module.exports = {
  mode: 'production',
  entry: {
    index: "./index.js",
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|tsx|ts)$/,
        exclude: /node_modules/,
        loader: 'ts-loader',
      },
    ]
  },
  output: {
    crossOriginLoading: "anonymous",
    publicPath: 'http://localhost:8081/',
    filename: 'index.js'
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'example',
      filename: 'remoteEntry.js',
      exposes: {
        './Remote': './bootstrap'
      },
      shared: {
        ...deps,
        react: { singleton: true, eager: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, eager: true, requiredVersion: deps['react-dom'] },
      }
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html'
    }),
    new SubresourceIntegrityPlugin({
      hashFuncNames: ["sha256"],
      enabled: true,
    }),
    {
      apply: (compiler) => {
        compiler.hooks.done.tap("wsi-test", (stats) => {
          expect(
            !stats.toJson().assets.find((asset) => asset.name == "index.js")
              .integrity
          ).not.toBeNull();
        });
      },
    },
  ],
};
