/**
 * Core types for agent-handoff protocol
 */

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type HandoffStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed' | 'timeout' | 'cancelled';

/**
 * A single message in conversation history
 */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Link in the handoff chain
 */
export interface HandoffLink {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  status: HandoffStatus;
  duration?: number;
}

/**
 * Core handoff payload
 */
export interface Handoff {
  /** Unique identifier for this handoff */
  id: string;
  
  /** Source agent identifier */
  from: string;
  
  /** Target agent identifier */
  to: string;
  
  /** ISO timestamp */
  timestamp: string;
  
  /** Task-specific context for the receiving agent */
  context: Record<string, unknown>;
  
  /** Compressed summary of prior conversation */
  conversationSummary?: string;
  
  /** Selected relevant messages from history */
  relevantMessages?: Message[];
  
  /** Agent to return results to (for sub-task pattern) */
  returnTo?: string;
  
  /** Context to include with return */
  returnContext?: Record<string, unknown>;
  
  /** Parent handoff ID (for chaining) */
  parentId?: string;
  
  /** Full chain of handoffs leading to this one */
  chain: HandoffLink[];
  
  /** Priority level */
  priority?: Priority;
  
  /** Timeout in milliseconds */
  timeout?: number;
  
  /** Arbitrary tags for filtering/grouping */
  tags?: string[];
  
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for creating a new handoff
 */
export interface CreateHandoffOptions {
  from: string;
  to: string;
  context: Record<string, unknown>;
  conversationSummary?: string;
  relevantMessages?: Message[];
  returnTo?: string;
  returnContext?: Record<string, unknown>;
  parentId?: string;
  priority?: Priority;
  timeout?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Type definition in a schema
 */
export type SchemaType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'object'
  | 'string[]'
  | 'number[]'
  | { enum: string[] }
  | { type: string; items?: SchemaType };

/**
 * Field definitions for schema
 */
export interface SchemaFields {
  required: string[];
  optional?: string[];
  types?: Record<string, SchemaType>;
}

/**
 * Schema defining what an agent accepts and returns
 */
export interface HandoffSchema {
  /** Agent name */
  name: string;
  
  /** Semantic version */
  version: string;
  
  /** What this agent accepts */
  accepts: SchemaFields;
  
  /** What this agent returns */
  returns: SchemaFields;
  
  /** Compatible versions (semver ranges) */
  compatibleWith?: string[];
  
  /** Human-readable description */
  description?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
  expected?: unknown;
  received?: unknown;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path?: string;
}

/**
 * Completion result
 */
export interface HandoffResult {
  handoffId: string;
  status: 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: HandoffErrorInfo;
  partialResult?: Record<string, unknown>;
  duration: number;
  timestamp: string;
}

export interface HandoffErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Options for completing a handoff
 */
export interface CompleteHandoffOptions {
  handoffId: string;
  status: 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  partialResult?: Record<string, unknown>;
  recoverable?: boolean;
}

/**
 * Context compression options
 */
export interface CompressContextOptions {
  messages: Message[];
  maxTokens?: number;
  strategy?: 'relevance' | 'recency' | 'summary';
  focus?: string[];
}

/**
 * Compressed context result
 */
export interface CompressedContext {
  summary: string;
  messages: Message[];
  tokenCount: number;
  originalCount: number;
  compressionRatio: number;
}

/**
 * Tracked handoff with state
 */
export interface TrackedHandoff extends Handoff {
  status: HandoffStatus;
  startTime: number;
  endTime?: number;
  result?: HandoffResult;
}

/**
 * Middleware function type
 */
export type MiddlewareFn = (
  handoff: Handoff,
  next: (handoff: Handoff) => Promise<HandoffResult>
) => Promise<HandoffResult>;

/**
 * Manager options
 */
export interface HandoffManagerOptions {
  /** Storage backend */
  storage?: StorageBackend;
  
  /** Default timeout in ms */
  defaultTimeout?: number;
  
  /** Enable chain tracking */
  trackChains?: boolean;
}

/**
 * Storage backend interface
 */
export interface StorageBackend {
  save(handoff: TrackedHandoff): Promise<void>;
  get(id: string): Promise<TrackedHandoff | null>;
  find(query: StorageQuery): Promise<TrackedHandoff[]>;
  update(id: string, updates: Partial<TrackedHandoff>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface StorageQuery {
  agent?: string;
  status?: HandoffStatus;
  since?: Date;
  limit?: number;
  tags?: string[];
}
