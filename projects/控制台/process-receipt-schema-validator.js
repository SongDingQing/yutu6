'use strict';

const fs = require('fs');
const path = require('path');

function valuesEqual(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch (_) { return false; }
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] == null ? 0 : Number(match[8]);
  const offsetMinute = match[9] == null ? 0 : Number(match[9]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function resolvePointer(schema, pointer) {
  if (!pointer) return schema;
  if (!pointer.startsWith('/')) return null;
  let current = schema;
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = current[part];
  }
  return current;
}

function createSchemaLoader() {
  const cache = new Map();
  return function loadSchema(file) {
    const resolved = path.resolve(file);
    if (!cache.has(resolved)) cache.set(resolved, JSON.parse(fs.readFileSync(resolved, 'utf8')));
    return cache.get(resolved);
  };
}

function validate(value, schemaFile) {
  const loadSchema = createSchemaLoader();
  const rootFile = path.resolve(schemaFile);
  const rootSchema = loadSchema(rootFile);

  function visit(instance, schema, currentRoot, currentFile, instancePath) {
    const errors = [];
    const add = (keyword, message, at = instancePath) => errors.push({ keyword, path: at, message });
    if (!schema || typeof schema !== 'object') {
      add('schema', 'invalid schema');
      return errors;
    }

    if (schema.$ref) {
      const [filePart, fragment = ''] = String(schema.$ref).split('#', 2);
      let referencedRoot = currentRoot;
      let referencedFile = currentFile;
      if (filePart) {
        referencedFile = path.resolve(path.dirname(currentFile), filePart);
        try { referencedRoot = loadSchema(referencedFile); }
        catch (_) {
          add('$ref', `cannot load ${filePart}`);
          return errors;
        }
      }
      const target = resolvePointer(referencedRoot, fragment);
      if (!target) add('$ref', `cannot resolve ${schema.$ref}`);
      else errors.push(...visit(instance, target, referencedRoot, referencedFile, instancePath));
      return errors;
    }

    if (schema.type) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!allowed.some(type => typeMatches(instance, type))) {
        add('type', `must be ${allowed.join('|')}`);
        return errors;
      }
    }
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && !valuesEqual(instance, schema.const)) {
      add('const', `must equal ${JSON.stringify(schema.const)}`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.some(item => valuesEqual(instance, item))) {
      add('enum', 'must match an allowed value');
    }
    if (Array.isArray(schema.anyOf)) {
      const branches = schema.anyOf.map(child => visit(instance, child, currentRoot, currentFile, instancePath));
      if (!branches.some(branch => branch.length === 0)) add('anyOf', 'must match at least one schema');
    }
    if (Array.isArray(schema.allOf)) {
      for (const child of schema.allOf) errors.push(...visit(instance, child, currentRoot, currentFile, instancePath));
    }
    if (schema.if) {
      const conditionMatches = visit(instance, schema.if, currentRoot, currentFile, instancePath).length === 0;
      if (conditionMatches && schema.then) errors.push(...visit(instance, schema.then, currentRoot, currentFile, instancePath));
      if (!conditionMatches && schema.else) errors.push(...visit(instance, schema.else, currentRoot, currentFile, instancePath));
    }

    if (typeof instance === 'string') {
      if (Number.isInteger(schema.minLength) && instance.length < schema.minLength) add('minLength', `must have at least ${schema.minLength} characters`);
      if (Number.isInteger(schema.maxLength) && instance.length > schema.maxLength) add('maxLength', `must have at most ${schema.maxLength} characters`);
      if (schema.pattern) {
        try { if (!new RegExp(schema.pattern).test(instance)) add('pattern', 'must match pattern'); }
        catch (_) { add('schema', 'invalid pattern'); }
      }
      if (schema.format === 'date-time' && !validDateTime(instance)) add('format', 'must be an RFC3339 date-time');
    }
    if (typeof instance === 'number' && Number.isFinite(instance)) {
      if (typeof schema.minimum === 'number' && instance < schema.minimum) add('minimum', `must be >= ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && instance > schema.maximum) add('maximum', `must be <= ${schema.maximum}`);
    }
    if (Array.isArray(instance)) {
      if (Number.isInteger(schema.minItems) && instance.length < schema.minItems) add('minItems', `must contain at least ${schema.minItems} items`);
      if (Number.isInteger(schema.maxItems) && instance.length > schema.maxItems) add('maxItems', `must contain at most ${schema.maxItems} items`);
      if (schema.uniqueItems === true) {
        const seen = new Set();
        for (const item of instance) {
          let key;
          try { key = JSON.stringify(item); } catch (_) { key = String(item); }
          if (seen.has(key)) {
            add('uniqueItems', 'items must be unique');
            break;
          }
          seen.add(key);
        }
      }
      if (schema.items) {
        instance.forEach((item, index) => {
          errors.push(...visit(item, schema.items, currentRoot, currentFile, `${instancePath}[${index}]`));
        });
      }
    }
    if (instance !== null && typeof instance === 'object' && !Array.isArray(instance)) {
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      for (const key of Array.isArray(schema.required) ? schema.required : []) {
        if (!Object.prototype.hasOwnProperty.call(instance, key)) add('required', `missing required property ${key}`);
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(instance, key)) {
          errors.push(...visit(instance[key], childSchema, currentRoot, currentFile, `${instancePath}.${key}`));
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(instance)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) add('additionalProperties', `unexpected property ${key}`, `${instancePath}.${key}`);
        }
      }
    }
    return errors;
  }

  return visit(value, rootSchema, rootSchema, rootFile, '$');
}

module.exports = { validate };
