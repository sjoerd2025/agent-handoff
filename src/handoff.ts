/**
 * Core handoff creation and manipulation
 */

import { nanoid } from 'nanoid';
import {
  Handoff,
  CreateHandoffOptions,
  HandoffResult,
  CompleteHandoffOptions,
  HandoffLink,
} from './types.js';

/**
 * Create a new handoff
 */
export function createHandoff(options: CreateHandoffOptions): Handoff {
  const id = nanoid(12);
  const timestamp = new Date().toISOString();
  
  const handoff: Handoff = {
    id,
    from: options.from,
    to: options.to,
    timestamp,
    context: options.context,
    chain: [],
    ...(options.conversationSummary && { conversationSummary: options.conversationSummary }),
    ...(options.relevantMessages && { relevantMessages: options.relevantMessages }),
    ...(options.returnTo && { returnTo: options.returnTo }),
    ...(options.returnContext && { returnContext: options.returnContext }),
    ...(options.parentId && { parentId: options.parentId }),
    ...(options.priority && { priority: options.priority }),
    ...(options.timeout && { timeout: options.timeout }),
    ...(options.tags && { tags: options.tags }),
    ...(options.metadata && { metadata: options.metadata }),
  };
  
  // Add self to chain
  handoff.chain.push({
    id: handoff.id,
    from: handoff.from,
    to: handoff.to,
    timestamp: handoff.timestamp,
    status: 'pending',
  });
  
  return handoff;
}

/**
 * Create a child handoff that extends the chain
 */
export function createChildHandoff(
  parent: Handoff,
  options: Omit<CreateHandoffOptions, 'parentId'>
): Handoff {
  const child = createHandoff({
    ...options,
    parentId: parent.id,
  });
  
  // Inherit chain from parent
  child.chain = [
    ...parent.chain,
    child.chain[0],
  ];
  
  return child;
}

/**
 * Complete a handoff with results
 */
export function completeHandoff(options: CompleteHandoffOptions): HandoffResult {
  const timestamp = new Date().toISOString();
  
  const result: HandoffResult = {
    handoffId: options.handoffId,
    status: options.status,
    duration: 0, // Will be calculated by manager
    timestamp,
  };
  
  if (options.status === 'completed' && options.result) {
    result.result = options.result;
  }
  
  if (options.status === 'failed' && options.error) {
    result.error = {
      code: options.error.code,
      message: options.error.message,
      recoverable: options.recoverable ?? false,
    };
    if (options.partialResult) {
      result.partialResult = options.partialResult;
    }
  }
  
  return result;
}

/**
 * Get the chain summary as a readable string
 */
export function getChainSummary(chain: HandoffLink[]): string {
  return chain.map(link => `${link.from} -> ${link.to}`).join(' | ');
}

/**
 * Calculate total chain duration in milliseconds
 */
export function getChainDuration(chain: HandoffLink[]): number {
  if (chain.length < 2) return 0;
  
  const first = new Date(chain[0].timestamp).getTime();
  const last = new Date(chain[chain.length - 1].timestamp).getTime();
  
  return last - first;
}

/**
 * Find an agent in the chain
 */
export function findInChain(chain: HandoffLink[], agent: string): HandoffLink | undefined {
  return chain.find(link => link.from === agent || link.to === agent);
}

/**
 * Check if a handoff is part of a return path
 */
export function isReturnHandoff(handoff: Handoff): boolean {
  if (!handoff.parentId) return false;
  
  // Check if this is going back to a previous agent in the chain
  const previousAgents = new Set(handoff.chain.slice(0, -1).map(l => l.from));
  return previousAgents.has(handoff.to);
}

/**
 * Merge contexts for handoff
 */
export function mergeContexts(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  
  return merged;
}

/**
 * Extract return payload from a completed handoff
 */
export function extractReturnPayload(
  originalHandoff: Handoff,
  result: HandoffResult
): CreateHandoffOptions | null {
  if (!originalHandoff.returnTo) {
    return null;
  }
  
  return {
    from: originalHandoff.to,
    to: originalHandoff.returnTo,
    context: {
      ...originalHandoff.returnContext,
      result: result.result,
      status: result.status,
      originalHandoffId: originalHandoff.id,
    },
    parentId: originalHandoff.id,
    tags: ['return', ...(originalHandoff.tags || [])],
  };
}
