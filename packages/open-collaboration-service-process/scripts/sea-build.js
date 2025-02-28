const execSync = require('child_process').execSync;
const fs = require('fs');
const inject = require('postject').inject

var EXECUTABLE_NAME = 'oct-servcice-daemon'

if (process.platform === 'win32') {
    EXECUTABLE_NAME = EXECUTABLE_NAME + '.exe'
    fs.copyFileSync(process.execPath, 'bin/' + EXECUTABLE_NAME)
} else {
    execSync(`cp $(command -v node) bin/${EXECUTABLE_NAME} `)
}

const postjectOptions = { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' }

if(process.platform === 'darwin') {
    execSync(`codesign --remove-signature ${EXECUTABLE_NAME}`)
    postjectOptions.machoSegmentName = 'NODE_SEA'
}

console.log('injecting ', process.cwd()  + '/bin/sea-prep.blob', 'into ', process.cwd() + '/' + EXECUTABLE_NAME)
inject(process.cwd() + '/bin/' + EXECUTABLE_NAME, 'NODE_SEA_BLOB', fs.readFileSync(process.cwd()  + '/bin/sea-prep.blob'), postjectOptions)

if(process.platform === 'darwin') {
    execSync(`codesign --sign - ${EXECUTABLE_NAME}`)
}