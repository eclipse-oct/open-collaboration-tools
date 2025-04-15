// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as deepl from 'deepl-node';
import * as path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// resolves __filename
export const getLocalFilename = (referenceUrl: string | URL) => {
    return fileURLToPath(referenceUrl);
};

// resolves __dirname
export const getLocalDirectory = (referenceUrl: string | URL) => {
    return path.dirname(getLocalFilename(referenceUrl));
};
const authKey = process.env.DEEPL_AUTH_KEY;
if (!authKey) {
    throw new Error('DEEPL_AUTH_KEY environment variable is not set');
}
const translator = new deepl.Translator(authKey);
const supportedLanguages = {
    'zh-cn': 'ZH-HANS',
    'zh-tw': 'ZH-HANT',
    'fr': 'FR',
    'de': 'DE',
    'es': 'ES',
    'it': 'IT',
    'ja': 'JA',
    'ko': 'KO',
    'ru': 'RU',
    'pt-br': 'PT-BR',
    'tr': 'TR',
    'pl': 'PL',
    'cs': 'CS',
    'hu': 'HU',
};

const paths = [
    path.resolve(getLocalDirectory(import.meta.url), '..', 'package.nls.json'),
    path.resolve(getLocalDirectory(import.meta.url), '..', 'l10n', 'bundle.l10n.json'),
];

async function translateFile(filePath: string): Promise<void> {
    const basename = path.basename(filePath);
    const content = await readJson(filePath);
    const contentKeys = Object.keys(content);
    for (const [vscodeLang, deeplLang] of Object.entries(supportedLanguages)) {
        const targetPath = filePath.replace('.json', `.${vscodeLang}.json`);
        const existingContent = await readJson(targetPath);
        const missing: Record<string, string> = {};
        const extra: Record<string, string> = {};
        for (const key of Object.keys(content)) {
            if (!existingContent[key]) {
                missing[key] = content[key];
            }
        }
        for (const key of Object.keys(existingContent)) {
            if (!content[key]) {
                extra[key] = existingContent[key];
            }
        }
        const missingPairs = Object.entries(missing);
        if (missingPairs.length === 0 && Object.keys(extra).length === 0) {
            console.log(`File ${basename} already up to date for '${vscodeLang}'.`);
            continue;
        }
        if (missingPairs.length > 0) {
            console.log(`Translating ${missingPairs.length} values from ${basename} to '${vscodeLang}'.`);
            const translations = await translator.translateText(Object.values(missing), null, deeplLang as deepl.TargetLanguageCode);
            for (let i = 0; i < missingPairs.length; i++) {
                existingContent[missingPairs[i][0]] = translations[i].text;
            }
        }
        if (Object.keys(extra).length > 0) {
            console.log(`Removing ${Object.keys(extra).length} values from ${basename} for '${vscodeLang}'.`);
            for (const key of Object.keys(extra)) {
                delete existingContent[key];
            }
        }
        const entries = Object.entries(existingContent).sort(([a], [b]) => contentKeys.indexOf(a) - contentKeys.indexOf(b));
        const translatedContent = Object.fromEntries(entries);
        await writeFile(targetPath, JSON.stringify(translatedContent, undefined, 2));
    }
}

async function readJson(filePath: string): Promise<any> {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
        return {};
    }
}

async function main() {
    try {
        await translator.getUsage();
    } catch {
        console.error('Invalid DEEPL_AUTH_KEY');
        return;
    }
    for (const filePath of paths) {
        await translateFile(filePath);
    }
}

main();
