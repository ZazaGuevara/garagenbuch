/* Garagenbuch – automatische Sicherung in Google Drive
   Ordner «Garagenbuch» im Google Drive des Inhabers:
     daten/garagenbuch-daten.json        aktueller Stand (gleiches Format wie die Komplett-Sicherung)
     daten/verlauf/garagenbuch-daten JJJJ-MM-TT.json   Stand am Ende jedes Tages
     belege/JJJJ/…                       jede Belegdatei
     rechnungen/JJJJ/…                   jede Rechnung / jeder KV als PDF
     abschluesse/JJJJ/Jahresabschluss JJJJ.pdf
   Mehrere Geräte (iPhone + Mac): vor dem Hochladen wird der Stand im Drive geholt und zusammengeführt –
   pro Eintrag gewinnt die neuere Änderung (siehe platform.applyRemote).
   Die App hat nur Zugriff auf Dateien, die sie selbst angelegt hat (Google-Berechtigung drive.file). */
(function(){
  const API="https://www.googleapis.com/drive/v3", UP="https://www.googleapis.com/upload/drive/v3", FOLDER="application/vnd.google-apps.folder";
  const ROOT="Garagenbuch";
  const D={state:"off",email:"",last:0,msg:""};
  window.driveState=D;
  const meta=platform.meta;
  let device=null, tok=null, timer=null, running=false, again=false, retryAt=0;
  const ok=new Set();                 // in dieser Sitzung geprüfte Ordner
  const day=()=>new Date().toISOString().slice(0,10);
  const qs=s=>String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  async function hash(s){ const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,24); }

  /* ---------- Verbinden ---------- */
  async function connect(){
    const a=new Uint8Array(16); crypto.getRandomValues(a);
    const pair=[...a].map(b=>b.toString(16).padStart(2,"0")).join("");
    await meta.set("drive:pair",{pair,t:Date.now()});
    location.href="/api/auth/start?pair="+pair;
  }
  let polling=false;
  async function pollClaim(){
    if(polling) return; polling=true;
    try{
      while(true){
        const p=await meta.get("drive:pair"); if(!p) break;
        if(Date.now()-p.t>15*60000){ await meta.del("drive:pair"); if(D.state==="connecting") D.state=device?"ok":"off"; break; }
        if(document.visibilityState==="visible"&&navigator.onLine){
          D.state="connecting"; ui();
          const r=await fetch("/api/auth/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pair:p.pair})}).catch(()=>null);
          if(r&&r.status===200){ const j=await r.json(); device=j.device; D.email=j.email||""; tok=null;
            await meta.set("drive:device",device); await meta.set("drive:email",D.email); await meta.del("drive:pair");
            D.state="ok"; ui(); window.toast?.("Mit Google Drive verbunden"); schedule(0); break; }
          if(r&&r.status!==202){ await meta.del("drive:pair"); D.state=device?"ok":"off"; D.msg=""; break; }
        }
        await new Promise(r=>setTimeout(r,2500));
      }
    } finally { polling=false; ui(); }
  }
  async function disconnect(){
    if(!confirm("Verbindung zu Google Drive trennen? Die Daten bleiben im Drive und auf diesem Gerät, es wird aber nicht mehr automatisch gesichert.")) return;
    if(device) await fetch("/api/auth/logout",{method:"POST",headers:{Authorization:"Bearer "+device}}).catch(()=>{});
    device=null; tok=null; await meta.del("drive:device"); D.state="off"; ui();
  }

  /* ---------- Zugang zu Google ---------- */
  async function token(){
    if(tok&&tok.exp>Date.now()+60000) return tok.token;
    const r=await fetch("/api/token",{headers:{Authorization:"Bearer "+device}});
    if(r.status===401) throw {code:"reconnect"};
    if(!r.ok) throw new Error("Server antwortet nicht ("+r.status+")");
    const j=await r.json(); tok={token:j.access_token,exp:j.expires_at}; if(j.email) D.email=j.email;
    return tok.token;
  }
  async function g(url,opt={},retry=true){
    const r=await fetch(url,{...opt,headers:{...(opt.headers||{}),Authorization:"Bearer "+await token()}});
    if(r.status===401&&retry){ tok=null; return g(url,opt,false); }
    if(!r.ok&&r.status!==404){ let m=""; try{ m=(await r.json()).error?.message||""; }catch(e){} throw new Error("Google Drive: "+(m||r.status)); }
    return r;
  }
  async function find(q,fields="id,name,modifiedTime"){
    const r=await g(API+"/files?"+new URLSearchParams({q:q+" and trashed=false",fields:`files(${fields})`,pageSize:"10",spaces:"drive"}));
    return (await r.json()).files?.[0]||null;
  }
  async function folder(path){
    const key="drive:f:"+path; let id=await meta.get(key);
    if(id&&!ok.has(path)){ const r=await g(API+"/files/"+id+"?fields=id,trashed"); const j=r.status===404?null:await r.json(); if(!j||j.trashed) id=null; else ok.add(path); }
    if(id) return id;
    const parts=path.split("/"), name=parts.pop(), parent=parts.length? await folder(parts.join("/")) : "root";
    const f=await find(`name='${qs(name)}' and mimeType='${FOLDER}' and '${parent}' in parents`);
    if(f) id=f.id;
    else { const r=await g(API+"/files?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:FOLDER,parents:[parent]})}); id=(await r.json()).id; }
    await meta.set(key,id); ok.add(path); return id;
  }
  /* Datei anlegen oder ersetzen. fileId = bekannte Datei, sonst Suche nach appProperties bzw. Name im Ordner */
  async function upload({name,parent,blob,fileId,props}){
    if(!fileId){
      const q=props? Object.entries(props).map(([k,v])=>`appProperties has { key='${k}' and value='${qs(v)}' }`).join(" and ") : `name='${qs(name)}' and '${parent}' in parents`;
      fileId=(await find(q))?.id;
    }
    const b="gb"+Math.random().toString(36).slice(2), type=blob.type||"application/octet-stream";
    const md=fileId? {name,...(props?{appProperties:props}:{})} : {name,parents:[parent],...(props?{appProperties:props}:{})};
    const body=new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(md)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`,blob,`\r\n--${b}--`]);
    const url=fileId? `${UP}/files/${fileId}?uploadType=multipart&fields=id,modifiedTime` : `${UP}/files?uploadType=multipart&fields=id,modifiedTime`;
    const r=await g(url,{method:fileId?"PATCH":"POST",headers:{"Content-Type":`multipart/related; boundary=${b}`},body});
    if(r.status===404) return upload({name,parent,blob,props});   // Datei wurde im Drive gelöscht → neu anlegen
    return r.json();
  }

  /* ---------- Sichern ---------- */
  function schedule(ms){
    if(!device||store.local) return;
    if(running){ again=true; return; }
    clearTimeout(timer); timer=setTimeout(sync,Math.max(ms,retryAt-Date.now(),0));
  }
  async function sync(){
    if(!device||running) return;
    if(!store.base){ schedule(1000); return; }
    if(!navigator.onLine){ D.state="offline"; ui(); return; }
    running=true; again=false; D.state="busy"; D.msg=""; ui();
    try{
      const data=await syncData();
      await syncBelege(data);
      await syncRechnungen(data);
      await syncAbschluss(data);
      D.last=Date.now(); await meta.set("drive:last",D.last); D.state="ok"; D.msg=""; retryAt=0;
    }catch(e){
      if(e?.code==="reconnect"){ D.state="reconnect"; D.msg=""; }
      else { D.state=navigator.onLine?"error":"offline"; D.msg=e?.message||String(e); retryAt=Date.now()+2*60000; setTimeout(()=>schedule(0),2*60000+500); }
      console.warn("Drive-Sicherung:",e);
    }finally{ running=false; ui(); if(again) schedule(3000); }
  }

  /* Daten: Stand im Drive holen und zusammenführen, dann (falls anders) hochladen */
  function toRemote(d){
    const base=store.base, docs={}, u=d.sync?.u||{};
    for(const [coll,key] of Object.entries(COLL)) for(const rec of (d[key]||[])){ if(!rec?.id) continue; const p=`${base}/store/${coll}/${rec.id}`; const {id,...data}=rec; docs[p]={data,u:u[p]||0}; }
    if(d.set&&Object.keys(d.set).length){ const p=base+"/settings"; docs[p]={data:d.set,u:u[p]||0}; }
    return [docs,d.sync?.tomb||{}];
  }
  function fromLocal(exp){
    const out={app:"Garagenbuch",version:1,datum:day(),set:{},entries:[],jobs:[],parts:[],cars:[],sync:{u:{},tomb:exp.tombs}};
    for(const d of exp.docs){
      const m=d.path.match(/\/store\/([^/]+)\/([^/]+)$/);
      if(m&&COLL[m[1]]) out[COLL[m[1]]].push({id:m[2],...d.data});
      else if(d.path===store.base+"/settings") out.set=d.data; else continue;
      out.sync.u[d.path]=d.updated;
    }
    return out;
  }
  async function syncData(){
    const dir=await folder(ROOT+"/daten");
    let id=await meta.get("drive:dataId"), info=null;
    if(id){ const r=await g(API+"/files/"+id+"?fields=id,modifiedTime,trashed"); info=r.status===404?null:await r.json(); if(!info||info.trashed){ id=null; info=null; } }
    if(!id){ info=await find(`name='garagenbuch-daten.json' and '${dir}' in parents`); id=info?.id||null; }
    if(id&&info.modifiedTime!==await meta.get("drive:dataMod")){
      D.msg="Stand im Drive wird abgeglichen …"; ui();
      const d=await (await g(API+"/files/"+id+"?alt=media")).json();
      if(d?.app==="Garagenbuch"){ const [docs,tombs]=toRemote(d); await platform.applyRemote(docs,tombs); }
    }
    const out=fromLocal(await platform.exportSync());
    const h=await hash(JSON.stringify({...out,datum:0}));
    if(!id||h!==await meta.get("drive:dataHash")){
      D.msg="Daten werden gesichert …"; ui();
      const blob=new Blob([JSON.stringify(out,null,1)],{type:"application/json"});
      const r=await upload({name:"garagenbuch-daten.json",parent:dir,blob,fileId:id});
      await meta.set("drive:dataId",r.id); await meta.set("drive:dataMod",r.modifiedTime); await meta.set("drive:dataHash",h);
      const vdir=await folder(ROOT+"/daten/verlauf"), v=await meta.get("drive:verlauf"), dd=day();
      const vr=await upload({name:`garagenbuch-daten ${dd}.json`,parent:vdir,blob,fileId:v?.day===dd?v.id:null});
      await meta.set("drive:verlauf",{day:dd,id:vr.id});
    }
    return out;
  }

  /* Belege: jede Datei einmal hochladen; fehlt eine Datei auf diesem Gerät (anderes Gerät hat sie erfasst) → aus Drive holen */
  async function syncBelege(data){
    const up=await meta.get("drive:belege")||{}, miss=await meta.get("drive:missing")||{};
    const L=data.entries.filter(e=>e.belegAsset&&!up[e.belegAsset]&&!(miss[e.belegAsset]>Date.now()-3600000));
    for(const [i,e] of L.entries()){
      D.msg=`Belege ${i+1} von ${L.length} …`; ui();
      const blob=await platform.getBlob(e.belegAsset);
      if(blob){
        const ext=blob.type.includes("pdf")?"pdf":blob.type.includes("png")?"png":"jpg";
        const parent=await folder(`${ROOT}/belege/${(e.datum||"").slice(0,4)||"ohne Datum"}`);
        const r=await upload({name:belegPfad(e).split("/").pop()+"."+ext,parent,blob,props:{asset:e.belegAsset}});
        up[e.belegAsset]=r.id;
      } else {
        const f=await find(`appProperties has { key='asset' and value='${qs(e.belegAsset)}' }`,"id,mimeType");
        if(f){ const b=await (await g(API+"/files/"+f.id+"?alt=media")).blob(); await platform.putBlobWithId(e.belegAsset,b); up[e.belegAsset]=f.id; delete miss[e.belegAsset]; }
        else miss[e.belegAsset]=Date.now();
      }
      if(i%5===4) await meta.set("drive:belege",up);
    }
    await meta.set("drive:belege",up); await meta.set("drive:missing",miss);
  }

  /* Rechnungen & KV als PDF – neu hochladen, wenn sich die Rechnung (oder Firmen-/Bankdaten) geändert hat */
  async function syncRechnungen(data){
    if(!window.jspdf||!window.qrcode||!data.jobs.length) return;
    const done=await meta.get("drive:re")||{}, s=data.set||{};
    const firm=JSON.stringify([s.firma,s.strasse,s.ort,s.tel,s.mail,s.iban,s.kontoName,s.kontoStrasse,s.kontoOrt,s.mwstnr,(s.logo||"").length,s.zahlfrist]);
    let n=0;
    for(const j of data.jobs){
      const h=await hash(firm+JSON.stringify(j)); if(done[j.id]?.h===h) continue;
      D.msg=`Rechnungen als PDF … (${++n})`; ui();
      const blob=buildPdf(j).output("blob");
      const parent=await folder(`${ROOT}/rechnungen/${(j.datum||"").slice(0,4)||"ohne Datum"}`);
      const name=`${j.nr||j.id} ${String(j.kunde||"").replace(/[^\wäöüÄÖÜ .-]/g,"").slice(0,30)}`.trim()+".pdf";
      const r=await upload({name,parent,blob,fileId:done[j.id]?.id,props:{job:j.id}});
      done[j.id]={id:r.id,h}; if(n%5===0) await meta.set("drive:re",done);
    }
    await meta.set("drive:re",done);
  }

  /* Jahresabschluss pro Jahr: einmal täglich auffrischen */
  async function syncAbschluss(data){
    if(!window.jspdf||await meta.get("drive:absDay")===day()) return;
    const years=[...new Set(data.entries.map(e=>(e.datum||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))];
    const ids=await meta.get("drive:abs")||{}, keep=S.year;
    try{
      for(const y of years){
        D.msg=`Jahresabschluss ${y} …`; ui();
        S.year=+y; const blob=buildAbschluss().output("blob"); S.year=keep;
        const r=await upload({name:`Jahresabschluss ${y}.pdf`,parent:await folder(`${ROOT}/abschluesse/${y}`),blob,fileId:ids[y]});
        ids[y]=r.id;
      }
    } finally { S.year=keep; }
    await meta.set("drive:abs",ids); await meta.set("drive:absDay",day());
  }

  /* ---------- Anzeige ---------- */
  const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const zeit=t=>{ if(!t) return ""; const d=new Date(t), h=d.toTimeString().slice(0,5); return d.toDateString()===new Date().toDateString()? `heute ${h}` : `${d.toLocaleDateString("de-CH")} ${h}`; };
  const btn=(act,label,cls="")=>`<button class="btn sm ${cls}" type="button" data-drive="${act}">${label}</button>`;
  function line(){
    switch(D.state){
      case "off": return {cls:"warn",html:`<b>Google-Drive-Sicherung ist noch nicht eingerichtet.</b> Ihre Daten liegen nur auf diesem Gerät.`,act:btn("connect","Mit Google verbinden")};
      case "connecting": return {cls:"",html:`<span class="spinner"></span> Warte auf die Anmeldung bei Google … Nach der Anmeldung zur App zurückkehren.`,act:btn("cancel","Abbrechen","ghost")};
      case "reconnect": return {cls:"warn",html:`<b>Google-Verbindung abgelaufen.</b> Bitte neu verbinden – bis dahin wird nicht gesichert.`,act:btn("connect","Neu verbinden")};
      case "busy": return {cls:"",html:`<span class="spinner"></span> Sichere in Google Drive … ${esc(D.msg)}`,act:""};
      case "offline": return {cls:"",html:`Kein Internet – wird automatisch gesichert, sobald wieder Verbindung besteht.`,act:""};
      case "error": return {cls:"warn",html:`<b>Sicherung hat nicht geklappt</b> (${esc(D.msg)}). Wird in 2 Minuten wiederholt.`,act:btn("sync","Jetzt nochmals","ghost")};
      default: return {cls:"ok",html:`✓ In Google Drive gesichert${D.last?" · "+zeit(D.last):""}`,act:""};
    }
  }
  function boxHtml(){
    const l=line();
    if(l.cls==="ok") return `<div class="small muted" style="margin-top:-8px">${l.html}</div>`;
    return `<div class="banner" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between${l.cls==="warn"?"":";border-left-color:var(--line)"}"><span>${l.html}</span>${l.act}</div>`;
  }
  function panelHtml(){
    const l=line(), on=!!device&&D.state!=="off";
    return `<h3>Google-Drive-Sicherung</h3>
      <p class="small muted">Alle Buchungen, Belege, Rechnungen (PDF) und Jahresabschlüsse werden automatisch in Ihrem Google Drive im Ordner «Garagenbuch» abgelegt. Die App sieht nur diesen Ordner, nicht Ihre anderen Dateien. Auf einem zweiten Gerät (z.B. Mac) einfach ebenfalls verbinden – die Daten werden zusammengeführt.</p>
      <div>${l.html}</div>
      ${on&&D.email?`<div class="small muted">Verbunden mit ${esc(D.email)}</div>`:""}
      <div class="actions">${on? btn("sync","Jetzt sichern")+(D.state==="reconnect"?btn("connect","Neu verbinden"):"")+btn("disconnect","Verbindung trennen","ghost") : (D.state==="connecting"?btn("cancel","Abbrechen","ghost"):btn("connect","Mit Google verbinden"))}</div>`;
  }
  function ui(){
    const b=document.getElementById("driveBox"); if(b) b.innerHTML=boxHtml();
    const p=document.getElementById("drivePanel"); if(p) p.innerHTML=panelHtml();
  }
  /* Einbau in die App (wird von render() aufgerufen) */
  window.driveBox=()=>store.local? "" : `<div id="driveBox">${boxHtml()}</div>`;
  window.drivePanel=()=>store.local? "" : `<div class="panel" style="max-width:680px" id="drivePanel">${panelHtml()}</div>`;
  window.driveFresh=()=>!!device&&D.last>Date.now()-3*864e5;

  document.addEventListener("click",async e=>{
    const b=e.target.closest?.("[data-drive]"); if(!b) return;
    const a=b.dataset.drive;
    if(a==="connect") connect();
    else if(a==="cancel"){ await meta.del("drive:pair"); D.state=device?"ok":"off"; ui(); }
    else if(a==="sync"){ retryAt=0; schedule(0); }
    else if(a==="disconnect") disconnect();
  });

  async function init(){
    device=await meta.get("drive:device")||null;
    D.email=await meta.get("drive:email")||""; D.last=await meta.get("drive:last")||0;
    D.state=device?"ok":"off";
    if(await meta.get("drive:pair")) pollClaim();
    platform.onChange(()=>schedule(4000));
    addEventListener("online",()=>schedule(500));
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"){ schedule(1500); meta.get("drive:pair").then(p=>p&&pollClaim()); } });
    setInterval(()=>schedule(0),5*60000);
    ui(); if(typeof render==="function") render();
    schedule(1500);
  }
  init().catch(e=>console.warn("Drive-Sicherung:",e));
})();
