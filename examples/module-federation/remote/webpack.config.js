const { SubresourceIntegrityPlugin } = require("webpack-subresource-integrity");
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const expect = require("expect");

module.exports = {
  mode: 'development',
  entry: {
    index: "./index.js",
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react','@babel/preset-env'],
            plugins: ['@babel/plugin-transform-runtime'],
          }
        }
      }
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
      shared: ['react', 'react-dom'],
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
