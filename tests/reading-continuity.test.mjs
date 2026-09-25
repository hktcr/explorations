import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingOrchestra, planBar} from '../reader-soundscape.mjs';

const profile={mode:'dorian',tonic:48,seed:5,motifSeed:1,sectionSeed:777,energy:.4,thought:.5,
  space:.2,valence:0,confidence:1,phraseSpace:.25,words:50,cadence:.2};

function fixture(overrides={}) {
  const calls=[],audit={nodes:0,oscillators:0};
  const context={currentTime:0,state:'running',destination:{}};
  function parameter(){
    let timeline=[];
    const p={value:0};
    const add=(kind,value,at)=>{calls.push({kind,value,at,now:context.currentTime});timeline.push({kind,value,at});};
    p.cancelScheduledValues=at=>{calls.push({kind:'cancel',at,now:context.currentTime});timeline=timeline.filter(e=>e.at<at);};
    p.cancelAndHoldAtTime=at=>{const value=p.at(at);p.cancelScheduledValues(at);add('set',value,at);};
    p.setValueAtTime=(value,at)=>add('set',value,at);
    p.linearRampToValueAtTime=(value,at)=>add('linear',value,at);
    p.exponentialRampToValueAtTime=(value,at)=>add('exponential',value,at);
    p.setTargetAtTime=(value,at)=>add('target',value,at);
    p.events=()=>timeline;
    p.at=at=>{
      let previous={at:0,value:p.value};
      for(const event of [...timeline].sort((a,b)=>a.at-b.at)){
        if(event.at>at){
          if(event.kind==='linear')return previous.value+(event.value-previous.value)*(at-previous.at)/(event.at-previous.at);
          return previous.value;
        }
        previous=event;
      }
      return previous.value;
    };
    return p;
  }
  const node=fields=>{audit.nodes++;return {...fields,connect(){},disconnect(){}};};
  Object.assign(context,{
    createGain:()=>node({gain:parameter()}),createBiquadFilter:()=>node({frequency:parameter(),Q:parameter()}),
    createDynamicsCompressor:()=>node({threshold:parameter(),ratio:parameter(),knee:parameter()}),
    createDelay:()=>node({delayTime:parameter()}),createStereoPanner:()=>node({pan:parameter()}),
    createPeriodicWave:()=>({}),createOscillator:()=>{audit.oscillators++;return node({frequency:parameter(),setPeriodicWave(){},start(){},stop(){}});}
  });
  const e=new ReadingOrchestra();e.context=context;e.current={...profile,...overrides};e.target={...e.current};
  e.mode=e.candidateMode=e.current.mode;e.candidateSince=0;e.lastModeBar=-4;e.nextAt=.06;e.buildGraph();
  const schedules=[],pads=[],notes=[],pairs=[];
  const schedule=e.schedule.bind(e),pad=e.pads.bind(e),note=e.note.bind(e),pair=e.planPair.bind(e);
  e.schedule=at=>{schedules.push({step:e.step,at,now:context.currentTime});return schedule(at);};
  e.pads=(at,chord)=>{pads.push({step:e.step,at,chord:[...chord]});return pad(at,chord);};
  e.note=(...args)=>{const admitted=note(...args);notes.push({at:args[2],step:e.step,admitted});return admitted;};
  e.planPair=(...args)=>{pairs.push({bar:args[0],at:args[1],options:args[2]});return pair(...args);};
  const clear=()=>{calls.length=0;schedules.length=0;pads.length=0;notes.length=0;pairs.length=0;};
  const prime=step=>{while(e.step<step){context.currentTime=e.nextAt;e.nextAt+=e.schedule(e.nextAt);}clear();};
  return {e,context,calls,audit,schedules,pads,notes,pairs,clear,prime};
}

test('40, 119 and 121 ms late ticks never submit an AudioParam time before their 20 ms safety window',()=>{
  for(const lateness of [.04,.119,.121]){
    const f=fixture();f.prime(4);f.context.currentTime=f.e.nextAt+lateness;
    const safe=f.context.currentTime+.02;f.e.tick();
    assert.ok(f.schedules.length>0&&f.schedules.length<=4);
    assert.ok(f.schedules.every(s=>s.at+1e-10>=safe));
    assert.ok(f.calls.every(c=>c.at+1e-10>=c.now+.02),'all parameter events and cancellations must use future times');
    assert.equal(f.e.plans.length,2);assert.equal(f.audit.nodes,52);assert.equal(f.audit.oscillators,15);
  }
});

test('catch-up crosses step and pair boundaries without losing the current pad or its plan',()=>{
  for(const [oldStep,landStep] of [[15,16],[16,17],[31,32],[32,33],[15,4097],[16,1_000_001]]){
    const f=fixture();f.prime(oldStep);const oldNext=f.e.nextAt,beat=f.e.plans.at(-1).beat,unit=beat/4;
    const expectedAt=oldNext+(landStep-oldStep)*unit;
    f.context.currentTime=expectedAt-.021;
    f.e.target={...f.e.target,energy:1,thought:0,mode:'major',valence:.8};
    f.e.candidateMode='major';f.e.candidateSince=-100;
    const mode=f.e.mode;assert.doesNotThrow(()=>f.e.tick());
    assert.equal(f.schedules[0].step,landStep);
    assert.ok(Math.abs(f.schedules[0].at-expectedAt)<1e-8,'retain elapsed beat phase instead of anchoring to now');
    assert.ok(f.schedules.length<=4);assert.ok(f.pairs.length<=1,'skip old pairs analytically');
    assert.equal(f.e.plans.length,2);assert.ok(f.e.plans.some(p=>p.bar===Math.floor(landStep/16)));
    assert.ok(f.e.plans.every(p=>p.beat===beat),'recovery must keep the reserved tempo');
    assert.equal(f.e.mode,mode,'recovery must not apply a candidate mode');
    assert.ok(f.pads.some(p=>p.at+1e-8>=expectedAt),'missed bar-zero pad must be restored');
    assert.ok(f.e.recoveryUntil>=expectedAt+.36);
    assert.equal(f.audit.nodes,52);assert.equal(f.audit.oscillators,15);
    assert.ok(f.e.stats().plannedEvents<=64);
  }
});

test('recovery at bar zero keeps the zero-gain retune plateau when the new text also changes pad level',()=>{
  const f=fixture();f.prime(15);const unit=f.e.plans.at(-1).beat/4;
  const landing=f.e.nextAt+(32-15)*unit;
  f.context.currentTime=landing-.021;f.e.target={...f.e.target,space:1};
  f.e.tick();
  let retunes=0;
  for(const voice of f.e.voices.slice(0,3))for(const change of voice.oscillator.frequency.events()){
    if(change.kind!=='set'||change.at<landing)continue;
    retunes++;
    assert.ok(Math.abs(voice.gain.gain.at(change.at))<1e-8,'a second pad call must not cancel silence before frequency changes');
  }
  assert.ok(retunes>0,'fixture must actually retune moved voices');
});

test('a normal running tick fills the 240 ms horizon with at most four straight sixteenth steps',()=>{
  const f=fixture({energy:1,thought:0});f.prime(5);f.context.currentTime=f.e.nextAt-.021;
  const at=f.e.nextAt,unit=f.e.plans[0].beat/4;f.e.tick();
  assert.ok(f.schedules.length>=1&&f.schedules.length<=4);
  f.schedules.forEach((s,i)=>assert.ok(Math.abs(s.at-at-i*unit)<1e-10));
  assert.ok(f.schedules.every(s=>s.at<f.context.currentTime+.24));
  assert.ok(f.notes.every(note=>note.admitted));
});

test('a slow recovery-plan calculation rechecks the audio clock before submitting automation',()=>{
  for(const landing of [32,33]){
    const f=fixture();f.prime(31);const unit=f.e.plans.at(-1).beat/4;
    f.context.currentTime=f.e.nextAt+(landing-31)*unit-.021;
    const planPair=f.e.planPair;
    f.e.planPair=function(...args){const result=planPair.apply(this,args);f.context.currentTime+=.03;return result;};
    f.e.tick();
    assert.ok(f.calls.every(c=>c.at+1e-10>=c.now+.02),'audio time can advance while the new plan is calculated');
    assert.ok(f.schedules.length<=4);assert.equal(f.e.plans.length,2);
    // Deferring a tick is safe only if recovery later restores the missed pad.
    f.context.currentTime+=.04;f.e.tick();
    assert.ok(f.pads.length>0,'a deferred partial-bar recovery must not lose its pending pad change');
    assert.ok(f.calls.every(c=>c.at+1e-10>=c.now+.02));
  }
});

test('normal pair boundaries change tempo by no more than 3 BPM while the next pair remains locked',()=>{
  for(const [from,to] of [[{energy:0,thought:1},{energy:1,thought:0}],[{energy:1,thought:0},{energy:0,thought:1}]]){
    const f=fixture(from);let at=.06,lastTempo=null,changed=0,pair;
    for(let i=0;i<32*20;i++){
      f.context.currentTime=at;if(i===1)f.e.target={...f.e.target,...to};
      const delta=f.e.schedule(at);
      if(i%32===0){
        const tempo=60/f.e.plans[0].beat;
        if(lastTempo!==null){assert.ok(Math.abs(tempo-lastTempo)<=3+1e-8);if(Math.abs(tempo-lastTempo)>.01)changed++;}
        lastTempo=tempo;pair=f.e.plans;
      }
      assert.equal(f.e.plans,pair);assert.equal(f.e.plans[0].beat,f.e.plans[1].beat);at+=delta;
    }
    assert.ok(changed>5,'exercise a sustained transition, not one unchanged pair');
  }
});

test('regular bass and pulse keep their phases while text changes their weight and melodic roles',()=>{
  const modes=['major','minor','dorian','lydian'];
  for(const mode of modes)for(const seed of [0,1,7,0xffffffff])for(const air of [.1,.9])for(let bar=0;bar<16;bar++){
    const p=planBar({bar,beat:60/90,tonic:48,mode,motifSeed:seed,profile:{...profile,energy:.9,thought:.2,phraseSpace:air}});
    assert.deepEqual(p.events.filter(e=>e.role==='bass').map(e=>e.step),[4,12]);
    assert.deepEqual(p.events.filter(e=>e.role==='pulse').map(e=>e.step),[0,8]);
  }
  const make=p=>planBar({bar:1,beat:60/90,tonic:48,mode:'dorian',motifSeed:1,profile:{...profile,...p}});
  const forceful=make({energy:.9,thought:.1,space:.1}),reflective=make({energy:.4,thought:.9,space:.9});
  const mean=(p,role)=>{const events=p.events.filter(e=>e.role===role);return events.reduce((sum,e)=>sum+e.level,0)/events.length;};
  assert.ok(mean(forceful,'lead')>mean(reflective,'lead'));
  assert.ok(mean(reflective,'answer')>mean(forceful,'answer'));
  assert.ok(mean(forceful,'bass')>mean(reflective,'bass'));
  const pivot=planBar({bar:2,beat:60/90,tonic:48,mode:'minor',pivot:true,profile});
  assert.deepEqual(pivot.events.map(e=>[e.role,e.step]),[['bass',8]]);
});
