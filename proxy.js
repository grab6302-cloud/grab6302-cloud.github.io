/* QSP Server v9 — $0 Cloud Edition
   Key check qua jsonbin.io (FREE)
   Proxy chỉ relay data harvest/play trên localhost khách hàng */
const http = require('http');
const fs = require('fs');
const https = require('https');
const path = require('path');

const DB_FILE = path.join(__dirname, 'answers.json');
const CFG_FILE = path.join(__dirname, 'config.json');

let answers = {};
let config = {};
try { answers = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e){}
try { config = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch(e){}

function saveAnswers(){ fs.writeFileSync(DB_FILE, JSON.stringify(answers, null, 2), 'utf8'); }
function strip(s){ return (s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().toLowerCase(); }

/* Tìm đáp án */
function findAnswer(q){
  q = strip(q);
  if(answers[q]) return answers[q];
  var words = q.split(' ').filter(w=>w.length>2);
  var best=null, bestS=0;
  for(var k of Object.keys(answers)){
    var m=0; words.forEach(w=>{ if(k.indexOf(w)>-1) m++; });
    var s = words.length>0 ? m/words.length : 0;
    if(s > bestS && s > 0.6){ bestS=s; best=answers[k]; }
  }
  return best;
}

/* Check key qua jsonbin.io */
function checkKeyOnline(key, callback){
  if(!config.JSONBIN_ID){ callback(false); return; }
  var options = {
    hostname: 'api.jsonbin.io',
    path: '/v3/b/' + config.JSONBIN_ID + '/latest',
    headers: { 'X-Master-Key': config.JSONBIN_KEY }
  };
  https.get(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        var j = JSON.parse(data);
        var record = j.record || j;
        /* Hỗ trợ cả cấu trúc cũ (keys ở root) và mới (_keys nested) */
        var keys = record._keys || record;
        if(keys[key] && keys[key].active){
          var exp = keys[key].expires;
          if(!exp || Date.now() <= exp){ callback(true, keys[key]); return; }
        }
        callback(false);
      } catch(e){ callback(false); }
    });
  }).on('error', () => callback(false));
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Key');
  if(req.method === 'OPTIONS'){ res.writeHead(200); res.end(); return; }

  const url = new URL('http://localhost' + req.url);
  const key = req.headers['x-key'] || url.searchParams.get('key') || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  /* Check key */
  if(url.pathname === '/check'){
    checkKeyOnline(key, (valid, info) => {
      if(valid) res.end(JSON.stringify({valid:true, expires:info.expires ? new Date(info.expires).toLocaleDateString('vi') : '∞'}));
      else { res.writeHead(403); res.end(JSON.stringify({valid:false})); }
    });
    return;
  }

  /* POST /ask — câu hỏi → đáp án (cần key) */
  if(url.pathname === '/ask' && req.method === 'POST'){
    checkKeyOnline(key, (valid) => {
      if(!valid){ res.writeHead(403); res.end(JSON.stringify({error:'Key invalid'})); return; }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try{
          var d = JSON.parse(body);
          var opts = (d.opts||[]).map(o=>strip(o));
          var ans = findAnswer(d.q);
          var idx = -1;
          if(ans){ for(var i=0;i<opts.length;i++){ for(var a of ans){ if(opts[i]===a||opts[i].indexOf(a)>-1||a.indexOf(opts[i])>-1){idx=i;break;}}if(idx!==-1)break;}}
          res.end(JSON.stringify({idx, total:Object.keys(answers).length}));
        }catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
      });
    });
    return;
  }

  /* POST /harvest — gửi đáp án */
  if(url.pathname === '/harvest' && req.method === 'POST'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try{
        var batch = JSON.parse(body);
        var nu = 0;
        for(var q in batch){
          if(!answers[q]){ answers[q]=batch[q]; nu++; }
          else { batch[q].forEach(a=>{ if(answers[q].indexOf(a)<0){ answers[q].push(a); nu++; }}); }
        }
        if(nu>0) saveAnswers();
        res.end(JSON.stringify({ok:true, total:Object.keys(answers).length, new:nu}));
      }catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  /* GET /load — cho CHƠI poll */
  if(url.pathname === '/load'){
    res.end(JSON.stringify({total:Object.keys(answers).length, db:answers}));
    return;
  }

  /* POST /save — cho DÒ gửi */
  if(url.pathname === '/save' && req.method === 'POST'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try{
        Object.assign(answers, JSON.parse(body));
        saveAnswers();
        res.end(JSON.stringify({ok:true, total:Object.keys(answers).length}));
      }catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  res.end(JSON.stringify({status:'QSP v9', answers:Object.keys(answers).length}));
}).listen(9876, () => {
  console.log('');
  console.log('  ╔══════════════════════════════╗');
  console.log('  ║  QSP SERVER v9 — $0 Edition  ║');
  console.log('  ║  Port: 9876                  ║');
  console.log('  ║  Answers: ' + Object.keys(answers).length.toString().padEnd(18) + ' ║');
  console.log('  ║  JSONBin: ' + (config.JSONBIN_ID ? '✅' : '❌').padEnd(19) + '║');
  console.log('  ╚══════════════════════════════╝');
  console.log('');
});
