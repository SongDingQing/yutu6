#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'projects/控制台/public/newapi.html'), 'utf8');

assert(
  html.includes('<div class="drawer" id="detailDrawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle" aria-hidden="true">'),
  'new-api detail drawer must expose dialog role, modal state, label owner, and hidden state',
);
assert(html.includes('let lastDetailFocus = null;'), 'detail drawer must keep the opener focus target');
assert(
  html.includes('lastDetailFocus = document.activeElement && document.activeElement.focus ? document.activeElement : null;'),
  'opening the drawer must capture the previously focused trigger',
);
assert(html.includes("drawer.setAttribute('aria-hidden', 'false');"), 'opening the drawer must clear aria-hidden');
assert(html.includes("const closeBtn = $('#closeDrawer');\n  if (closeBtn) closeBtn.focus();"), 'opening the drawer must move focus into the dialog');
assert(html.includes('const wasOpen = drawer.classList.contains(\'open\');'), 'closing must know whether focus should be restored');
assert(html.includes("drawer.setAttribute('aria-hidden', 'true');"), 'closing the drawer must restore aria-hidden');
assert(
  html.includes('if (wasOpen && lastDetailFocus && document.contains(lastDetailFocus)) lastDetailFocus.focus();'),
  'closing the drawer must restore focus to the opener when it still exists',
);
assert(
  html.includes("if (e.key === 'Escape' && $('#detailDrawer').classList.contains('open')) closeDrawer();"),
  'Escape must close an open detail drawer',
);

console.log(JSON.stringify({ pass: true, suite: 'newapi-a11y' }));
