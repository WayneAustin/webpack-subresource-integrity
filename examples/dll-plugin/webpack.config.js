const { SubresourceIntegrityPlugin } = require("webpack-subresource-integrity");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebpackBeforeBuildPlugin = require("before-build-webpack");
const webpack = require("webpack");
const path = require("path");
const { readFileSync } = require("fs");
const { RunInPuppeteerPlugin } = require("wsi-test-helper");

module.exports = {
  resolve: {
    extensions: [".js", ".jsx"],
  },
  entry: {
    alpha: ["./alpha", "./a"],
    beta: ["./beta", "./b", "./c"],
  },
  output: {
    filename: "MyDll.[name].js",
    library: "[name]_[fullhash]",
  },
  plugins: [
    new webpack.DllPlugin({
      path: path.join(__dirname, "dist", "[name]-manifest.json"),
      name: "[name]_[fullhash]",
    }),
    new WebpackBeforeBuildPlugin(
      function (_stats, callback) {
        webpack(
          {
            mode: "production",
            entry: {
              index: "./index.js",
            },
            output: {
              path: path.join(__dirname, "dist"),
              crossOriginLoading: "anonymous",
            },
            plugins: [
              new webpack.DllReferencePlugin({
                context: path.join(__dirname),
                manifest: require(path.join(
                  __dirname,
                  "dist/alpha-manifest.json"
                )), // eslint-disable-line
              }),
              new webpack.DllReferencePlugin({
                scope: "beta",
                manifest: require(path.join(
                  __dirname,
                  "dist/beta-manifest.json"
                )), // eslint-disable-line
                extensions: [".js", ".jsx"],
              }),
              new HtmlWebpackPlugin(),

              {
                apply: (compiler) => {
                  compiler.hooks.thisCompilation.tap(
                    "wsi-test",
                    (compilation) => {
                      const hooks = HtmlWebpackPlugin.getHooks(compilation);

                      hooks.alterAssetTags.tapPromise(
                        "wsi-test",
                        async (data) => {
                          ["MyDll.alpha.js", "MyDll.beta.js"].forEach((src) => {
                            data.assetTags.scripts.unshift({
                              tagName: "script",
                              voidTag: false,
                              attributes: { defer: true, src },
                            });
                          });
                          return data;
                        }
                      );
                    }
                  );
                },
              },

              new SubresourceIntegrityPlugin({
                hashFuncNames: ["sha256", "sha384"],
                enabled: true,
              }),

              new RunInPuppeteerPlugin(),
            ],
          },
          function afterEmit(err, stats) {
            if (err || stats.hasErrors() || stats.hasWarnings()) {
              callback(err || new Error(stats.toString({ reason: true })));
            } else {
              callback();
            }
          }
        );
      },
      ["done"]
    ),
  ],
};
