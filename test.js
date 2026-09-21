/*
 * test.js — run with:  node test.js
 *
 * No dependencies, no build, no framework. It reads index.html as text, pulls the
 * shipped functions out of it, and runs them against joeos-core's own contract
 * vectors in contract/ — the same files that test ops.py and first.ts.
 *
 * That is the point: this app is a port, and a port is only worth anything if it
 * gives the same answers as the thing it was ported from. 29 cases. All must pass.
 */
const fs=require('fs');
const path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const C=path.join(__dirname,'contract')+path.sep;

function grab(re,label){const m=SRC.match(re);if(!m)throw new Error('could not extract '+label);return m[0];}
const parts=[
 grab(/const VECTORS=\[[^\]]*\];/,'VECTORS'),
 grab(/const words=[^\n]*?;/,'words'),
 grab(/function isNum\(x\)\{[^}]*\}/,'isNum'),
 grab(/function lowv\(x,t\)\{[^}]*\}/,'lowv'),
 grab(/function highv\(x,t\)\{[^}]*\}/,'highv'),
 grab(/function isTripped\(c\)\{[^}]*\}/,'isTripped'),
 grab(/function chipFor\(v\)\{[\s\S]*?return out\("F","Steady","Normal momentum\. One next action at a time\."\);\}/,'chipFor'),
 grab(/var PHYSICAL_VERBS=\[[\s\S]*?\];/,'PHYSICAL_VERBS'),
 grab(/var Y2030=[^\n]*?;/,'Y2030'),
 grab(/function scoreItem\(it,code\)\{[\s\S]*?return sc;\}/,'scoreItem'),
];
const F=new Function(parts.join('\n')+'\nreturn {VECTORS,chipFor,isTripped,scoreItem,words,PHYSICAL_VERBS};')();
console.log('extracted: VECTORS='+F.VECTORS.length+' verbs='+F.PHYSICAL_VERBS.length);

// ---- public copy ships neither door URL nor door key ----
const README=fs.readFileSync(path.join(__dirname,'README.md'),'utf8');
const secretHits=[];
for(const [label,re,blob] of [
  ['index.html script.google.com',/script\.google\.com/i,SRC],
  ['index.html Apps Script deployment id',/AKfycb/,SRC],
  ['index.html macros/s/ exec path',/macros\/s\//,SRC],
  ['README script.google.com',/script\.google\.com/i,README],
  ['README Apps Script deployment id',/AKfycb/,README],
  ['README macros/s/ exec path',/macros\/s\//,README],
]){if(re.test(blob))secretHits.push(label);}
if(!SRC.includes('now.door_url'))secretHits.push('missing now.door_url');
if(!SRC.includes('now.door_key'))secretHits.push('missing now.door_key');
if(!SRC.includes('id="doorUrlBox"')||!SRC.includes('id="doorKeyBox"'))secretHits.push('missing Raw door fields');
if(!SRC.includes('id="verNum">0.9.5<'))secretHits.push('version not 0.9.5');
if(!SRC.includes('origin_surface:"walker"'))secretHits.push('missing origin_surface walker');
if(SRC.includes('id="lock"')||/LOCK_PIN/.test(SRC)||SRC.includes('now.lock_fails'))secretHits.push('PIN lock still present');
if(/LOCK_PIN|now\.lock_fails|Enter PIN/.test(README))secretHits.push('README still documents PIN lock');
if(secretHits.length){
  console.log('\nDOOR SHIP  FAIL  '+JSON.stringify(secretHits));
  process.exit(1);
}
console.log('door ship: no exec URL / key in index.html or README; localStorage fields present');

const bag={};
const doorSrc=(grab(/var DOOR_URL_LS=[\s\S]*?function doorKeyed\(\)\{return !!\(doorUrl\(\)&&doorKey\(\)\);\}/,'door helpers')+'\n'+grab(/function dumpHoldToast\(err\)\{[\s\S]*?return "No door right now — queued on this phone\. Open STUCK → Raw door\.";\}/,'dumpHoldToast')+'\nfunction darkDoor(){return false;}\nreturn {doorKeyed,setDoorUrl,setDoorKey,dumpHoldToast};').replace(/localStorage/g,'ls');
const D=new Function('ls',doorSrc)({
  getItem:k=>Object.prototype.hasOwnProperty.call(bag,k)?bag[k]:null,
  setItem:(k,v)=>{bag[k]=String(v);},
});
let dPass=0,dFail=[];
function dcheck(name,ok){if(ok)dPass++;else dFail.push(name);}
dcheck('empty is not keyed',D.doorKeyed()===false);
dcheck('missing both toast',/No door URL or door key/.test(D.dumpHoldToast()));
D.setDoorUrl('https://example.invalid/door');
dcheck('url only is not keyed',D.doorKeyed()===false);
dcheck('missing key toast',/No door key/.test(D.dumpHoldToast()));
D.setDoorKey('not-a-live-key');
dcheck('both set is keyed',D.doorKeyed()===true);
dcheck('keyed no-door toast generic',/No door right now/.test(D.dumpHoldToast()));
dcheck('keyed network toast',/Door unreachable \(network\)/.test(D.dumpHoldToast({code:'network'})));
D.setDoorUrl('');
dcheck('key only is not keyed',D.doorKeyed()===false);
dcheck('missing url toast',/No door URL/.test(D.dumpHoldToast()));
console.log('DOOR HOLD   '+dPass+'/9');
if(dFail.length){console.log(JSON.stringify(dFail,null,1));process.exit(1);}

// ---- state / floor matrix ----
const sv=JSON.parse(fs.readFileSync(C+'state_vectors.json','utf8'));
let sPass=0,sFail=[];
for(const c of sv.cases){
  const got=F.chipFor(c.vec||{}).st;
  if(got===c.code)sPass++;else sFail.push({case:c.name,expected:c.code,got});
}

// ---- FIRST chooser ----
const fv=JSON.parse(fs.readFileSync(C+'first_vectors.json','utf8'));
const OPEN=s=>s!=='done'&&s!=='dropped'&&s!=='parked';
let fPass=0,fFail=[];
for(const c of fv.cases){
  const hour=parseInt(c.now.slice(11,13),10);
  const chip=c.vec?F.chipFor(c.vec):{st:null,red:false};
  // NOW puts the stop path in isDark(): 02:00-05:59 is night, a C floor is red.
  const dark=(hour>=2&&hour<6)?'night':(chip.red?'red':null);
  const stop=!!dark;
  let id=null;
  if(!stop){
    const pool=c.captures.filter(x=>OPEN(x.status));
    if(pool.length){
      let best=pool[0],bs=F.scoreItem(best,chip.st);
      for(let i=1;i<pool.length;i++){const sc=F.scoreItem(pool[i],chip.st);if(sc>bs){best=pool[i];bs=sc;}}
      id=best.id;
    }
  }
  const okStop=stop===!!c.expect_stop;
  const okId=stop?true:(id===(c.expect_id===undefined?null:c.expect_id));
  if(okStop&&okId)fPass++;else fFail.push({case:c.name,expect_stop:c.expect_stop,got_stop:stop,expect_id:c.expect_id,got_id:id});
}
console.log('\nSTATE MATRIX  '+sPass+'/'+sv.cases.length);
if(sFail.length)console.log(JSON.stringify(sFail,null,1));
console.log('FIRST CHOOSER '+fPass+'/'+fv.cases.length);
if(fFail.length)console.log(JSON.stringify(fFail,null,1));
const total=sPass+fPass, want=sv.cases.length+fv.cases.length;
console.log('\nTOTAL '+total+'/'+want+(total===want?'  — the port agrees with the brain':'  — FAILED'));
process.exit(total===want?0:1);
