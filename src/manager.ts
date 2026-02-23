/**
 * Handoff manager for tracking and orchestrating handoffs
 */

import {
  Handoff,
  HandoffSchema,
  HandoffResult,
  TrackedHandoff,
  HandoffManagerOptions,
  ValidationResult,
  MiddlewareFn,
  StorageBackend,
  StorageQuery,
  HandoffStatus,
} from './types.js';
import { validateHandoff, validateResult } from './validation.js';

/**
 * In-memory storage backend
 */
class MemoryStorage implements StorageBackend {
  private handoffs = new Map<string, TrackedHandoff>();
  
  async save(handoff: TrackedHandoff): Promise<void> {
    this.handoffs.set(handoff.id, handoff);
  }
  
  async get(id: string): Promise<TrackedHandoff | null> {
    return this.handoffs.get(id) || null;
  }
  
  async find(query: StorageQuery): Promise<TrackedHandoff[]> {
    let results = Array.from(this.handoffs.values());
    
    if (query.agent) {
      results = results.filter(h => h.from === query.agent || h.to === query.agent);
    }
    
    if (query.status) {
      results = results.filter(h => h.status === query.status);
    }
    
    if (query.since) {
      const sinceTime = query.since.getTime();
      results = results.filter(h => h.startTime >= sinceTime);
    }
    
    if (query.tags && query.tags.length > 0) {
      const queryTags = new Set(query.tags);
      results = results.filter(h => 
        h.tags?.some(t => queryTags.has(t))
      );
    }
    
    // Sort by time descending
    results.sort((a, b) => b.startTime - a.startTime);
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }
  
  async update(id: string, updates: Partial<TrackedHandoff>): Promise<void> {
    const existing = this.handoffs.get(id);
    if (existing) {
      this.handoffs.set(id, { ...existing, ...updates });
    }
  }
  
  async delete(id: string): Promise<void> {
    this.handoffs.delete(id);
  }
}

/**
 * Handoff manager
 */
export class HandoffManager {
  private schemas = new Map<string, HandoffSchema>();
  private storage: StorageBackend;
  private middleware: MiddlewareFn[] = [];
  private defaultTimeout: number;
  private trackChains: boolean;
  
  constructor(options: HandoffManagerOptions = {}) {
    this.storage = options.storage || new MemoryStorage();
    this.defaultTimeout = options.defaultTimeout || 30000;
    this.trackChains = options.trackChains ?? true;
  }
  
  /**
   * Register an agent schema
   */
  registerSchema(schema: HandoffSchema): void {
    this.schemas.set(schema.name, schema);
  }
  
  /**
   * Get a registered schema
   */
  getSchema(name: string): HandoffSchema | undefined {
    return this.schemas.get(name);
  }
  
  /**
   * List all registered schemas
   */
  listSchemas(): HandoffSchema[] {
    return Array.from(this.schemas.values());
  }
  
  /**
   * Validate a handoff against the target schema
   */
  validate(handoff: Handoff): ValidationResult {
    const schema = this.schemas.get(handoff.to);
    
    if (!schema) {
      return {
        valid: true,
        errors: [],
        warnings: [{
          code: 'UNKNOWN_TARGET',
          message: `No schema registered for target '${handoff.to}'`,
        }],
      };
    }
    
    return validateHandoff(handoff, schema);
  }
  
  /**
   * Validate a result against the source schema
   */
  validateResult(handoff: Handoff, result: HandoffResult): ValidationResult {
    const schema = this.schemas.get(handoff.to);
    
    if (!schema) {
      return {
        valid: true,
        errors: [],
        warnings: [{
          code: 'UNKNOWN_SOURCE',
          message: `No schema registered for '${handoff.to}'`,
        }],
      };
    }
    
    return validateResult(result, schema);
  }
  
  /**
   * Track a handoff
   */
  async track(handoff: Handoff): Promise<TrackedHandoff> {
    const tracked: TrackedHandoff = {
      ...handoff,
      status: 'pending',
      startTime: Date.now(),
    };
    
    await this.storage.save(tracked);
    
    return tracked;
  }
  
  /**
   * Update handoff status
   */
  async updateStatus(id: string, status: HandoffStatus): Promise<void> {
    await this.storage.update(id, { status });
  }
  
  /**
   * Complete a handoff
   */
  async complete(id: string, result: HandoffResult): Promise<void> {
    const handoff = await this.storage.get(id);
    if (!handoff) {
      throw new Error(`Handoff not found: ${id}`);
    }
    
    const endTime = Date.now();
    const duration = endTime - handoff.startTime;
    
    await this.storage.update(id, {
      status: result.status === 'completed' ? 'completed' : 'failed',
      endTime,
      result: { ...result, duration },
    });
    
    // Update chain status
    if (this.trackChains) {
      const chainIndex = handoff.chain.findIndex(l => l.id === id);
      if (chainIndex >= 0) {
        const updatedChain = [...handoff.chain];
        updatedChain[chainIndex] = {
          ...updatedChain[chainIndex],
          status: result.status === 'completed' ? 'completed' : 'failed',
          duration,
        };
        await this.storage.update(id, { chain: updatedChain });
      }
    }
  }
  
  /**
   * Get a handoff by ID
   */
  async get(id: string): Promise<TrackedHandoff | null> {
    return this.storage.get(id);
  }
  
  /**
   * Get handoff state
   */
  async getState(id: string): Promise<{
    status: HandoffStatus;
    duration?: number;
    result?: HandoffResult;
  } | null> {
    const handoff = await this.storage.get(id);
    if (!handoff) return null;
    
    return {
      status: handoff.status,
      duration: handoff.endTime ? handoff.endTime - handoff.startTime : undefined,
      result: handoff.result,
    };
  }
  
  /**
   * Get the full chain for a handoff
   */
  async getChain(id: string): Promise<TrackedHandoff[]> {
    const handoff = await this.storage.get(id);
    if (!handoff) return [];
    
    const chain: TrackedHandoff[] = [];
    
    for (const link of handoff.chain) {
      const tracked = await this.storage.get(link.id);
      if (tracked) {
        chain.push(tracked);
      }
    }
    
    return chain;
  }
  
  /**
   * Find handoffs by agent
   */
  async findByAgent(agent: string): Promise<TrackedHandoff[]> {
    return this.storage.find({ agent });
  }
  
  /**
   * Find recent handoffs
   */
  async findRecent(limit = 10, since?: Date): Promise<TrackedHandoff[]> {
    return this.storage.find({ limit, since });
  }
  
  /**
   * Find handoffs by status
   */
  async findByStatus(status: HandoffStatus): Promise<TrackedHandoff[]> {
    return this.storage.find({ status });
  }
  
  /**
   * Find handoffs by tags
   */
  async findByTags(tags: string[]): Promise<TrackedHandoff[]> {
    return this.storage.find({ tags });
  }
  
  /**
   * Add middleware
   */
  use(middleware: MiddlewareFn): void {
    this.middleware.push(middleware);
  }
  
  /**
   * Execute a handoff through middleware chain
   */
  async execute(
    handoff: Handoff,
    handler: (handoff: Handoff) => Promise<HandoffResult>
  ): Promise<HandoffResult> {
    // Build middleware chain
    let index = 0;
    
    const next = async (h: Handoff): Promise<HandoffResult> => {
      if (index < this.middleware.length) {
        const middleware = this.middleware[index];
        index++;
        return middleware(h, next);
      }
      return handler(h);
    };
    
    // Track before execution
    const tracked = await this.track(handoff);
    await this.updateStatus(tracked.id, 'in_progress');
    
    try {
      // Execute with timeout
      const timeout = handoff.timeout || this.defaultTimeout;
      
      const result = await Promise.race([
        next(handoff),
        new Promise<HandoffResult>((_, reject) => {
          setTimeout(() => reject(new Error('Handoff timeout')), timeout);
        }),
      ]);
      
      await this.complete(tracked.id, result);
      return result;
    } catch (error) {
      const failResult: HandoffResult = {
        handoffId: handoff.id,
        status: 'failed',
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
        duration: Date.now() - tracked.startTime,
        timestamp: new Date().toISOString(),
      };
      
      await this.complete(tracked.id, failResult);
      return failResult;
    }
  }
  
  /**
   * Clean up old handoffs
   */
  async cleanup(olderThan: Date): Promise<number> {
    const old = await this.storage.find({ since: new Date(0) });
    let cleaned = 0;
    
    for (const h of old) {
      if (h.startTime < olderThan.getTime()) {
        await this.storage.delete(h.id);
        cleaned++;
      }
    }
    
    return cleaned;
  }
}

/**
 * Create a pre-configured manager
 */
export function createManager(options?: HandoffManagerOptions): HandoffManager {
  return new HandoffManager(options);
}
