// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { injectable, postConstruct } from 'inversify';
import * as vscode from 'vscode';
import { CollaborationInstance } from './collaboration-instance';
import { TextDiffChange } from 'open-collaboration-protocol';
import { CollaborationUri } from './utils/uri';

@injectable()
export class CollaborationDiffService {

    // originalDocumentUri, diffDocumentUri
    private diffDocuments = new Map<string, string>();

    // diffDocumentUri, changes
    private documentChanges = new Map<string, TextDiffChange[]>();

    @postConstruct()
    protected init(): void {
        // Listen for changes to temp diff document
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const tempUriString = event.document.uri.toString();
            if (this.documentChanges.has(tempUriString)) {
                const changes = event.contentChanges.map<TextDiffChange>(change => ({
                    range: {
                        start: change.range.start,
                        end: change.range.end,
                    },
                    text: change.text,
                }));

                const existingChanges = this.documentChanges.get(tempUriString) || [];
                this.documentChanges.set(tempUriString, existingChanges.concat(changes));
            }
        });

        vscode.workspace.onDidCloseTextDocument((document) => {
            const tempUriString = document.uri.toString();
            if (this.documentChanges.has(tempUriString)) {
                this.documentChanges.delete(tempUriString);
                this.diffDocuments.delete(tempUriString);
            }
        });
    }

    async createTempDiffDocument(fileUri: vscode.Uri): Promise<void> {
        const originalDocument = await vscode.workspace.openTextDocument(fileUri);

        const document = await vscode.workspace.openTextDocument({
            content: originalDocument.getText(),
            language: originalDocument.languageId,
            encoding: originalDocument.encoding,
        });

        const tempUriString = document.uri.toString();
        this.diffDocuments.set(tempUriString, CollaborationUri.getProtocolPath(fileUri)!);
        this.documentChanges.set(tempUriString, []);

        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    async sendDiff(diffFileUri: vscode.Uri): Promise<void> {
        const originalFilePath = this.diffDocuments.get(diffFileUri.toString());

        if(!originalFilePath) {
            vscode.window.showErrorMessage(vscode.l10n.t('No original file found for the provided diff document.'));
            return;
        }

        // Get the accumulated changes for this document
        const changes = this.documentChanges.get(diffFileUri.toString()) || [];

        // Send the changes with the original file name
        CollaborationInstance.Current?.proposeChanges(originalFilePath, changes);
    }

}
