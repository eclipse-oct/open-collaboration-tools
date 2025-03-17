import esbuild from "esbuild";

export const esbuildProblemMatcherPlugin = (type: 'web' | 'node', buildType: 'watch' | 'build'): esbuild.Plugin => {
    const prefix = `[${buildType}/${type}]`
    return {
        name: 'esbuild-problem-matcher',
        setup(build) {
            build.onStart(() => {
                console.log(prefix + ' started');
            });
            build.onEnd((result) => {
                result.errors.forEach(({ text, location }) => {
                    console.error(`✘ [ERROR] ${text}`);
                    if (location) {
                        console.error(`    ${location.file}:${location.line}:${location.column}:`);
                    }
                });
                console.log(prefix + ' finished');
            });
        },
    };
};
