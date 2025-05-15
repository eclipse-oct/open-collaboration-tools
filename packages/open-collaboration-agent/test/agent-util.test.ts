// ******************************************************************************
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { applyChanges } from '../src/agent-util.js';
import type { IDocumentSync } from '../src/document-sync.js';

describe('agent-util', () => {
    describe('applyChanges', () => {
        let mockDocumentSync: IDocumentSync;
        let applyEditMock: ReturnType<typeof vi.fn>;
        function callArgs(call: unknown[]) {
            return {
                path: call[0] as string,
                text: call[1] as string,
                offset: call[2] as number,
                length: call[3] as number
            };
        }

        // Reusable helper to create a real document sync that tracks content changes
        const createRealDocSync = (initialContent: string) => {
            let updatedContent = initialContent;
            return {
                sync: {
                    applyEdit: (path: string, text: string, offset: number, length: number) => {
                        // Simulate the actual edit
                        updatedContent =
                            updatedContent.substring(0, offset) +
                            text +
                            updatedContent.substring(offset + length);

                        // Call the mock for verification
                        applyEditMock(path, text, offset, length);
                    }
                },
                getContent: () => updatedContent
            };
        };

        beforeEach(() => {
            // Create a mock for the document sync with properly typed mock function
            applyEditMock = vi.fn();
            mockDocumentSync = {
                applyEdit: applyEditMock
            };
        });

        afterEach(() => {
            vi.resetAllMocks();
        });

        test('should do nothing with an empty changes array', () => {
            const docPath = 'test.ts';
            const docContent = 'function test() {\n  return true;\n}';
            const docLines = docContent.split('\n');

            applyChanges(docPath, docContent, docLines, [], mockDocumentSync);

            expect(applyEditMock).not.toHaveBeenCalled();
        });

        test('should do nothing with an unchanged document', () => {
            const docPath = 'test.ts';
            const docContent = 'function test() {\n  return true;\n}';
            const docLines = docContent.split('\n');

            const changes = [
                'function test() {\n  return true;\n}'
            ];

            applyChanges(docPath, docContent, docLines, changes, mockDocumentSync);

            expect(applyEditMock).not.toHaveBeenCalled();
        });

        test('should apply simple changes correctly', () => {
            const docPath = 'test.ts';
            const docContent = 'function test() {\n  // Old content\n  return true;\n}';
            const docLines = docContent.split('\n');

            const changes = [
                'function test() {\n  // New content\n  return true;\n}'
            ];

            applyChanges(docPath, docContent, docLines, changes, mockDocumentSync);

            expect(applyEditMock).toHaveBeenCalledTimes(1);
            const call = callArgs(applyEditMock.mock.calls[0]);
            expect(call.path).toBe(docPath);
            expect(call.text).toBe('  // New content');
        });

        test('should handle multiple changes correctly', () => {
            const docPath = 'test.ts';
            const docContent = 'function first() {\n  // First old\n}\n\nfunction second() {\n  // Second old\n}';
            const docLines = docContent.split('\n');

            const changes = [
                'function first() {\n  // First new\n}',
                'function second() {\n  // Second new\n}'
            ];

            applyChanges(docPath, docContent, docLines, changes, mockDocumentSync);

            // Verify document sync was called twice with correct content
            expect(applyEditMock).toHaveBeenCalledTimes(2);
            const firstCall = callArgs(applyEditMock.mock.calls[0]);
            expect(firstCall.text).toBe('  // First new');
            expect(firstCall.offset).toBe(19);
            expect(firstCall.length).toBe(14);
            const secondCall = callArgs(applyEditMock.mock.calls[1]);
            expect(secondCall.text).toBe('  // Second new');
            expect(secondCall.offset).toBe(57);
            expect(secondCall.length).toBe(15);
        });

        test('should handle document state updates for sequential changes', () => {
            const docPath = 'test.ts';
            const docContent = 'function first() {\n  return 1;\n}\n\nfunction second() {\n  return 2;\n}';

            // Create tracking doc sync
            const { sync, getContent } = createRealDocSync(docContent);

            // Apply sequential changes that would affect each other
            const changes = [
                'function first() {\n  return 100;\n}',
                'function second() {\n  return 200;\n}'
            ];

            // Apply each change separately to simulate sequential application
            applyChanges(docPath, docContent, docContent.split('\n'), [changes[0]], sync);

            // Get updated content and apply second change to it
            const updatedContent = getContent();
            applyChanges(docPath, updatedContent, updatedContent.split('\n'), [changes[1]], sync);

            // Verify both changes were applied
            expect(applyEditMock).toHaveBeenCalledTimes(2);
            const firstCall = callArgs(applyEditMock.mock.calls[0]);
            expect(firstCall.text).toBe('  return 100;');
            expect(firstCall.offset).toBe(19);
            expect(firstCall.length).toBe(11);
            const secondCall = callArgs(applyEditMock.mock.calls[1]);
            expect(secondCall.text).toBe('  return 200;');
            expect(secondCall.offset).toBe(56);
            expect(secondCall.length).toBe(11);

            const finalContent = getContent();
            expect(finalContent).toBe('function first() {\n  return 100;\n}\n\nfunction second() {\n  return 200;\n}');
        });

        test('should minimize applied changes when modifying only a portion of a larger file', () => {
            const docPath = 'test.ts';
            const docContent =
                '// Header\n' +
                'function prelude() {}\n\n' +
                'class FirstClass {\n' +
                '  method1() {\n' +
                '    return "original";\n' +
                '  }\n\n' +
                '  method2() {\n' +
                '    return true;\n' +
                '  }\n' +
                '}\n\n' +
                'class SecondClass {}\n';

            const docLines = docContent.split('\n');

            const change = [
                '// Header\n' +
                'function prelude() {}\n\n' +
                'class FirstClass {\n' +
                '  method1() {\n' +
                '    return "MODIFIED";\n' +
                '  }\n\n' +
                '  method2() {\n' +
                '    return true;\n' +
                '  }\n' +
                '}\n\n' +
                'class SecondClass {}\n'
            ];

            applyChanges(docPath, docContent, docLines, change, mockDocumentSync);

            // Verify the edit was applied only to the changed portion
            expect(applyEditMock).toHaveBeenCalledTimes(1);
            const call = callArgs(applyEditMock.mock.calls[0]);

            // The replacement text should contain only the modified method
            expect(call.text).toBe('    return "MODIFIED";');
            expect(call.offset).toBe(66);
            expect(call.length).toBe(22);
        });
    });
});
