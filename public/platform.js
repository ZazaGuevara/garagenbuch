/* Garagenbuch – Plattform-Schicht
   Ersetzt die Claude.ai-Laufzeit (window.claude.use) durch eigene Bausteine:
   - db:        Speicher im Gerät (IndexedDB), gleiche Schnittstelle wie vorher (collection/doc, onSnapshot, set, delete)
   - user:      fester lokaler Benutzer
   - assets:    Belegfotos/PDFs im Gerät ablegen (upload → id)
   - downloads: Dateien sichern – am iPhone über «Teilen» (In Dateien sichern, Mail …), am Mac als Download
   - sample:    Beleglesen mit Claude – folgt in Schritt 5 (bis dann: nicht verfügbar)
   Die Geschäftslogik in index.html bleibt unverändert. */
(function(){
  const DB_NAME="garagenbuch", DB_VER=1;
  let dbp=null;
  function openDb(){
    if(dbp) return dbp;
    dbp=new Promise((res,rej)=>{
      const r=indexedDB.open(DB_NAME,DB_VER);
      r.onupgradeneeded=()=>{ const d=r.result;
        if(!d.objectStoreNames.contains("docs")){ const s=d.createObjectStore("docs",{keyPath:"path"}); s.createIndex("coll","coll"); }
        if(!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs",{keyPath:"id"});
        if(!d.objectStoreNames.contains("meta")) d.createObjectStore("meta",{keyPath:"key"}); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
    return dbp;
  }
  async function tx(store,mode,fn){
    const d=await openDb();
    return new Promise((res,rej)=>{ const t=d.transaction(store,mode); const s=t.objectStore(store); let out; const r=fn(s);
      if(r) r.onsuccess=()=>{ out=r.result; };
      t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); });
  }
  const split=p=>{ const i=p.lastIndexOf("/"); return [p.slice(0,i),p.slice(i+1)]; };
  const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);

  /* ---------- Änderungs-Meldungen (für Bildschirm und später Google-Drive-Sicherung) ---------- */
  const collSubs=new Map(), docSubs=new Map(), changeSubs=new Set();
  /* Viele Änderungen kurz hintereinander (z.B. Sicherung einspielen) nur einmal melden */
  const pendingColl=new Set(); let pendTimer=null;
  function emitColl(coll){ pendingColl.add(coll); if(pendTimer) return; pendTimer=setTimeout(()=>{ pendTimer=null; const L=[...pendingColl]; pendingColl.clear(); L.forEach(emitCollNow); },30); }
  async function emitCollNow(coll){
    const subs=collSubs.get(coll); if(!subs||!subs.size) return;
    const rows=await tx("docs","readonly",s=>s.index("coll").getAll(coll));
    const snap={docs:(rows||[]).map(r=>({id:split(r.path)[1],data:()=>r.data}))};
    for(const [cb] of subs) try{ cb(snap); }catch(e){ console.error(e); }
  }
  async function emitDoc(path){
    const subs=docSubs.get(path); if(!subs||!subs.size) return;
    const r=await tx("docs","readonly",s=>s.get(path));
    const snap={exists:!!r,data:()=>r?.data};
    for(const [cb] of subs) try{ cb(snap); }catch(e){ console.error(e); }
  }
  function changed(path,kind){
    const [coll]=split(path); emitColl(coll); emitDoc(path);
    for(const fn of changeSubs) try{ fn({path,kind}); }catch(e){ console.error(e); }
  }
  function sub(map,key,cb,errCb,first){
    if(!map.has(key)) map.set(key,new Map()); map.get(key).set(cb,errCb);
    first().catch(e=>errCb&&errCb(e));
    return ()=>map.get(key)?.delete(cb);
  }

  const db={
    collection(coll){ return {
      onSnapshot(cb,errCb){ return sub(collSubs,coll,cb,errCb,async()=>{ const rows=await tx("docs","readonly",s=>s.index("coll").getAll(coll)); cb({docs:(rows||[]).map(r=>({id:split(r.path)[1],data:()=>r.data}))}); }); },
      async get(){ const rows=await tx("docs","readonly",s=>s.index("coll").getAll(coll)); return {docs:(rows||[]).map(r=>({id:split(r.path)[1],data:()=>r.data}))}; }
    }; },
    doc(path){ return {
      async set(data){ await tx("docs","readwrite",s=>s.put({path,coll:split(path)[0],data:structuredClone(data),updated:Date.now()})); changed(path,"set"); },
      async delete(){ await tx("docs","readwrite",s=>s.delete(path)); changed(path,"delete"); },
      async get(){ const r=await tx("docs","readonly",s=>s.get(path)); return {exists:!!r,data:()=>r?.data}; },
      onSnapshot(cb,errCb){ return sub(docSubs,path,cb,errCb,async()=>{ const r=await tx("docs","readonly",s=>s.get(path)); cb({exists:!!r,data:()=>r?.data}); }); }
    }; }
  };

  /* ---------- Belegdateien ---------- */
  const assets={
    async upload(blob,meta){ const id=newId(); await tx("blobs","readwrite",s=>s.put({id,blob,type:blob.type||"",name:meta?.name||"",created:Date.now()})); changed("blobs/"+id,"blob"); return {id}; }
  };
  async function getBlob(id){ const r=await tx("blobs","readonly",s=>s.get(id)); return r? r.blob : null; }
  async function putBlobWithId(id,blob){ await tx("blobs","readwrite",s=>s.put({id,blob,type:blob.type||"",created:Date.now()})); }
  async function fetchBlob(id){ const b=await getBlob(id); return b? new Response(b,{headers:{"Content-Type":b.type||"application/octet-stream"}}) : new Response(null,{status:404}); }

  /* ---------- Dateien sichern ---------- */
  const MIME={pdf:"application/pdf",zip:"application/zip",csv:"text/csv",json:"application/json",png:"image/png",jpg:"image/jpeg",txt:"text/plain"};
  const isTouch=()=>/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Mac/.test(navigator.platform||""));
  function toFile(filename,data){
    const ext=(filename.split(".").pop()||"").toLowerCase(), type=(data instanceof Blob&&data.type)||MIME[ext]||"application/octet-stream";
    const blob=data instanceof Blob? data : new Blob([data],{type:type+(type.startsWith("text/")?";charset=utf-8":"")});
    return new File([blob],filename,{type});
  }
  function downloadLink(file){
    const url=URL.createObjectURL(file); const a=document.createElement("a"); a.href=url; a.download=file.name; a.rel="noopener";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  /* Kleines Fenster mit Knopf: nötig, wenn das iPhone «Teilen» nur direkt nach einem Tippen erlaubt */
  function sheet(title,html,buttons){
    return new Promise(res=>{
      const o=document.createElement("div"); o.className="pf-sheet"; o.setAttribute("role","dialog"); o.setAttribute("aria-modal","true");
      o.innerHTML=`<div class="pf-box"><b>${title}</b>${html||""}<div class="pf-btns"></div></div>`;
      const bx=o.querySelector(".pf-btns");
      for(const [label,cls,fn] of buttons){ const b=document.createElement("button"); b.className="btn"+(cls?" "+cls:""); b.textContent=label;
        b.onclick=async()=>{ const keep=await fn(); if(!keep){ o.remove(); res(label); } }; bx.appendChild(b); }
      o.addEventListener("click",e=>{ if(e.target===o){ o.remove(); res(null); } });
      document.body.appendChild(o); bx.querySelector("button")?.focus();
    });
  }
  async function shareFile(file){
    try{ await navigator.share({files:[file]}); return "ok"; }
    catch(e){ if(e?.name==="AbortError") return "abort"; if(e?.name==="NotAllowedError") return "needtap"; throw e; }
  }
  const downloads={
    async save({filename,data}){
      const file=toFile(filename,data);
      if(isTouch()&&navigator.canShare?.({files:[file]})){
        let r=await shareFile(file);
        if(r==="needtap"){ let out="abort";
          await sheet("Datei ist bereit",`<span class="pf-name">${esc(filename)}</span>`,[["Sichern / Teilen","",async()=>{ out=await shareFile(file); return false; }],["Abbrechen","ghost",()=>false]]);
          r=out; }
        if(r==="abort") throw {code:"declined"};
        return;
      }
      downloadLink(file);
    }
  };
  const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  /* ---------- Beleg anzeigen ---------- */
  async function openBlob(id){
    const b=await getBlob(id); if(!b){ alert("Beleg nicht gefunden."); return; }
    const url=URL.createObjectURL(b), isImg=(b.type||"").startsWith("image/");
    const ext=b.type.includes("pdf")?"pdf":b.type.includes("png")?"png":"jpg";
    await sheet("Beleg", isImg?`<img class="pf-img" src="${url}" alt="Beleg">`:`<iframe class="pf-pdf" src="${url}" title="Beleg"></iframe>`,
      [["Sichern / Teilen","",async()=>{ try{ await downloads.save({filename:`Beleg.${ext}`,data:b}); }catch(e){} return true; }],["Schliessen","ghost",()=>false]]);
    URL.revokeObjectURL(url);
  }
  document.addEventListener("click",e=>{ const a=e.target.closest?.("a[data-blob]"); if(!a) return; e.preventDefault(); openBlob(a.dataset.blob); });

  const st=document.createElement("style");
  st.textContent=`.pf-sheet{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.pf-box{background:var(--surface,#fff);color:var(--ink,#111);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px;width:min(720px,100%);max-height:90vh;overflow:auto}
.pf-btns{display:flex;gap:10px;flex-wrap:wrap}.pf-name{font-size:.85rem;color:var(--muted,#666);overflow-wrap:anywhere}
.pf-img{max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px}.pf-pdf{width:100%;height:70vh;border:1px solid var(--line,#ddd);border-radius:8px}`;
  document.head.appendChild(st);

  /* Daten dauerhaft speichern lassen (Browser darf sie dann nicht von sich aus aufräumen) */
  try{ navigator.storage?.persist?.(); }catch(e){}

  const user={ async id(){ return "lokal"; } };
  const caps={db,user,assets,downloads,sample:null};

  window.platform={
    async use(name){ if(name==="db"){ try{ await openDb(); }catch(e){ return null; } } return caps[name]||null; },
    fetchBlob, getBlob, putBlobWithId, newId,
    onChange(fn){ changeSubs.add(fn); return ()=>changeSubs.delete(fn); }
  };
})();
