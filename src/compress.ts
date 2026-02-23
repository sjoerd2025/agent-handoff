/**
 * Context compression utilities for handoffs
 */

import { Message, CompressContextOptions, CompressedContext } from './types.js';

/**
 * Rough token count estimation (4 chars per token avg)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get total token count for messages
 */
function getMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/**
 * Compress conversation context for handoff
 */
export function compressContext(options: CompressContextOptions): CompressedContext {
  const { messages, maxTokens = 2000, strategy = 'relevance', focus = [] } = options;
  
  const originalCount = getMessageTokens(messages);
  
  if (originalCount <= maxTokens) {
    // No compression needed
    return {
      summary: '',
      messages: messages,
      tokenCount: originalCount,
      originalCount,
      compressionRatio: 1,
    };
  }
  
  let selectedMessages: Message[];
  let summary: string;
  
  switch (strategy) {
    case 'recency':
      ({ messages: selectedMessages, summary } = compressRecency(messages, maxTokens, focus));
      break;
    case 'summary':
      ({ messages: selectedMessages, summary } = compressSummary(messages, maxTokens, focus));
      break;
    case 'relevance':
    default:
      ({ messages: selectedMessages, summary } = compressRelevance(messages, maxTokens, focus));
      break;
  }
  
  const tokenCount = getMessageTokens(selectedMessages) + estimateTokens(summary);
  
  return {
    summary,
    messages: selectedMessages,
    tokenCount,
    originalCount,
    compressionRatio: originalCount / tokenCount,
  };
}

/**
 * Recency-based compression: keep most recent messages
 */
function compressRecency(
  messages: Message[],
  maxTokens: number,
  focus: string[]
): { messages: Message[]; summary: string } {
  // Reserve tokens for summary
  const summaryBudget = Math.floor(maxTokens * 0.3);
  const messageBudget = maxTokens - summaryBudget;
  
  // Take messages from the end until we hit budget
  const selected: Message[] = [];
  let tokens = 0;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content);
    
    if (tokens + msgTokens <= messageBudget) {
      selected.unshift(msg);
      tokens += msgTokens;
    } else {
      break;
    }
  }
  
  // Summarize older messages
  const older = messages.slice(0, messages.length - selected.length);
  const summary = summarizeMessages(older, focus, summaryBudget);
  
  return { messages: selected, summary };
}

/**
 * Relevance-based compression: score messages by relevance to focus topics
 */
function compressRelevance(
  messages: Message[],
  maxTokens: number,
  focus: string[]
): { messages: Message[]; summary: string } {
  // Score each message by relevance
  const scored = messages.map((msg, index) => ({
    msg,
    index,
    score: scoreRelevance(msg, focus, index, messages.length),
    tokens: estimateTokens(msg.content),
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Reserve tokens for summary
  const summaryBudget = Math.floor(maxTokens * 0.25);
  const messageBudget = maxTokens - summaryBudget;
  
  // Select highest-scoring messages that fit
  const selected: typeof scored = [];
  let tokens = 0;
  
  for (const item of scored) {
    if (tokens + item.tokens <= messageBudget) {
      selected.push(item);
      tokens += item.tokens;
    }
  }
  
  // Re-sort by original order
  selected.sort((a, b) => a.index - b.index);
  
  // Summarize excluded messages
  const includedIndices = new Set(selected.map(s => s.index));
  const excluded = messages.filter((_, i) => !includedIndices.has(i));
  const summary = summarizeMessages(excluded, focus, summaryBudget);
  
  return {
    messages: selected.map(s => s.msg),
    summary,
  };
}

/**
 * Summary-based compression: aggressive summarization with minimal raw messages
 */
function compressSummary(
  messages: Message[],
  maxTokens: number,
  focus: string[]
): { messages: Message[]; summary: string } {
  // Heavy emphasis on summary
  const summaryBudget = Math.floor(maxTokens * 0.7);
  const messageBudget = maxTokens - summaryBudget;
  
  // Only keep critical messages (first user message, last few messages)
  const critical: Message[] = [];
  let tokens = 0;
  
  // First user message
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    const t = estimateTokens(firstUser.content);
    if (tokens + t <= messageBudget) {
      critical.push(firstUser);
      tokens += t;
    }
  }
  
  // Last 2-3 messages
  for (let i = messages.length - 1; i >= 0 && critical.length < 4; i--) {
    const msg = messages[i];
    if (critical.includes(msg)) continue;
    
    const t = estimateTokens(msg.content);
    if (tokens + t <= messageBudget) {
      critical.unshift(msg);
      tokens += t;
    } else {
      break;
    }
  }
  
  // Summarize everything
  const summary = summarizeMessages(messages, focus, summaryBudget);
  
  return { messages: critical, summary };
}

/**
 * Score message relevance
 */
function scoreRelevance(
  msg: Message,
  focus: string[],
  index: number,
  total: number
): number {
  let score = 0;
  
  // Recency bonus (0-30 points)
  score += (index / total) * 30;
  
  // Role scoring
  if (msg.role === 'user') score += 20;
  if (msg.role === 'assistant') score += 15;
  if (msg.role === 'system') score += 25;
  
  // Focus term matching (0-50 points)
  const content = msg.content.toLowerCase();
  let focusMatches = 0;
  for (const term of focus) {
    if (content.includes(term.toLowerCase())) {
      focusMatches++;
    }
  }
  if (focus.length > 0) {
    score += (focusMatches / focus.length) * 50;
  }
  
  // Length penalty for very long messages
  const tokens = estimateTokens(msg.content);
  if (tokens > 500) {
    score -= Math.min(10, (tokens - 500) / 100);
  }
  
  return score;
}

/**
 * Create a summary of messages
 */
function summarizeMessages(
  messages: Message[],
  focus: string[],
  maxTokens: number
): string {
  if (messages.length === 0) return '';
  
  const parts: string[] = [];
  
  // Count by role
  const roles = new Map<string, number>();
  for (const msg of messages) {
    roles.set(msg.role, (roles.get(msg.role) || 0) + 1);
  }
  
  parts.push(`Prior context: ${messages.length} messages`);
  
  // Role breakdown
  const roleBreakdown = Array.from(roles.entries())
    .map(([role, count]) => `${count} ${role}`)
    .join(', ');
  parts.push(`(${roleBreakdown})`);
  
  // Extract key points from user messages
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length > 0) {
    const keyPoints = extractKeyPoints(userMessages, focus, 3);
    if (keyPoints.length > 0) {
      parts.push('Key points: ' + keyPoints.join('; '));
    }
  }
  
  // Extract decisions/outcomes from assistant messages
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  if (assistantMessages.length > 0) {
    const decisions = extractDecisions(assistantMessages, 2);
    if (decisions.length > 0) {
      parts.push('Decisions: ' + decisions.join('; '));
    }
  }
  
  // Truncate to max tokens
  let summary = parts.join('. ');
  while (estimateTokens(summary) > maxTokens && summary.length > 50) {
    // Remove from the end
    const lastDot = summary.lastIndexOf('.');
    if (lastDot > 50) {
      summary = summary.slice(0, lastDot);
    } else {
      break;
    }
  }
  
  return summary;
}

/**
 * Extract key points from user messages
 */
function extractKeyPoints(messages: Message[], _focus: string[], max: number): string[] {
  const points: string[] = [];
  
  for (const msg of messages) {
    // Extract first sentence or question
    const sentences = msg.content.split(/[.!?]+/).filter(s => s.trim());
    for (const sentence of sentences.slice(0, 1)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 10 && trimmed.length < 200) {
        points.push(trimmed);
        if (points.length >= max) break;
      }
    }
    if (points.length >= max) break;
  }
  
  return points;
}

/**
 * Extract decisions from assistant messages
 */
function extractDecisions(messages: Message[], max: number): string[] {
  const decisions: string[] = [];
  
  // Look for decision-like patterns
  const patterns = [
    /I will ([^.]+)/gi,
    /Let's ([^.]+)/gi,
    /We should ([^.]+)/gi,
    /The ([^.]+) is ([^.]+)/gi,
  ];
  
  for (const msg of messages) {
    for (const pattern of patterns) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleaned = match.trim();
          if (cleaned.length > 10 && cleaned.length < 100) {
            decisions.push(cleaned);
            if (decisions.length >= max) break;
          }
        }
      }
      if (decisions.length >= max) break;
    }
    if (decisions.length >= max) break;
  }
  
  return decisions;
}

/**
 * Create a minimal context for handoff (just key facts)
 */
export function createMinimalContext(
  messages: Message[],
  focus: string[]
): string {
  const compressed = compressContext({
    messages,
    maxTokens: 500,
    strategy: 'summary',
    focus,
  });
  
  return compressed.summary;
}
