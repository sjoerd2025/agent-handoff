/**
 * Schema validation for handoffs
 */

import {
  Handoff,
  HandoffSchema,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaType,
  HandoffResult,
} from './types.js';

/**
 * Validate a handoff against a target schema
 */
export function validateHandoff(
  handoff: Handoff,
  schema: HandoffSchema
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Check target matches
  if (handoff.to !== schema.name) {
    errors.push({
      code: 'SCHEMA_MISMATCH',
      message: `Handoff target '${handoff.to}' does not match schema '${schema.name}'`,
      expected: schema.name,
      received: handoff.to,
    });
  }
  
  // Validate required fields
  for (const field of schema.accepts.required) {
    if (!(field in handoff.context)) {
      errors.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `Missing required field: ${field}`,
        path: `context.${field}`,
      });
    }
  }
  
  // Validate types if defined
  if (schema.accepts.types) {
    for (const [field, expectedType] of Object.entries(schema.accepts.types)) {
      if (field in handoff.context) {
        const typeError = validateType(
          handoff.context[field],
          expectedType,
          `context.${field}`
        );
        if (typeError) {
          errors.push(typeError);
        }
      }
    }
  }
  
  // Check for unknown fields
  const knownFields = new Set([
    ...schema.accepts.required,
    ...(schema.accepts.optional || []),
  ]);
  
  for (const field of Object.keys(handoff.context)) {
    if (!knownFields.has(field)) {
      warnings.push({
        code: 'UNKNOWN_FIELD',
        message: `Unknown field '${field}' in context`,
        path: `context.${field}`,
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a result against a schema's return definition
 */
export function validateResult(
  result: HandoffResult,
  schema: HandoffSchema
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  if (result.status === 'completed' && result.result) {
    // Validate required return fields
    for (const field of schema.returns.required) {
      if (!(field in result.result)) {
        errors.push({
          code: 'MISSING_REQUIRED_RETURN',
          message: `Missing required return field: ${field}`,
          path: `result.${field}`,
        });
      }
    }
    
    // Validate return types
    if (schema.returns.types) {
      for (const [field, expectedType] of Object.entries(schema.returns.types)) {
        if (field in result.result) {
          const typeError = validateType(
            result.result[field],
            expectedType,
            `result.${field}`
          );
          if (typeError) {
            errors.push(typeError);
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if two schemas are compatible
 */
export function areCompatible(
  sender: HandoffSchema,
  receiver: HandoffSchema
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Check if receiver declares compatibility
  if (receiver.compatibleWith) {
    const isCompatible = receiver.compatibleWith.some(compat => {
      return matchesVersion(sender.name, sender.version, compat);
    });
    
    if (!isCompatible) {
      warnings.push({
        code: 'COMPATIBILITY_NOT_DECLARED',
        message: `Receiver does not declare compatibility with ${sender.name}@${sender.version}`,
      });
    }
  }
  
  // Check that sender's return matches receiver's accepts
  const senderReturns = new Set([
    ...sender.returns.required,
    ...(sender.returns.optional || []),
  ]);
  
  for (const required of receiver.accepts.required) {
    if (!senderReturns.has(required)) {
      errors.push({
        code: 'INCOMPATIBLE_CONTRACT',
        message: `Sender does not return required field '${required}'`,
        expected: required,
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a value against a schema type
 */
function validateType(
  value: unknown,
  expectedType: SchemaType,
  path: string
): ValidationError | null {
  if (typeof expectedType === 'string') {
    // Simple type check
    if (expectedType === 'string[]') {
      if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) {
        return {
          code: 'TYPE_MISMATCH',
          message: `Expected string array at ${path}`,
          path,
          expected: 'string[]',
          received: getTypeName(value),
        };
      }
    } else if (expectedType === 'number[]') {
      if (!Array.isArray(value) || !value.every(v => typeof v === 'number')) {
        return {
          code: 'TYPE_MISMATCH',
          message: `Expected number array at ${path}`,
          path,
          expected: 'number[]',
          received: getTypeName(value),
        };
      }
    } else {
      const actualType = typeof value;
      if (actualType !== expectedType) {
        return {
          code: 'TYPE_MISMATCH',
          message: `Expected ${expectedType} at ${path}, got ${actualType}`,
          path,
          expected: expectedType,
          received: actualType,
        };
      }
    }
  } else if ('enum' in expectedType) {
    if (!expectedType.enum.includes(value as string)) {
      return {
        code: 'INVALID_ENUM_VALUE',
        message: `Invalid value at ${path}. Expected one of: ${expectedType.enum.join(', ')}`,
        path,
        expected: expectedType.enum,
        received: value,
      };
    }
  }
  
  return null;
}

/**
 * Get human-readable type name
 */
function getTypeName(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

/**
 * Check if a version matches a compatibility string
 */
function matchesVersion(name: string, version: string, compat: string): boolean {
  // Simple matching: exact or caret range
  const [compatName, compatVersion] = compat.split('@');
  
  if (compatName !== name) return false;
  
  if (!compatVersion) return true;
  
  if (compatVersion.startsWith('^')) {
    // Caret range: compatible with same major version
    const major = compatVersion.slice(1).split('.')[0];
    const versionMajor = version.split('.')[0];
    return major === versionMajor;
  }
  
  return compatVersion === version;
}

/**
 * Create a schema from a simple definition
 */
export function defineSchema(
  name: string,
  version: string,
  definition: {
    description?: string;
    accepts: string[];
    optionalAccepts?: string[];
    returns: string[];
    optionalReturns?: string[];
    compatibleWith?: string[];
  }
): HandoffSchema {
  return {
    name,
    version,
    description: definition.description,
    accepts: {
      required: definition.accepts,
      optional: definition.optionalAccepts,
    },
    returns: {
      required: definition.returns,
      optional: definition.optionalReturns,
    },
    compatibleWith: definition.compatibleWith,
  };
}
