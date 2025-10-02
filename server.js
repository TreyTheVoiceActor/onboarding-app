const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// === Koder (alle = 123 som default) ===
const ACCESS_KEY = process.env.ACCESS_KEY || '123'; // HR/Afd. leder
const VIEW_KEY   = process.env.VIEW_KEY   || '123'; // Brugere
const ADMIN_KEY  = process.env.ADMIN_KEY  || '123'; // Admin

app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((req,_res,next)=>{ console.log(new Date().toISOString(), req.method, req.url); next(); });

// Forside
app.get('/', (_req,res) => res.sendFile(path.join(__dirname, 'index.html')));

// === DB & Config ===
const DATA_FILE   = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function ensureFile(fp, fallback){
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(fallback, null, 2), 'utf8');
}
function readJson(fp, fallback){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); } catch{ return fallback; } }
function writeJson(fp, obj){ fs.writeFileSync(fp, JSON.stringify(obj,null,2), 'utf8'); }

ensureFile(DATA_FILE, []);
ensureFile(CONFIG_FILE, { leaderEmails: {}, notify: { hr: "", it: "" } });

function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,''); }
function ts(){ const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function newId(){ return `OB-${ymd(new Date())}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

// === Email via env SMTP ===
function getTransportOrNull(){
  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE||'false') === 'true';
  if (!host || !user || !pass || !from) return null;
  const transporter = nodemailer.createTransport({ host, port, secure, auth:{ user, pass } });
  return { transporter, from };
}
function shortRights(mode, same){
  if (mode==='none') return 'Ingen';
  if (mode==='after') return 'Efter jobstart';
  if (mode==='same') return `Som ${same||'??'}`;
  return '';
}

// Mail ved oprettelse → leder (via initialer)
async function sendLeaderMail(entry){
  const cfg = readJson(CONFIG_FILE, { leaderEmails: {} });
  const to = cfg.leaderEmails?.[entry.managerInitials] || '';
  const mailCfg = getTransportOrNull();
  if (!to)   return { sent:false, reason:'no_recipient' };
  if (!mailCfg) return { sent:false, reason:'no_smtp' };

  const baseUrl = process.env.PUBLIC_URL || '';
  const link = baseUrl || '(indsæt jeres URL)';

  const mail = {
    from: mailCfg.from,
    to,
    subject: `Bruger-ID for ${entry.firstName} ${entry.lastName}: ${entry.id}`,
    text:
`Hej ${entry.managerInitials},

Der er oprettet en ny medarbejder.

Bruger-ID: ${entry.id}
Navn: ${entry.firstName} ${entry.lastName}
Afdeling: ${entry.department}
Startdato: ${entry.startDate}

Udfyld IT-rettigheder her: ${link}
Adgangskode (Afd. leder): ${ACCESS_KEY}

Mvh
Onboarding-systemet`
  };

  try{
    const info = await mailCfg.transporter.sendMail(mail);
    console.log('Leder-mail sendt:', info.messageId);
    return { sent:true };
  } catch(e){
    console.error('Leder-mail fejl:', e.message);
    return { sent:false, reason:'send_error', error:e.message };
  }
}

// Mail ved færdiggørelse → HR & IT
async function sendCompletionMails(entry){
  const cfg = readJson(CONFIG_FILE, { notify: { hr:"", it:"" } });
  const hrTo = cfg.notify?.hr || '';
  const itTo = cfg.notify?.it || '';
  const mailCfg = getTransportOrNull();
  if (!mailCfg) return { hrSent:false, itSent:false, reason:'no_smtp' };
  if (!hrTo && !itTo) return { hrSent:false, itSent:false, reason:'no_recipients' };

  const baseUrl = process.env.PUBLIC_URL || '';
  const link = baseUrl || '(indsæt jeres URL)';
  const body =
`Bruger er færdig (IT-rettigheder gemt).

Bruger-ID: ${entry.id}
Navn: ${entry.firstName} ${entry.lastName} (${entry.initials})
Afdeling: ${entry.department}
Title: ${entry.title}
Startdato: ${entry.startDate}
Leder (initialer): ${entry.managerInitials}
Tlf: ${entry.phone}

Rettigheder:
- Fil: ${shortRights(entry.rightsFiles, entry.rightsFilesSame)}
- AX: ${shortRights(entry.rightsAX, entry.rightsAXSame)}
- D4: ${shortRights(entry.rightsD4, entry.rightsD4Same)}

Udstyr:
- PC: ${entry.pcType || 'Ingen'}
- Docking: ${entry.docking || 'Nej'}
- Skærme: ${entry.screens || '0'}

Software:
- ${[entry.softwareSelect, entry.softwareExtra].filter(Boolean).join(' | ') || 'Som standard'}

Se systemet her: ${link}`;

  const subject = `Onboarding færdig: ${entry.firstName} ${entry.lastName} (${entry.id})`;

  const results = { hrSent:false, itSent:false };
  try{
    if (hrTo) {
      const info = await mailCfg.transporter.sendMail({ from: mailCfg.from, to: hrTo, subject, text: body });
      console.log('HR-mail sendt:', info.messageId);
      results.hrSent = true;
    }
    if (itTo) {
      const info = await mailCfg.transporter.sendMail({ from: mailCfg.from, to: itTo, subject, text: body });
      console.log('IT-mail sendt:', info.messageId);
      results.itSent = true;
    }
  } catch(e){
    console.error('Færdig-mail fejl:', e.message);
    return { ...results, error: e.message };
  }
  return results;
}

// === API ===
app.get('/api/ping', (_req,res)=>res.json({ ok:true }));

// HR opretter — nu OPRETTES KUN hvis leder-mail sendes med succes
app.post('/api/create', async (req,res)=>{
  const { key, firstName, lastName, initials, startDate, department, title, managerInitials, phone } = req.body || {};
  if (key !== ACCESS_KEY) return res.status(403).json({ ok:false, error:'Forkert adgangskode.' });
  const required = { firstName, lastName, initials, startDate, department, title, managerInitials, phone };
  for (const [k,v] of Object.entries(required)) if(!v) return res.status(400).json({ ok:false, error:`Felt mangler: ${k}` });

  // Lav entry og ID men GEM IKKE endnu
  const entry = {
    id: newId(), tsCreated: ts(),
    firstName, lastName, initials, startDate, department, title, managerInitials, phone,
    rightsFiles:'', rightsFilesSame:'', rightsAX:'', rightsAXSame:'', rightsD4:'', rightsD4Same:'',
    pcType:'', docking:'', screens:'',
    softwareSelect:'', softwareExtra:'',
    tsUpdated:''
  };

  // send mail til leder — kun hvis den lykkes, gemmes i DB
  const mail = await sendLeaderMail(entry);
  if (!mail.sent) {
    const reason = mail.reason==='no_recipient'
      ? 'Ingen email fundet for leder-initialer i Admin.'
      : mail.reason==='no_smtp'
        ? 'SMTP ikke sat (tjek env).'
        : mail.error || 'Kunne ikke sende leder-mail.';
    return res.status(500).json({ ok:false, error: reason });
  }

  const db = readJson(DATA_FILE, []);
  db.push(entry);
  writeJson(DATA_FILE, db);
  res.json({ ok:true, id: entry.id, mail });
});

// Afd. leder henter én
app.get('/api/get/:id', (req,res)=>{
  const key = req.query.key;
  if (key !== ACCESS_KEY) return res.status(403).json({ ok:false, error:'Forkert adgangskode.' });
  const db = readJson(DATA_FILE, []);
  const item = db.find(x=>x.id===req.params.id);
  if (!item) return res.status(404).json({ ok:false, error:'Bruger-ID ikke fundet.' });
  res.json({ ok:true, entry: item });
});

// Afd. leder gemmer rettigheder → sender HR/IT mail
app.post('/api/update/:id', async (req,res)=>{
  const { key, rightsFiles, rightsFilesSame, rightsAX, rightsAXSame, rightsD4, rightsD4Same, pcType, docking, screens, softwareSelect, softwareExtra } = req.body || {};
  if (key !== ACCESS_KEY) return res.status(403).json({ ok:false, error:'Forkert adgangskode.' });

  if (rightsFiles==='same' && !rightsFilesSame) return res.status(400).json({ ok:false, error:'Angiv initialer for Fil rettigheder (Det samme som).' });
  if (rightsAX==='same'   && !rightsAXSame)   return res.status(400).json({ ok:false, error:'Angiv initialer for AX rettigheder (Det samme som).' });
  if (rightsD4==='same'   && !rightsD4Same)   return res.status(400).json({ ok:false, error:'Angiv initialer for D4 Infonet (Det samme som).' });

  const db = readJson(DATA_FILE, []);
  const i = db.findIndex(x=>x.id===req.params.id);
  if (i === -1) return res.status(404).json({ ok:false, error:'Bruger-ID ikke fundet.' });

  const cur = db[i];
  const updated = {
    ...cur,
    rightsFiles: rightsFiles ?? cur.rightsFiles,
    rightsFilesSame: rightsFilesSame ?? cur.rightsFilesSame,
    rightsAX: rightsAX ?? cur.rightsAX,
    rightsAXSame: rightsAXSame ?? cur.rightsAXSame,
    rightsD4: rightsD4 ?? cur.rightsD4,
    rightsD4Same: rightsD4Same ?? cur.rightsD4Same,
    pcType: pcType ?? cur.pcType,
    docking: docking ?? cur.docking,
    screens: screens ?? cur.screens,
    softwareSelect: softwareSelect ?? cur.softwareSelect,
    softwareExtra: softwareExtra ?? cur.softwareExtra,
    tsUpdated: ts()
  };
  db[i] = updated;
  writeJson(DATA_FILE, db);

  const notify = await sendCompletionMails(updated);
  res.json({ ok:true, notify });
});

// Liste (Brugere/Admin)
app.get('/api/list', (req,res)=>{
  const key = req.query.key;
  if (key !== VIEW_KEY && key !== ADMIN_KEY) return res.status(403).json({ ok:false, error:'Forkert kode.' });
  const q = (req.query.q||'').toLowerCase();
  const db = readJson(DATA_FILE, []);
  const filtered = db.filter(e=>{
    const hay = [
      e.id, e.firstName, e.lastName, e.initials, e.department, e.title, e.managerInitials, e.phone
    ].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=> (a.tsCreated < b.tsCreated ? 1 : -1));
  res.json({ ok:true, entries: filtered });
});

// Slet bruger (Admin)
app.delete('/api/delete/:id', (req,res)=>{
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ ok:false, error:'Forkert kode.' });
  const db = readJson(DATA_FILE, []);
  const i = db.findIndex(e=>e.id===req.params.id);
  if (i === -1) return res.status(404).json({ ok:false, error:'Bruger-ID ikke fundet.' });
  db.splice(i,1);
  writeJson(DATA_FILE, db);
  res.json({ ok:true });
});

// Export CSV (Admin)
app.get('/api/export', (req,res)=>{
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ ok:false, error:'Forkert kode.' });

  const db = readJson(DATA_FILE, []);
  const head = [
    "id","tsCreated","firstName","lastName","initials","startDate","department","title","managerInitials","phone",
    "rightsFiles","rightsFilesSame","rightsAX","rightsAXSame","rightsD4","rightsD4Same",
    "pcType","docking","screens","softwareSelect","softwareExtra","tsUpdated"
  ];
  const rows = db.map(e => head.map(h => (e[h]??"").toString().replaceAll('"','""')));
  const lines = [head.join(';'), ...rows.map(r => r.map(v => v.includes(';')||v.includes('\n')?`"${v}"`:v).join(';'))];
  const csv = '\uFEFF' + lines.join('\n');

  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="onboarding.csv"');
  res.send(csv);
});

// Admin konfig (lederEmails + notify hr/it)
app.get('/api/config/get', (req,res)=>{
  const key = req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ ok:false, error:'Forkert kode.' });
  const cfg = readJson(CONFIG_FILE, { leaderEmails:{}, notify:{ hr:"", it:"" } });
  res.json({ ok:true, config: { leaderEmails: cfg.leaderEmails || {}, notify: cfg.notify || { hr:"", it:"" } } });
});
app.post('/api/config/save', (req,res)=>{
  const { key, leaderEmails, notify } = req.body || {};
  if (key !== ADMIN_KEY) return res.status(403).json({ ok:false, error:'Forkert kode.' });
  const next = {
    leaderEmails: leaderEmails || {},
    notify: { hr: (notify?.hr||"").trim(), it: (notify?.it||"").trim() }
  };
  writeJson(CONFIG_FILE, next);
  res.json({ ok:true });
});

// Fallback
app.get('*', (_req,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.listen(PORT,HOST,()=>console.log(`Onboarding kører på http://localhost:${PORT}`));
