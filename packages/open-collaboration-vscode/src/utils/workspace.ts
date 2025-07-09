// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import { CollaborationUri } from './uri.js';
import { nanoid } from 'nanoid';
import { isWeb } from './system.js';

export function removeWorkspaceFolders() {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length > 0) {
        const newFolders: vscode.WorkspaceFolder[] = [];
        for (const folder of workspaceFolders) {
            if (folder.uri.scheme !== CollaborationUri.SCHEME) {
                newFolders.push(folder);
            }
        }
        if (newFolders.length !== workspaceFolders.length) {
            vscode.workspace.updateWorkspaceFolders(0, workspaceFolders.length, ...newFolders);
        }
    }
}

export interface Folder {
    uri: vscode.Uri;
    name: string;
}

export interface CodeWorkspace {
    folders: CodeWorkspaceFolder[];
}

export interface CodeWorkspaceFolder {
    name: string;
    uri: string;
}

export async function storeWorkspace(folders: Folder[], storageUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const canWrite = vscode.workspace.fs.isWritableFileSystem(storageUri.scheme);
    if (!canWrite || isWeb()) {
        return undefined;
    }
    try {
        const uuid = nanoid(24);
        const workspaceFileDir = storageUri.with({ path: storageUri.path + `/workspaces/${uuid}` });
        const workspace: CodeWorkspace = {
            folders: folders.map(folder => ({
                name: folder.name,
                uri: folder.uri.toString(true)
            }))
        };
        await vscode.workspace.fs.createDirectory(workspaceFileDir);
        const workspaceFile = workspaceFileDir.with({ path: workspaceFileDir.path + '/Open Collaboration.code-workspace' });
        const textEncoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(workspaceFile, textEncoder.encode(JSON.stringify(workspace, undefined, 2)));
        return workspaceFile;
    } catch {
        // In case of failure, the extension should replace the existing workspace folders with the new ones.
        // This isn't ideal, but it's better than losing the workspace.
        return undefined;
    }
}

export async function closeSharedEditors(): Promise<void> {
    const tabInputs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    const collabTabs = tabInputs.filter(tab => {
        if (typeof tab.input === 'object' && tab.input && 'uri' in tab.input && tab.input.uri instanceof vscode.Uri) {
            return tab.input.uri.scheme === CollaborationUri.SCHEME;
        }
        return false;
    });
    await vscode.window.tabGroups.close(collabTabs);
}
