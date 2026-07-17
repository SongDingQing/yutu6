(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.OfficeBuildingState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STATES=Object.freeze({READING:'reading',TYPING:'typing',HANDOFF:'handoff'});

  function queueRunningCount(snapshots){
    if(!Array.isArray(snapshots)) throw new TypeError('queue snapshots must be an array');
    return snapshots.reduce((total,snapshot,index)=>{
      if(!snapshot||typeof snapshot!=='object'||snapshot.ok===false) throw new TypeError(`invalid queue snapshot at ${index}`);
      if(!Array.isArray(snapshot.running)) throw new TypeError(`queue snapshot ${index} has no running array`);
      return total+snapshot.running.length;
    },0);
  }

  function isSecretaryEnqueue(event){
    return !!event&&event.type==='queue.enqueued'&&event.queueAgent==='secretary';
  }

  function handoffEventKey(event){
    if(!event) return '';
    return String(event.queueId||event.taskId||event.task||event.seq||'');
  }

  function createStateMachine(options){
    const opts=options||{};
    if(typeof opts.onState!=='function') throw new TypeError('onState is required');
    const setTimer=opts.setTimer||setTimeout;
    const clearTimer=opts.clearTimer||clearTimeout;
    const handoffMs=Number(opts.handoffMs)||7600;
    let runningCount=0;
    let trusted=false;
    let handoffActive=false;
    let handoffTimer=null;
    let currentState=STATES.READING;
    let eventCursor=0;
    let eventSeeded=false;
    const seenHandoffs=new Set();

    function desiredState(){
      if(handoffActive) return STATES.HANDOFF;
      if(runningCount>0) return STATES.TYPING;
      return STATES.READING;
    }

    function emit(reason,eventKey,force){
      const next=desiredState();
      if(!force&&next===currentState) return next;
      currentState=next;
      opts.onState(next,{reason,eventKey:eventKey||'',runningCount,trusted});
      return next;
    }

    function rememberHandoff(key){
      if(!key) return false;
      if(seenHandoffs.has(key)) return false;
      seenHandoffs.add(key);
      if(seenHandoffs.size>256) seenHandoffs.delete(seenHandoffs.values().next().value);
      return true;
    }

    function startHandoff(key){
      if(!rememberHandoff(key)) return false;
      if(handoffTimer) clearTimer(handoffTimer);
      handoffActive=true;
      emit('secretary-queue-enqueued',key,true);
      handoffTimer=setTimer(()=>{
        handoffTimer=null;
        handoffActive=false;
        emit('handoff-complete',key,true);
      },handoffMs);
      return true;
    }

    function seedEvents(events,lastSeq){
      if(!Array.isArray(events)) throw new TypeError('events must be an array');
      for(const event of events){
        const seq=Number(event&&event.seq)||0;
        eventCursor=Math.max(eventCursor,seq);
        if(isSecretaryEnqueue(event)) rememberHandoff(handoffEventKey(event));
      }
      eventCursor=Math.max(eventCursor,Number(lastSeq)||0);
      eventSeeded=true;
      return eventCursor;
    }

    function applyEvents(events,lastSeq){
      if(!eventSeeded) return seedEvents(events,lastSeq);
      if(!Array.isArray(events)) throw new TypeError('events must be an array');
      const previousCursor=eventCursor;
      let latestHandoff=null;
      for(const event of events){
        const seq=Number(event&&event.seq)||0;
        eventCursor=Math.max(eventCursor,seq);
        if(seq&&seq<=previousCursor) continue;
        if(!isSecretaryEnqueue(event)) continue;
        const key=handoffEventKey(event);
        if(key&&!seenHandoffs.has(key)) latestHandoff={key,event};
      }
      eventCursor=Math.max(eventCursor,Number(lastSeq)||0);
      if(latestHandoff) startHandoff(latestHandoff.key);
      return eventCursor;
    }

    function applyQueueSnapshots(snapshots){
      const previousCount=runningCount;
      const wasTrusted=trusted;
      runningCount=queueRunningCount(snapshots);
      trusted=true;
      emit('queue-snapshot','',!wasTrusted||previousCount!==runningCount);
      return currentState;
    }

    function destroy(){
      if(handoffTimer) clearTimer(handoffTimer);
      handoffTimer=null;
    }

    emit('initial','',true);
    return {
      applyEvents,
      applyQueueSnapshots,
      destroy,
      getEventCursor:()=>eventCursor,
      getState:()=>currentState,
      isEventSeeded:()=>eventSeeded,
      seedEvents
    };
  }

  return {STATES,createStateMachine,queueRunningCount,isSecretaryEnqueue,handoffEventKey};
});
