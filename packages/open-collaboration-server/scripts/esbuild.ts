import esbuild from "esbuild";
import { esbuildProblemMatcherPlugin } from "../../../scripts/esbuild";

const production = process.argv.includes('--production');

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
		plugins: [
			esbuildProblemMatcherPlugin('node', 'build')
		]
	});

    await nodeContext.rebuild();
    await nodeContext.dispose();
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
