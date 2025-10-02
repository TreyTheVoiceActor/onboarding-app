const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;   // vigtigt i Codespaces
const HOST = '0.0.0.0';
const ACCESS_KEY = '123';

// --- simple CORS ---
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '1mb' }));

// --- log alle requests ---
app.use((req,_res,next)=>{ console.log(new Date().toISOString(), req.method, req.url); next(); });

// --- servér index.html fra root ---
app.get('/', (_req,res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- database i fil ----------
const DATA_FILE = path.join(__dirname, 'data.json');
function ensureDataFile(){ if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8'); }
function readDb(){ try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')||'[]'); } catch { return []; } }
function saveDb(db){ fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2),'utf8'); }
function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function ts(){ const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function newId(){ return `OB-${ymd(new Date())}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

// ---------- API ----------
app.get('/api/ping', (_req,res)=>res.json({ ok:true }));

app.post('/api/create', (req,res)=>{
  const { key, firstName, lastName, initials, startDate, department, title, manager, phone, softwareSelect, softwareExtra } = req.body||{};
  if (key!==ACCESS_KEY) return res.status(403).json({ ok:false, error:'Forkert adgangsnøgle.' });
  const required = { firstName,lastName,initials,startDate,department,title,manager,phone };
  for (const [k,v] of Object.entries(required)) if(!v) return res.status(400).json({ ok:false,error:`Felt mangler: ${k}` });

  ensureDataFile();
  const db=readDb();
  const id=newId();
  db.push({
    id, tsCreated:ts(),
    firstName,lastName,initials,startDate,department,title,manager,phone,
    rightsFiles:'',rightsFilesSame:'',
    rightsAX:'',rightsAXSame:'',
    rightsD4:'',rightsD4Same:'',
    pcType:'',docking:'',screens:'',
    softwareSelect:softwareSelect||'Som standard',
    softwareExtra:softwareExtra||'',
    tsUpdated:''
  });
  saveDb(db);
  res.json({ok:true,id});
});

app.get('/api/get/:id',(req,res)=>{
  if(req.query.key!==ACCESS_KEY) return res.status(403).json({ok:false,error:'Forkert adgangsnøgle.'});
  ensureDataFile();
  const db=readDb();
  const item=db.find(x=>x.id===req.params.id);
  if(!item) return res.status(404).json({ok:false,error:'ID ikke fundet.'});
  res.json({ok:true,entry:item});
});

app.post('/api/update/:id',(req,res)=>{
  const { key, rightsFiles, rightsFilesSame, rightsAX, rightsAXSame, rightsD4, rightsD4Same, pcType, docking, screens, softwareSelect, softwareExtra }=req.body||{};
  if(key!==ACCESS_KEY) return res.status(403).json({ok:false,error:'Forkert adgangsnøgle.'});
  if(rightsFiles==='same'&&!rightsFilesSame) return res.status(400).json({ok:false,error:'Angiv initialer for Fil rettigheder (Det samme som).'});
  if(rightsAX==='same'&&!rightsAXSame) return res.status(400).json({ok:false,error:'Angiv initialer for AX rettigheder (Det samme som).'});
  if(rightsD4==='same'&&!rightsD4Same) return res.status(400).json({ok:false,error:'Angiv initialer for D4 Infonet (Det samme som).'});

  ensureDataFile();
  const db=readDb();
  const i=db.findIndex(x=>x.id===req.params.id);
  if(i===-1) return res.status(404).json({ok:false,error:'ID ikke fundet.'});
  const cur=db[i];
  db[i]={...cur,
    rightsFiles:rightsFiles??cur.rightsFiles,
    rightsFilesSame:rightsFilesSame??cur.rightsFilesSame,
    rightsAX:rightsAX??cur.rightsAX,
    rightsAXSame:rightsAXSame??cur.rightsAXSame,
    rightsD4:rightsD4??cur.rightsD4,
    rightsD4Same:rightsD4Same??cur.rightsD4Same,
    pcType:pcType??cur.pcType,
    docking:docking??cur.docking,
    screens:screens??cur.screens,
    softwareSelect:softwareSelect??cur.softwareSelect,
    softwareExtra:softwareExtra??cur.softwareExtra,
    tsUpdated:ts()
  };
  saveDb(db);
  res.json({ok:true});
});

// fallback til index.html
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.listen(PORT,HOST,()=>{
  ensureDataFile();
  console.log(`Onboarding kører på http://localhost:${PORT}`);
});
