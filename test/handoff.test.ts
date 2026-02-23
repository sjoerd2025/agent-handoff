import { describe, it, expect } from 'vitest';
import {
  createHandoff,
  createChildHandoff,
  completeHandoff,
  getChainSummary,
  getChainDuration,
  findInChain,
  isReturnHandoff,
  mergeContexts,
  extractReturnPayload,
} from '../src/handoff.js';

describe('createHandoff', () => {
  it('creates a handoff with required fields', () => {
    const handoff = createHandoff({
      from: 'agent-a',
      to: 'agent-b',
      context: { query: 'test' },
    });
    
    expect(handoff.id).toBeDefined();
    expect(handoff.from).toBe('agent-a');
    expect(handoff.to).toBe('agent-b');
    expect(handoff.context.query).toBe('test');
    expect(handoff.timestamp).toBeDefined();
    expect(handoff.chain).toHaveLength(1);
  });
  
  it('includes optional fields when provided', () => {
    const handoff = createHandoff({
      from: 'agent-a',
      to: 'agent-b',
      context: { task: 'analyze' },
      conversationSummary: 'User asked for analysis',
      returnTo: 'agent-a',
      priority: 'high',
      timeout: 5000,
      tags: ['research', 'urgent'],
    });
    
    expect(handoff.conversationSummary).toBe('User asked for analysis');
    expect(handoff.returnTo).toBe('agent-a');
    expect(handoff.priority).toBe('high');
    expect(handoff.timeout).toBe(5000);
    expect(handoff.tags).toEqual(['research', 'urgent']);
  });
  
  it('adds itself to the chain', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'worker',
      context: {},
    });
    
    expect(handoff.chain).toHaveLength(1);
    expect(handoff.chain[0].from).toBe('coordinator');
    expect(handoff.chain[0].to).toBe('worker');
    expect(handoff.chain[0].status).toBe('pending');
  });
});

describe('createChildHandoff', () => {
  it('extends the parent chain', () => {
    const parent = createHandoff({
      from: 'a',
      to: 'b',
      context: { step: 1 },
    });
    
    const child = createChildHandoff(parent, {
      from: 'b',
      to: 'c',
      context: { step: 2 },
    });
    
    expect(child.parentId).toBe(parent.id);
    expect(child.chain).toHaveLength(2);
    expect(child.chain[0].from).toBe('a');
    expect(child.chain[1].from).toBe('b');
  });
});

describe('completeHandoff', () => {
  it('creates completion for successful handoff', () => {
    const result = completeHandoff({
      handoffId: 'test-123',
      status: 'completed',
      result: { findings: ['item1', 'item2'] },
    });
    
    expect(result.handoffId).toBe('test-123');
    expect(result.status).toBe('completed');
    expect(result.result?.findings).toHaveLength(2);
    expect(result.timestamp).toBeDefined();
  });
  
  it('creates completion for failed handoff', () => {
    const result = completeHandoff({
      handoffId: 'test-456',
      status: 'failed',
      error: { code: 'TIMEOUT', message: 'Task timed out' },
      partialResult: { partial: true },
      recoverable: true,
    });
    
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.error?.recoverable).toBe(true);
    expect(result.partialResult?.partial).toBe(true);
  });
});

describe('getChainSummary', () => {
  it('formats chain as readable string', () => {
    const handoff = createHandoff({ from: 'a', to: 'b', context: {} });
    const child = createChildHandoff(handoff, { from: 'b', to: 'c', context: {} });
    
    const summary = getChainSummary(child.chain);
    expect(summary).toBe('a -> b | b -> c');
  });
});

describe('findInChain', () => {
  it('finds an agent in the chain', () => {
    const handoff = createHandoff({ from: 'a', to: 'b', context: {} });
    const child = createChildHandoff(handoff, { from: 'b', to: 'c', context: {} });
    
    const link = findInChain(child.chain, 'b');
    expect(link).toBeDefined();
    expect(link?.from).toBe('a');
    expect(link?.to).toBe('b');
  });
  
  it('returns undefined for unknown agent', () => {
    const handoff = createHandoff({ from: 'a', to: 'b', context: {} });
    const link = findInChain(handoff.chain, 'z');
    expect(link).toBeUndefined();
  });
});

describe('isReturnHandoff', () => {
  it('identifies return handoffs', () => {
    const h1 = createHandoff({ from: 'a', to: 'b', context: {} });
    const h2 = createChildHandoff(h1, { from: 'b', to: 'c', context: {} });
    const h3 = createChildHandoff(h2, { from: 'c', to: 'a', context: {} });
    
    expect(isReturnHandoff(h1)).toBe(false);
    expect(isReturnHandoff(h2)).toBe(false);
    expect(isReturnHandoff(h3)).toBe(true);
  });
});

describe('mergeContexts', () => {
  it('merges two context objects', () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    
    const merged = mergeContexts(base, override);
    expect(merged).toEqual({ a: 1, b: 3, c: 4 });
  });
  
  it('ignores undefined values in override', () => {
    const base = { a: 1, b: 2 };
    const override = { b: undefined, c: 3 };
    
    const merged = mergeContexts(base, override);
    expect(merged).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('extractReturnPayload', () => {
  it('creates return handoff options', () => {
    const original = createHandoff({
      from: 'coordinator',
      to: 'researcher',
      context: { query: 'test' },
      returnTo: 'coordinator',
      returnContext: { originalRequestId: '123' },
    });
    
    const result = completeHandoff({
      handoffId: original.id,
      status: 'completed',
      result: { findings: ['a', 'b'] },
    });
    
    const payload = extractReturnPayload(original, result);
    
    expect(payload).not.toBeNull();
    expect(payload?.from).toBe('researcher');
    expect(payload?.to).toBe('coordinator');
    expect(payload?.context.originalRequestId).toBe('123');
    expect(payload?.context.result).toEqual({ findings: ['a', 'b'] });
    expect(payload?.tags).toContain('return');
  });
  
  it('returns null when no returnTo specified', () => {
    const original = createHandoff({
      from: 'a',
      to: 'b',
      context: {},
    });
    
    const result = completeHandoff({
      handoffId: original.id,
      status: 'completed',
      result: {},
    });
    
    expect(extractReturnPayload(original, result)).toBeNull();
  });
});
