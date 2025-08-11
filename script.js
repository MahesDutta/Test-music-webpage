/* VibePlayer v3 script
Features:
- Live search (iTunes + JioSaavn)
- Full-song playback via JioSaavn when available (attempts matching)
- Auto-refresh every 5 minutes for last search -> new songs added (toast shown)
- No-repeat playlist, color-changing animation per track
- Responsive, smooth animations
Note: JioSaavn endpoints are unofficial and may require a proxy in some environments.
*/

const iTunesEndpoint = q => `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=30`;
const jioSearchEndpoint = q => `https://saavn.me/search/songs?query=${encodeURIComponent(q)}`;

const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const navTabs = document.querySelectorAll('.nav-tab');
const pages = document.querySelectorAll('.page');
const logoBtn = document.getElementById('logoBtn');

const searchInput = document.getElementById('searchInput');
const suggestionsEl = document.getElementById('suggestions');
const resultsList = document.getElementById('resultsList');

const audio = document.getElementById('audio');
const artwork = document.getElementById('artwork');
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');

const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

const sourceItunes = document.getElementById('sourceItunes');
const sourceJio = document.getElementById('sourceJio');

const toastEl = document.getElementById('toast');
const toastArt = document.getElementById('toastArt');
const toastTitle = document.getElementById('toastTitle');
const toastArtist = document.getElementById('toastArtist');

let currentList = [];
let playlist = [];
let historyPlayed = new Set();
let currentPlaylistPos = -1;
let isPlaying = false;
let searchToken = 0;
let lastQuery = '';
let autoRefreshTimer = null;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function applyTheme(dark){
  if(dark){ body.classList.add('dark'); themeToggle.checked = true; localStorage.setItem('vibe-theme','dark'); }
  else { body.classList.remove('dark'); themeToggle.checked = false; localStorage.setItem('vibe-theme','light'); }
}
const stored = localStorage.getItem('vibe-theme');
if(stored) applyTheme(stored==='dark');
else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
themeToggle.addEventListener('change', ()=> applyTheme(themeToggle.checked) );

logoBtn.addEventListener('click', ()=> setActivePage('home'));
navTabs.forEach(t=> t.addEventListener('click', ()=> setActivePage(t.dataset.tab)));
function setActivePage(id){ pages.forEach(p=> p.classList.toggle('active', p.id===id)); navTabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===id)); window.scrollTo({top:0, behavior:'smooth'}); }

function debounce(fn, wait=320){ let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); }; }
async function fetchJson(url){ try{ const r = await fetch(url); return await r.json(); }catch(e){ console.warn('Fetch failed', url, e); return null; } }

function mapItunes(data){ if(!data||!data.results) return []; return data.results.map(it=> ({ id: 'itunes::'+(it.trackId||Math.random()), title: it.trackName, artist: it.artistName, artwork: it.artworkUrl100?it.artworkUrl100.replace('100x100','600x600'):'', preview: it.previewUrl||null, link: it.trackViewUrl||null, source:'itunes', genre: it.primaryGenreName||'' })); }
function mapJio(data){ try{ const list = data.results?.songs||data.results||[]; return list.map(s=> ({ id:'jio::'+(s.sid||s.id||Math.random()), title:s.title||s.song||'', artist:(s.more_info&&s.more_info.primary_artists)||s.subtitle||s.singers||s.artists||'', artwork:s.image?s.image.replace('150x150','500x500'):(s.album_image||''), preview:s.media_preview_url||s.downloadUrl||s.media_url||null, link:s.perma_url||s.url||null, source:'jiosaavn', genre:s.language||'' })); }catch(e){ return []; } }

function mergeResults(arrays){ const seen=new Set(); const merged=[]; for(const arr of arrays){ for(const it of arr){ const key = it.id || (it.source+'::'+it.title+'::'+it.artist); if(!seen.has(key)){ seen.add(key); merged.push(it); } } } return merged; }

function renderSuggestions(list){ suggestionsEl.innerHTML=''; if(!list||!list.length){ suggestionsEl.style.display='none'; return; } for(let i=0;i<Math.min(8,list.length);i++){ const it=list[i]; const div=document.createElement('div'); div.className='item'; div.tabIndex=0; div.innerHTML=`<img src="${escapeHtml(it.artwork||'placeholder.jpg')}" alt=""><div style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(it.title)}</strong><small style="color:var(--muted)">${escapeHtml(it.artist)} • ${it.source}</small></div>`; div.addEventListener('click', ()=>{ selectTrackById(it.id); suggestionsEl.style.display='none'; }); suggestionsEl.appendChild(div); } suggestionsEl.style.display='block'; }

function renderResults(list,newIds=[]){ resultsList.innerHTML=''; if(!list||!list.length){ resultsList.innerHTML=`<li class="card">No results for "${escapeHtml(lastQuery)}"</li>`; return; } list.forEach((it,idx)=>{ const li=document.createElement('li'); li.className='result-card'+(newIds.includes(it.id)?' new-item':''); li.dataset.index=idx; li.innerHTML=`<img src="${escapeHtml(it.artwork||'placeholder.jpg')}" alt=""><div class="result-meta"><b>${escapeHtml(it.title)}</b><small>${escapeHtml(it.artist)} • ${it.source}</small></div>`; li.addEventListener('click', ()=>{ createPlaylistFromResults(idx); playIndex(0); setActivePage('home'); }); resultsList.appendChild(li); }); }

function selectTrackById(id){ const idx=currentList.findIndex(x=>x.id===id); if(idx>=0){ createPlaylistFromResults(idx); playIndex(0); } }

async function performSearch(query){ if(!query||query.length<1){ suggestionsEl.style.display='none'; resultsList.innerHTML=''; return; } lastQuery=query; const token=++searchToken; suggestionsEl.style.display='block'; suggestionsEl.innerHTML=`<div style="padding:10px;color:var(--muted)">Searching “${escapeHtml(query)}”…</div>`; const calls=[]; if(sourceItunes.checked) calls.push(fetchJson(iTunesEndpoint(query)).then(mapItunes).catch(()=>[])); if(sourceJio.checked) calls.push(fetchJson(jioSearchEndpoint(query)).then(mapJio).catch(()=>[])); const arrs=await Promise.all(calls); if(token!==searchToken) return; const merged=mergeResults(arrs); if(merged.length===0 && !sourceJio.checked){ const j=await fetchJson(jioSearchEndpoint(query)); const mapped=mapJio(j); merged.push(...mapped); } currentList=merged; renderSuggestions(currentList.slice(0,12)); renderResults(currentList); ensureAutoRefresh(); }

const debouncedSearch = debounce(q=>{ performSearch(q); },320);
searchInput.addEventListener('input', e=>{ const v=e.target.value.trim(); if(!v){ suggestionsEl.style.display='none'; resultsList.innerHTML=''; } debouncedSearch(v); });
document.addEventListener('click', ev=>{ if(!ev.target.closest('.search-row')) suggestionsEl.style.display='none'; });

function createPlaylistFromResults(selectedIdx){ playlist=[]; historyPlayed.clear(); const primary=currentList[selectedIdx]; const queryWords=(lastQuery||'').toLowerCase().split(/\s+/).filter(Boolean); const primaryTags=((primary.title+' '+primary.artist+' '+(primary.genre||'')).toLowerCase()).split(/\s+/).filter(Boolean); const scoreFor=(item)=>{ if(item.id===primary.id) return -1; let score=0; if(item.source===primary.source) score+=5; queryWords.forEach(w=>{ if((item.title+' '+item.artist).toLowerCase().includes(w)) score+=4; }); primaryTags.forEach(w=>{ if((item.title+' '+item.artist).toLowerCase().includes(w)) score+=3; }); if(primary.genre && item.genre && item.genre===primary.genre) score+=3; score += Math.random()*2; return score; }; const scored=currentList.map((it,i)=>({it,i,score:scoreFor(it)})).filter(s=>s.score>=0); scored.sort((a,b)=> b.score - a.score); playlist.push(selectedIdx); for(const s of scored){ if(playlist.length>=40) break; if(playlist.includes(s.i)) continue; playlist.push(s.i); } if(playlist.length>2){ const head=playlist.slice(0,1); const tail=playlist.slice(1); for(let i=tail.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [tail[i],tail[j]]=[tail[j],tail[i]]; } playlist = head.concat(tail); } currentPlaylistPos=-1; }

async function playIndex(pos){ if(!playlist||playlist.length===0) return; if(pos<0||pos>=playlist.length) return; currentPlaylistPos=pos; const idx=playlist[pos]; const track=currentList[idx]; if(!track) return; trackTitle.textContent=track.title||'Unknown title'; trackArtist.textContent=track.artist||'Unknown artist'; artwork.src = track.artwork || 'placeholder.jpg'; applyColorPaletteForTrack(track); let playableUrl = track.preview || track.link || null; if(track.source==='itunes'){ const q = `${track.title} ${track.artist}`; const jresp = await fetchJson(jioSearchEndpoint(q)); const jmapped = mapJio(jresp); if(jmapped && jmapped.length>0 && jmapped[0].preview) playableUrl = jmapped[0].preview; if(jmapped && jmapped.length>0){ if(jmapped[0].preview) playableUrl = jmapped[0].preview; if(jmapped[0].artwork) artwork.src = jmapped[0].artwork; } } else if(track.source==='jiosaavn'){ playableUrl = track.preview || track.link || playableUrl; } if(!playableUrl){ if(track.link){ window.open(track.link,'_blank'); setTimeout(()=> playNext(),600); return; } else { setTimeout(()=> playNext(),600); return; } } audio.src = playableUrl; try{ await audio.play(); isPlaying=true; updatePlayButton(); historyPlayed.add(track.id); }catch(err){ console.warn('Playback failed', err); isPlaying=false; updatePlayButton(); } }

function playNext(){ if(!playlist||playlist.length===0) return; let next = (currentPlaylistPos+1)%playlist.length; for(let i=0;i<playlist.length;i++){ const candidate=(currentPlaylistPos+1+i)%playlist.length; const idx=playlist[candidate]; const it=currentList[idx]; if(!historyPlayed.has(it.id)){ next=candidate; break; } } playIndex(next); }
function playPrev(){ if(!playlist||playlist.length===0) return; let prev = (currentPlaylistPos-1+playlist.length)%playlist.length; playIndex(prev); }

playPauseBtn.addEventListener('click', ()=>{ if(!audio.src) return; if(audio.paused){ audio.play(); isPlaying=true; } else { audio.pause(); isPlaying=false; } updatePlayButton(); });
audio.addEventListener('play', ()=>{ isPlaying=true; updatePlayButton(); });
audio.addEventListener('pause', ()=>{ isPlaying=false; updatePlayButton(); });
audio.addEventListener('ended', ()=>{ isPlaying=false; updatePlayButton(); setTimeout(()=> playNext(),400); });
prevBtn.addEventListener('click', ()=> playPrev());
nextBtn.addEventListener('click', ()=> playNext());

function updatePlayButton(){ playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play'; playPauseBtn.classList.toggle('playing', isPlaying); }

const palettes = [['#ff7a18','#af002d'],['#7c3aed','#06b6d4'],['#f59e0b','#ef4444'],['#06b6d4','#3b82f6'],['#a78bfa','#ec4899'],['#22c55e','#06b6d4'],['#f97316','#b91c1c']];
function applyColorPaletteForTrack(track){ const id = track.id || (track.title+track.artist); let h=0; for(let i=0;i<id.length;i++) h=(h<<5)-h+id.charCodeAt(i); const idx=Math.abs(h)%palettes.length; const [c1,c2]=palettes[idx]; document.documentElement.style.setProperty('--accent1', c1); document.documentElement.style.setProperty('--accent2', c2); document.documentElement.style.setProperty('--dynamic-gradient', `linear-gradient(135deg, ${hexToRgba(c1,0.10)}, ${hexToRgba(c2,0.10)})`); try{ artwork.animate([{transform:'scale(1)'},{transform:'scale(1.04)'},{transform:'scale(1)'}], {duration:1200, easing:'ease-out'}); }catch(e){} }
function hexToRgba(hex,a=1){ const h=hex.replace('#',''); const bigint=parseInt(h,16); const r=(bigint>>16)&255; const g=(bigint>>8)&255; const b=bigint&255; return `rgba(${r},${g},${b},${a})`; }

let toastTimer=null;
function showToast(track){ if(!track) return; toastArt.src = track.artwork || 'placeholder.jpg'; toastTitle.textContent = track.title || ''; toastArtist.textContent = track.artist || ''; toastEl.hidden = false; toastEl.style.opacity='1'; toastEl.style.transform='translateY(0)'; clearTimeout(toastTimer); toastTimer = setTimeout(()=>{ toastEl.hidden = true; }, 3500); }

async function checkForNewReleases(){ if(!lastQuery||lastQuery.length<1) return; const calls=[]; if(sourceItunes.checked) calls.push(fetchJson(iTunesEndpoint(lastQuery)).then(mapItunes).catch(()=>[])); if(sourceJio.checked) calls.push(fetchJson(jioSearchEndpoint(lastQuery)).then(mapJio).catch(()=>[])); const arrs = await Promise.all(calls); const merged = mergeResults(arrs); const existing = new Set(currentList.map(x=>x.id)); const newItems = merged.filter(x=>!existing.has(x.id)); if(newItems.length>0){ currentList = [...newItems, ...currentList]; const newIds = newItems.map(x=>x.id); renderResults(currentList, newIds); showToast(newItems[0]); for(const it of newItems){ const idx=currentList.findIndex(x=>x.id===it.id); if(idx>=0 && !playlist.includes(idx)) playlist.push(idx); } } }

function startAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer = setInterval(()=>{ checkForNewReleases(); }, AUTO_REFRESH_MS); }
function stopAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer=null; }
function ensureAutoRefresh(){ startAutoRefresh(); }

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

setActivePage('home');
document.getElementById('feedbackForm').addEventListener('submit', e=>{ e.preventDefault(); alert('Thanks for your feedback!'); e.target.reset(); });
window._vibe = { performSearch: (q)=> performSearch(q), playNext, playPrev, checkForNewReleases };
const debouncedSearch2 = debounce(q=>{ performSearch(q); },320);
searchInput.addEventListener('input', e=>{ const v=e.target.value.trim(); if(!v){ suggestionsEl.style.display='none'; resultsList.innerHTML=''; } debouncedSearch2(v); });
document.addEventListener('click', ev=>{ if(!ev.target.closest('.search-row')) suggestionsEl.style.display='none'; });
