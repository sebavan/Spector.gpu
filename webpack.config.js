const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: {
      contentScript: './src/extension/contentScript.ts',
      contentScriptProxy: './src/extension/contentScriptProxy.ts',
      background: './src/extension/background.ts',
      popup: './src/extension/popup/popup.tsx',
      result: './src/extension/resultView/result.tsx',
    },

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },

    devtool: isDev ? 'cheap-module-source-map' : false,

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@core': path.resolve(__dirname, 'src/core'),
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@extension': path.resolve(__dirname, 'src/extension'),
      },
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                declaration: false,
                declarationMap: false,
              },
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.s?css$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            'sass-loader',
          ],
        },
      ],
    },

    plugins: [
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),

      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/extension/popup/popup.html'),
        filename: 'popup.html',
        chunks: ['popup'],
      }),

      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'src/extension/resultView/result.html'),
        filename: 'result.html',
        chunks: ['result'],
      }),

      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src/extension/manifest.json'),
            to: 'manifest.json',
          },
          {
            from: path.resolve(__dirname, 'src/extension/icons'),
            to: 'icons',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],

    optimization: {
      splitChunks: {
        chunks(chunk) {
          // Content scripts and background MUST be self-contained (no code splitting).
          // Only allow chunk splitting for the React UI entries.
          return chunk.name === 'popup' || chunk.name === 'result';
        },
      },
    },
  };
};
