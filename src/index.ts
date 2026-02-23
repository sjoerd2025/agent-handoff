/**
 * agent-handoff - Context transfer protocol for multi-agent systems
 */

// Types
export type {
  Handoff,
  CreateHandoffOptions,
  HandoffSchema,
  HandoffResult,
  HandoffErrorInfo,
  CompleteHandoffOptions,
  TrackedHandoff,
  HandoffStatus,
  Priority,
  Message,
  HandoffLink,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaFields,
  SchemaType,
  CompressContextOptions,
  CompressedContext,
  HandoffManagerOptions,
  StorageBackend,
  StorageQuery,
  MiddlewareFn,
} from './types.js';

// Core handoff functions
export {
  createHandoff,
  createChildHandoff,
  completeHandoff,
  getChainSummary,
  getChainDuration,
  findInChain,
  isReturnHandoff,
  mergeContexts,
  extractReturnPayload,
} from './handoff.js';

// Validation
export {
  validateHandoff,
  validateResult,
  areCompatible,
  defineSchema,
} from './validation.js';

// Manager
export { HandoffManager, createManager } from './manager.js';

// Compression
export { compressContext, createMinimalContext } from './compress.js';

// Error class
export class HandoffError extends Error {
  constructor(
    public code: string,
    message: string,
    public recoverable = false
  ) {
    super(message);
    this.name = 'HandoffError';
  }
}

// Utility to create a handoff function for a specific target
export function createHandoffFunction(config: {
  manager: import('./manager.js').HandoffManager;
  target: string;
  contextMapper?: (args: Record<string, unknown>) => Record<string, unknown>;
  defaultPriority?: import('./types.js').Priority;
  defaultTimeout?: number;
}): (args: Record<string, unknown>, from: string) => import('./types.js').Handoff {
  const { manager, target, contextMapper, defaultPriority, defaultTimeout } = config;
  
  return (args: Record<string, unknown>, from: string) => {
    const { createHandoff } = require('./handoff.js');
    
    const context = contextMapper ? contextMapper(args) : args;
    
    const handoff = createHandoff({
      from,
      to: target,
      context,
      priority: defaultPriority,
      timeout: defaultTimeout,
    });
    
    // Validate if schema exists
    const validation = manager.validate(handoff);
    if (!validation.valid) {
      const errors = validation.errors.map(e => e.message).join('; ');
      throw new HandoffError('VALIDATION_FAILED', errors);
    }
    
    return handoff;
  };
}

// Version
export const VERSION = '0.1.0';
