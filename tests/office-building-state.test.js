#!/usr/bin/env node
'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const State=require('../projects/控制台/public/office-building-state');

const ROOT=path.resolve(__dirname,'..');
const projectFile=rel=>path.join(ROOT,rel);
const sha256=file=>crypto.createHash('sha256').update(fs.readFileSync(projectFile(file))).digest('hex');

function main(){
  const html=fs.readFileSync(projectFile('projects/控制台/public/office-building.html'),'utf8');
  assert(!html.includes('onclick="sw('),'normal UI must not expose manual animation switching');
  assert(!html.includes('function sw('),'legacy manual animation switch must be removed');
  assert(!html.includes('data:image/gif;base64,'),'office building must use external GIF assets');
  assert(!html.includes('>打字办公</button>')&&!html.includes('>看书</button>')&&!html.includes('>交接文件</button>'),'animation states must not be user-selectable buttons');
  assert(html.includes('role="status" aria-live="polite" aria-atomic="true"'),'automatic state must be announced accessibly');
  assert(html.includes('const POLL_MS=4000'),'canonical state polling must stay within the approved 3-5 second interval');
  assert(html.includes("fetchJson('/api/runners')"),'page must discover canonical queue agents from the existing runners endpoint');
  assert(html.includes('/api/queue/${encodeURIComponent(agent)}'),'page must read existing canonical queue snapshots');
  assert(html.includes("initial?'/api/events?n=120'"),'page must seed its event cursor from history without replaying it');
  assert(html.includes('保留上次可信动画'),'read failures must preserve the last trusted animation');

  const assets={
    'projects/控制台/public/office-demo-assets/office-building-typing.gif':'f922af2c31dceaa5ae590745b221f79533eb316642ad7071312a4ca60ae34968',
    'projects/控制台/public/office-demo-assets/office-building-reading.gif':'647ac4de331ea6f947f28b7b0a2cb644dcb106170234984af96d714fff28714b',
    'projects/控制台/public/office-demo-assets/office-building-handoff.gif':'f96fcfd11346d629217d5e66358730f38baee601bebde76d88c4dc066b8b457d'
  };
  for(const [asset,expectedHash] of Object.entries(assets)){
    assert(fs.existsSync(projectFile(asset)),`missing external animation asset: ${asset}`);
    assert.strictEqual(fs.readFileSync(projectFile(asset)).subarray(0,6).toString('ascii'),'GIF89a',`${asset} must remain a GIF`);
    assert.strictEqual(sha256(asset),expectedHash,`${asset} must preserve the approved animation bytes`);
  }

  const states=[];
  const timers=[];
  const cleared=[];
  const machine=State.createStateMachine({
    handoffMs:7600,
    onState:(state,meta)=>states.push({state,meta}),
    setTimer:(fn,ms)=>{ const timer={fn,ms}; timers.push(timer); return timer; },
    clearTimer:timer=>cleared.push(timer)
  });

  assert.strictEqual(machine.getState(),'reading','reading must be the safe initial visual while the first snapshot loads');
  assert.strictEqual(states.at(-1).meta.trusted,false,'initial reading visual must not claim a trusted idle snapshot');
  assert.strictEqual(machine.applyQueueSnapshots([{ok:true,running:[],queued:[{id:'queued-only'}],paused:[]}]),'reading','queued-only work must not look like active execution');
  assert.strictEqual(states.at(-1).meta.trusted,true,'valid queue data must establish a trusted state');
  assert.strictEqual(machine.applyQueueSnapshots([{ok:true,running:[{id:'run-1'}],queued:[]}]),'typing','any canonical running task must select typing');

  machine.seedEvents([
    {seq:10,type:'queue.enqueued',queueAgent:'secretary',queueId:'historical'}
  ],10);
  assert.strictEqual(machine.getState(),'typing','initial historical secretary enqueue must not replay handoff');
  machine.applyEvents([{seq:10,type:'queue.enqueued',queueAgent:'secretary',queueId:'historical'}],10);
  assert.strictEqual(machine.getState(),'typing','repeated polling must not replay an old handoff');

  machine.applyEvents([{seq:11,type:'queue.enqueued',queueAgent:'secretary',queueId:'new-task'}],11);
  assert.strictEqual(machine.getState(),'handoff','a new secretary enqueue must override typing with handoff');
  assert.strictEqual(timers.at(-1).ms,7600,'handoff must use the existing 7.6 second playback window');
  machine.applyQueueSnapshots([{ok:true,running:[]}]);
  assert.strictEqual(machine.getState(),'handoff','queue changes must not interrupt the higher-priority handoff');
  timers.at(-1).fn();
  assert.strictEqual(machine.getState(),'reading','handoff must fall back to reading when no task is running');

  machine.applyQueueSnapshots([{ok:true,running:[{id:'run-2'}]}]);
  machine.applyEvents([{seq:12,type:'queue.enqueued',queueAgent:'secretary',queueId:'newer-task'}],12);
  machine.applyQueueSnapshots([{ok:true,running:[{id:'run-2'}]}]);
  timers.at(-1).fn();
  assert.strictEqual(machine.getState(),'typing','handoff must fall back to typing when a running task remains');
  const timerCount=timers.length;
  machine.applyEvents([{seq:12,type:'queue.enqueued',queueAgent:'secretary',queueId:'newer-task'}],12);
  assert.strictEqual(timers.length,timerCount,'duplicate event polling must not restart handoff');

  const trustedState=machine.getState();
  assert.throws(()=>machine.applyQueueSnapshots(null),/array/,'invalid reads must be rejected instead of converted to idle');
  assert.strictEqual(machine.getState(),trustedState,'a failed queue read must retain the last trusted state');
  machine.destroy();
  assert(cleared.length>=0);

  console.log(JSON.stringify({pass:true,suite:'office-building-state',states:states.map(entry=>entry.state)}));
}

main();
