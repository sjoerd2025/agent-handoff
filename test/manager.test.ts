import { describe, it, expect, beforeEach } from 'vitest';
import { HandoffManager } from '../src/manager.js';
import { createHandoff, completeHandoff } from '../src/handoff.js';
import { HandoffSchema } from '../src/types.js';

describe('HandoffManager', () => {
  let manager: HandoffManager;
  
  beforeEach(() => {
    manager = new HandoffManager();
  });
  
  describe('schema management', () => {
    const schema: HandoffSchema = {
      name: 'test-agent',
      version: '1.0.0',
      accepts: { required: ['input'] },
      returns: { required: ['output'] },
    };
    
    it('registers and retrieves schemas', () => {
      manager.registerSchema(schema);
      
      const retrieved = manager.getSchema('test-agent');
      expect(retrieved).toEqual(schema);
    });
    
    it('lists all schemas', () => {
      manager.registerSchema(schema);
      manager.registerSchema({
        ...schema,
        name: 'another-agent',
      });
      
      const schemas = manager.listSchemas();
      expect(schemas).toHaveLength(2);
    });
    
    it('returns undefined for unknown schema', () => {
      const retrieved = manager.getSchema('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });
  
  describe('validation', () => {
    it('validates handoff against registered schema', () => {
      manager.registerSchema({
        name: 'typed-agent',
        version: '1.0.0',
        accepts: { required: ['data'] },
        returns: { required: ['result'] },
      });
      
      const handoff = createHandoff({
        from: 'caller',
        to: 'typed-agent',
        context: { data: 'test' },
      });
      
      const result = manager.validate(handoff);
      expect(result.valid).toBe(true);
    });
    
    it('warns for unregistered target', () => {
      const handoff = createHandoff({
        from: 'caller',
        to: 'unknown-agent',
        context: { data: 'test' },
      });
      
      const result = manager.validate(handoff);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === 'UNKNOWN_TARGET')).toBe(true);
    });
  });
  
  describe('tracking', () => {
    it('tracks a handoff', async () => {
      const handoff = createHandoff({
        from: 'a',
        to: 'b',
        context: { x: 1 },
      });
      
      const tracked = await manager.track(handoff);
      
      expect(tracked.id).toBe(handoff.id);
      expect(tracked.status).toBe('pending');
      expect(tracked.startTime).toBeDefined();
    });
    
    it('updates status', async () => {
      const handoff = createHandoff({
        from: 'a',
        to: 'b',
        context: {},
      });
      
      await manager.track(handoff);
      await manager.updateStatus(handoff.id, 'in_progress');
      
      const state = await manager.getState(handoff.id);
      expect(state?.status).toBe('in_progress');
    });
    
    it('completes a handoff', async () => {
      const handoff = createHandoff({
        from: 'a',
        to: 'b',
        context: {},
      });
      
      await manager.track(handoff);
      
      const result = completeHandoff({
        handoffId: handoff.id,
        status: 'completed',
        result: { done: true },
      });
      
      await manager.complete(handoff.id, result);
      
      const state = await manager.getState(handoff.id);
      expect(state?.status).toBe('completed');
      expect(state?.duration).toBeDefined();
    });
  });
  
  describe('querying', () => {
    beforeEach(async () => {
      // Set up some test data
      const h1 = createHandoff({ from: 'a', to: 'b', context: {}, tags: ['type1'] });
      const h2 = createHandoff({ from: 'b', to: 'c', context: {}, tags: ['type2'] });
      const h3 = createHandoff({ from: 'c', to: 'a', context: {}, tags: ['type1'] });
      
      await manager.track(h1);
      await manager.track(h2);
      await manager.track(h3);
      await manager.updateStatus(h1.id, 'completed');
    });
    
    it('finds by agent', async () => {
      const results = await manager.findByAgent('b');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
    
    it('finds by status', async () => {
      const results = await manager.findByStatus('completed');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
    
    it('finds recent', async () => {
      const results = await manager.findRecent(10);
      expect(results.length).toBeGreaterThanOrEqual(3);
    });
    
    it('finds by tags', async () => {
      const results = await manager.findByTags(['type1']);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
  
  describe('middleware', () => {
    it('runs middleware in order', async () => {
      const calls: string[] = [];
      
      manager.use(async (handoff, next) => {
        calls.push('middleware1-before');
        const result = await next(handoff);
        calls.push('middleware1-after');
        return result;
      });
      
      manager.use(async (handoff, next) => {
        calls.push('middleware2-before');
        const result = await next(handoff);
        calls.push('middleware2-after');
        return result;
      });
      
      const handoff = createHandoff({ from: 'a', to: 'b', context: {} });
      
      await manager.execute(handoff, async () => {
        calls.push('handler');
        return completeHandoff({
          handoffId: handoff.id,
          status: 'completed',
          result: {},
        });
      });
      
      expect(calls).toEqual([
        'middleware1-before',
        'middleware2-before',
        'handler',
        'middleware2-after',
        'middleware1-after',
      ]);
    });
    
    it('handles errors in execution', async () => {
      const handoff = createHandoff({ from: 'a', to: 'b', context: {} });
      
      const result = await manager.execute(handoff, async () => {
        throw new Error('Test error');
      });
      
      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('EXECUTION_ERROR');
    });
  });
  
  describe('chain tracking', () => {
    it('retrieves full chain', async () => {
      const h1 = createHandoff({ from: 'a', to: 'b', context: {} });
      const h2 = createHandoff({ 
        from: 'b', 
        to: 'c', 
        context: {},
        parentId: h1.id,
      });
      h2.chain = [...h1.chain, h2.chain[0]];
      
      await manager.track(h1);
      await manager.track(h2);
      
      const chain = await manager.getChain(h2.id);
      expect(chain.length).toBeGreaterThanOrEqual(1);
    });
  });
});
