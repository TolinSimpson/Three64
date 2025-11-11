'use strict';

// Webpack-based build script to bundle the runtime into public/runtime.js
// Requires devDependencies: webpack, webpack-cli
import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  mode: process.env.NODE_ENV || 'development',
  context: __dirname,
  target: 'web',
  entry: './runtime/main.js',
  output: {
    path: path.resolve(__dirname, '../public'),
    filename: 'runtime.js',
  },
  resolve: {
    extensions: ['.js'],
  },
  module: {
    rules: [],
  },
  devtool: 'source-map',
  stats: 'minimal',
};

function run() {
  const compiler = webpack(config);
  compiler.run((err, stats) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    const info = stats.toJson();
    if (stats.hasErrors()) {
      console.error(info.errors);
      process.exit(1);
    }
    if (stats.hasWarnings()) {
      console.warn(info.warnings);
    }
    console.log('Built:', path.relative(process.cwd(), path.join(config.output.path, config.output.filename)));
    compiler.close((closeErr) => {
      if (closeErr) {
        console.error(closeErr);
        process.exit(1);
      }
    });
  });
}

run();


