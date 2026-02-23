/**
 * LangChain adapter for agent-handoff
 */

import { HandoffManager, createHandoff, Handoff } from '../index.js';

/**
 * LangChain-compatible tool definition
 */
export interface LangChainTool {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  func: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Adapter for integrating agent-handoff with LangChain
 */
export class LangChainAdapter {
  constructor(
    private manager: HandoffManager,
    private sourceAgent: string = 'langchain-agent'
  ) {}
  
  /**
   * Create a LangChain-compatible tool for handing off to another agent
   */
  createHandoffTool(
    target: string,
    options: {
      name?: string;
      description?: string;
      handler?: (handoff: Handoff) => Promise<Record<string, unknown>>;
    } = {}
  ): LangChainTool {
    const schema = this.manager.getSchema(target);
    
    // Build tool schema from handoff schema
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    
    if (schema) {
      for (const field of schema.accepts.required) {
        properties[field] = { type: 'string', description: `Required: ${field}` };
        required.push(field);
      }
      for (const field of schema.accepts.optional || []) {
        properties[field] = { type: 'string', description: `Optional: ${field}` };
      }
    } else {
      // Generic schema
      properties.context = { type: 'object', description: 'Context to pass to the target agent' };
      required.push('context');
    }
    
    const name = options.name || `handoff_to_${target.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const description = options.description || 
      (schema?.description ? `Hand off to ${target}: ${schema.description}` : `Hand off task to ${target} agent`);
    
    return {
      name,
      description,
      schema: {
        type: 'object',
        properties,
        required,
      },
      func: async (input: Record<string, unknown>) => {
        const handoff = createHandoff({
          from: this.sourceAgent,
          to: target,
          context: input,
        });
        
        // Validate
        const validation = this.manager.validate(handoff);
        if (!validation.valid) {
          return JSON.stringify({
            error: 'Validation failed',
            errors: validation.errors,
          });
        }
        
        // Track
        const tracked = await this.manager.track(handoff);
        
        // Execute handler if provided
        if (options.handler) {
          try {
            const result = await options.handler(handoff);
            return JSON.stringify({
              status: 'completed',
              handoffId: tracked.id,
              result,
            });
          } catch (e) {
            return JSON.stringify({
              status: 'failed',
              handoffId: tracked.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        
        return JSON.stringify({
          status: 'pending',
          handoffId: tracked.id,
          message: `Handoff created to ${target}`,
        });
      },
    };
  }
  
  /**
   * Create tools for all registered schemas
   */
  createAllHandoffTools(
    handler?: (handoff: Handoff) => Promise<Record<string, unknown>>
  ): LangChainTool[] {
    const schemas = this.manager.listSchemas();
    return schemas.map(schema => 
      this.createHandoffTool(schema.name, { handler })
    );
  }
  
  /**
   * Convert messages from LangChain format to handoff format
   */
  convertMessages(messages: Array<{ type: string; content: string }>): Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
  }> {
    return messages.map(m => ({
      role: this.mapRole(m.type),
      content: m.content,
    }));
  }
  
  private mapRole(type: string): 'user' | 'assistant' | 'system' | 'tool' {
    switch (type.toLowerCase()) {
      case 'human':
      case 'user':
        return 'user';
      case 'ai':
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      case 'function':
      case 'tool':
        return 'tool';
      default:
        return 'assistant';
    }
  }
}

/**
 * Create a LangChain adapter
 */
export function createLangChainAdapter(
  manager: HandoffManager,
  sourceAgent?: string
): LangChainAdapter {
  return new LangChainAdapter(manager, sourceAgent);
}
