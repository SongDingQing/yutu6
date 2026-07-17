'use strict';

// Board prompt context reuse is deliberately project-local. Only complete Markdown
// heading blocks are eligible for hash reuse; unheaded fragments remain inline so
// identical words used under different local semantics are never silently dropped.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'yutu6-board-context-ref@2';
const MANIFEST_SCHEMA = 'yutu6-board-context-ref-manifest@2';
const HASH_BOUNDARY = 'block_aware_complete_markdown_heading_block';
const REDACTION_VERSION = 'interaction-trace-upstream-redacted@1';
const DELIVERY_MODE = 'server_materialize_verified_v1';
const MATERIALIZED_START = '<!-- board-context-materialized';
const MATERIALIZED_END = '<!-- /board-context-materialized -->';
const HTML_BLOCK_TAGS = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption',
  'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset',
  'h[1-6]', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link',
  'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p',
  'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'title', 'tr', 'track', 'ul',
].join('|');
const HTML_BLOCK_TAG_RE = new RegExp(`^<\\/?(?:${HTML_BLOCK_TAGS})(?:[ \\t\\n/>]|$)`, 'i');
const COMPLETE_HTML_TAG_RE = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>\s*$/;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function contextPayloadHash(blocks) {
  return sha256(JSON.stringify({
    schema: SCHEMA,
    manifest_schema: MANIFEST_SCHEMA,
    redaction_version: REDACTION_VERSION,
    hash_boundary: HASH_BOUNDARY,
    blocks: (blocks || []).map(block => ({ hash: block.hash, text: block.text })),
  }));
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'unknown';
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function normalizeBlock(value) {
  // Strip only blank separator lines outside the heading block. Spaces and tabs
  // on content lines are part of Markdown semantics (two trailing spaces encode
  // a hard line break), so they must remain in both the stored text and its hash.
  return normalizeNewlines(value)
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}

function delimitedHtmlBlock(kind, source, opener, closer) {
  const start = source.indexOf(opener);
  return {
    recognized: true,
    state: source.indexOf(closer, start + opener.length) === -1
      ? { kind, closer, failClosedAtEof: true }
      : null,
  };
}

function htmlBlockOpening(line) {
  const match = String(line || '').match(/^ {0,3}(.*)$/);
  if (!match) return null;
  const source = match[1];
  if (source.startsWith('<!--')) return delimitedHtmlBlock('html_comment', source, '<!--', '-->');
  if (source.startsWith('<?')) return delimitedHtmlBlock('html_processing_instruction', source, '<?', '?>');
  if (source.startsWith('<![CDATA[')) return delimitedHtmlBlock('html_cdata', source, '<![CDATA[', ']]>');
  if (/^<![A-Za-z]/.test(source)) return delimitedHtmlBlock('html_declaration', source, '<!', '>');

  const rawTag = source.match(/^<(script|pre|style|textarea)(?:[ \t>]|$)/i);
  if (rawTag) {
    const closeRe = new RegExp(`<\\/${rawTag[1]}[ \\t]*>`, 'i');
    return {
      recognized: true,
      state: closeRe.test(source)
        ? null
        : { kind: `html_raw_${rawTag[1].toLowerCase()}`, closeRe, failClosedAtEof: true },
    };
  }
  if (HTML_BLOCK_TAG_RE.test(source) || COMPLETE_HTML_TAG_RE.test(source)) {
    // CommonMark type 6/7 HTML blocks end at the first blank line (or EOF).
    // Until then, ATX-looking lines are raw HTML payload rather than headings.
    return { recognized: true, state: { kind: 'html_block_until_blank', closeOnBlank: true } };
  }
  return null;
}

function htmlBlockClosed(state, line) {
  if (!state) return true;
  if (state.closeOnBlank) return /^[ \t]*$/.test(line);
  if (state.closer) return String(line).includes(state.closer);
  if (state.closeRe) return state.closeRe.test(String(line));
  return false;
}

function scanMarkdownHeadings(value) {
  const text = normalizeNewlines(value);
  const headings = [];
  let offset = 0;
  let fence = null;
  let htmlBlock = null;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(offset, end);
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        fence = null;
      }
    } else if (htmlBlock) {
      if (htmlBlockClosed(htmlBlock, line)) htmlBlock = null;
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      const validOpening = opening
        && (opening[1][0] === '~' || !opening[2].includes('`'));
      if (validOpening) {
        fence = { marker: opening[1][0], length: opening[1].length };
      } else {
        const htmlOpening = htmlBlockOpening(line);
        if (htmlOpening && htmlOpening.recognized) {
          htmlBlock = htmlOpening.state;
        } else {
          const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*$/);
          if (heading) {
            headings.push({
              index: offset,
              level: heading[1].length,
              heading: line.trim(),
            });
          }
        }
      }
    }
    offset = newline === -1 ? text.length : newline + 1;
  }
  return {
    headings,
    unclosedFence: fence,
    unclosedHtmlBlock: htmlBlock && htmlBlock.failClosedAtEof ? htmlBlock : null,
  };
}

function titledBlocks(value) {
  const text = normalizeNewlines(value);
  const scanned = scanMarkdownHeadings(text);
  const headings = scanned.headings;
  if (!headings.length) {
    return {
      preamble: text.trim(),
      blocks: [],
      ambiguousMarkdownFence: Boolean(scanned.unclosedFence),
      ambiguousMarkdownHtmlBlock: Boolean(scanned.unclosedHtmlBlock),
    };
  }
  // Secretary packs use one repeated wrapper level (currently ##). Embedded source
  // documents may start with their own # title; that title must stay inside the
  // wrapper block rather than becoming a new dedupe unit.
  const boundaryLevel = headings[0].level;
  const boundaries = headings.filter(heading => heading.level === boundaryLevel);
  const preamble = text.slice(0, boundaries[0].index).trim();
  const blocks = boundaries.map((heading, index) => {
    const end = index + 1 < boundaries.length ? boundaries[index + 1].index : text.length;
    const block = normalizeBlock(text.slice(heading.index, end));
    return {
      heading: heading.heading,
      level: heading.level,
      text: block,
      hash: sha256(block),
    };
  });
  return {
    preamble,
    blocks,
    ambiguousMarkdownFence: Boolean(scanned.unclosedFence),
    ambiguousMarkdownHtmlBlock: Boolean(scanned.unclosedHtmlBlock),
  };
}

// Mirrors the two secretary-pack layouts already supported by board-review:
// old layout places the pack before "目标:", current layout appends it at the end.
function splitSecretaryContextPack(value) {
  const text = normalizeNewlines(value);
  const start = text.indexOf('[秘书后台背景包]');
  if (start === -1) {
    return { taskText: text.trim(), packText: '', preamble: '', blocks: [] };
  }
  const goalIndex = text.indexOf('\n目标:', start);
  const packText = goalIndex > start ? text.slice(start, goalIndex) : text.slice(start);
  const taskText = goalIndex > start
    ? `${text.slice(0, start)}${text.slice(goalIndex + 1)}`.trim()
    : text.slice(0, start).trim();
  const parsed = titledBlocks(packText);
  return {
    taskText,
    packText: packText.trim(),
    preamble: parsed.preamble,
    blocks: parsed.blocks,
    ambiguousMarkdownFence: parsed.ambiguousMarkdownFence,
    ambiguousMarkdownHtmlBlock: parsed.ambiguousMarkdownHtmlBlock,
  };
}

function dedupeTitledBlocks(sources) {
  const unique = [];
  const byHash = new Map();
  const sourceOrders = [];
  let equivalent = true;
  for (const source of sources) {
    const order = [];
    for (const block of source.blocks || []) {
      const existing = byHash.get(block.hash);
      if (existing && existing.text !== block.text) {
        // A SHA-256 collision must fail closed: keep the block out of the ref.
        equivalent = false;
        continue;
      }
      if (!existing) {
        const row = Object.assign({}, block, { sources: [] });
        byHash.set(block.hash, row);
        unique.push(row);
      }
      const row = byHash.get(block.hash);
      if (row && !row.sources.includes(source.id)) row.sources.push(source.id);
      order.push(block.hash);
      if (!row || row.text !== block.text || sha256(block.text) !== block.hash) equivalent = false;
    }
    sourceOrders.push({ source: source.id, hashes: order });
  }
  return {
    unique,
    sourceOrders,
    equivalent,
    originalBlockCount: sources.reduce((total, source) => total + (source.blocks || []).length, 0),
  };
}

function relativeToWorkspace(file, workspaceRoot) {
  const absolute = path.resolve(file);
  const root = path.resolve(workspaceRoot || process.cwd());
  const relative = path.relative(root, absolute);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? relative.split(path.sep).join('/')
    : absolute;
}

function writeReadonlyAtomic(file, content) {
  const body = String(content || '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const reuseExisting = () => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`board context_ref is not a regular file: ${file}`);
    const existing = fs.readFileSync(file, 'utf8');
    if (existing !== body) throw new Error(`board context_ref content mismatch: ${file}`);
    fs.chmodSync(file, 0o400);
    return { file, reused: true };
  };
  if (fs.existsSync(file)) return reuseExisting();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.chmodSync(tmp, 0o400);
  try {
    // link(2) publishes the already-complete inode without replacing an existing
    // immutable ref. A concurrent writer either wins atomically or reuses only an
    // exact byte-for-byte match; readers can never observe a half-written file.
    fs.linkSync(tmp, file);
    fs.unlinkSync(tmp);
    return { file, reused: false };
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    if (error && error.code === 'EEXIST') return reuseExisting();
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function recordProviderUsage(boardContext, record = {}) {
  if (!boardContext || !boardContext.contextFile || !record.usage) return null;
  const usage = record.usage;
  const numericUsage = {};
  for (const key of [
    'prompt_tokens', 'completion_tokens', 'total_tokens', 'cached_tokens',
    'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens',
  ]) {
    if (usage[key] != null && Number.isFinite(Number(usage[key]))) numericUsage[key] = Number(usage[key]);
  }
  if (!Object.keys(numericUsage).length) return null;
  const request = record.request && typeof record.request === 'object' ? {
    final_request: record.request.final_request === true,
    runner: record.request.runner || record.runner || null,
    model: record.request.model || null,
    prompt_sha256: /^[a-f0-9]{64}$/.test(String(record.request.prompt_sha256 || ''))
      ? String(record.request.prompt_sha256)
      : null,
    prompt_chars: Number.isFinite(Number(record.request.prompt_chars))
      ? Number(record.request.prompt_chars)
      : null,
  } : null;
  // Provider usage is hard evidence only when it is cryptographically bound to
  // the actual final request. Unbound metrics may still be emitted as runtime
  // telemetry by the caller, but must not become a durable comparison receipt.
  if (!request || !request.final_request || !request.prompt_sha256 || request.prompt_chars == null) return null;
  const requestId = request && request.prompt_sha256 ? request.prompt_sha256.slice(0, 16) : 'no-request-hash';
  const file = path.join(
    path.dirname(path.resolve(boardContext.contextFile)),
    'provider-usage',
    `${safeId(record.node)}-${safeId(record.runner)}-a${safeId(record.attempt || 1)}-${requestId}.json`,
  );
  const receipt = {
    schema: 'yutu6-board-context-provider-usage@2',
    task_id: record.taskId || null,
    node: record.node || null,
    role: record.role || null,
    runner: record.runner || null,
    attempt: Number(record.attempt) || 1,
    candidate_index: Number(record.candidateIndex) || 0,
    context_ref: boardContext.ref,
    context_sha256: boardContext.sha256,
    delivery_mode: DELIVERY_MODE,
    request,
    usage: numericUsage,
  };
  writeReadonlyAtomic(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return file;
}

function readonlyFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o222) === 0;
  }
  catch (_) { return false; }
}

function parseStoredBlocks(body) {
  const text = normalizeNewlines(body);
  const marker = /<!-- context-block sha256=([a-f0-9]{64}) sources=([^>]+) -->\n/g;
  const matches = [];
  let match;
  while ((match = marker.exec(text))) {
    matches.push({
      index: match.index,
      bodyIndex: marker.lastIndex,
      hash: match[1],
      sources: match[2].split(',').map(value => value.trim()).filter(Boolean),
    });
  }
  return matches.map((row, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = normalizeBlock(text.slice(row.bodyIndex, end));
    return { hash: row.hash, sources: row.sources, text: block };
  });
}

function resolveBoardContextRef(boardContext) {
  if (!boardContext || boardContext.enabled !== true) return { ok: false, reason: 'context_ref_disabled' };
  const contextFile = boardContext.contextFile && path.resolve(boardContext.contextFile);
  const manifestFile = boardContext.manifestFile && path.resolve(boardContext.manifestFile);
  if (!contextFile || !manifestFile) return { ok: false, reason: 'context_ref_files_missing' };
  if (!readonlyFile(contextFile) || !readonlyFile(manifestFile)) {
    return { ok: false, reason: 'context_ref_not_readonly' };
  }
  let body;
  let manifest;
  try {
    body = fs.readFileSync(contextFile, 'utf8');
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (_) {
    return { ok: false, reason: 'context_ref_read_failed' };
  }
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA
    || manifest.context_ref !== boardContext.ref
    || manifest.context_sha256 !== boardContext.sha256
    || manifest.hash_boundary !== HASH_BOUNDARY
    || manifest.redaction_version !== REDACTION_VERSION) {
    return { ok: false, reason: 'context_ref_manifest_mismatch' };
  }
  const blocks = parseStoredBlocks(body);
  if (!blocks.length || blocks.length !== manifest.unique_block_count
    || !Array.isArray(manifest.blocks) || manifest.blocks.length !== blocks.length) {
    return { ok: false, reason: 'context_ref_block_count_mismatch' };
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const expected = manifest.blocks[index] || {};
    if (sha256(block.text) !== block.hash
      || expected.sha256 !== block.hash
      || expected.chars !== block.text.length) {
      return { ok: false, reason: 'context_ref_block_hash_mismatch' };
    }
  }
  const payloadHash = contextPayloadHash(blocks);
  if (payloadHash !== boardContext.sha256) return { ok: false, reason: 'context_ref_payload_hash_mismatch' };
  return {
    ok: true,
    mode: DELIVERY_MODE,
    ref: boardContext.ref,
    sha256: payloadHash,
    manifest: boardContext.manifest,
    blocks,
    content: blocks.map(block => block.text).join('\n\n'),
  };
}

function materializeContextOnce(goal, boardContext) {
  const source = String(goal || '');
  const resolved = resolveBoardContextRef(boardContext);
  if (!resolved.ok) return resolved;
  const delivered = [
    `${MATERIALIZED_START} sha256=${resolved.sha256} ref=${resolved.ref} -->`,
    'Board 共享稳定背景（runner 侧已从同一只读 context_ref 校验并物化一次）:',
    resolved.content,
    MATERIALIZED_END,
  ].join('\n');
  if (source.includes(MATERIALIZED_START) || source.includes(MATERIALIZED_END)) {
    const startCount = source.split(MATERIALIZED_START).length - 1;
    const endCount = source.split(MATERIALIZED_END).length - 1;
    const start = source.indexOf(MATERIALIZED_START);
    const end = start === -1 ? -1 : source.indexOf(MATERIALIZED_END, start);
    const existing = start !== -1 && end !== -1
      ? source.slice(start, end + MATERIALIZED_END.length)
      : '';
    return startCount === 1 && endCount === 1 && existing === delivered
      ? { ok: true, reused: true, goal: source, resolved }
      : { ok: false, reason: 'context_ref_materialized_content_mismatch' };
  }
  return {
    ok: true,
    reused: false,
    goal: `${delivered}\n\n${source}`,
    resolved,
  };
}

function estimateInputTokens(value) {
  const text = String(value || '');
  if (!text) return 0;
  const ascii = (text.match(/[\x00-\x7F]/g) || []).length;
  return Math.ceil((text.length - ascii) + ascii / 4);
}

function prepareBoardContextRef(opts = {}) {
  const instruction = splitSecretaryContextPack(opts.instruction || '');
  const plan = splitSecretaryContextPack(opts.planText || '');
  if (instruction.ambiguousMarkdownFence || plan.ambiguousMarkdownFence
    || instruction.ambiguousMarkdownHtmlBlock || plan.ambiguousMarkdownHtmlBlock) {
    const reason = instruction.ambiguousMarkdownFence || plan.ambiguousMarkdownFence
      ? 'ambiguous_markdown_fence'
      : 'ambiguous_markdown_html_block';
    return {
      enabled: false,
      reason,
      instruction: { taskText: String(opts.instruction || '').trim(), preamble: '' },
      plan: { taskText: String(opts.planText || '').trim(), preamble: '' },
      semanticEquivalent: false,
    };
  }
  const sources = [
    { id: 'instruction', blocks: instruction.blocks },
    { id: 'plan', blocks: plan.blocks },
  ];
  const deduped = dedupeTitledBlocks(sources);
  if (!deduped.equivalent || !deduped.unique.length) {
    return {
      enabled: false,
      reason: deduped.equivalent ? 'no_titled_context_blocks' : 'block_hash_equivalence_failed',
      instruction: { taskText: String(opts.instruction || '').trim(), preamble: '' },
      plan: { taskText: String(opts.planText || '').trim(), preamble: '' },
      semanticEquivalent: false,
    };
  }

  const payloadHash = contextPayloadHash(deduped.unique);
  const taskId = safeId(opts.taskId);
  const root = path.join(
    path.resolve(opts.artifactsRoot || path.join(__dirname, 'artifacts')),
    'engine-runs',
    taskId,
    'board-context-ref',
  );
  const refId = payloadHash.slice(0, 24);
  const contextFile = path.join(root, `context-${refId}.md`);
  const manifestFile = path.join(root, `context-${refId}.manifest.json`);
  const contextPath = relativeToWorkspace(contextFile, opts.workspaceRoot);
  const manifestPath = relativeToWorkspace(manifestFile, opts.workspaceRoot);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    task_id: opts.taskId || null,
    context_ref: contextPath,
    context_sha256: payloadHash,
    hash_boundary: HASH_BOUNDARY,
    redaction_version: REDACTION_VERSION,
    hash_contract: 'schema+manifest_schema+redaction_version+block_boundary+ordered_block_hash_and_text',
    semantic_equivalence: 'verified_exact_block_hash',
    original_block_count: deduped.originalBlockCount,
    unique_block_count: deduped.unique.length,
    reused_block_copies: Math.max(0, deduped.originalBlockCount - deduped.unique.length),
    source_orders: deduped.sourceOrders,
    blocks: deduped.unique.map(block => ({
      heading: block.heading,
      level: block.level,
      sha256: block.hash,
      chars: block.text.length,
      sources: block.sources,
    })),
    not_deduplicated: [
      instruction.preamble ? { source: 'instruction', reason: 'unheaded_fragment', chars: instruction.preamble.length } : null,
      plan.preamble ? { source: 'plan', reason: 'unheaded_fragment', chars: plan.preamble.length } : null,
    ].filter(Boolean),
  };
  const body = [
    '# Board shared read-only context',
    '',
    `- schema: ${SCHEMA}`,
    `- task_id: ${opts.taskId || '-'}`,
    `- context_sha256: ${payloadHash}`,
    `- manifest: ${manifestPath}`,
    `- redaction_version: ${REDACTION_VERSION}`,
    `- hash_boundary: ${HASH_BOUNDARY}`,
    '- reuse_rule: only exact SHA-256 matches of complete block-aware Markdown heading blocks',
    '- safety_rule: fenced-code and HTML-block headings are not boundaries; ambiguous unclosed fences/HTML delimiters fail closed; unheaded fragments stay inline',
    '',
    '## Shared titled blocks',
    '',
    ...deduped.unique.flatMap(block => [
      `<!-- context-block sha256=${block.hash} sources=${block.sources.join(',')} -->`,
      block.text,
      '',
    ]),
  ].join('\n').replace(/\n+$/, '\n');
  const written = writeReadonlyAtomic(contextFile, body);
  writeReadonlyAtomic(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    enabled: true,
    ref: contextPath,
    manifest: manifestPath,
    sha256: payloadHash,
    contextFile,
    manifestFile,
    reused: written.reused,
    semanticEquivalent: true,
    instruction: { taskText: instruction.taskText, preamble: instruction.preamble },
    plan: { taskText: plan.taskText, preamble: plan.preamble },
    originalBlockCount: deduped.originalBlockCount,
    uniqueBlockCount: deduped.unique.length,
    reusedBlockCopies: Math.max(0, deduped.originalBlockCount - deduped.unique.length),
  };
}

function measurePromptReduction(beforePrompts, afterPrompts) {
  const before = (beforePrompts || []).map(String).join('\n');
  const after = (afterPrompts || []).map(String).join('\n');
  const beforeTokens = estimateInputTokens(before);
  const afterTokens = estimateInputTokens(after);
  const reduction = beforeTokens - afterTokens;
  return {
    estimator: 'rough_local_chars_v1',
    before_chars: before.length,
    after_chars: after.length,
    reduced_chars: before.length - after.length,
    before_estimated_input_tokens: beforeTokens,
    after_estimated_input_tokens: afterTokens,
    reduced_estimated_input_tokens: reduction,
    reduction_ratio: beforeTokens > 0 ? Number((reduction / beforeTokens).toFixed(6)) : 0,
    lower_input_tokens: reduction > 0,
  };
}

module.exports = {
  SCHEMA,
  MANIFEST_SCHEMA,
  HASH_BOUNDARY,
  REDACTION_VERSION,
  DELIVERY_MODE,
  MATERIALIZED_START,
  MATERIALIZED_END,
  sha256,
  contextPayloadHash,
  titledBlocks,
  splitSecretaryContextPack,
  dedupeTitledBlocks,
  prepareBoardContextRef,
  parseStoredBlocks,
  resolveBoardContextRef,
  materializeContextOnce,
  measurePromptReduction,
  estimateInputTokens,
  writeJsonAtomic,
  recordProviderUsage,
};
