/**
 * Checks that every %placeholder% in the VS Code extension manifest has a matching key in
 * package.nls.json. A missing key is not a build error — it ships a literal "%oct.foo%" to users.
 *
 * Added 2026-08-28: the l10n coupling was a documented rule with nothing enforcing it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages', 'open-collaboration-vscode');
const manifestPath = path.join(pkgDir, 'package.json');
const nlsPath = path.join(pkgDir, 'package.nls.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const nls = JSON.parse(readFileSync(nlsPath, 'utf8'));

/** Collect every whole-string %placeholder% value, remembering where it was found. */
function collect(node, trail, found) {
    if (typeof node === 'string') {
        const match = /^%(.+)%$/.exec(node);
        if (match) {
            found.push({ key: match[1], at: trail });
        }
    } else if (Array.isArray(node)) {
        node.forEach((child, i) => collect(child, `${trail}[${i}]`, found));
    } else if (node && typeof node === 'object') {
        for (const [k, child] of Object.entries(node)) {
            collect(child, trail ? `${trail}.${k}` : k, found);
        }
    }
    return found;
}

const used = collect(manifest, '', []);
const missing = used.filter(u => !(u.key in nls));
const unused = Object.keys(nls).filter(k => !used.some(u => u.key === k));

if (unused.length > 0) {
    console.log(`note: ${unused.length} key(s) in package.nls.json are not referenced by the manifest: ${unused.join(', ')}`);
}

if (missing.length === 0) {
    console.log(`check-nls: ok — ${used.length} placeholder(s) resolved against package.nls.json`);
    process.exit(0);
}

console.error('check-nls: manifest placeholders have no translation key.\n');
for (const { key, at } of missing) {
    console.error(`  %${key}%  (package.json → ${at})`);
}
console.error(`
Why this fails: VS Code substitutes %key% from package.nls.json at load time. With no key, users
see the literal text "%${missing[0].key}%" in the command palette or settings UI — the manifest
still parses, the build still passes, and nothing else catches it.

To fix: add each key to packages/open-collaboration-vscode/package.nls.json with its English text,
e.g.

  "${missing[0].key}": "Some human-readable text"

Leave the 14 package.nls.<locale>.json files alone — translations are produced by the maintainers
with 'npm run l10n-translate', not by hand.`);
process.exit(1);
