import { execSync } from 'child_process';
import fs from 'fs';
import { inject } from 'postject'

/**
 * This is a script to create a single executable file which contains the nodejs executable and the oct-service-process application
 * This is done by injecting the oct-service-process application into the nodejs executable
 * The resulting executable can be run as a standalone application without the need of nodejs being installed
 */

var EXECUTABLE_NAME = 'oct-service-process'

if (process.platform === 'win32') {
    EXECUTABLE_NAME = EXECUTABLE_NAME + '.exe'
    fs.copyFileSync(process.execPath, 'bin/' + EXECUTABLE_NAME)
} else {
    execSync(`cp $(command -v node) bin/${EXECUTABLE_NAME} `)
}

const postjectOptions = { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' }

if (process.platform === 'darwin') {
    execSync(`codesign --remove-signature ${EXECUTABLE_NAME}`)
    postjectOptions.machoSegmentName = 'NODE_SEA'
}

console.log('injecting ', process.cwd() + '/bin/sea-prep.blob', 'into ', process.cwd() + '/' + EXECUTABLE_NAME)
// Here the sea-prep blob containing oct-service-process application is injected into the node js executable
inject(process.cwd() + '/bin/' + EXECUTABLE_NAME, 'NODE_SEA_BLOB', fs.readFileSync(process.cwd() + '/bin/sea-prep.blob'), postjectOptions)

if (process.platform === 'darwin') {
    execSync(`codesign --sign - ${EXECUTABLE_NAME}`)
}
