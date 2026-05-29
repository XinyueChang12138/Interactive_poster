const levels = [
  { key: "subgroup", title: "Disaster Subgroups", text: "First level: broad hazard groups in the dataset." },
  { key: "type", title: "Disaster Types", text: "Second level: disaster types inside the selected subgroup." },
  { key: "subtype", title: "Disaster Subtypes", text: "Third level: more specific disaster subtypes." },
  { key: "country", title: "Places Where Events Happened", text: "Location level: countries or territories where the selected disaster records happened." },
  { key: "event", title: "Recorded Events and Time", text: "Final level: event records with country, region, and start date." }
];

let state = { depth: 0, filters: [] };
let zoom = 0.72;
const colors = ["#68d9c8", "#f5a0c8", "#afeff1", "#ffd9af", "#fff0a8", "#ddc8ff", "#d2f4cb", "#fadbe6", "#dbe0ff", "#f7f1b8", "#b8efe6", "#e6b5d8"];
const $ = id => document.getElementById(id);

function getDate(row){
  const y = row.year || "Unknown year";
  const m = row.month ? String(row.month).padStart(2,"0") : "";
  const d = row.day ? String(row.day).padStart(2,"0") : "";
  return [y,m,d].filter(Boolean).join("-");
}

function filteredRows(){
  return RAW_EVENTS.filter(row => state.filters.every(f => row[f.key] === f.value));
}

function groupBy(rows, key){
  const map = new Map();
  rows.forEach(row => {
    const value = (row[key] && row[key].trim()) ? row[key] : "Unknown";
    if(!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  });
  return [...map.entries()].map(([name, items]) => ({ name, value: items.length, rows: items }))
    .sort((a,b) => b.value - a.value || a.name.localeCompare(b.name));
}

function normalizeItems(items){
  // Keep much more of the hierarchy visible. Only extremely long lists are grouped.
  // The treemap panel is now vertically scrollable, so labels do not need to be squeezed into one fixed screen.
  if(items.length <= 60) return items;
  const visible = items.slice(0, 59);
  const otherRows = items.slice(59).flatMap(d => d.rows);
  visible.push({ name: "Other smaller categories", value: otherRows.length, rows: otherRows, isOther: true });
  return visible;
}

function getReadableCanvasHeight(items){
  const count = items.length;
  const longest = Math.max(...items.map(d => d.name.length), 10);
  const countBoost = count * 78;
  const labelBoost = Math.min(760, longest * 10);
  const base = Math.max(900, Math.min(5600, 760 + countBoost + labelBoost));
  return Math.round(base * zoom);
}

function getReadableCanvasWidth(items){
  const count = items.length;
  const longest = Math.max(...items.map(d => d.name.length), 10);
  const countBoost = count * 14;
  const labelBoost = Math.min(740, longest * 12);
  const base = Math.max(1100, Math.min(2300, 980 + countBoost + labelBoost));
  return Math.round(base * zoom);
}

// Squarified treemap. Gives more poster-like blocks than long thin strips.
function squarify(items, x, y, w, h){
  const total = items.reduce((s,d)=>s+d.value,0) || 1;
  const scaled = items.map(d => ({...d, area: d.value / total * w * h}));
  const rects = [];
  let row = [], rest = scaled.slice();
  let rx=x, ry=y, rw=w, rh=h;

  const worst = (row, side) => {
    if(!row.length) return Infinity;
    const areas = row.map(d=>d.area), sum = areas.reduce((a,b)=>a+b,0);
    const max = Math.max(...areas), min = Math.min(...areas);
    return Math.max((side*side*max)/(sum*sum), (sum*sum)/(side*side*min));
  };

  const layoutRow = (row) => {
    const sum = row.reduce((s,d)=>s+d.area,0);
    if(rw >= rh){
      const rowH = sum / rw;
      let cx = rx;
      row.forEach(d => {
        const rectW = d.area / rowH;
        rects.push({...d, x:cx, y:ry, w:rectW, h:rowH});
        cx += rectW;
      });
      ry += rowH; rh -= rowH;
    }else{
      const rowW = sum / rh;
      let cy = ry;
      row.forEach(d => {
        const rectH = d.area / rowW;
        rects.push({...d, x:rx, y:cy, w:rowW, h:rectH});
        cy += rectH;
      });
      rx += rowW; rw -= rowW;
    }
  };

  while(rest.length){
    const item = rest[0];
    const side = Math.min(rw, rh);
    if(!row.length || worst([...row, item], side) <= worst(row, side)){
      row.push(item); rest.shift();
    }else{
      layoutRow(row); row = [];
    }
  }
  if(row.length) layoutRow(row);
  return rects;
}

function render(){
  const rows = filteredRows();
  const level = levels[state.depth];
  const tree = $("treemap");
  tree.innerHTML = "";

  $("viewTitle").textContent = level.title;
  $("viewText").textContent = level.text;
  $("totalEvents").textContent = rows.length.toLocaleString();
  $("totalCountries").textContent = new Set(rows.map(r => r.country).filter(Boolean)).size;
  const years = rows.map(r => Number(r.year)).filter(Boolean);
  $("yearRange").textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "—";
  $("backBtn").disabled = state.depth === 0;
  renderBreadcrumbs();

  if(state.depth === 4){ renderFinalEvents(rows); return; }

  const rawItems = groupBy(rows, level.key);
  const items = normalizeItems(rawItems);
  if(!items.length){ tree.innerHTML = `<div class="empty">No records found.</div>`; return; }

  // Make the treemap taller when there are many labels.
  // This avoids the previous issue where country names or long subtype names were crushed into tiny strips.
  const canvasHeight = getReadableCanvasHeight(items);
  const canvasWidth = getReadableCanvasWidth(items);
  tree.innerHTML = `<div id="treeCanvas" class="tree-canvas" style="width:${canvasWidth}px;height:${canvasHeight}px"></div>`;
  const canvas = document.getElementById("treeCanvas");
  tree.scrollTop = 0;
  tree.scrollLeft = 0;

  const rects = squarify(items, 0, 0, 100, 100);

  rects.forEach((d, i) => {
    const el = document.createElement("div");
    const pixelArea = (d.w / 100) * (d.h / 100) * 1000 * canvasHeight;
    el.className = "node" + (pixelArea < 52000 ? " small" : "") + (pixelArea < 26000 ? " tiny" : "") + (pixelArea < 12000 ? " micro" : "");
    el.style.left = d.x + "%";
    el.style.top = d.y + "%";
    el.style.width = d.w + "%";
    el.style.height = d.h + "%";
    el.style.minHeight = "54px";
    el.style.background = colors[i % colors.length];
    el.title = `${d.name}: ${d.value} records`;
    el.innerHTML = `<div class="node-content"><div class="node-title">${escapeHtml(d.name)}</div><div class="node-meta">${d.value.toLocaleString()} records</div></div>`;
    el.addEventListener("click", () => drill(d.name, d));
    el.addEventListener("mouseenter", () => showSummary(d));
    canvas.appendChild(el);
  });


  showIntro(rows, rawItems);
}

function drill(value, item){
  const key = levels[state.depth].key;
  // Other is still interactive: it filters to the exact rows inside Other by storing a custom row set.
  if(item?.isOther){
    state.filters.push({ key: "__customRows", value, rows: item.rows });
  }else{
    state.filters.push({ key, value });
  }
  state.depth = Math.min(state.depth + 1, levels.length - 1);
  render();
}

function filteredRows(){
  let rows = RAW_EVENTS;
  state.filters.forEach(f => {
    if(f.key === "__customRows") rows = f.rows;
    else rows = rows.filter(row => row[f.key] === f.value);
  });
  return rows;
}

function back(){
  if(state.depth === 0) return;
  state.filters.pop();
  state.depth -= 1;
  render();
}
function reset(){ state = { depth: 0, filters: [] }; render(); }

function renderBreadcrumbs(){
  const bc = $("breadcrumbs");
  bc.innerHTML = "";
  const home = document.createElement("span");
  home.className = "crumb";
  home.textContent = "All data";
  bc.appendChild(home);
  state.filters.forEach(f => {
    const c = document.createElement("span");
    c.className = "crumb";
    c.textContent = f.value;
    bc.appendChild(c);
  });
}

function showSummary(d){
  const countries = [...new Set(d.rows.map(r => r.country).filter(Boolean))].slice(0,10);
  const sample = [...d.rows].sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)).slice(0,5);
  $("detailTitle").textContent = d.name;
  $("detailContent").innerHTML = `
    <p><strong>${d.value.toLocaleString()}</strong> recorded events in this category.</p>
    <div class="label" style="margin-top:22px;">Top places</div>
    <div class="pill-row">${countries.map(c => `<span class="pill">${escapeHtml(c)}</span>`).join("")}</div>
    <div class="label" style="margin-top:28px;">Example events</div>
    <div class="event-list">${sample.map(eventCard).join("")}</div>
  `;
}

function showIntro(rows, items){
  const top = items.slice(0,6).map(d => `<span class="pill">${escapeHtml(d.name)}: ${d.value.toLocaleString()}</span>`).join("");
  $("detailTitle").textContent = "How to read this view";
  $("detailContent").innerHTML = `
    <p>The larger the rectangle, the more records it contains. Click a block to enter the next hierarchy level.</p>
    <div class="label" style="margin-top:22px;">Largest groups in this view</div>
    <div class="pill-row">${top}</div>
  `;
}

function renderFinalEvents(rows){
  const tree = $("treemap");
  const sorted = [...rows].sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0));
  tree.innerHTML = `<div class="final-list">${sorted.slice(0,80).map(finalCard).join("")}</div>`;
  $("detailTitle").textContent = "Where and when";
  $("detailContent").innerHTML = `
    <p><strong>${rows.length.toLocaleString()}</strong> records match this path. The centre panel now lists specific records with country, region and start date.</p>
    <div class="event-list">${sorted.slice(0,8).map(eventCard).join("")}</div>
  `;
}

function eventCard(r){
  const eventName = r.event ? r.event : `${r.type} — ${r.subtype}`;
  return `<div class="event-card">
    <div></div><div>
      <strong>${escapeHtml(eventName)}</strong>
      <span>${escapeHtml(r.country)} · ${escapeHtml(r.subregion)} · ${escapeHtml(r.region)}</span>
      <span>${escapeHtml(r.subgroup)} → ${escapeHtml(r.type)} → ${escapeHtml(r.subtype)}</span>
      <span class="date">Start date: ${escapeHtml(getDate(r))}</span>
    </div>
  </div>`;
}
function finalCard(r){
  const eventName = r.event ? r.event : `${r.type} — ${r.subtype}`;
  return `<div class="final-card">
    <strong>${escapeHtml(eventName)}</strong>
    <span>${escapeHtml(r.country)} · ${escapeHtml(r.subregion)} · ${escapeHtml(r.region)}</span>
    <span>${escapeHtml(r.subgroup)} → ${escapeHtml(r.type)} → ${escapeHtml(r.subtype)}</span>
    <span class="date">Start date: ${escapeHtml(getDate(r))}</span>
  </div>`;
}

function escapeHtml(str){
  return String(str ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

$("backBtn").addEventListener("click", back);
$("resetBtn").addEventListener("click", reset);
$("startBtn").addEventListener("click", () => $("explorer").scrollIntoView({behavior:"smooth"}));
$("zoomOutBtn").addEventListener("click", () => { zoom = Math.max(0.48, +(zoom - 0.12).toFixed(2)); render(); });
$("zoomFitBtn").addEventListener("click", () => { zoom = 0.72; render(); });
$("zoomInBtn").addEventListener("click", () => { zoom = Math.min(1.25, +(zoom + 0.12).toFixed(2)); render(); });
render();
