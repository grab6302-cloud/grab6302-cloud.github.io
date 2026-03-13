/* QSP Server v10 — Cloud Sync Edition
   - Key check qua JSONBin
   - Answer DB sync lên cloud (nhiều user cùng đóng góp)
   - Serve bookmarklet scripts
   - 3 modes: harvest, highlight, auto */

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

function saveLocal(){ fs.writeFileSync(DB_FILE, JSON.stringify(answers, null, 2), 'utf8'); }
function strip(s){ return (s||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().toLowerCase(); }

/* ── Cloud sync: upload answers to JSONBin ── */
let _syncTimer = null;
function scheduleSync(){
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToCloud, 5000); // batch sync after 5s idle
}

function syncToCloud(){
  if(!config.JSONBIN_ID) return;
  console.log('  ☁️  Syncing answers to cloud...');
  
  // First read current cloud data
  var opts = {
    hostname: 'api.jsonbin.io',
    path: '/v3/b/' + config.JSONBIN_ID + '/latest',
    headers: { 'X-Master-Key': config.JSONBIN_KEY }
  };
  
  https.get(opts, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        var j = JSON.parse(data);
        var record = j.record || {};
        
        // Merge cloud answers with local
        var cloudAnswers = record._answers || {};
        var merged = Object.assign({}, cloudAnswers, answers);
        
        // Also merge individual answer arrays
        for(var q in cloudAnswers){
          if(answers[q]){
            cloudAnswers[q].forEach(a => {
              if(answers[q].indexOf(a) < 0) merged[q].push(a);
            });
          }
        }
        
        // Update cloud
        record._answers = merged;
        answers = merged;
        saveLocal();
        
        var postData = JSON.stringify(record);
        var putOpts = {
          hostname: 'api.jsonbin.io',
          path: '/v3/b/' + config.JSONBIN_ID,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': config.JSONBIN_KEY,
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        var req = https.request(putOpts, (res2) => {
          let d2 = '';
          res2.on('data', c => d2 += c);
          res2.on('end', () => {
            console.log('  ✅ Cloud sync done! Total: ' + Object.keys(merged).length + ' answers');
          });
        });
        req.on('error', (e) => console.log('  ❌ Cloud sync error:', e.message));
        req.write(postData);
        req.end();
      } catch(e){ console.log('  ❌ Sync parse error:', e.message); }
    });
  }).on('error', (e) => console.log('  ❌ Cloud read error:', e.message));
}

/* ── Pull answers from cloud ── */
function pullFromCloud(callback){
  if(!config.JSONBIN_ID){ callback(); return; }
  var opts = {
    hostname: 'api.jsonbin.io',
    path: '/v3/b/' + config.JSONBIN_ID + '/latest',
    headers: { 'X-Master-Key': config.JSONBIN_KEY }
  };
  https.get(opts, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        var j = JSON.parse(data);
        var cloud = (j.record || {})._answers || {};
        var nu = 0;
        for(var q in cloud){
          if(!answers[q]){ answers[q] = cloud[q]; nu++; }
          else { cloud[q].forEach(a => { if(answers[q].indexOf(a)<0){ answers[q].push(a); nu++; }}); }
        }
        if(nu > 0) saveLocal();
        console.log('  ☁️  Pulled ' + nu + ' new answers from cloud. Total: ' + Object.keys(answers).length);
      } catch(e){}
      callback();
    });
  }).on('error', () => callback());
}

/* ── Find answer (fuzzy match) ── */
function findAnswer(q){
  q = strip(q);
  if(answers[q]) return answers[q];
  var words = q.split(' ').filter(w => w.length > 2);
  var best = null, bestS = 0;
  for(var k of Object.keys(answers)){
    var m = 0;
    words.forEach(w => { if(k.indexOf(w) > -1) m++; });
    var s = words.length > 0 ? m / words.length : 0;
    if(s > bestS && s > 0.6){ bestS = s; best = answers[k]; }
  }
  return best;
}

/* ── Check key via JSONBin ── */
function checkKeyOnline(key, callback){
  if(!config.JSONBIN_ID){ callback(false); return; }
  var opts = {
    hostname: 'api.jsonbin.io',
    path: '/v3/b/' + config.JSONBIN_ID + '/latest',
    headers: { 'X-Master-Key': config.JSONBIN_KEY }
  };
  https.get(opts, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        var j = JSON.parse(data);
        var record = j.record || j;
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

/* ── Encryption: XOR with rotating token ── */
const crypto = require('crypto');
function encryptResponse(data){
  var token = crypto.randomBytes(8).toString('hex'); // 16 char hex
  var json = JSON.stringify(data);
  var encrypted = '';
  for(var i = 0; i < json.length; i++){
    encrypted += String.fromCharCode(json.charCodeAt(i) ^ token.charCodeAt(i % token.length));
  }
  return JSON.stringify({ _t: token, _d: Buffer.from(encrypted).toString('base64') });
}

/* ── Bookmarklet script generator ── */
function getScript(mode){
  return `(function(){
  var QSP_MODE = '${mode}';
  var QSP_SERVER = 'http://localhost:9876';
  var _key = localStorage.getItem('qsp_key');
  if(!_key){ _key = prompt('🔑 Nhập License Key:'); if(!_key) return; }

  /* Decrypt XOR response */
  function decrypt(r){try{var t=r._t,d=atob(r._d),o='';for(var i=0;i<d.length;i++)o+=String.fromCharCode(d.charCodeAt(i)^t.charCodeAt(i%t.length));return JSON.parse(o)}catch(e){return null}}

  /* Status panel */
  var panel = document.createElement('div');
  panel.id = 'qsp-panel';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#0f0;padding:12px 18px;border-radius:12px;font:bold 13px monospace;border:2px solid #00e676;box-shadow:0 0 20px rgba(0,230,118,.3);min-width:200px';
  panel.innerHTML = '⏳ Đang kiểm tra key...';
  document.body.appendChild(panel);

  function log(msg, color){ panel.innerHTML = msg; if(color) panel.style.borderColor = color; }

  /* Check key */
  fetch(QSP_SERVER+'/check?key='+_key).then(r=>r.json()).then(function(d){
    if(!d.valid){ log('❌ Key không hợp lệ!','#f44'); localStorage.removeItem('qsp_key'); return; }
    localStorage.setItem('qsp_key', _key);
    var modeLabel = {harvest:'💀 DÒ',highlight:'🔍 CHỈ XEM',auto:'🎯 AUTO'}[QSP_MODE];
    log('✅ '+modeLabel+' | Key OK','#00e676');
    startEngine();
  }).catch(function(){ log('❌ Server offline! Chạy proxy.js','#f44'); });

  var _lastQ = '', _lastHQ = '', _processing = false, _hCount = 0;

  function startEngine(){
    var obs = new MutationObserver(function(){ engineTick(); });
    obs.observe(document.body, {childList:true, subtree:true, characterData:true});
    setInterval(engineTick, 1500);
  }

  function engineTick(){
    tryHarvest();
    if(QSP_MODE !== 'harvest') tryPlay();
  }

  function tryHarvest(){
    try {
      /* Find question and correct answer after reveal */
      var allText = document.querySelectorAll('[class*="question"], [class*="Question"], [data-testid*="question"], h1, h2, h3, .question-text, .prompt');
      var qEl = null;
      allText.forEach(function(el){ if(el.textContent.trim().length > 10 && !qEl) qEl = el; });
      if(!qEl) return;

      var q = qEl.textContent.trim();
      if(q === _lastHQ) return;

      /* Look for correct answer indicators */
      var correct = document.querySelectorAll('[class*="correct"], [class*="Correct"], [data-correct="true"], .correct, .right-answer, [style*="green"], [class*="success"]');
      if(correct.length === 0) return;

      _lastHQ = q;
      var answers = [];
      correct.forEach(function(el){ answers.push(el.textContent.trim().toLowerCase()); });

      var batch = {};
      batch[q.toLowerCase()] = answers;

      fetch(QSP_SERVER+'/harvest', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(batch)
      }).then(r=>r.json()).then(function(d){
        _hCount++;
        var modeLabel = {harvest:'💀 DÒ',highlight:'🔍 CHỈ XEM',auto:'🎯 AUTO'}[QSP_MODE];
        log(modeLabel+' | 📥 Dò: '+_hCount+' | DB: '+d.total,'#ff9800');
      });
    } catch(e){}
  }

  /* ── PLAY (highlight / auto) ── */
  function tryPlay(){
    if(_processing) return;
    try {
      /* Find question */
      var qEls = document.querySelectorAll('[class*="question"], [class*="Question"], [data-testid*="question"], h1, h2, h3, .question-text, .prompt');
      var qEl = null;
      qEls.forEach(function(el){ if(el.textContent.trim().length > 10 && !qEl) qEl = el; });
      if(!qEl) return;

      var q = qEl.textContent.trim();
      if(q === _lastQ) return;
      _lastQ = q;
      _processing = true;

      /* Find answer options */
      var optEls = document.querySelectorAll('[class*="answer"], [class*="Answer"], [class*="option"], [class*="Option"], [class*="choice"], [data-testid*="answer"], button[class*="btn"]');
      if(optEls.length < 2){
        optEls = document.querySelectorAll('.option, .answer, [role="button"]');
      }
      var opts = [];
      optEls.forEach(function(el){ opts.push(el.textContent.trim()); });

      var modeLabel = QSP_MODE === 'auto' ? '🎯 AUTO' : '🔍 CHỈ XEM';
      log(modeLabel+' | 🔍 Đang tìm đáp án...','#00bcd4');

      /* Ask server */
      fetch(QSP_SERVER+'/ask', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Key':_key},
        body: JSON.stringify({q:q, opts:opts})
      }).then(r=>r.json()).then(function(raw){
        var d = decrypt(raw);
        if(!d){ log(modeLabel+' | ❌ Lỗi giải mã','#f44'); _processing=false; return; }
        if(d.idx >= 0 && d.idx < optEls.length){
          /* Random delay 6-10 seconds */
          var delay = 6000 + Math.floor(Math.random() * 4000);
          var sec = (delay/1000).toFixed(1);
          log(modeLabel+' | ⏱️ Chờ '+sec+'s...','#ff9800');

          setTimeout(function(){
            /* Highlight */
            optEls[d.idx].style.cssText += ';box-shadow:0 0 25px #00e676,0 0 50px rgba(0,230,118,.3)!important;border:3px solid #00e676!important;position:relative;z-index:9999;transition:.3s';
            log(modeLabel+' | ✅ Đáp án #'+(d.idx+1)+' | DB:'+d.total,'#00e676');

            if(QSP_MODE === 'auto'){
              /* Auto click after small extra delay */
              var clickDelay = 500 + Math.floor(Math.random() * 1500);
              setTimeout(function(){
                optEls[d.idx].click();
                log(modeLabel+' | 🖱️ Đã click! Chờ câu tiếp...','#00e676');
                _processing = false;
              }, clickDelay);
            } else {
              _processing = false;
            }
          }, delay);
        } else {
          log(modeLabel+' | ❓ Chưa có đáp án | DB:'+d.total,'#ff5722');
          _processing = false;
        }
      }).catch(function(){ log(modeLabel+' | ⚠️ Lỗi kết nối','#f44'); _processing = false; });
    } catch(e){ _processing = false; }
  }
})();`;
}

/* ════════════════ HTTP SERVER ════════════════ */
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Key');
  if(req.method === 'OPTIONS'){ res.writeHead(200); res.end(); return; }

  const url = new URL('http://localhost' + req.url);
  const key = req.headers['x-key'] || url.searchParams.get('key') || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  /* ── Serve bookmarklet script ── */
  if(url.pathname === '/script'){
    var mode = url.searchParams.get('mode') || 'highlight';
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(getScript(mode));
    return;
  }

  /* ── Check key ── */
  if(url.pathname === '/check'){
    checkKeyOnline(key, (valid, info) => {
      if(valid) res.end(JSON.stringify({valid:true, expires:info.expires ? new Date(info.expires).toLocaleDateString('vi') : '∞'}));
      else { res.writeHead(403); res.end(JSON.stringify({valid:false})); }
    });
    return;
  }

  /* ── POST /ask — query answer (needs key) ── */
  if(url.pathname === '/ask' && req.method === 'POST'){
    checkKeyOnline(key, (valid) => {
      if(!valid){ res.writeHead(403); res.end(JSON.stringify({error:'Key invalid'})); return; }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try{
          var d = JSON.parse(body);
          var opts = (d.opts||[]).map(o => strip(o));
          var ans = findAnswer(d.q);
          var idx = -1;
          if(ans){
            for(var i=0; i<opts.length; i++){
              for(var a of ans){
                if(opts[i] === a || opts[i].indexOf(a) > -1 || a.indexOf(opts[i]) > -1){
                  idx = i; break;
                }
              }
              if(idx !== -1) break;
            }
          }
          res.end(encryptResponse({idx, total:Object.keys(answers).length}));
        }catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
      });
    });
    return;
  }

  /* ── POST /harvest — save answers ── */
  if(url.pathname === '/harvest' && req.method === 'POST'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try{
        var batch = JSON.parse(body);
        var nu = 0;
        for(var q in batch){
          var sq = strip(q);
          if(!answers[sq]){ answers[sq] = batch[q].map(a => strip(a)); nu++; }
          else { batch[q].forEach(a => { var sa = strip(a); if(answers[sq].indexOf(sa)<0){ answers[sq].push(sa); nu++; }}); }
        }
        if(nu > 0){ saveLocal(); scheduleSync(); }
        res.end(JSON.stringify({ok:true, total:Object.keys(answers).length, new:nu}));
      }catch(e){ res.writeHead(400); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  /* ── GET /load — full DB ── */
  if(url.pathname === '/load'){
    res.end(JSON.stringify({total:Object.keys(answers).length, db:answers}));
    return;
  }

  /* ── GET /sync — force cloud sync ── */
  if(url.pathname === '/sync'){
    syncToCloud();
    res.end(JSON.stringify({ok:true, msg:'Sync started'}));
    return;
  }

  /* ── GET /pull — pull from cloud ── */
  if(url.pathname === '/pull'){
    pullFromCloud(function(){
      res.end(JSON.stringify({ok:true, total:Object.keys(answers).length}));
    });
    return;
  }

  res.end(JSON.stringify({status:'QSP v10', answers:Object.keys(answers).length, modes:['harvest','highlight','auto']}));
}).listen(9876, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════╗');
  console.log('  ║  QSP SERVER v10 — Cloud Sync       ║');
  console.log('  ║  Port: 9876                        ║');
  console.log('  ║  Answers: ' + Object.keys(answers).length.toString().padEnd(24) + '║');
  console.log('  ║  JSONBin: ' + (config.JSONBIN_ID ? '✅ Connected' : '❌ Not set').padEnd(24) + '║');
  console.log('  ║                                    ║');
  console.log('  ║  Modes:                            ║');
  console.log('  ║  💀 /script?mode=harvest            ║');
  console.log('  ║  🔍 /script?mode=highlight          ║');
  console.log('  ║  🎯 /script?mode=auto               ║');
  console.log('  ╚════════════════════════════════════╝');
  console.log('');

  // Pull latest from cloud on startup
  pullFromCloud(function(){
    console.log('  🚀 Server ready!');
  });
});
