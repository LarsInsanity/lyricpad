import { basicSetup } from "codemirror";
import { EditorView, Decoration } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORAGE = 'lyricpad-next-workspace-v1';
const DEFAULT_LYRICS = '[VERSE 1]\n\n';

function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}
function newSong(){return {id:uid(),title:'Untitled',lyrics:DEFAULT_LYRICS,bpm:120,key:'',notes:'',rhymeOverride:'auto',provider:'openai',model:'',updatedAt:Date.now()}}
function load(){try{const x=JSON.parse(localStorage.getItem(STORAGE));if(x?.songs?.length)return x}catch{}return {songs:[newSong()],activeId:null,sideTab:'rhymes',accessKey:''}}
let state=load(); if(!state.activeId||!state.songs.some(s=>s.id===state.activeId)) state.activeId=state.songs[0].id;
let cursorLine=1, suggestions=[], serverStatus=null, sideOpen=false, saveTimer=null, editorView=null;
function active(){return state.songs.find(s=>s.id===state.activeId)||state.songs[0]}
function persist(){localStorage.setItem(STORAGE,JSON.stringify(state))}
function schedulePersist(){clearTimeout(saveTimer);saveTimer=setTimeout(persist,120)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function words(s){return (String(s).toLowerCase().match(/[a-zà-öø-ÿ']+/g)||[]).map(w=>w.replace(/^'+|'+$/g,''))}
function endWord(line){const w=words(line);return w.at(-1)||''}
function isSection(line){return /^\s*\[[^\]]+\]\s*$/.test(line)}
function lineSyllables(line){return isSection(line)?0:words(line).reduce((n,w)=>n+syllables(w),0)}

// v0.7 — browser phonetic engine generated from CMUdict + a common-word corpus.
let RHYME_DATA = Object.create(null);
let RHYME_READY = false;
const PERFECT_INDEX = new Map();
const VOWEL_INDEX = new Map();
const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);

function phoneBase(phone){return String(phone||'').replace(/\d/g,'')}
function wordEntry(word){return RHYME_DATA[word?.toLowerCase?.()||''] || null}
function phonesFor(word){const e=wordEntry(word);return e?.[0] || []}
function wordFrequency(word){const e=wordEntry(word);return Number(e?.[1]||0)}
function rhymeTail(word){
  const p=phonesFor(word); if(!p.length)return [];
  let idx=-1;
  for(let i=0;i<p.length;i++) if(/[12]$/.test(p[i])) idx=i;
  if(idx<0) for(let i=0;i<p.length;i++) if(/\d$/.test(p[i])) idx=i;
  return p.slice(idx>=0?idx:Math.max(0,p.length-2)).map(phoneBase);
}
function vowelNucleus(word){for(const p of rhymeTail(word))if(VOWELS.has(p))return p;return ''}
function tailKey(word){return rhymeTail(word).join(' ')}
function lcsRatio(a,b){
  if(!a.length||!b.length)return 0;
  const dp=Array(b.length+1).fill(0);
  for(let i=1;i<=a.length;i++){
    let prev=0;
    for(let j=1;j<=b.length;j++){
      const old=dp[j];
      dp[j]=a[i-1]===b[j-1]?prev+1:Math.max(dp[j],dp[j-1]);
      prev=old;
    }
  }
  return 2*dp[b.length]/(a.length+b.length);
}
function nearRhymeScore(a,b){
  const ta=rhymeTail(a),tb=rhymeTail(b);if(!ta.length||!tb.length)return 0;
  const seq=lcsRatio(ta,tb); const max=Math.min(ta.length,tb.length,4); let match=0;
  for(let i=1;i<=max;i++)if(ta[ta.length-i]===tb[tb.length-i])match++;
  return .65*seq+.35*(max?match/max:0);
}
function fallbackRhymeScore(a,b){
  if(!a||!b||a===b)return 0;
  const aa=a.replace(/(ing|ed|es|s)$/,''),bb=b.replace(/(ing|ed|es|s)$/,'');
  if(aa.slice(-3)===bb.slice(-3))return .82;
  if(aa.slice(-2)===bb.slice(-2))return .74;
  return 0;
}
function rhymeScore(a,b){
  a=(a||'').toLowerCase();b=(b||'').toLowerCase();if(!a||!b||a===b)return 0;
  const ta=tailKey(a),tb=tailKey(b);
  if(ta&&tb&&ta===tb)return 1;
  if(ta&&tb)return nearRhymeScore(a,b);
  return fallbackRhymeScore(a,b);
}
function rhymes(a,b){return rhymeScore(a,b)>=.72}
function syllables(word){
  word=(word||'').toLowerCase().replace(/[^a-z']/g,'');if(!word)return 0;
  const p=phonesFor(word);if(p.length){const n=p.filter(x=>/\d$/.test(x)).length;if(n)return n}
  const w=word.replace(/[^a-z]/g,'');if(!w)return 0;if(w.length<=3)return 1;
  let base=w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');
  return Math.max(1,(base.match(/[aeiouy]+/g)||[]).length);
}
function songwriterWordOK(word,source=''){
  if(!word||word===source||!/^[a-z]+$/.test(word)||word.length<2||word.length>18)return false;
  return wordFrequency(word)>=2;
}
function buildRhymeIndexes(){
  PERFECT_INDEX.clear();VOWEL_INDEX.clear();
  for(const word of Object.keys(RHYME_DATA)){
    const key=tailKey(word); if(key){if(!PERFECT_INDEX.has(key))PERFECT_INDEX.set(key,[]);PERFECT_INDEX.get(key).push(word)}
    const v=vowelNucleus(word);if(v){if(!VOWEL_INDEX.has(v))VOWEL_INDEX.set(v,[]);VOWEL_INDEX.get(v).push(word)}
  }
  for(const arr of PERFECT_INDEX.values())arr.sort((a,b)=>wordFrequency(b)-wordFrequency(a)||a.length-b.length||a.localeCompare(b));
}
function rhymeWords(word,limit=28){
  word=(word||'').toLowerCase();if(!word)return {perfect:[],near:[]};
  const key=tailKey(word);if(!key)return {perfect:[],near:[]};
  const sourceSyl=syllables(word);
  const perfect=(PERFECT_INDEX.get(key)||[]).filter(w=>songwriterWordOK(w,word)).sort((a,b)=>wordFrequency(b)-wordFrequency(a)||Math.abs(syllables(a)-sourceSyl)-Math.abs(syllables(b)-sourceSyl)||a.length-b.length).slice(0,limit);
  const nucleus=vowelNucleus(word),seen=new Set([word,...perfect]),candidates=[];
  for(const c of VOWEL_INDEX.get(nucleus)||[]){
    if(seen.has(c)||!songwriterWordOK(c,word))continue;
    const score=nearRhymeScore(word,c);const ta=rhymeTail(word),tb=rhymeTail(c);
    const useful=score+.28+(ta.at(-1)===tb.at(-1)?.08:0);
    if(useful>=.50)candidates.push([useful,wordFrequency(c),Math.abs(syllables(c)-sourceSyl),c.length,c]);
  }
  candidates.sort((a,b)=>b[0]-a[0]||b[1]-a[1]||a[2]-b[2]||a[3]-b[3]||a[4].localeCompare(b[4]));
  return {perfect,near:candidates.slice(0,limit).map(x=>x[4])};
}
async function loadRhymeData(){
  try{
    const r=await fetch('/rhyme-data.json',{cache:'force-cache'});if(!r.ok)throw new Error(`rhyme data ${r.status}`);
    RHYME_DATA=await r.json();RHYME_READY=true;buildRhymeIndexes();
    refreshRhymeDecorations();updateEditorDecorations();if(state.sideTab==='rhymes')renderSide();
  }catch(err){console.warn('Full rhyme dictionary unavailable; using fallback matching.',err)}
}

function sectionAt(lines, idx){let s='Song';for(let i=0;i<=idx&&i<lines.length;i++){const m=lines[i].match(/^\s*\[([^\]]+)\]/);if(m)s=m[1]}return s}
function analyzeFamilies(text,lineNo){
  const lines=text.split('\n'); const sec=sectionAt(lines,lineNo-1); const rows=[];
  for(let i=0;i<Math.min(lineNo,lines.length);i++){const ln=lines[i].trim();if(ln&&!isSection(ln)&&sectionAt(lines,i)===sec){const ew=endWord(ln);if(ew)rows.push({line:i+1,text:ln,end:ew})}}
  const families=[];
  for(const row of rows){let fi=families.findIndex(f=>rhymes(row.end,f.rep));if(fi<0){families.push({rep:row.end,words:[row.end],lines:[row.line]});fi=families.length-1}else{if(!families[fi].words.includes(row.end))families[fi].words.push(row.end);families[fi].lines.push(row.line)}row.family=fi}
  const pattern=rows.map(r=>String.fromCharCode(65+r.family)).join('');
  let auto='new';
  if(rows.length>=3){const x=rows.slice(-3).map(r=>r.family); if(x[0]===x[2]&&x[0]!==x[1]) auto=String.fromCharCode(65+x[1]);}
  if(rows.length>=4){const x=rows.slice(-4).map(r=>r.family);if(x[0]===x[2]&&x[1]===x[3]&&x[0]!==x[1])auto='new';else if(x[0]===x[1]&&x[2]===x[3]&&x[0]!==x[2])auto='new'}
  if(rows.length===2&&rows[0].family!==rows[1].family)auto='A';
  return {section:sec,rows,families,pattern,auto};
}
function analyzeDocument(text){
  const lines=text.split('\n');
  const meta=lines.map((line,i)=>({line:i+1,text:line,syllables:lineSyllables(line),family:null,familyLetter:'',end:endWord(line),section:sectionAt(lines,i)}));
  const sections=new Map();
  meta.forEach((row,i)=>{
    if(!row.text.trim()||isSection(row.text)||!row.end)return;
    const key=row.section||'Song'; if(!sections.has(key))sections.set(key,[]); sections.get(key).push(i);
  });
  for(const idxs of sections.values()){
    const fams=[];
    for(const idx of idxs){const row=meta[idx];let fi=fams.findIndex(f=>rhymes(row.end,f.rep));if(fi<0){fams.push({rep:row.end});fi=fams.length-1}row.family=fi;row.familyLetter=String.fromCharCode(65+fi)}
  }
  return meta;
}
const RHYME_CLASSES=['rhyme-a','rhyme-b','rhyme-c','rhyme-d','rhyme-e','rhyme-f','rhyme-g','rhyme-h'];
const refreshRhymesEffect=StateEffect.define();
function buildDecorationSet(doc){
  const text=doc.toString(),meta=analyzeDocument(text),counts={};
  for(const row of meta)if(row.familyLetter)counts[row.familyLetter]=(counts[row.familyLetter]||0)+1;
  const ranges=[];
  for(const row of meta){
    const line=doc.line(row.line);
    if(isSection(row.text)){
      ranges.push(Decoration.line({class:'cm-section-line'}).range(line.from));
      continue;
    }
    if(row.familyLetter && counts[row.familyLetter]>=2 && row.end){
      const lower=line.text.toLowerCase();const at=lower.lastIndexOf(row.end.toLowerCase());
      if(at>=0){const cls=RHYME_CLASSES[(row.family||0)%RHYME_CLASSES.length];ranges.push(Decoration.mark({class:`cm-rhyme-word ${cls}`}).range(line.from+at,line.from+at+row.end.length));}
    }
  }
  ranges.sort((a,b)=>a.from-b.from||a.to-b.to);
  return Decoration.set(ranges,true);
}
const rhymeDecorationField=StateField.define({
  create(state){return buildDecorationSet(state.doc)},
  update(value,tr){return tr.docChanged||tr.effects.some(e=>e.is(refreshRhymesEffect))?buildDecorationSet(tr.newDoc):value},
  provide:f=>EditorView.decorations.from(f)
});
function editorText(){return editorView?.state.doc.toString()??active()?.lyrics??''}
function selectionOffsets(){const s=editorView?.state.selection.main;return s?{start:s.from,end:s.to}:{start:0,end:0}}
function setEditorSelection(start,end=start){if(!editorView)return;const len=editorView.state.doc.length;start=Math.max(0,Math.min(start,len));end=Math.max(0,Math.min(end,len));editorView.dispatch({selection:{anchor:start,head:end},scrollIntoView:true})}
function replaceEditorRange(insert,start,end){if(!editorView)return;editorView.dispatch({changes:{from:start,to:end,insert},selection:{anchor:start+insert.length},scrollIntoView:true});editorView.focus()}
function gutterHTML(meta,currentLine){
  return `<div class="gutter-head"><span>Line</span><span>Syl</span><span>Rhyme</span></div><div class="gutter-lines">${meta.map(row=>`<div class="gutter-row ${row.line===currentLine?'current':''}" data-gutter-line="${row.line}"><span>${row.line}</span><span>${row.syllables||''}</span><span class="gutter-rhyme">${row.familyLetter?`<b class="cue-dot ${RHYME_CLASSES[(row.family||0)%RHYME_CLASSES.length]}">◆${row.familyLetter}</b><em class="end-word ${RHYME_CLASSES[(row.family||0)%RHYME_CLASSES.length]}">${esc(row.end)}</em>`:''}</span></div>`).join('')}</div>`;
}
function updateEditorDecorations(){
  if(!editorView)return;const text=editorText(),pos=selectionOffsets(),inf=currentLineInfo(text,pos.start),meta=analyzeDocument(text);const gut=$('#lineGutter');if(gut)gut.innerHTML=gutterHTML(meta,inf.line);syncEditorScroll();
  $$('[data-gutter-line]').forEach(row=>row.ondblclick=()=>{const target=Number(row.dataset.gutterLine);if(target<1||target>editorView.state.doc.lines)return;editorView.focus();setEditorSelection(editorView.state.doc.line(target).from)});
}
function refreshRhymeDecorations(){if(editorView)editorView.dispatch({effects:refreshRhymesEffect.of(true)})}
function syncEditorScroll(){const gut=$('#lineGutter .gutter-lines');if(gut&&editorView)gut.scrollTop=editorView.scrollDOM.scrollTop}
function mountEditor(){
  if(editorView){editorView.destroy();editorView=null}
  const host=$('#editorHost');if(!host)return;const s=active();
  editorView=new EditorView({
    state:EditorState.create({doc:s.lyrics,extensions:[
      basicSetup,
      rhymeDecorationField,
      EditorView.contentAttributes.of({spellcheck:'true','aria-label':'Lyrics'}),
      EditorView.updateListener.of(update=>{
        if(!update.docChanged&&!update.selectionSet)return;
        const text=update.state.doc.toString(),pos=update.state.selection.main.head,inf=currentLineInfo(text,pos);
        cursorLine=inf.line;
        if(update.docChanged){s.lyrics=text;s.updatedAt=Date.now();schedulePersist()}
        updateCoach(inf);updateEditorDecorations();
        if(state.sideTab==='rhymes')window.clearTimeout(mountEditor._rhymeTimer),mountEditor._rhymeTimer=window.setTimeout(renderSide,80);
      })
    ]}),
    parent:host
  });
  editorView.scrollDOM.addEventListener('scroll',syncEditorScroll,{passive:true});
  updateEditorDecorations();
}

function resolveRhyme(song,analysis){
  const o=song.rhymeOverride||'auto'; const chosen=o==='auto'?analysis.auto:o;
  if(chosen==='none')return {mode:'none',label:'None',target:''};
  if(chosen==='new')return {mode:'new',label:'New family',target:''};
  const idx=chosen.charCodeAt(0)-65, fam=analysis.families[idx];
  if(!fam)return {mode:'new',label:'New family',target:''};
  return {mode:'family',label:`${chosen} — ${fam.words.slice(-3).join(' / ')}`,target:fam.words.at(-1),family:chosen,words:fam.words};
}
function currentLineInfo(text,selStart){const before=text.slice(0,selStart);const line=before.split('\n').length;const lines=text.split('\n');const current=lines[line-1]||'';return {line,current,syllables:lineSyllables(current)}}
function buildPrompt(action,song,analysis,rctx){
 const recent=analysis.rows.slice(-8).map(r=>r.text).join('\n')||'(no lyric lines yet)';
 const rhyme = rctx.mode==='family'?`The next line MUST rhyme naturally with the sound family anchored by "${rctx.target}" (${rctx.words.join(', ')}). Do not simply repeat the anchor word.`:rctx.mode==='new'?'Start a fresh rhyme family; do not force any previous rhyme sound.':'Do not force a rhyme.';
 const task={continue:'Give 6 believable complete NEXT lyric lines. Move the thought forward; do not merely paraphrase existing lines.',tighten:'Give 6 tighter alternatives for the current lyric line, preserving meaning.',vivid:'Give 6 more vivid alternatives, without inventing an unrelated scene.',brainstorm:'Give 8 concise directions the song could explore next.'}[action]||'Give 6 useful lyric suggestions.';
 return `SONG: ${song.title}\nSECTION: ${analysis.section}\nBPM: ${song.bpm}\nKEY: ${song.key||'unspecified'}\nNOTES: ${song.notes||'none'}\nDETECTED RHYME PATTERN: ${analysis.pattern||'not established'}\nRHYME INSTRUCTION: ${rhyme}\n\nRECENT LYRICS:\n${recent}\n\nFULL LYRICS:\n${song.lyrics.slice(-7000)}\n\nTASK:\n${task}\nReturn only suggestions, one per line. No numbering or explanations.`
}
const AI_INSTRUCTIONS=`You are LyricPad's restrained songwriting copilot. Follow the writer's actual song rather than showing off generic poetry. Semantic continuity matters more than poetic imagery. Match the writer's simplicity, speaker, tense, addressee and emotional subject. Never invent unrelated props, places, weather, letters, roads, rooms, photographs or backstory. Treat rhyme anchors as SOUND targets, not words to echo. Suggestions must be complete singable lyric lines unless the task explicitly asks for ideas. Avoid clichés, obvious AI phrasing, and repeated line openings.`;

function render(){
 if(editorView){editorView.destroy();editorView=null}
 const s=active(); const analysis=analyzeFamilies(s.lyrics,cursorLine); const rc=resolveRhyme(s,analysis);
 document.getElementById('app').innerHTML=`<div class="shell">
 <div class="topbar"><div class="brand">LyricPad <span>Next</span></div><button id="newSong">＋ New</button><button id="exportBtn" class="desktop-only">Export</button><button id="importBtn" class="desktop-only">Import</button><input id="importFile" type="file" accept="application/json,.json" hidden><div class="spacer"></div><button id="panelBtn" class="mobile-panel-toggle">Tools</button><span class="desktop-only"><span class="status-dot ${serverStatus?.ok?'ok':''}"></span>${serverStatus?.ok?'AI server':'Offline'}</span></div>
 <div class="tabs">${state.songs.map(x=>`<button class="tab ${x.id===s.id?'active':''}" data-id="${x.id}"><span>${esc(x.title||'Untitled')}</span><span class="tab-close" data-close="${x.id}">×</span></button>`).join('')}<button class="tab" id="plusTab">＋</button></div>
 <div class="workspace"><main class="main"><div class="meta"><input class="title-input" id="title" value="${esc(s.title)}" placeholder="Untitled"><input class="mini" id="bpm" type="number" min="40" max="300" value="${s.bpm}"><span class="empty">BPM</span><input class="mini" id="key" value="${esc(s.key)}" placeholder="Key"></div>
 <div class="editor-wrap"><div class="editor-host" id="editorHost"></div><div class="line-gutter" id="lineGutter"></div></div>
 <div class="coach"><span class="coach-info">Line ${cursorLine} · ${currentLineInfo(s.lyrics,0).syllables || ''} ${analysis.section} · pattern ${analysis.pattern||'—'}</span><select id="rhymeOverride"><option value="auto">Auto → ${analysis.auto==='new'?'New':analysis.auto}</option>${analysis.families.map((f,i)=>`<option value="${String.fromCharCode(65+i)}">${String.fromCharCode(65+i)} — ${esc(f.words.slice(-3).join(' / '))}</option>`).join('')}<option value="new">New rhyme</option><option value="none">No rhyme</option></select><button class="primary" data-ai="continue">✦ Next lines</button><button data-ai="tighten">Tighten</button><button data-ai="vivid">More vivid</button></div></main>
 <aside class="side ${sideOpen?'open':''}"><div class="side-tabs"><button data-side="rhymes" class="${state.sideTab==='rhymes'?'active':''}">Rhymes</button><button data-side="ai" class="${state.sideTab==='ai'?'active':''}">AI</button><button data-side="notes" class="${state.sideTab==='notes'?'active':''}">Notes</button><button data-side="settings" class="${state.sideTab==='settings'?'active':''}">Settings</button><button data-side="phone" class="${state.sideTab==='phone'?'active':''}">Access</button></div><div class="side-content" id="sideContent"></div></aside></div></div>`;
 $('#rhymeOverride').value=s.rhymeOverride||'auto'; bind(); renderSide();
}
function renderSide(){const s=active(), box=$('#sideContent'); if(!box)return;
 if(state.sideTab==='rhymes'){const info=currentWord();const r=rhymeWords(info.word);box.innerHTML=`<div class="section-title">Word at cursor</div><h3>${esc(info.word||'—')}</h3><div class="rhyme-grid"><div><div class="section-title">Strong rhymes</div><div class="chip-list">${r.perfect.map(w=>`<span class="chip" data-rhyme="${w}">${w}</span>`).join('')||'<span class="empty">Type/select a common word.</span>'}</div></div><div><div class="section-title">Near / slant</div><div class="chip-list">${r.near.map(w=>`<span class="chip" data-rhyme="${w}">${w}</span>`).join('')||'<span class="empty">No useful slants in the small offline lexicon yet.</span>'}</div></div></div><p class="empty">Phonetic rhymes are ranked toward common, songwriter-friendly English words. Near rhymes share the stressed vowel and similar ending sounds.</p>`;$$('[data-rhyme]').forEach(x=>x.onclick=()=>insertAtCursor(x.dataset.rhyme));}
 if(state.sideTab==='ai'){box.innerHTML=`<div class="section-title">AI suggestions</div><div class="suggestions">${suggestions.map((x,i)=>`<div class="suggestion"><div class="suggestion-text">${esc(x)}</div><div class="suggestion-actions"><button data-copy="${i}">Copy</button><button data-insert="${i}">Insert</button><button data-replace="${i}">Replace line</button></div></div>`).join('')||'<div class="empty">Press Next lines, Tighten, or More vivid. Suggestions appear here as individually copyable cards.</div>'}</div>`;$$('[data-copy]').forEach(b=>b.onclick=()=>copyText(suggestions[+b.dataset.copy]));$$('[data-insert]').forEach(b=>b.onclick=()=>insertAtCursor(suggestions[+b.dataset.insert]));$$('[data-replace]').forEach(b=>b.onclick=()=>replaceCurrentLine(suggestions[+b.dataset.replace]));}
 if(state.sideTab==='notes'){box.innerHTML=`<div class="section-title">Song notes / intent</div><textarea class="notes" id="notes">${esc(s.notes||'')}</textarea><p class="empty">These notes are included in AI context, so you can describe the theme, point of view, words to avoid, or what the song is about.</p>`;$('#notes').oninput=e=>{s.notes=e.target.value;s.updatedAt=Date.now();schedulePersist()}}
 if(state.sideTab==='settings'){box.innerHTML=`<div class="section-title">AI provider</div><div class="settings-grid"><label>Provider<select id="provider"><option value="openai">OpenAI (hosted/server)</option><option value="ollama">Ollama</option></select></label><label>Model override<input id="model" value="${esc(s.model||'')}" placeholder="Use server default"></label><label>LyricPad access key<input id="accessKey" type="password" value="${esc(state.accessKey||'')}" placeholder="Required if enabled on server" autocomplete="off"></label><button id="checkServer">Check AI server</button><div class="empty">${serverStatus?`Server: ${serverStatus.ok?'online':'offline'}<br>Hosted: ${serverStatus.hosted?'yes':'no'}<br>OpenAI configured: ${serverStatus.openaiConfigured?'yes':'no'}<br>Access key required: ${serverStatus.accessKeyRequired?'yes':'no'}<br>Default OpenAI model: ${esc(serverStatus.openaiModel||'—')}`:'Not checked yet.'}</div></div>`;$('#provider').value=s.provider||'openai';$('#provider').onchange=e=>{s.provider=e.target.value;schedulePersist()};$('#model').oninput=e=>{s.model=e.target.value;schedulePersist()};$('#accessKey').oninput=e=>{state.accessKey=e.target.value;schedulePersist()};$('#checkServer').onclick=checkServer}
 if(state.sideTab==='phone'){const origin=serverStatus?.publicUrl||location.origin;const hosted=serverStatus?.hosted||location.protocol==='https:'&&!['localhost','127.0.0.1'].includes(location.hostname);const http=serverStatus?.httpUrls?.[0]||'';box.innerHTML=hosted?`<div class="section-title">Anywhere access</div><div class="phone-card"><b>Your LyricPad URL</b><div class="phone-url">${esc(origin)}</div><button id="copyPublicUrl">Copy address</button><div class="phone-step"><b>1</b><span>Open this same HTTPS address on your Samsung, iPad, PC, or any other device.</span></div><div class="phone-step"><b>2</b><span>Android: use the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. iPad: Safari → Share → <strong>Add to Home Screen</strong>.</span></div><div class="phone-step"><b>3</b><span>If you enabled a LyricPad access key on Render, enter it once under <strong>Settings</strong> on each device.</span></div></div><div class="empty warn">The app shell works anywhere, but v0.6 still stores each device's song library locally. Cross-device song sync is not implemented yet.</div>`:`<div class="section-title">Local access</div><div class="phone-card"><b>Same Wi-Fi</b><div class="phone-url">${esc(http||'Check the server first to discover your PC address.')}</div>${http?`<button id="copyPhoneUrl">Copy phone address</button>`:''}<div class="empty">For anywhere access without LAN/certificate setup, deploy this build to Render. Render provides a public HTTPS address automatically.</div></div>`;if($('#copyPublicUrl'))$('#copyPublicUrl').onclick=()=>copyText(origin);if($('#copyPhoneUrl'))$('#copyPhoneUrl').onclick=()=>copyText(http)}
}
function bind(){const s=active();mountEditor();
 $('#newSong').onclick=$('#plusTab').onclick=()=>{const n=newSong();state.songs.push(n);state.activeId=n.id;suggestions=[];schedulePersist();render();setTimeout(()=>$('#title')?.select(),0)};
 $$('.tab[data-id]').forEach(t=>t.onclick=e=>{if(e.target.dataset.close)return;state.activeId=t.dataset.id;suggestions=[];schedulePersist();render()});
 $$('[data-close]').forEach(c=>c.onclick=e=>{e.stopPropagation();if(state.songs.length===1){state.songs=[newSong()];state.activeId=state.songs[0].id}else{const idx=state.songs.findIndex(x=>x.id===c.dataset.close);state.songs.splice(idx,1);if(state.activeId===c.dataset.close)state.activeId=state.songs[Math.max(0,idx-1)].id}schedulePersist();render()});
 $('#title').oninput=e=>{s.title=e.target.value;s.updatedAt=Date.now();schedulePersist();const tab=$(`.tab[data-id="${s.id}"] span`);if(tab)tab.textContent=s.title||'Untitled'};
 $('#bpm').oninput=e=>{s.bpm=Number(e.target.value)||120;schedulePersist()};$('#key').oninput=e=>{s.key=e.target.value;schedulePersist()};
 $('#rhymeOverride').onchange=e=>{s.rhymeOverride=e.target.value;schedulePersist();const p=selectionOffsets();updateCoach(currentLineInfo(editorText(),p.start))};
 $$('[data-ai]').forEach(b=>b.onclick=()=>runAI(b.dataset.ai));$$('[data-side]').forEach(b=>b.onclick=()=>{state.sideTab=b.dataset.side;schedulePersist();$$('[data-side]').forEach(x=>x.classList.toggle('active',x===b));renderSide()});
 $('#panelBtn').onclick=()=>{sideOpen=!sideOpen;$('.side').classList.toggle('open',sideOpen)};
 $('#exportBtn').onclick=exportWorkspace;$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=importWorkspace;
}
function updateCoach(inf){const s=active(), a=analyzeFamilies(s.lyrics,inf.line), r=resolveRhyme(s,a), el=$('.coach-info');if(el)el.textContent=`Line ${inf.line} · ${inf.syllables} syllables · ${a.section} · ${a.pattern||'—'} · next ${r.label}`;refreshRhymeSelect(a,s)}
function refreshRhymeSelect(a,s){const sel=$('#rhymeOverride');if(!sel||document.activeElement===sel)return;const wanted=s.rhymeOverride||'auto';const signature=`${a.auto}|${a.families.map(f=>f.words.join('/')).join('|')}`;if(sel.dataset.sig===signature)return;sel.dataset.sig=signature;sel.innerHTML=`<option value="auto">Auto → ${a.auto==='new'?'New':a.auto}</option>${a.families.map((f,i)=>`<option value="${String.fromCharCode(65+i)}">${String.fromCharCode(65+i)} — ${esc(f.words.slice(-3).join(' / '))}</option>`).join('')}<option value="new">New rhyme</option><option value="none">No rhyme</option>`;sel.value=[...sel.options].some(o=>o.value===wanted)?wanted:'auto';if(sel.value!==wanted)s.rhymeOverride=sel.value}
function currentWord(){const t=editorText(),p=selectionOffsets().start;let a=p,b=p;while(a>0&&/[A-Za-zÀ-ÖØ-öø-ÿ']/.test(t[a-1]))a--;while(b<t.length&&/[A-Za-zÀ-ÖØ-öø-ÿ']/.test(t[b]))b++;return{word:t.slice(a,b).toLowerCase(),a,b}}
function insertAtCursor(text){const p=selectionOffsets();replaceEditorRange(text,p.start,p.end)}
function replaceCurrentLine(text){const t=editorText(),p=selectionOffsets().start;let a=t.lastIndexOf('\n',p-1)+1,b=t.indexOf('\n',p);if(b<0)b=t.length;replaceEditorRange(text,a,b)}
async function copyText(text){try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error('clipboard unavailable')}catch{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}toast('Copied')}
function cleanSuggestions(text){return [...new Set(String(text||'').split(/\r?\n/).map(x=>x.trim().replace(/^[-•\d.)\s]+/, '')).filter(x=>words(x).length>=3))].slice(0,10)}
async function runAI(action){const s=active(),p=selectionOffsets(),inf=currentLineInfo(editorText(),p.start),a=analyzeFamilies(s.lyrics,inf.line),r=resolveRhyme(s,a);state.sideTab='ai';renderSide();const box=$('#sideContent');box.innerHTML='<div class="empty">Thinking…</div>';try{const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','X-LyricPad-Key':state.accessKey||''},body:JSON.stringify({provider:s.provider||'openai',model:s.model||'',instructions:AI_INSTRUCTIONS,prompt:buildPrompt(action,s,a,r)})});const data=await res.json();if(!res.ok)throw new Error(data.error||'AI request failed');suggestions=cleanSuggestions(data.text);renderSide();if(!suggestions.length)throw new Error('The model returned no usable lyric lines.')}catch(e){box.innerHTML=`<div class="empty"><b>AI unavailable</b><br><br>${esc(e.message)}<br><br>Your lyrics and rhyme tools still work offline.</div>`}}
async function checkServer(){try{const r=await fetch('/api/status');serverStatus=await r.json();toast('AI server online')}catch{serverStatus={ok:false};toast('AI server not reachable')}renderSide()}
function exportWorkspace(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lyricpad-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
async function importWorkspace(e){const f=e.target.files?.[0];if(!f)return;try{const x=JSON.parse(await f.text());if(!Array.isArray(x.songs)||!x.songs.length)throw new Error('Not a LyricPad workspace');state=x;if(!state.activeId)state.activeId=state.songs[0].id;persist();render();toast('Workspace imported')}catch(err){toast(err.message)}e.target.value=''}
function toast(msg){let t=$('.toast');if(t)t.remove();t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='t'){e.preventDefault();$('#newSong')?.click()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='w'){e.preventDefault();$(`[data-close="${state.activeId}"]`)?.click()}});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
render(); checkServer(); loadRhymeData();
