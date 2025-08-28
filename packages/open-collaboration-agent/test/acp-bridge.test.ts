// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test } from 'vitest';
import { ACPBridge } from '../src/acp-bridge.js';

describe('ACPBridge', () => {
    describe('getMimeType', () => {
        test('should return correct MIME type for TypeScript files', () => {
            const bridge = new ACPBridge('echo', undefined);
            // Access private method via type assertion for testing
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('test.ts')).toBe('text/typescript');
            expect(getMimeType('test.tsx')).toBe('text/typescript');
        });

        test('should return correct MIME type for JavaScript files', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('test.js')).toBe('text/javascript');
            expect(getMimeType('test.jsx')).toBe('text/javascript');
        });

        test('should return correct MIME type for JSON files', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('package.json')).toBe('application/json');
        });

        test('should return correct MIME type for Markdown files', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('README.md')).toBe('text/markdown');
        });

        test('should return text/plain for unknown file types', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('test.unknown')).toBe('text/plain');
            expect(getMimeType('noextension')).toBe('text/plain');
        });

        test('should handle uppercase extensions', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('test.TS')).toBe('text/typescript');
            expect(getMimeType('test.JS')).toBe('text/javascript');
        });

        test('should return correct MIME types for various programming languages', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('script.py')).toBe('text/x-python');
            expect(getMimeType('Main.java')).toBe('text/x-java');
            expect(getMimeType('main.go')).toBe('text/x-go');
            expect(getMimeType('lib.rs')).toBe('text/x-rust');
            expect(getMimeType('script.sh')).toBe('text/x-shellscript');
        });

        test('should return correct MIME types for markup and style files', () => {
            const bridge = new ACPBridge('echo', undefined);
            const getMimeType = (bridge as any).getMimeType.bind(bridge);
            
            expect(getMimeType('index.html')).toBe('text/html');
            expect(getMimeType('styles.css')).toBe('text/css');
            expect(getMimeType('config.xml')).toBe('text/xml');
            expect(getMimeType('config.yaml')).toBe('text/yaml');
            expect(getMimeType('config.yml')).toBe('text/yaml');
        });
    });
});
