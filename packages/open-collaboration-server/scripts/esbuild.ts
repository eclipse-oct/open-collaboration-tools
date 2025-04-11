import esbuild from "esbuild";
import { esbuildProblemMatcherPlugin } from "../../../scripts/esbuild";

const production = process.argv.includes('--production');

const main = async () => {
	const nodeContext = await esbuild.context({
		entryPoints: [
			'src/app.ts'
		],
		bundle: true,
		format: 'esm',
		minify: production,
		sourcemap: !production,
        treeShaking: true,
		platform: 'node',
        target: 'node20',
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
