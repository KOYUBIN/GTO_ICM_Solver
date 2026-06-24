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

// The engine's "exports" map points bundlers at TS source (for Next.js), but
// Metro can't resolve its NodeNext ".js" specifiers to ".ts". Force Metro to
// load the built ./dist JS for @gto/engine instead (its internal ./*.js
// specifiers then resolve within dist). Run `npm run build:engine` first.
const ENGINE_DIST = path.resolve(workspaceRoot, 'packages/engine/dist');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@gto/engine') {
    return { type: 'sourceFile', filePath: path.join(ENGINE_DIST, 'index.js') };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
