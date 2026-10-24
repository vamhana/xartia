// W.2.10.01 — Канал WS pulse
// Планетарный пульс, общины, мосты, заморозка расширения.

import type { Community, Bridge, Pulse } from '../core/planetary/entity.js';
import { logger } from '../lib/logger.js';

import { publish } from './_helpers.js';

const REDIS_CHANNEL = 'ws:broadcast:pulse';

export async function registerPulseChannel(): Promise<void> {
  logger.info({ channel: 'pulse' }, 'ws: pulse channel registered');
}

export async function emitPulseUpdated(communityId: string, pulse: Pulse): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'pulse.community_update',
      payload: { communityId, pulse, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, communityId }, 'ws: emitPulseUpdated failed');
  }
}

export async function emitCommunityCreated(community: Community): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'community.created',
      payload: community,
    });
  } catch (e) {
    logger.warn({ err: e, communityId: community.id }, 'ws: emitCommunityCreated failed');
  }
}

export async function emitCommunityStatusChanged(
  communityId: string,
  status: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'community.status_changed',
      payload: { communityId, status, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, communityId }, 'ws: emitCommunityStatusChanged failed');
  }
}

export async function emitBridgeEstablished(bridge: Bridge): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'bridge.established',
      payload: bridge,
    });
  } catch (e) {
    logger.warn({ err: e, bridgeId: bridge.id }, 'ws: emitBridgeEstablished failed');
  }
}

export async function emitExpansionFrozen(reason: string): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'expansion.frozen',
      payload: { reason, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, reason }, 'ws: emitExpansionFrozen failed');
  }
}