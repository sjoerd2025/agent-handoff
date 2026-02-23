import { describe, it, expect } from 'vitest';
import {
  validateHandoff,
  validateResult,
  areCompatible,
  defineSchema,
} from '../src/validation.js';
import { createHandoff, completeHandoff } from '../src/handoff.js';
import { HandoffSchema } from '../src/types.js';

describe('validateHandoff', () => {
  const schema: HandoffSchema = {
    name: 'research-agent',
    version: '1.0.0',
    accepts: {
      required: ['query', 'maxResults'],
      optional: ['filters'],
      types: {
        query: 'string',
        maxResults: 'number',
      },
    },
    returns: {
      required: ['results'],
      optional: ['metadata'],
    },
  };
  
  it('validates a correct handoff', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'research-agent',
      context: {
        query: 'AI agents',
        maxResults: 10,
      },
    });
    
    const result = validateHandoff(handoff, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  
  it('rejects handoff missing required fields', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'research-agent',
      context: {
        query: 'AI agents',
        // missing maxResults
      },
    });
    
    const result = validateHandoff(handoff, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
  });
  
  it('rejects handoff with wrong types', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'research-agent',
      context: {
        query: 'AI agents',
        maxResults: 'ten', // should be number
      },
    });
    
    const result = validateHandoff(handoff, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'TYPE_MISMATCH')).toBe(true);
  });
  
  it('warns about unknown fields', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'research-agent',
      context: {
        query: 'AI agents',
        maxResults: 10,
        unknownField: 'value',
      },
    });
    
    const result = validateHandoff(handoff, schema);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.code === 'UNKNOWN_FIELD')).toBe(true);
  });
  
  it('rejects mismatched target', () => {
    const handoff = createHandoff({
      from: 'coordinator',
      to: 'wrong-agent',
      context: {
        query: 'AI agents',
        maxResults: 10,
      },
    });
    
    const result = validateHandoff(handoff, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'SCHEMA_MISMATCH')).toBe(true);
  });
});

describe('validateResult', () => {
  const schema: HandoffSchema = {
    name: 'research-agent',
    version: '1.0.0',
    accepts: {
      required: ['query'],
    },
    returns: {
      required: ['results', 'count'],
      optional: ['metadata'],
      types: {
        results: 'string[]',
        count: 'number',
      },
    },
  };
  
  it('validates a correct result', () => {
    const result = completeHandoff({
      handoffId: 'test-123',
      status: 'completed',
      result: {
        results: ['result1', 'result2'],
        count: 2,
      },
    });
    
    const validation = validateResult(result, schema);
    expect(validation.valid).toBe(true);
  });
  
  it('rejects result missing required returns', () => {
    const result = completeHandoff({
      handoffId: 'test-123',
      status: 'completed',
      result: {
        results: ['result1'],
        // missing count
      },
    });
    
    const validation = validateResult(result, schema);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.code === 'MISSING_REQUIRED_RETURN')).toBe(true);
  });
});

describe('areCompatible', () => {
  const sender: HandoffSchema = {
    name: 'task-router',
    version: '2.0.0',
    accepts: {
      required: ['task'],
    },
    returns: {
      required: ['assignee', 'context'],
      optional: ['priority'],
    },
  };
  
  const receiver: HandoffSchema = {
    name: 'worker-agent',
    version: '1.0.0',
    accepts: {
      required: ['assignee', 'context'],
      optional: ['priority'],
    },
    returns: {
      required: ['output'],
    },
    compatibleWith: ['task-router@^2.0.0'],
  };
  
  it('passes when contracts align', () => {
    const result = areCompatible(sender, receiver);
    expect(result.valid).toBe(true);
  });
  
  it('fails when receiver needs field sender doesnt return', () => {
    const badReceiver: HandoffSchema = {
      ...receiver,
      accepts: {
        required: ['assignee', 'context', 'missingField'],
      },
    };
    
    const result = areCompatible(sender, badReceiver);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INCOMPATIBLE_CONTRACT')).toBe(true);
  });
});

describe('defineSchema', () => {
  it('creates a schema from simple definition', () => {
    const schema = defineSchema('my-agent', '1.0.0', {
      description: 'My test agent',
      accepts: ['input'],
      optionalAccepts: ['config'],
      returns: ['output'],
      optionalReturns: ['logs'],
    });
    
    expect(schema.name).toBe('my-agent');
    expect(schema.version).toBe('1.0.0');
    expect(schema.description).toBe('My test agent');
    expect(schema.accepts.required).toEqual(['input']);
    expect(schema.accepts.optional).toEqual(['config']);
    expect(schema.returns.required).toEqual(['output']);
    expect(schema.returns.optional).toEqual(['logs']);
  });
});
