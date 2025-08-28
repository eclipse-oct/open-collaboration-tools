/**
 * Spawns a second Extension Development Host window (separate process).
 * Used for chat testing: run "Run VS Code Extension" first, then this config.
 * Requires env: WORKSPACE_FOLDER, VSCODE_EXEC_PATH. Args: folder path, user-data-dir path (relative to workspace).
 */
import { spawn } from 'child_process';
import path from 'path';

const workspaceFolder = process.env.WORKSPACE_FOLDER || process.cwd();
const execPath = process.env.VSCODE_EXEC_PATH;
const folderArg = process.argv[2];
const userDataDirArg = process.argv[3];

if (!execPath || !folderArg || !userDataDirArg) {
  console.error('Usage: node launch-extension-host.js <folder> <user-data-dir>');
  console.error('Requires env: WORKSPACE_FOLDER, VSCODE_EXEC_PATH');
  process.exit(1);
}

const folder = path.resolve(workspaceFolder, folderArg);
const userDataDir = path.resolve(workspaceFolder, userDataDirArg);
const extPath = path.resolve(workspaceFolder, 'packages/open-collaboration-vscode');

// Always use local server (testing only)
const spawnEnv = {
  ...process.env,
  DEVELOPMENT: 'true',
  OCT_SERVER_URL: 'http://localhost:8100',
};

const child = spawn(execPath, [
  folder,
  '--extensionDevelopmentPath=' + extPath,
  '--user-data-dir=' + userDataDir,
], { detached: true, stdio: 'ignore', env: spawnEnv });
child.unref();
