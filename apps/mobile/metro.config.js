// Metro config for the monorepo: watch the shared engine package so changes
// in packages/engine are picked up, and resolve modules from both the app's
// own node_modules and the repo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, path.resolve(workspaceRoot, 'packages/engine')];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
