const path = require('path');
const HtmlPlugin = require('html-webpack-plugin');

module.exports = {
    entry: './src/index.ts',
    devtool: 'inline-source-map',
    watch: true,
    output: {
      path: path.resolve('dist'),
      filename: 'index.js',
    },
    resolve: {
        extensions: [".ts", ".js"]
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    plugins: [
        new HtmlPlugin({
            template: './src/index.html',
            inject: true
        })
    ]
  };