#!/usr/bin/env node
// Three64 Editor - CLI entry point
// Usage: node src/editor/cli.mjs [--port=3664]

const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));
if (portArg) {
  process.env.EDITOR_PORT = portArg.split('=')[1];
}

// Resolve server.mjs relative to this script so the CLI works from any cwd
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, 'server.mjs');
import(pathToFileURL(serverPath).href);
