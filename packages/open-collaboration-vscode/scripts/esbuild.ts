import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { esbuildProblemMatcherPlugin } from "../../../scripts/esbuild";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const buildType = watch ? 'watch' : 'build';

/**
 * node-pty is a native module and cannot be bundled. The VSIX is packaged without node_modules
 * (and node-pty is hoisted to the monorepo root anyway), so its runtime files are copied to
 * dist/node_modules/node-pty, where the lazy `require('node-pty')` in dist/extension.js resolves it.
 * node-pty ships N-API prebuilds for darwin/linux/win32 (x64 + arm64), so one copy serves all
 * platforms. Debug symbols, source maps and tests are skipped to keep the VSIX small.
 */
function copyNodePty(): void {
	const sourceDir = path.dirname(createRequire(path.resolve('package.json')).resolve('node-pty/package.json'));
	const targetDir = path.resolve('dist', 'node_modules', 'node-pty');
	fs.rmSync(targetDir, { recursive: true, force: true });
	for (const entry of ['package.json', 'LICENSE', 'lib', 'prebuilds']) {
		// fs.cpSync preserves file modes, which keeps the macOS spawn-helper executable
		fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), {
			recursive: true,
			filter: source => !/\.(pdb|map)$|\.test\.js$/.test(source)
		});
	}
}

const main = async () => {
	copyNodePty();

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
		// and is instead resolved via a lazy `require` at runtime (see node-pty-backend.ts) from
		// the copy placed in dist/node_modules by copyNodePty().
		// @xterm/headless and @xterm/addon-serialize are pure JS and are bundled: the VSIX is
		// packaged without node_modules, so keeping them external would break activation.
		external: ['vscode', 'node-pty'],
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
