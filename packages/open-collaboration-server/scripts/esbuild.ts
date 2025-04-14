import esbuild from "esbuild";
import { esbuildProblemMatcherPlugin } from "../../../scripts/esbuild";

const production = process.argv.includes('--production');

// context https://github.com/evanw/esbuild/pull/2067
// solution taken from: https://bajtos.net/posts/2022-05-bundling-nodejs-for-aws-lambda/
const REQUIRE_SHIM = `
// Shim require if needed.
import module from 'module';
if (typeof globalThis.require === "undefined") {
  globalThis.require = module.createRequire(import.meta.url);
}
`;

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
		],
        banner: {
            js: REQUIRE_SHIM
        }
	});

    await nodeContext.rebuild();
    await nodeContext.dispose();
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
