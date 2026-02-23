# agent-handoff

Context transfer protocol for multi-agent systems. Clean handoffs between AI agents with schema validation, state serialization, and chain tracking.

## The Problem

When multiple AI agents work together, handing off context between them is messy:

- Conversation history gets lost or bloated
- No standard format for "here's what you need to know"
- Hard to track which agent handled what
- No clean way to return results when sub-tasks complete
- State serialization is ad-hoc and error-prone

## What This Solves

agent-handoff provides:

- **Handoff Protocol**: Standardized format for agent-to-agent context transfer
- **Context Packaging**: Smart compression of conversation history into relevant summaries
- **Schema Validation**: Ensure receiving agents can handle the handoff payload
- **Chain Tracking**: Full audit trail of which agents handled what
- **Return Callbacks**: Clean mechanism for sub-agents to return results

## Installation

```bash
npm install agent-handoff
```

## Quick Start

```typescript
import { HandoffManager, createHandoff, HandoffSchema } from 'agent-handoff';

// Define what context your agent needs
const researchAgentSchema: HandoffSchema = {
  name: 'research-agent',
  version: '1.0.0',
  accepts: {
    required: ['query', 'constraints'],
    optional: ['priorFindings', 'maxDepth']
  },
  returns: {
    required: ['findings', 'sources'],
    optional: ['confidence', 'followUpQuestions']
  }
};

// Create a handoff manager
const manager = new HandoffManager();

// Register agent schemas
manager.registerSchema(researchAgentSchema);

// Create a handoff
const handoff = createHandoff({
  from: 'coordinator-agent',
  to: 'research-agent',
  context: {
    query: 'Find recent developments in agent orchestration',
    constraints: { maxSources: 10, recency: '30d' }
  },
  conversationSummary: 'User asked about multi-agent coordination patterns',
  returnTo: 'coordinator-agent'
});

// Validate before sending
const validation = manager.validate(handoff);
if (!validation.valid) {
  console.error('Handoff rejected:', validation.errors);
}

// Track the handoff
const tracked = manager.track(handoff);
console.log('Handoff ID:', tracked.id);
```

## Handoff Protocol

A handoff payload contains:

```typescript
interface Handoff {
  // Routing
  id: string;
  from: string;
  to: string;
  timestamp: string;
  
  // Context (what the receiving agent needs)
  context: Record<string, unknown>;
  
  // Compressed history (optional)
  conversationSummary?: string;
  relevantMessages?: Message[];
  
  // Return path (for sub-task completion)
  returnTo?: string;
  returnContext?: Record<string, unknown>;
  
  // Chain tracking
  chain: HandoffLink[];
  
  // Metadata
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  timeout?: number;
  tags?: string[];
}
```

## Schema Validation

Define what your agent accepts and returns:

```typescript
const schema: HandoffSchema = {
  name: 'code-review-agent',
  version: '2.1.0',
  
  accepts: {
    required: ['code', 'language'],
    optional: ['style-guide', 'focus-areas'],
    types: {
      code: 'string',
      language: { enum: ['typescript', 'python', 'go', 'rust'] },
      'style-guide': 'string',
      'focus-areas': 'string[]'
    }
  },
  
  returns: {
    required: ['review', 'issues'],
    optional: ['suggestions', 'score'],
    types: {
      review: 'string',
      issues: 'Issue[]',
      suggestions: 'string[]',
      score: 'number'
    }
  },
  
  // Compatibility declarations
  compatibleWith: ['code-review-agent@^1.0.0']
};
```

## Context Compression

Reduce token overhead when handing off:

```typescript
import { compressContext } from 'agent-handoff';

const compressed = compressContext({
  messages: fullConversationHistory,
  maxTokens: 2000,
  strategy: 'relevance', // or 'recency', 'summary'
  focus: ['user requirements', 'technical constraints']
});

// Use compressed context in handoff
const handoff = createHandoff({
  from: 'main-agent',
  to: 'specialist-agent',
  context: taskData,
  conversationSummary: compressed.summary,
  relevantMessages: compressed.messages
});
```

## Chain Tracking

Full audit trail of multi-agent workflows:

```typescript
const manager = new HandoffManager();

// Each handoff automatically tracks its chain
const h1 = manager.track(createHandoff({ from: 'A', to: 'B', ... }));
const h2 = manager.track(createHandoff({ from: 'B', to: 'C', ..., parentId: h1.id }));
const h3 = manager.track(createHandoff({ from: 'C', to: 'D', ..., parentId: h2.id }));

// Get full chain
const chain = manager.getChain(h3.id);
// Returns: [A -> B, B -> C, C -> D]

// Find all handoffs involving an agent
const bHandoffs = manager.findByAgent('B');

// Get current state
const state = manager.getState(h1.id);
// { status: 'completed', duration: 3420, returnValue: {...} }
```

## Return Results

Clean mechanism for sub-agents to return results:

```typescript
import { completeHandoff } from 'agent-handoff';

// When sub-agent completes its task
const result = completeHandoff({
  handoffId: originalHandoff.id,
  status: 'completed',
  result: {
    findings: [...],
    sources: [...],
    confidence: 0.87
  }
});

// Result automatically routed to returnTo agent
// with returnContext merged in
```

## Error Handling

Handle failures gracefully:

```typescript
import { failHandoff, HandoffError } from 'agent-handoff';

try {
  // Agent attempts task...
} catch (error) {
  failHandoff({
    handoffId: handoff.id,
    error: new HandoffError('TIMEOUT', 'Research took too long'),
    partialResult: { findings: partialFindings },
    recoverable: true
  });
}
```

## Middleware

Add custom processing to handoffs:

```typescript
const manager = new HandoffManager();

// Add logging
manager.use(async (handoff, next) => {
  console.log(`Handoff: ${handoff.from} -> ${handoff.to}`);
  const result = await next(handoff);
  console.log(`Completed: ${handoff.id}`);
  return result;
});

// Add validation
manager.use(async (handoff, next) => {
  if (!handoff.context.query) {
    throw new HandoffError('INVALID_CONTEXT', 'Missing query');
  }
  return next(handoff);
});

// Add metrics
manager.use(metricsMiddleware({ prefix: 'agent_handoff' }));
```

## Framework Integration

Works with any agent framework:

```typescript
// With LangChain
import { LangChainAdapter } from 'agent-handoff/adapters/langchain';

const adapter = new LangChainAdapter(manager);
const tool = adapter.createHandoffTool('research-agent');

// With AutoGen
import { AutoGenAdapter } from 'agent-handoff/adapters/autogen';

// With custom agents
import { createHandoffFunction } from 'agent-handoff';

const handoffToSpecialist = createHandoffFunction({
  manager,
  target: 'specialist-agent',
  contextMapper: (args) => ({ query: args.task, constraints: args.limits })
});
```

## CLI

Inspect and debug handoffs:

```bash
# List recent handoffs
agent-handoff list --since 1h

# Inspect a specific handoff
agent-handoff inspect <handoff-id>

# Show chain for a handoff
agent-handoff chain <handoff-id>

# Validate a schema file
agent-handoff validate schema.json

# Export handoff history
agent-handoff export --format json --output handoffs.json
```

## Why This Matters

Multi-agent systems are becoming common, but the plumbing is still primitive. agent-handoff provides:

1. **Interoperability**: Standard protocol means agents from different frameworks can collaborate
2. **Debuggability**: Full chain tracking makes it easy to understand what happened
3. **Reliability**: Schema validation catches mismatches before runtime failures
4. **Efficiency**: Context compression reduces token waste in handoffs

## License

MIT
