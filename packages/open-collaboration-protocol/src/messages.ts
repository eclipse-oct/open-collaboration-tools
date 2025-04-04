// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as types from './types';
import { BroadcastType, RequestType, NotificationType } from './messaging';

export namespace Messages {

    export namespace Peer {
        export const Join = new RequestType<[types.User], types.JoinResponse | undefined>('peer/join');
        export const Info = new NotificationType<[types.Peer]>('peer/info');
        export const Init = new NotificationType<[types.InitData]>('peer/init');
    }

    export namespace Room {
        export const Joined = new BroadcastType<[types.Peer]>('room/joined');
        export const Left = new BroadcastType<[types.Peer]>('room/left');
        export const Leave = new NotificationType<[]>('room/leave');
        export const PermissionsUpdated = new BroadcastType<[types.Permissions]>('room/permissionsUpdated');
        export const Closed = new BroadcastType('room/closed');
    }

    export namespace Editor {
        export const Open = new NotificationType<[types.Path]>('editor/open');
        export const Close = new BroadcastType<[types.Path]>('editor/close');
    }

    export namespace Chat {
        export const Message = new BroadcastType<[types.ChatMessage]>('chat/message');
        export const History = new RequestType<[types.Timestamp], types.ChatMessage[]>('chat/history');
    }

    export namespace Sync {
        export const DataUpdate = new BroadcastType<[types.Binary]>('sync/dataUpdate');
        export const DataNotify = new NotificationType<[types.Binary]>('sync/dataNotify');
        export const AwarenessUpdate = new BroadcastType<[types.Binary]>('sync/awarenessUpdate');
        export const AwarenessQuery = new BroadcastType<[]>('sync/awarenessQuery');
        export const AwarenessNotify = new NotificationType<[types.Binary]>('sync/awarenessNotify');
    }

    export namespace FileSystem {
        export const Stat = new RequestType<[types.Path], types.FileSystemStat>('fileSystem/stat');
        export const Mkdir = new RequestType<[types.Path], undefined>('fileSystem/mkdir');
        export const ReadFile = new RequestType<[types.Path], types.FileData>('fileSystem/readFile');
        export const WriteFile = new RequestType<[types.Path, types.FileData], undefined>('fileSystem/writeFile');
        export const ReadDir = new RequestType<[types.Path], Record<string, types.FileType>>('fileSystem/readDir');
        export const Delete = new RequestType<[types.Path], undefined>('fileSystem/delete');
        export const Rename = new RequestType<[types.Path, types.Path], undefined>('fileSystem/rename');
        export const Change = new BroadcastType<[types.FileChangeEvent]>('fileSystem/change');
    }

}
