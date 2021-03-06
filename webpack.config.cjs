const path = require('path');
const HtmlPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const production = process.env.NODE_ENV == "production";
console.log(production);
module.exports = [{
    entry: './src/client/index.ts',
    devtool: production ? 'inline-source-map' : 'nosources-source-map',
    watch: !production,
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
            template: './src/client/index.html',
            inject: true
        }),

        new CopyPlugin({
            patterns: [
                {from: "./src/client/css", to: "."},
                {from: "./Public/Sounds", to: "."}               
            ]  
        })
    ]},

    {
        mode: 'development',
        entry: './src/client/electron/electron.ts',
        watch: !production,
        output: {
          path: path.resolve('dist'),
          filename: 'electron.cjs'
        },
        target: 'electron-main',
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    include: /src/,
                    use: [{ loader: 'ts-loader' }]
                }
            ]
        },
      }
];