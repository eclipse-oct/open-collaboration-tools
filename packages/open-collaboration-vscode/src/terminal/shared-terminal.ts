// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as vscode from 'vscode';
import * as types from 'open-collaboration-protocol';
import { NodePtyBackend } from './node-pty-backend.js';
import { PtyBackend } from './pty-backend.js';
import { OutputChunker } from './output-chunker.js';
import { TerminalEmulator } from './terminal-emulator.js';

const DEFAULT_DIMENSIONS: types.TerminalDimensions = { columns: 80, rows: 24 };

export interface SharedTerminalOptions {
    id: types.TerminalId;
    name: string;
    mode: types.TerminalAccessMode;
    ownerId: types.Id;
    shell: string;
    shellArgs: string[];
    cwd: string;
    scrollback: number;
    /** Whether the room-wide permissions currently force every terminal to read-only. */
    isRoomReadonly: () => boolean;
}

/**
 * One shared terminal, owned by the host. Owns the pty backend, the local view (a
 * `vscode.Pseudoterminal` with no local echo, per docs/terminal-sharing.md §3), the headless
 * emulator used for late-join snapshots, and the set of guests currently subscribed to its
 * output. Access-mode enforcement for remote input happens here, on the host, never trusting
 * what a sender claims (§11).
 */
export class SharedTerminal implements vscode.Disposable {

    readonly id: types.TerminalId;
    readonly ownerId: types.Id;

    private readonly backend: PtyBackend;
    private readonly emulator: TerminalEmulator;
    private readonly chunker: OutputChunker;
    private readonly subscribers = new Set<types.Id>();
    private readonly isRoomReadonly: () => boolean;

    private _name: string;
    private _mode: types.TerminalAccessMode;
    private _dimensions: types.TerminalDimensions = DEFAULT_DIMENSIONS;
    private _exit: types.TerminalExit | undefined;

    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number | void>();
    readonly pseudoterminal: vscode.Pseudoterminal;

    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();
    /** Fired whenever `info` changes (name, mode or dimensions) and remote peers must be told. */
    readonly onDidUpdate = this.onDidUpdateEmitter.event;

    private readonly onDidOutputEmitter = new vscode.EventEmitter<types.TerminalChunk>();
    /** Fired for every chunk that must be relayed to current subscribers. */
    readonly onDidOutput = this.onDidOutputEmitter.event;

    private readonly onDidExitEmitter = new vscode.EventEmitter<types.TerminalExit>();
    readonly onDidExit = this.onDidExitEmitter.event;

    constructor(options: SharedTerminalOptions) {
        this.id = options.id;
        this.ownerId = options.ownerId;
        this._name = options.name;
        this._mode = options.mode;
        this.isRoomReadonly = options.isRoomReadonly;

        this.backend = new NodePtyBackend({
            shell: options.shell,
            shellArgs: options.shellArgs,
            cwd: options.cwd,
            env: process.env,
            columns: this._dimensions.columns,
            rows: this._dimensions.rows
        });
        this.emulator = new TerminalEmulator(this._dimensions.columns, this._dimensions.rows, options.scrollback);
        this.chunker = new OutputChunker(chunk => this.onDidOutputEmitter.fire(chunk));

        this.backend.onData(data => {
            this.emulator.write(data);
            this.chunker.push(data);
            this.writeEmitter.fire(data);
        });
        this.backend.onExit(exit => {
            this.chunker.flush();
            this._exit = { code: exit.code, signal: exit.signal !== undefined ? String(exit.signal) : undefined };
            this.closeEmitter.fire(exit.code);
            this.onDidExitEmitter.fire(this._exit);
        });

        this.pseudoterminal = {
            onDidWrite: this.writeEmitter.event,
            onDidClose: this.closeEmitter.event,
            open: initialDimensions => {
                if (initialDimensions) {
                    this.applyDimensions(initialDimensions);
                }
            },
            close: () => {
                this.kill();
            },
            handleInput: data => {
                // The owner's own keystrokes are never subject to access-mode checks.
                this.backend.write(data);
            },
            setDimensions: dimensions => {
                this.applyDimensions(dimensions);
            }
        };
    }

    get info(): types.TerminalInfo {
        return {
            id: this.id,
            name: this._name,
            ownerId: this.ownerId,
            mode: this._mode,
            dimensions: this._dimensions,
            exit: this._exit
        };
    }

    get mode(): types.TerminalAccessMode {
        return this._mode;
    }

    setMode(mode: types.TerminalAccessMode): void {
        if (this._mode !== mode) {
            this._mode = mode;
            this.onDidUpdateEmitter.fire();
        }
    }

    /** The access mode currently in effect, after applying the room-wide readonly override. */
    private effectiveMode(): types.TerminalAccessMode {
        return this.isRoomReadonly() ? 'read' : this._mode;
    }

    addSubscriber(peerId: types.Id): types.TerminalSnapshot {
        // Flush first so the snapshot's `buffer` and `seq` describe exactly the same point in
        // the stream: any output still sitting in the coalescing window would otherwise be
        // visible in the emulator's serialized buffer without yet having a seq of its own.
        this.chunker.flush();
        this.subscribers.add(peerId);
        return {
            info: this.info,
            dimensions: this._dimensions,
            buffer: this.emulator.serialize(),
            seq: this.chunker.currentSeq
        };
    }

    removeSubscriber(peerId: types.Id): void {
        this.subscribers.delete(peerId);
    }

    hasSubscriber(peerId: types.Id): boolean {
        return this.subscribers.has(peerId);
    }

    get subscriberIds(): types.Id[] {
        return Array.from(this.subscribers);
    }

    /**
     * Handles `terminal/input` from a remote peer. Silently drops the input if the sender is
     * not currently permitted to write - the sender's own claim about its intentions is never
     * trusted, only the mode tracked here on the host.
     */
    handleRemoteInput(data: string): void {
        if (this.effectiveMode() === 'readWrite') {
            this.backend.write(data);
        }
    }

    /**
     * A guest's own panel dimensions. Purely informational for now (§9): the pty stays sized
     * to the host's panel so wrapping is identical for everyone.
     */
    handleRemoteViewResize(_peerId: types.Id, _dimensions: types.TerminalDimensions): void {
        // Reserved for a future `min()` dimension clamp across write-enabled participants.
    }

    private applyDimensions(dimensions: types.TerminalDimensions): void {
        if (dimensions.columns === this._dimensions.columns && dimensions.rows === this._dimensions.rows) {
            return;
        }
        this._dimensions = dimensions;
        this.backend.resize(dimensions.columns, dimensions.rows);
        this.emulator.resize(dimensions.columns, dimensions.rows);
        this.onDidUpdateEmitter.fire();
    }

    kill(): void {
        this.backend.kill();
    }

    dispose(): void {
        this.kill();
        this.chunker.dispose();
        this.emulator.dispose();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
        this.onDidUpdateEmitter.dispose();
        this.onDidOutputEmitter.dispose();
        this.onDidExitEmitter.dispose();
    }
}
