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
