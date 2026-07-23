import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentPreviewSource,
  parsePersistedAttachments,
  serializePersistedAttachments,
} from '../src/lib/attachments.js';
import type { ImageAttachment } from '../src/types.js';

test('staged attachment draft survives a refresh without base64', () => {
  const attachment: ImageAttachment = {
    id: 'mtest-1234567890abcdef',
    name: 'evidence.png',
    type: 'image/png',
    size: 2048,
    hash: 'a'.repeat(64),
    path: 'projects/控制台/artifacts/task-attachments/staged/mtest.png',
    previewUrl: '/api/attachments/mtest-1234567890abcdef',
    staged: true,
  };
  const encoded = serializePersistedAttachments([attachment]);
  assert.equal(encoded.includes('data:'), false);
  const restored = parsePersistedAttachments(encoded);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, attachment.id);
  assert.equal(restored[0].staged, true);
  assert.equal(attachmentPreviewSource(restored[0]), '/api/attachments/mtest-1234567890abcdef');
});

test('invalid or oversized persisted attachment references are discarded', () => {
  assert.deepEqual(parsePersistedAttachments('not json'), []);
  assert.deepEqual(parsePersistedAttachments(JSON.stringify([{
    id: '../escape',
    name: 'bad',
    type: 'image/png',
    size: 10,
  }])), []);
  assert.deepEqual(parsePersistedAttachments(JSON.stringify([{
    id: 'mtest-1234567890abcdef',
    name: 'huge',
    type: 'image/png',
    size: 11 * 1024 * 1024,
  }])), []);
});
