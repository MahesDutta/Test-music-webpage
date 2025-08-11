// Responsive Music Player with live suggestions from iTunes + JioSaavn (unofficial endpoint)
// NOTE: JioSaavn's public endpoints are unofficial and may have CORS restrictions. In some environments you may need a proxy.
// iTunes Search API (no auth): https://itunes.apple.com/search?term=...&entity=song&limit=10
// JioSaavn unofficial search (examples used widely): https://saavn.me/search/songs?query=QUERY

const iTunesEndpoint = (q) => `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=10`;
const jioEndpoint = (q) => `https://saavn.me/search/songs?query=${encodeURIComponent(q)}`; // unofficial

// DOM refs
const searchInput = document.getElementById('searchInput');
const suggestionsEl = document.getElementById('suggestions');
const audio = document.getElementById('audio');
const artwork = document.getElementById('artwork');
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');
const playPauseBtn = document.getElementById('playPauseBtn');
const tabs = Array.from(document.querySelectorAll('.tab'));
let activeSource = 'both'; // both / itunes / jiosaavn

// State
let currentList = [];
let currentIndex = -1;
let isPlaying = false;
let searchToken = 0;

// Utils
function debounce(fn, wait=350){
  let t;
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); };
}

function setActiveTab(source){
  activeSource = source;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.source === source));
  // show combined when 'both' selected
  if(source === 'both'){
    tabs.forEach(t => t.classList.toggle('active', t.dataset.source === 'both'));
  }
}

// Tab click handlers with animation class toggles
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const source = tab.dataset.source;
    setActiveTab(source);
    // small animation
    tab.animate([{transform:'translateY(0) scale(1)'},{transform:'translateY(-6px) scale(1.02)'}], {duration:220, fill:'forwards'}).onfinish = ()=>{
      tab.animate([{transform:'translateY(-6px) scale(1.02)'},{transform:'translateY(0) scale(1)'}], {duration:220, fill:'forwards'});
    };
    // trigger a new search to update suggestions for this source
    triggerSearch(searchInput.value.trim());
  });
});

// Search handling
const triggerSearch = debounce(async (query)=>{
  if(!query || query.length < 1){
    suggestionsEl.style.display = 'none';
    suggestionsEl.innerHTML = '';
    return;
  }

  const token = ++searchToken;
  suggestionsEl.style.display = 'block';
  suggestionsEl.innerHTML = `<div style="padding:12px;color:#aab8cc">Searching “${escapeHtml(query)}” …</div>`;

  try {
    const results = await fetchCombinedResults(query, activeSource);
    // ensure response is still relevant
    if(token !== searchToken) return;
    currentList = results;
    renderSuggestions(results);
  } catch(err){
    console.error('Search error', err);
    suggestionsEl.innerHTML = `<div style="padding:12px;color:#f88">Error fetching results</div>`;
  }
}, 300);

searchInput.addEventListener('input', (e)=>{
  const v = e.target.value.trim();
  triggerSearch(v);
  if(!v) { suggestionsEl.style.display='none'; }
});

// Close suggestions on outside click
document.addEventListener('click', (ev)=>{
  if(!ev.target.closest('.search-wrap')){
    suggestionsEl.style.display='none';
  }
});

// Fetching both APIs and merging
async function fetchCombinedResults(query, source='both'){
  const calls = [];
  if(source === 'both' || source === 'itunes'){
    calls.push(fetch(iTunesEndpoint(query)).then(r=>r.json()).then(mapITunesResults).catch(()=>[]));
  }
  if(source === 'both' || source === 'jiosaavn'){
    calls.push(fetch(jioEndpoint(query)).then(r=>r.json()).then(mapJioResults).catch(()=>[]));
  }
  const all = await Promise.all(calls);
  // merge flatten preserve order
  const merged = all.flat();
  // unique by a simple id (source + id)
  const seen = new Set();
  const uniq = [];
  for(const item of merged){
    const key = (item.source||'') + '::' + (item.id||item.trackId||item.sid||item.title);
    if(!seen.has(key)){
      seen.add(key);
      uniq.push(item);
    }
  }
  return uniq.slice(0, 20);
}

// Map iTunes result items to a unified shape
function mapITunesResults(data){
  if(!data || !data.results) return [];
  return data.results.map(it => ({
    id: it.trackId,
    title: it.trackName,
    artist: it.artistName,
    artwork: it.artworkUrl100 ? it.artworkUrl100.replace('100x100','600x600') : '',
    preview: it.previewUrl || null,
    source: 'itunes',
    link: it.trackViewUrl || it.collectionViewUrl || null
  }));
}

// Map JioSaavn result items (unofficial shape — may vary)
function mapJioResults(data){
  try{
    if(!data || !data.results) return [];
    // the endpoint may return an array like data.results.songs or data.results
    const list = data.results?.songs || data.results || [];
    return list.map(s => ({
      id: s.sid || s.id || s.perma_url || s.title,
      title: s.title || s.song,
      artist: (s.more_info && s.more_info.primary_artists) || s.subtitle || s.singers || s.artists || s.primary_artists || '',
      artwork: s.image ? s.image.replace('150x150','500x500') : (s.album_image || ''),
      preview: s.media_preview_url || s.downloadUrl || s.media_url || null, // may or may not be present
      source: 'jiosaavn',
      link: s.perma_url || s.url || null
    }));
  } catch(e){
    return [];
  }
}

// Render suggestions dropdown
function renderSuggestions(list){
  if(!list || list.length === 0){
    suggestionsEl.innerHTML = `<div style="padding:12px;color:#aab8cc">No results</div>`;
    return;
  }
  suggestionsEl.innerHTML = '';
  for(let i=0;i<list.length;i++){
    const it = list[i];
    const div = document.createElement('div');
    div.className = 'item';
    div.tabIndex = 0;
    div.dataset.index = i;
    div.innerHTML = `
      <img src="${escapeHtml(it.artwork || 'placeholder.jpg')}" alt="${escapeHtml(it.title)}" />
      <div class="meta"><b>${escapeHtml(it.title)}</b><small>${escapeHtml(it.artist || '')} • ${it.source || ''}</small></div>
    `;
    div.addEventListener('click', ()=>{ selectTrack(i); suggestionsEl.style.display='none'; });
    div.addEventListener('keydown', (e)=>{ if(e.key==='Enter') { selectTrack(i); suggestionsEl.style.display='none'; } });
    suggestionsEl.appendChild(div);
  }
}

// Select and play a track from currentList
function selectTrack(index){
  if(!currentList || !currentList[index]) return;
  currentIndex = index;
  const track = currentList[index];
  trackTitle.textContent = track.title || 'Unknown title';
  trackArtist.textContent = track.artist || 'Unknown artist';
  artwork.src = track.artwork || 'placeholder.jpg';
  // try to use preview; if no preview, fallback to opening link in new tab
  if(track.preview){
    audio.src = track.preview;
    audio.play().then(()=>{
      isPlaying = true;
      updatePlayButton();
    }).catch(err=>{
      console.warn('Playback failed', err);
      isPlaying = false;
      updatePlayButton();
    });
  } else if(track.link){
    // no preview — open in new tab for user to play
    window.open(track.link, '_blank');
  } else {
    alert('No preview or playable link available for this track.');
  }
}

// Play/pause controls
playPauseBtn.addEventListener('click', ()=>{
  if(!audio.src) return;
  if(audio.paused){
    audio.play(); isPlaying = true;
  } else {
    audio.pause(); isPlaying = false;
  }
  updatePlayButton();
});

audio.addEventListener('play', ()=>{ isPlaying = true; updatePlayButton(); });
audio.addEventListener('pause', ()=>{ isPlaying = false; updatePlayButton(); });
audio.addEventListener('ended', ()=>{ isPlaying = false; updatePlayButton(); });

function updatePlayButton(){
  playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
}

// Prev / Next (simple)
document.getElementById('prevBtn').addEventListener('click', ()=>{
  if(currentList.length === 0) return;
  currentIndex = (currentIndex <= 0) ? currentList.length - 1 : currentIndex - 1;
  selectTrack(currentIndex);
});
document.getElementById('nextBtn').addEventListener('click', ()=>{
  if(currentList.length === 0) return;
  currentIndex = (currentIndex >= currentList.length - 1) ? 0 : currentIndex + 1;
  selectTrack(currentIndex);
});

// Escape HTML helper
function escapeHtml(s){ return String(s || '').replace(/[&<>"']/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }); }

// Initialize default tab
setActiveTab('both');

// Trigger search programmatically (used when switching tabs)
function triggerSearchNow(q){
  triggerSearch(q);
}

// Expose for console debugging
window._music = { triggerSearch: triggerSearchNow, fetchCombinedResults };

