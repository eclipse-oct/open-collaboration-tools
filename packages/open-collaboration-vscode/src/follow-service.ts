// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { inject, injectable } from 'inversify';
import { CollaborationInstance } from './collaboration-instance.js';
import { showQuickPick } from './utils/quick-pick.js';
import { CollaborationStatusViewDataProvider } from './collaboration-status-view.js';
import { ContextKeyService } from './context-key-service.js';

@injectable()
export class FollowService {

    @inject(CollaborationStatusViewDataProvider)
    private viewDataProvider: CollaborationStatusViewDataProvider;

    @inject(ContextKeyService)
    private contextKeyService: ContextKeyService;

    async followPeer(peer?: string): Promise<void> {
        if (!CollaborationInstance.Current) {
            return;
        }

        if (!peer) {
            const users = await CollaborationInstance.Current.connectedUsers;
            const items = users.map(user => ({ label: user.name, detail: user.id, key: user.id }));
            peer = await showQuickPick(items);
        }

        if (!peer) {
            return;
        }

        CollaborationInstance.Current.followUser(peer);
        this.viewDataProvider.update();
        this.contextKeyService.setFollowing(true);
    }

    async unfollowPeer() {
        if (!CollaborationInstance.Current) {
            return;
        }

        CollaborationInstance.Current.followUser(undefined);
        this.viewDataProvider.update();
        this.contextKeyService.setFollowing(false);
    }

}
