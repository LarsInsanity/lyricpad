const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORAGE = 'lyricpad-next-workspace-v1';
const DEFAULT_LYRICS = '[VERSE 1]\n\n';

const COMMON_RHYME_FAMILIES = [
  ['how','now','wow','somehow','allow','vow'],['down','town','around','ground','sound','found','bound','crown'],
  ['way','say','day','stay','away','play','gray','today'],['go','know','show','slow','below','although','ago'],
  ['been','within','skin','win','begin','again','sin','in'],['night','light','right','sight','fight','tonight','bright'],
  ['mind','find','behind','kind','blind','remind','time'],['heart','start','apart','part','dark','spark'],
  ['you','blue','true','through','do','new','knew','too'],['me','see','free','be','sea','three','memory'],
  ['fire','desire','higher','wire','tire'],['name','same','game','flame','blame','came'],
  ['love','above','enough','tough','rough'],['home','alone','known','phone','stone','own'],
  ['door','more','before','floor','anymore'],['rain','pain','again','train','same'],['eyes','lies','skies','goodbyes','rise'],
  ['feel','real','heal','deal','still'],['end','friend','bend','send','pretend'],['back','track','black','lack','crack'],
];

function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}
function newSong(){return {id:uid(),title:'Untitled',lyrics:DEFAULT_LYRICS,bpm:120,key:'',notes:'',rhymeOverride:'auto',provider:'openai',model:'',updatedAt:Date.now()}}
function load(){try{const x=JSON.parse(localStorage.getItem(STORAGE));if(x?.songs?.length)return x}catch{}return {songs:[newSong()],activeId:null,sideTab:'rhymes',accessKey:''}}
let state=load(); if(!state.activeId||!state.songs.some(s=>s.id===state.activeId)) state.activeId=state.songs[0].id;
let cursorLine=1, suggestions=[], serverStatus=null, sideOpen=false, saveTimer=null;
function active(){return state.songs.find(s=>s.id===state.activeId)||state.songs[0]}
function persist(){localStorage.setItem(STORAGE,JSON.stringify(state))}
function schedulePersist(){clearTimeout(saveTimer);saveTimer=setTimeout(persist,120)}
function esc(s=''){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function words(s){return (s.toLowerCase().match(/[a-zà-öø-ÿ']+/g)||[]).map(w=>w.replace(/^'+|'+$/g,''))}
function endWord(line){const w=words(line);return w.at(-1)||''}
function isSection(line){return /^\s*\[[^\]]+\]\s*$/.test(line)}
function syllables(word){word=word.toLowerCase().replace(/[^a-z]/g,'');if(!word)return 0;if(word.length<=3)return 1;word=word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');return Math.max(1,(word.match(/[aeiouy]{1,2}/g)||[]).length)}
function lineSyllables(line){return isSection(line)?0:words(line).reduce((n,w)=>n+syllables(w),0)}
function normalizedFamily(word){
  if(!word)return '';
  for(let i=0;i<COMMON_RHYME_FAMILIES.length;i++) if(COMMON_RHYME_FAMILIES[i].includes(word)) return `f${i}`;
  const w=word.replace(/(ing|ed|es|s)$/,'');
  return w.length>=3?w.slice(-3):w;
}
function rhymeScore(a,b){if(!a||!b||a===b)return 0;const fa=normalizedFamily(a),fb=normalizedFamily(b);if(fa===fb)return .95;const sa=a.slice(-2),sb=b.slice(-2);if(sa===sb)return .75;const va=(a.match(/[aeiouy]+(?=[^aeiouy]*$)/)||[])[0],vb=(b.match(/[aeiouy]+(?=[^aeiouy]*$)/)||[])[0];return va&&va===vb?.[0]?.[0]?.[0]?0.62:0}
function rhymes(a,b){return rhymeScore(a,b)>=.72}
function rhymeWords(word){
  if(!word)return {perfect:[],near:[]};
  const fam=COMMON_RHYME_FAMILIES.find(f=>f.includes(word));
  let perfect=fam?fam.filter(w=>w!==word):[];
  const near=[];
  for(const f of COMMON_RHYME_FAMILIES){for(const w of f){if(w!==word&&!perfect.includes(w)&&rhymeScore(word,w)>=.55)near.push(w)}}
  return {perfect:perfect.slice(0,18),near:[...new Set(near)].slice(0,20)};
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
function editorText(ed=$('#editor')){return ed?.value??''}
function selectionOffsets(ed=$('#editor')){return ed?{start:ed.selectionStart??0,end:ed.selectionEnd??0}:{start:0,end:0}}
function setEditorSelection(start,end=start,ed=$('#editor')){if(!ed)return;const len=ed.value.length;start=Math.max(0,Math.min(start,len));end=Math.max(0,Math.min(end,len));ed.setSelectionRange(start,end)}
function replaceEditorRange(insert,start,end,ed=$('#editor')){if(!ed)return;const old=ed.value,next=old.slice(0,start)+insert+old.slice(end);ed.value=next;const p=start+insert.length;setEditorSelection(p,p,ed)}
function gutterHTML(meta,currentLine){
  return `<div class="gutter-head"><span>Line</span><span>Syl</span><span>Rhyme</span></div><div class="gutter-lines">${meta.map(row=>`<div class="gutter-row ${row.line===currentLine?'current':''}" data-gutter-line="${row.line}"><span>${row.line}</span><span>${row.syllables||''}</span><span class="gutter-rhyme">${row.familyLetter?`<b class="cue-dot ${RHYME_CLASSES[(row.family||0)%RHYME_CLASSES.length]}">◆${row.familyLetter}</b><em class="end-word ${RHYME_CLASSES[(row.family||0)%RHYME_CLASSES.length]}">${esc(row.end)}</em>`:''}</span></div>`).join('')}</div>`;
}
function updateEditorDecorations(){
  const ed=$('#editor');if(!ed)return;const text=editorText(ed),pos=selectionOffsets(ed),inf=currentLineInfo(text,pos.start),meta=analyzeDocument(text);const gut=$('#lineGutter');if(gut)gut.innerHTML=gutterHTML(meta,inf.line);syncEditorScroll();
  $$('[data-gutter-line]').forEach(row=>row.ondblclick=()=>{const target=Number(row.dataset.gutterLine),lines=text.split('\n');let p=0;for(let i=1;i<target;i++)p+=lines[i-1].length+1;ed.focus();setEditorSelection(p,p,ed)});
}
function syncEditorScroll(){const ed=$('#editor'),gut=$('#lineGutter .gutter-lines');if(!ed)return;if(gut)gut.scrollTop=ed.scrollTop}

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
 const s=active(); const analysis=analyzeFamilies(s.lyrics,cursorLine); const rc=resolveRhyme(s,analysis);
 document.getElementById('app').innerHTML=`<div class="shell">
 <div class="topbar"><div class="brand">LyricPad <span>Next</span></div><button id="newSong">＋ New</button><button id="exportBtn" class="desktop-only">Export</button><button id="importBtn" class="desktop-only">Import</button><input id="importFile" type="file" accept="application/json,.json" hidden><div class="spacer"></div><button id="panelBtn" class="mobile-panel-toggle">Tools</button><span class="desktop-only"><span class="status-dot ${serverStatus?.ok?'ok':''}"></span>${serverStatus?.ok?'AI server':'Offline'}</span></div>
 <div class="tabs">${state.songs.map(x=>`<button class="tab ${x.id===s.id?'active':''}" data-id="${x.id}"><span>${esc(x.title||'Untitled')}</span><span class="tab-close" data-close="${x.id}">×</span></button>`).join('')}<button class="tab" id="plusTab">＋</button></div>
 <div class="workspace"><main class="main"><div class="meta"><input class="title-input" id="title" value="${esc(s.title)}" placeholder="Untitled"><input class="mini" id="bpm" type="number" min="40" max="300" value="${s.bpm}"><span class="empty">BPM</span><input class="mini" id="key" value="${esc(s.key)}" placeholder="Key"></div>
 <div class="editor-wrap"><textarea class="editor" id="editor" spellcheck="true" aria-label="Lyrics">${esc(s.lyrics)}</textarea><div class="line-gutter" id="lineGutter"></div></div>
 <div class="coach"><span class="coach-info">Line ${cursorLine} · ${currentLineInfo(s.lyrics,0).syllables || ''} ${analysis.section} · pattern ${analysis.pattern||'—'}</span><select id="rhymeOverride"><option value="auto">Auto → ${analysis.auto==='new'?'New':analysis.auto}</option>${analysis.families.map((f,i)=>`<option value="${String.fromCharCode(65+i)}">${String.fromCharCode(65+i)} — ${esc(f.words.slice(-3).join(' / '))}</option>`).join('')}<option value="new">New rhyme</option><option value="none">No rhyme</option></select><button class="primary" data-ai="continue">✦ Next lines</button><button data-ai="tighten">Tighten</button><button data-ai="vivid">More vivid</button></div></main>
 <aside class="side ${sideOpen?'open':''}"><div class="side-tabs"><button data-side="rhymes" class="${state.sideTab==='rhymes'?'active':''}">Rhymes</button><button data-side="ai" class="${state.sideTab==='ai'?'active':''}">AI</button><button data-side="notes" class="${state.sideTab==='notes'?'active':''}">Notes</button><button data-side="settings" class="${state.sideTab==='settings'?'active':''}">Settings</button><button data-side="phone" class="${state.sideTab==='phone'?'active':''}">Access</button></div><div class="side-content" id="sideContent"></div></aside></div></div>`;
 $('#rhymeOverride').value=s.rhymeOverride||'auto'; bind(); renderSide();
}
function renderSide(){const s=active(), box=$('#sideContent'); if(!box)return;
 if(state.sideTab==='rhymes'){const info=currentWord();const r=rhymeWords(info.word);box.innerHTML=`<div class="section-title">Word at cursor</div><h3>${esc(info.word||'—')}</h3><div class="rhyme-grid"><div><div class="section-title">Strong rhymes</div><div class="chip-list">${r.perfect.map(w=>`<span class="chip" data-rhyme="${w}">${w}</span>`).join('')||'<span class="empty">Type/select a common word.</span>'}</div></div><div><div class="section-title">Near / slant</div><div class="chip-list">${r.near.map(w=>`<span class="chip" data-rhyme="${w}">${w}</span>`).join('')||'<span class="empty">No useful slants in the small offline lexicon yet.</span>'}</div></div></div><p class="empty">Next uses a compact offline rhyme lexicon for now. We can port the larger v3.8 phonetic dictionary into the web build next.</p>`;$$('[data-rhyme]').forEach(x=>x.onclick=()=>insertAtCursor(x.dataset.rhyme));}
 if(state.sideTab==='ai'){box.innerHTML=`<div class="section-title">AI suggestions</div><div class="suggestions">${suggestions.map((x,i)=>`<div class="suggestion"><div class="suggestion-text">${esc(x)}</div><div class="suggestion-actions"><button data-copy="${i}">Copy</button><button data-insert="${i}">Insert</button><button data-replace="${i}">Replace line</button></div></div>`).join('')||'<div class="empty">Press Next lines, Tighten, or More vivid. Suggestions appear here as individually copyable cards.</div>'}</div>`;$$('[data-copy]').forEach(b=>b.onclick=()=>copyText(suggestions[+b.dataset.copy]));$$('[data-insert]').forEach(b=>b.onclick=()=>insertAtCursor(suggestions[+b.dataset.insert]));$$('[data-replace]').forEach(b=>b.onclick=()=>replaceCurrentLine(suggestions[+b.dataset.replace]));}
 if(state.sideTab==='notes'){box.innerHTML=`<div class="section-title">Song notes / intent</div><textarea class="notes" id="notes">${esc(s.notes||'')}</textarea><p class="empty">These notes are included in AI context, so you can describe the theme, point of view, words to avoid, or what the song is about.</p>`;$('#notes').oninput=e=>{s.notes=e.target.value;s.updatedAt=Date.now();schedulePersist()}}
 if(state.sideTab==='settings'){box.innerHTML=`<div class="section-title">AI provider</div><div class="settings-grid"><label>Provider<select id="provider"><option value="openai">OpenAI (hosted/server)</option><option value="ollama">Ollama</option></select></label><label>Model override<input id="model" value="${esc(s.model||'')}" placeholder="Use server default"></label><label>LyricPad access key<input id="accessKey" type="password" value="${esc(state.accessKey||'')}" placeholder="Required if enabled on server" autocomplete="off"></label><button id="checkServer">Check AI server</button><div class="empty">${serverStatus?`Server: ${serverStatus.ok?'online':'offline'}<br>Hosted: ${serverStatus.hosted?'yes':'no'}<br>OpenAI configured: ${serverStatus.openaiConfigured?'yes':'no'}<br>Access key required: ${serverStatus.accessKeyRequired?'yes':'no'}<br>Default OpenAI model: ${esc(serverStatus.openaiModel||'—')}`:'Not checked yet.'}</div></div>`;$('#provider').value=s.provider||'openai';$('#provider').onchange=e=>{s.provider=e.target.value;schedulePersist()};$('#model').oninput=e=>{s.model=e.target.value;schedulePersist()};$('#accessKey').oninput=e=>{state.accessKey=e.target.value;schedulePersist()};$('#checkServer').onclick=checkServer}
 if(state.sideTab==='phone'){const origin=serverStatus?.publicUrl||location.origin;const hosted=serverStatus?.hosted||location.protocol==='https:'&&!['localhost','127.0.0.1'].includes(location.hostname);const http=serverStatus?.httpUrls?.[0]||'';box.innerHTML=hosted?`<div class="section-title">Anywhere access</div><div class="phone-card"><b>Your LyricPad URL</b><div class="phone-url">${esc(origin)}</div><button id="copyPublicUrl">Copy address</button><div class="phone-step"><b>1</b><span>Open this same HTTPS address on your Samsung, iPad, PC, or any other device.</span></div><div class="phone-step"><b>2</b><span>Android: use the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. iPad: Safari → Share → <strong>Add to Home Screen</strong>.</span></div><div class="phone-step"><b>3</b><span>If you enabled a LyricPad access key on Render, enter it once under <strong>Settings</strong> on each device.</span></div></div><div class="empty warn">The app shell works anywhere, but v0.6 still stores each device's song library locally. Cross-device song sync is not implemented yet.</div>`:`<div class="section-title">Local access</div><div class="phone-card"><b>Same Wi-Fi</b><div class="phone-url">${esc(http||'Check the server first to discover your PC address.')}</div>${http?`<button id="copyPhoneUrl">Copy phone address</button>`:''}<div class="empty">For anywhere access without LAN/certificate setup, deploy this build to Render. Render provides a public HTTPS address automatically.</div></div>`;if($('#copyPublicUrl'))$('#copyPublicUrl').onclick=()=>copyText(origin);if($('#copyPhoneUrl'))$('#copyPhoneUrl').onclick=()=>copyText(http)}
}
function bind(){const s=active(), ed=$('#editor');updateEditorDecorations();ed.onscroll=syncEditorScroll;
 $('#newSong').onclick=$('#plusTab').onclick=()=>{const n=newSong();state.songs.push(n);state.activeId=n.id;suggestions=[];schedulePersist();render();setTimeout(()=>$('#title')?.select(),0)};
 $$('.tab[data-id]').forEach(t=>t.onclick=e=>{if(e.target.dataset.close)return;state.activeId=t.dataset.id;suggestions=[];schedulePersist();render()});
 $$('[data-close]').forEach(c=>c.onclick=e=>{e.stopPropagation();if(state.songs.length===1){state.songs=[newSong()];state.activeId=state.songs[0].id}else{const idx=state.songs.findIndex(x=>x.id===c.dataset.close);state.songs.splice(idx,1);if(state.activeId===c.dataset.close)state.activeId=state.songs[Math.max(0,idx-1)].id}schedulePersist();render()});
 $('#title').oninput=e=>{s.title=e.target.value;s.updatedAt=Date.now();schedulePersist();const tab=$(`.tab[data-id="${s.id}"] span`);if(tab)tab.textContent=s.title||'Untitled'};
 $('#bpm').oninput=e=>{s.bpm=Number(e.target.value)||120;schedulePersist()};$('#key').oninput=e=>{s.key=e.target.value;schedulePersist()};
 const updateCursor=()=>{const text=editorText(ed),pos=selectionOffsets(ed);const inf=currentLineInfo(text,pos.start);cursorLine=inf.line;s.lyrics=text;s.updatedAt=Date.now();schedulePersist();updateCoach(inf);updateEditorDecorations()};
 ed.oninput=updateCursor;ed.onclick=()=>{updateCursor();if(state.sideTab==='rhymes')renderSide()};ed.onkeyup=()=>{updateCursor();if(state.sideTab==='rhymes')renderSide()};
 $('#rhymeOverride').onchange=e=>{s.rhymeOverride=e.target.value;schedulePersist();const p=selectionOffsets(ed);updateCoach(currentLineInfo(editorText(ed),p.start))};
 $$('[data-ai]').forEach(b=>b.onclick=()=>runAI(b.dataset.ai));$$('[data-side]').forEach(b=>b.onclick=()=>{state.sideTab=b.dataset.side;schedulePersist();$$('[data-side]').forEach(x=>x.classList.toggle('active',x===b));renderSide()});
 $('#panelBtn').onclick=()=>{sideOpen=!sideOpen;$('.side').classList.toggle('open',sideOpen)};
 $('#exportBtn').onclick=exportWorkspace;$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=importWorkspace;
}
function updateCoach(inf){const s=active(), a=analyzeFamilies(s.lyrics,inf.line), r=resolveRhyme(s,a), el=$('.coach-info');if(el)el.textContent=`Line ${inf.line} · ${inf.syllables} syllables · ${a.section} · ${a.pattern||'—'} · next ${r.label}`;refreshRhymeSelect(a,s)}
function refreshRhymeSelect(a,s){const sel=$('#rhymeOverride');if(!sel||document.activeElement===sel)return;const wanted=s.rhymeOverride||'auto';const signature=`${a.auto}|${a.families.map(f=>f.words.join('/')).join('|')}`;if(sel.dataset.sig===signature)return;sel.dataset.sig=signature;sel.innerHTML=`<option value="auto">Auto → ${a.auto==='new'?'New':a.auto}</option>${a.families.map((f,i)=>`<option value="${String.fromCharCode(65+i)}">${String.fromCharCode(65+i)} — ${esc(f.words.slice(-3).join(' / '))}</option>`).join('')}<option value="new">New rhyme</option><option value="none">No rhyme</option>`;sel.value=[...sel.options].some(o=>o.value===wanted)?wanted:'auto';if(sel.value!==wanted)s.rhymeOverride=sel.value}
function currentWord(){const ed=$('#editor');if(!ed)return{word:''};const t=editorText(ed),p=selectionOffsets(ed).start;let a=p,b=p;while(a>0&&/[A-Za-zÀ-ÖØ-öø-ÿ']/.test(t[a-1]))a--;while(b<t.length&&/[A-Za-zÀ-ÖØ-öø-ÿ']/.test(t[b]))b++;return{word:t.slice(a,b).toLowerCase(),a,b}}
function insertAtCursor(text){const ed=$('#editor'),s=active(),p=selectionOffsets(ed);replaceEditorRange(text,p.start,p.end,ed);s.lyrics=editorText(ed);ed.focus();ed.dispatchEvent(new Event('input',{bubbles:true}))}
function replaceCurrentLine(text){const ed=$('#editor'),t=editorText(ed),p=selectionOffsets(ed).start;let a=t.lastIndexOf('\n',p-1)+1,b=t.indexOf('\n',p);if(b<0)b=t.length;replaceEditorRange(text,a,b,ed);active().lyrics=editorText(ed);ed.focus();ed.dispatchEvent(new Event('input',{bubbles:true}))}
async function copyText(text){try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error('clipboard unavailable')}catch{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}toast('Copied')}
function cleanSuggestions(text){return [...new Set(String(text||'').split(/\r?\n/).map(x=>x.trim().replace(/^[-•\d.)\s]+/, '')).filter(x=>words(x).length>=3))].slice(0,10)}
async function runAI(action){const s=active(),ed=$('#editor'),p=selectionOffsets(ed),inf=currentLineInfo(editorText(ed),p.start),a=analyzeFamilies(s.lyrics,inf.line),r=resolveRhyme(s,a);state.sideTab='ai';renderSide();const box=$('#sideContent');box.innerHTML='<div class="empty">Thinking…</div>';try{const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','X-LyricPad-Key':state.accessKey||''},body:JSON.stringify({provider:s.provider||'openai',model:s.model||'',instructions:AI_INSTRUCTIONS,prompt:buildPrompt(action,s,a,r)})});const data=await res.json();if(!res.ok)throw new Error(data.error||'AI request failed');suggestions=cleanSuggestions(data.text);renderSide();if(!suggestions.length)throw new Error('The model returned no usable lyric lines.')}catch(e){box.innerHTML=`<div class="empty"><b>AI unavailable</b><br><br>${esc(e.message)}<br><br>Your lyrics and rhyme tools still work offline.</div>`}}
async function checkServer(){try{const r=await fetch('/api/status');serverStatus=await r.json();toast('AI server online')}catch{serverStatus={ok:false};toast('AI server not reachable')}renderSide()}
function exportWorkspace(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lyricpad-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
async function importWorkspace(e){const f=e.target.files?.[0];if(!f)return;try{const x=JSON.parse(await f.text());if(!Array.isArray(x.songs)||!x.songs.length)throw new Error('Not a LyricPad workspace');state=x;if(!state.activeId)state.activeId=state.songs[0].id;persist();render();toast('Workspace imported')}catch(err){toast(err.message)}e.target.value=''}
function toast(msg){let t=$('.toast');if(t)t.remove();t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),1800)}
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='t'){e.preventDefault();$('#newSong')?.click()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='w'){e.preventDefault();$(`[data-close="${state.activeId}"]`)?.click()}});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
render(); checkServer();
