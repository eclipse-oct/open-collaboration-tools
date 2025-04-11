import esbuild from "esbuild";
import { esbuildProblemMatcherPlugin } from "../../../scripts/esbuild";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const buildType = watch ? 'watch' : 'build';

const main = async () => {
	const nodeContext = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin('node', buildType)
		]
	});

	const browserContext = await esbuild.context({
		entryPoints: [
			'src/extension-web.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outfile: 'dist/extension.web.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin('web', buildType),
		],
         // Node.js global to browser globalThis
        define: {
            global: 'globalThis'
        }
	});

	if (watch) {
        await Promise.all([
            nodeContext.watch(),
            browserContext.watch()
        ]);
	} else {
		await nodeContext.rebuild();
		await browserContext.rebuild();
		await nodeContext.dispose();
		await browserContext.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
