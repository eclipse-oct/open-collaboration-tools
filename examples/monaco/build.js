// build.js
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outdir: 'dist',
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    assetNames: 'assets/[name]',
    publicPath: '/',
    sourcemap: true,
  })

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});