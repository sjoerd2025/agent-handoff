#!/usr/bin/env node

/**
 * agent-handoff CLI
 */

import { HandoffManager, HandoffSchema, TrackedHandoff, VERSION } from './index.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const manager = new HandoffManager();

// Simple argument parser
function parseArgs(args: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = 'help';
  
  let i = 0;
  if (args[0] && !args[0].startsWith('-')) {
    command = args[0];
    i = 1;
  }
  
  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  
  return { command, flags, positional };
}

// Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Format timestamp
function formatTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Load handoffs from file for demo
function loadHandoffs(path: string): TrackedHandoff[] {
  if (!existsSync(path)) return [];
  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save handoffs to file
function saveHandoffs(path: string, handoffs: TrackedHandoff[]): void {
  writeFileSync(path, JSON.stringify(handoffs, null, 2));
}

// Commands
const commands: Record<string, (flags: Record<string, string | boolean>, positional: string[]) => void> = {
  help() {
    console.log(`
agent-handoff v${VERSION}

Usage: agent-handoff <command> [options]

Commands:
  list                    List recent handoffs
  inspect <id>            Inspect a specific handoff
  chain <id>              Show handoff chain
  validate <schema.json>  Validate a schema file
  export                  Export handoff history

Options:
  --since <duration>      Filter by time (e.g., 1h, 30m, 1d)
  --status <status>       Filter by status
  --agent <name>          Filter by agent
  --format <json|table>   Output format
  --output <file>         Output file path
  --help                  Show this help

Examples:
  agent-handoff list --since 1h
  agent-handoff inspect abc123
  agent-handoff chain abc123
  agent-handoff validate ./my-agent-schema.json
  agent-handoff export --format json --output handoffs.json
`);
  },
  
  list(flags) {
    const storagePath = flags.storage as string || './.handoffs.json';
    const handoffs = loadHandoffs(storagePath);
    
    if (handoffs.length === 0) {
      console.log('No handoffs found.');
      return;
    }
    
    // Apply filters
    let filtered = handoffs;
    
    if (flags.since) {
      const duration = parseDuration(flags.since as string);
      const cutoff = Date.now() - duration;
      filtered = filtered.filter(h => h.startTime >= cutoff);
    }
    
    if (flags.status) {
      filtered = filtered.filter(h => h.status === flags.status);
    }
    
    if (flags.agent) {
      const agent = flags.agent as string;
      filtered = filtered.filter(h => h.from === agent || h.to === agent);
    }
    
    const limit = parseInt(flags.limit as string) || 20;
    filtered = filtered.slice(0, limit);
    
    if (flags.format === 'json') {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      console.log(`\nRecent Handoffs (${filtered.length}):\n`);
      console.log('ID           From                To                  Status      Duration');
      console.log('─'.repeat(80));
      
      for (const h of filtered) {
        const duration = h.endTime ? formatDuration(h.endTime - h.startTime) : '-';
        console.log(
          `${h.id.padEnd(12)} ${h.from.padEnd(19).slice(0, 19)} ${h.to.padEnd(19).slice(0, 19)} ${h.status.padEnd(11)} ${duration}`
        );
      }
    }
  },
  
  inspect(flags, positional) {
    const id = positional[0];
    if (!id) {
      console.error('Error: handoff ID required');
      process.exit(1);
    }
    
    const storagePath = flags.storage as string || './.handoffs.json';
    const handoffs = loadHandoffs(storagePath);
    const handoff = handoffs.find(h => h.id === id || h.id.startsWith(id));
    
    if (!handoff) {
      console.error(`Handoff not found: ${id}`);
      process.exit(1);
    }
    
    if (flags.format === 'json') {
      console.log(JSON.stringify(handoff, null, 2));
    } else {
      console.log('\nHandoff Details:\n');
      console.log(`  ID:        ${handoff.id}`);
      console.log(`  From:      ${handoff.from}`);
      console.log(`  To:        ${handoff.to}`);
      console.log(`  Status:    ${handoff.status}`);
      console.log(`  Priority:  ${handoff.priority || 'normal'}`);
      console.log(`  Started:   ${formatTime(handoff.startTime)}`);
      if (handoff.endTime) {
        console.log(`  Ended:     ${formatTime(handoff.endTime)}`);
        console.log(`  Duration:  ${formatDuration(handoff.endTime - handoff.startTime)}`);
      }
      if (handoff.tags?.length) {
        console.log(`  Tags:      ${handoff.tags.join(', ')}`);
      }
      if (handoff.returnTo) {
        console.log(`  Return To: ${handoff.returnTo}`);
      }
      
      console.log('\nContext:');
      console.log(JSON.stringify(handoff.context, null, 2));
      
      if (handoff.conversationSummary) {
        console.log('\nConversation Summary:');
        console.log(`  ${handoff.conversationSummary}`);
      }
      
      if (handoff.result) {
        console.log('\nResult:');
        console.log(JSON.stringify(handoff.result, null, 2));
      }
    }
  },
  
  chain(flags, positional) {
    const id = positional[0];
    if (!id) {
      console.error('Error: handoff ID required');
      process.exit(1);
    }
    
    const storagePath = flags.storage as string || './.handoffs.json';
    const handoffs = loadHandoffs(storagePath);
    const handoff = handoffs.find(h => h.id === id || h.id.startsWith(id));
    
    if (!handoff) {
      console.error(`Handoff not found: ${id}`);
      process.exit(1);
    }
    
    if (flags.format === 'json') {
      console.log(JSON.stringify(handoff.chain, null, 2));
    } else {
      console.log('\nHandoff Chain:\n');
      
      for (let i = 0; i < handoff.chain.length; i++) {
        const link = handoff.chain[i];
        const prefix = i === handoff.chain.length - 1 ? '└─' : '├─';
        const statusIcon = link.status === 'completed' ? '✓' : 
                          link.status === 'failed' ? '✗' :
                          link.status === 'in_progress' ? '→' : '○';
        
        console.log(`  ${prefix} [${statusIcon}] ${link.from} → ${link.to}`);
        console.log(`  ${i === handoff.chain.length - 1 ? '  ' : '│ '}    ${formatTime(link.timestamp)}`);
        if (link.duration) {
          console.log(`  ${i === handoff.chain.length - 1 ? '  ' : '│ '}    Duration: ${formatDuration(link.duration)}`);
        }
      }
    }
  },
  
  validate(flags, positional) {
    const schemaPath = positional[0];
    if (!schemaPath) {
      console.error('Error: schema file path required');
      process.exit(1);
    }
    
    const fullPath = resolve(schemaPath);
    if (!existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      process.exit(1);
    }
    
    try {
      const data = readFileSync(fullPath, 'utf-8');
      const schema: HandoffSchema = JSON.parse(data);
      
      const errors: string[] = [];
      
      // Validate schema structure
      if (!schema.name) errors.push('Missing required field: name');
      if (!schema.version) errors.push('Missing required field: version');
      if (!schema.accepts) errors.push('Missing required field: accepts');
      if (!schema.returns) errors.push('Missing required field: returns');
      
      if (schema.accepts && !schema.accepts.required) {
        errors.push('accepts.required is required');
      }
      if (schema.returns && !schema.returns.required) {
        errors.push('returns.required is required');
      }
      
      // Check version format
      if (schema.version && !/^\d+\.\d+\.\d+/.test(schema.version)) {
        errors.push('version should be semver format (e.g., 1.0.0)');
      }
      
      if (errors.length > 0) {
        console.log('\nSchema validation failed:\n');
        for (const error of errors) {
          console.log(`  ✗ ${error}`);
        }
        process.exit(1);
      } else {
        console.log('\nSchema is valid!\n');
        console.log(`  Name:    ${schema.name}`);
        console.log(`  Version: ${schema.version}`);
        console.log(`  Accepts: ${schema.accepts.required.join(', ')}`);
        console.log(`  Returns: ${schema.returns.required.join(', ')}`);
        if (schema.description) {
          console.log(`  Desc:    ${schema.description}`);
        }
      }
    } catch (e) {
      console.error(`Error parsing schema: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
  },
  
  export(flags) {
    const storagePath = flags.storage as string || './.handoffs.json';
    const handoffs = loadHandoffs(storagePath);
    
    const output = flags.output as string;
    const format = flags.format as string || 'json';
    
    let data: string;
    if (format === 'json') {
      data = JSON.stringify(handoffs, null, 2);
    } else {
      // CSV format
      const headers = ['id', 'from', 'to', 'status', 'startTime', 'endTime', 'duration'];
      const rows = handoffs.map(h => [
        h.id,
        h.from,
        h.to,
        h.status,
        new Date(h.startTime).toISOString(),
        h.endTime ? new Date(h.endTime).toISOString() : '',
        h.endTime ? String(h.endTime - h.startTime) : '',
      ]);
      data = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }
    
    if (output) {
      writeFileSync(output, data);
      console.log(`Exported ${handoffs.length} handoffs to ${output}`);
    } else {
      console.log(data);
    }
  },
};

// Parse duration string to milliseconds
function parseDuration(str: string): number {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// Main
const args = process.argv.slice(2);
const { command, flags, positional } = parseArgs(args);

if (flags.help || flags.h) {
  commands.help({}, []);
} else if (commands[command]) {
  commands[command](flags, positional);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "agent-handoff help" for usage');
  process.exit(1);
}
