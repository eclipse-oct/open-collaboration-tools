import esbuild from "esbuild";

const production = process.argv.includes('--production');

function esbuildProblemMatcherPlugin(): esbuild.Plugin {
    const prefix = 'node';
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

const main = async () => {
	const nodeContext = await esbuild.context({
		entryPoints: [
			'src/app.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
        treeShaking: true,
		platform: 'node',
        target: 'node18',
		outfile: 'bundle/app.js',
		// logLevel: 'silent',
        external: [
            'url',
            'https',
            'http',
            'crypto',
            'querystring',
            'zlib',
            'path',
            'fs',
            'stream',
            'util',
            'assert',
            'net',
            'async_hooks',
            'timers'
        ],
		plugins: [
			esbuildProblemMatcherPlugin()
		]
	});

    await nodeContext.rebuild();
    await nodeContext.dispose();
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
