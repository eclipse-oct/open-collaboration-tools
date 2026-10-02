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
		// node-pty is a native module (a prebuilt/compiled .node addon); it cannot be bundled
		// and is instead resolved via plain `require` at runtime, see docs/terminal-sharing.md
		// §4.3. @xterm/headless and @xterm/addon-serialize are only ever used alongside it, so
		// they're kept external too, purely to keep the node bundle lean.
		external: ['vscode', 'node-pty', '@xterm/headless', '@xterm/addon-serialize'],
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

    const webviewContext = await esbuild.context({
        entryPoints: [
            'src/chat-webview/src/webview.tsx'
        ],
        bundle: true,
        format: 'cjs',
        		minify: production,
		sourcemap: !production,
		platform: 'browser',
		outfile: 'dist/chat-webview.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin('web', buildType),
		],
        loader: {
            ".css": "css"
        },
         // Node.js global to browser globalThis
        define: {
            global: 'globalThis'
        }
	});

	if (watch) {
        await Promise.all([
            nodeContext.watch(),
            browserContext.watch(),
            webviewContext.watch()
        ]);
	} else {
        await webviewContext.rebuild();
		await nodeContext.rebuild();
		await browserContext.rebuild();
		await nodeContext.dispose();
		await browserContext.dispose();
        await webviewContext.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
