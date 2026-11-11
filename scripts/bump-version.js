import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { nextReleaseVersion } from '../src/features/plugins/engineVersion.ts';
import { applyPluginEngineRelease, preparePluginEngineRelease } from './lib/pluginEngineRelease.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to the files containing the version
const packageJsonPath = path.resolve(__dirname, '../package.json');
const manifestJsonPath = path.resolve(__dirname, '../manifest.json');
const manifestDevJsonPath = path.resolve(__dirname, '../manifest.dev.json');
// The plugin CLI ships with the extension version it checks against.
const pluginCliPackagePath = path.resolve(
  __dirname,
  '../packages/create-voyager-plugin/package.json',
);
const xcodeProjectPath = path.resolve(__dirname, '../Voyager/Voyager.xcodeproj/project.pbxproj');

const args = process.argv.slice(2);
const explicitVersion = args.find((arg) => !arg.startsWith('--'));
const shouldFormat = !args.includes('--no-format');

// Helper to read JSON file
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function updateJsonVersion(filePath, version) {
  const source = fs.readFileSync(filePath, 'utf8');
  const updated = source.replace(/("version"\s*:\s*")[^"]+("\s*)/, `$1${version}$2`);
  if (updated === source && readJson(filePath).version !== version) {
    throw new Error(`Version field not found in ${filePath}`);
  }
  fs.writeFileSync(filePath, updated);
}

async function main() {
  try {
    console.log('Reading current version...');
    const packageJson = readJson(packageJsonPath);
    const currentVersion = packageJson.version;

    console.log(`Current version: ${currentVersion}`);

    const newVersion = explicitVersion ?? nextReleaseVersion(currentVersion);
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
      throw new Error(`Invalid version: ${newVersion}`);
    }
    console.log(`New version:     ${newVersion}`);

    const engineRelease = preparePluginEngineRelease(path.resolve(__dirname, '..'), newVersion);

    // Update package.json
    updateJsonVersion(packageJsonPath, newVersion);
    console.log('Updated package.json');

    // Update manifest.json
    if (fs.existsSync(manifestJsonPath)) {
      updateJsonVersion(manifestJsonPath, newVersion);
      console.log('Updated manifest.json');
    } else {
      console.warn('manifest.json not found, skipping...');
    }

    // Update manifest.dev.json
    if (fs.existsSync(manifestDevJsonPath)) {
      updateJsonVersion(manifestDevJsonPath, newVersion);
      console.log('Updated manifest.dev.json');
    }

    updateJsonVersion(pluginCliPackagePath, newVersion);
    console.log('Updated packages/create-voyager-plugin/package.json');

    const xcodeProject = fs.readFileSync(xcodeProjectPath, 'utf8');
    if (
      !xcodeProject.includes('MARKETING_VERSION =') ||
      !xcodeProject.includes('CURRENT_PROJECT_VERSION =')
    ) {
      throw new Error('Xcode version settings not found');
    }
    const updatedXcodeProject = xcodeProject.replace(
      /(MARKETING_VERSION|CURRENT_PROJECT_VERSION) = [^;]+;/g,
      `$1 = ${newVersion};`,
    );
    fs.writeFileSync(xcodeProjectPath, updatedXcodeProject);
    console.log('Updated Xcode app and extension versions');

    applyPluginEngineRelease(engineRelease);
    if (engineRelease.engineVersion) {
      console.log(
        `Stamped next as ${engineRelease.engineVersion} in ${engineRelease.updates.length} files`,
      );
    }

    console.log('Version bump complete! 🚀');

    if (shouldFormat) {
      console.log('Running format...');
      execSync('bun run format', { stdio: 'inherit' });
      console.log('Format complete! ✨');
    }
  } catch (error) {
    console.error('Error bumping version:', error);
    process.exit(1);
  }
}

main();
