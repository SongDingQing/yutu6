import {
  CONTRACT_SCHEMA_VERSION,
  type ContractSchemaVersion,
  type JsonRecord,
} from '../types.js';

export type ContractErrorCode =
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_enum'
  | 'invalid_value'
  | 'unsupported_version';

export class ContractError extends Error {
  readonly code: ContractErrorCode;
  readonly path: string;
  readonly expected: string;
  readonly receivedType: string;

  constructor(input: {
    code: ContractErrorCode;
    path: string;
    expected: string;
    received: unknown;
  }) {
    const receivedType = valueType(input.received);
    super(`${input.path}: 需要 ${input.expected}，实际为 ${receivedType}`);
    this.name = 'ContractError';
    this.code = input.code;
    this.path = input.path;
    this.expected = input.expected;
    this.receivedType = receivedType;
  }
}

export function readRecord(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError({
      code: value === undefined ? 'missing_field' : 'invalid_type',
      path,
      expected: '对象',
      received: value,
    });
  }
  return value as JsonRecord;
}

export function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractError({
      code: value === undefined ? 'missing_field' : 'invalid_type',
      path,
      expected: '数组',
      received: value,
    });
  }
  return value;
}

export function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ContractError({
      code: value === undefined ? 'missing_field' : 'invalid_type',
      path,
      expected: '字符串',
      received: value,
    });
  }
  return value;
}

export function readNonEmptyString(value: unknown, path: string): string {
  const result = readString(value, path);
  if (!result.trim()) {
    throw new ContractError({
      code: 'invalid_value',
      path,
      expected: '非空字符串',
      received: value,
    });
  }
  return result;
}

export function readOptionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : readString(value, path);
}

export function readOptionalNullableString(value: unknown, path: string): string | null | undefined {
  return value === undefined || value === null ? value : readString(value, path);
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ContractError({
      code: value === undefined ? 'missing_field' : 'invalid_type',
      path,
      expected: '布尔值',
      received: value,
    });
  }
  return value;
}

export function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
  return value === undefined ? undefined : readBoolean(value, path);
}

export function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractError({
      code: value === undefined ? 'missing_field' : 'invalid_type',
      path,
      expected: '有限数字',
      received: value,
    });
  }
  return value;
}

export function readOptionalNumber(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : readNumber(value, path);
}

export function readOptionalNullableNumber(value: unknown, path: string): number | null | undefined {
  return value === undefined || value === null ? value : readNumber(value, path);
}

export function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  const result = readString(value, path);
  if (!allowed.includes(result)) {
    throw new ContractError({
      code: 'invalid_enum',
      path,
      expected: allowed.join(' | '),
      received: value,
    });
  }
  return result as T[number];
}

export function readSchemaVersion(record: JsonRecord, path: string): ContractSchemaVersion {
  const raw = record.schemaVersion;
  if (raw === undefined) return CONTRACT_SCHEMA_VERSION;
  if (raw !== CONTRACT_SCHEMA_VERSION) {
    throw new ContractError({
      code: 'unsupported_version',
      path: `${path}.schemaVersion`,
      expected: String(CONTRACT_SCHEMA_VERSION),
      received: raw,
    });
  }
  return CONTRACT_SCHEMA_VERSION;
}

export function assertOk(record: JsonRecord, path: string): true {
  const ok = readBoolean(record.ok, `${path}.ok`);
  if (!ok) {
    throw new ContractError({
      code: 'invalid_value',
      path: `${path}.ok`,
      expected: 'true',
      received: ok,
    });
  }
  return true;
}

function valueType(value: unknown): string {
  if (value === undefined) return '缺失';
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  if (typeof value === 'number' && !Number.isFinite(value)) return '非有限数字';
  return typeof value;
}
