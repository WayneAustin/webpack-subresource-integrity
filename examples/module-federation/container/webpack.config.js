const { SubresourceIntegrityPlugin } = require("webpack-subresource-integrity");
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const expect = require("expect");
const deps = require('./package.json').dependencies;

class LoadRemotesPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('LoadRemotesPlugin', async (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).afterTemplateExecution.tapAsync('LoadRemotesPlugin',
        async (data, callback) => {
          const scriptTag = {
            tagName: 'script',
            attributes: {
              src: `http://localhost:8081/remoteEntry.js`,
              crossorigin: 'anonymous',
              integrity: 'sha256-8mVmOmUdZ9alUlb/mdmxe2KTdglrY+IvPXp8P0vSvb8='
            }
          };
          // note: .unshift so bundle.js is last to be served
          data.headTags.unshift(scriptTag);
          callback();
        });
    });
  }
};

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
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'container',
      library: { type: 'var', name: 'container' },
      filename: 'mfe/remoteEntry.js',
      remotes: {
        example: 'example',
      },
      shared: {
        ...deps,
        'react': { singleton: true, eager: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, eager: true, requiredVersion: deps['react-dom'] },
      }
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html'
    }),
    new LoadRemotesPlugin(),
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
