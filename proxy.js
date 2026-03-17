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
  /* Track wrong answers per question to exclude on retry */
  var _wrongIdxMap = {};  /* { questionText: [idx0, idx1, ...] } */
  var _retryingQ = '';    /* question currently being retried */

  function startEngine(){
    var obs = new MutationObserver(function(){ engineTick(); });
    obs.observe(document.body, {childList:true, subtree:true, characterData:true});
    setInterval(engineTick, 1500);
    /* Also watch for wrong-answer feedback to trigger retry */
    setInterval(checkWrongAnswer, 800);
  }

  function engineTick(){
    tryHarvest();
    if(QSP_MODE !== 'harvest') tryPlay();
  }

  /* ── Detect wrong answer feedback on page ── */
  function checkWrongAnswer(){
    if(!_retryingQ && !_processing) return;
    try {
      var wrongEls = document.querySelectorAll(
        '[class*="incorrect"], [class*="Incorrect"], [class*="wrong"], [class*="Wrong"], ' +
        '[class*="error"], [data-correct="false"], .incorrect, .wrong, ' +
        '[style*="border-color: red"], [style*="border-color:red"], ' +
        '[style*="background-color: red"], [style*="background-color:red"], ' +
        '[style*="background: red"], [style*="background:red"], ' +
        '[class*="fail"], [class*="missed"]'
      );
      /* Also detect red background/border via computed style */
      if(wrongEls.length === 0){
        var allOpts = document.querySelectorAll('[class*="answer"], [class*="Answer"], [class*="option"], [class*="Option"], [class*="choice"], [data-testid*="answer"], button[class*="btn"]');
        if(allOpts.length < 2) allOpts = document.querySelectorAll('.option, .answer, [role="button"]');
        allOpts.forEach(function(el){
          var cs = window.getComputedStyle(el);
          var bg = cs.backgroundColor || '';
          var bc = cs.borderColor || '';
          /* Check for red-ish colors */
          if((bg.indexOf('rgb(255') > -1 && bg.indexOf(', 0)') > -1) || 
             (bc.indexOf('rgb(255') > -1 && bc.indexOf(', 0)') > -1) ||
             el.getAttribute('aria-invalid') === 'true'){
            wrongEls = document.querySelectorAll('.__qsp_force_match__'); /* dummy to make length > 0 trick */
            /* Mark this element */
            el.setAttribute('data-qsp-wrong', 'true');
          }
        });
        wrongEls = document.querySelectorAll('[data-qsp-wrong="true"]');
      }
    } catch(e){}
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

  /* ── Check if an option element is marked wrong ── */
  function isOptionWrong(el){
    var cls = (el.className || '').toLowerCase();
    if(cls.indexOf('incorrect') > -1 || cls.indexOf('wrong') > -1 || cls.indexOf('error') > -1 || cls.indexOf('fail') > -1 || cls.indexOf('missed') > -1) return true;
    if(el.getAttribute('data-correct') === 'false') return true;
    if(el.getAttribute('aria-invalid') === 'true') return true;
    if(el.getAttribute('data-qsp-wrong') === 'true') return true;
    var style = el.getAttribute('style') || '';
    if(style.indexOf('red') > -1) return true;
    try {
      var cs = window.getComputedStyle(el);
      var bg = cs.backgroundColor || '';
      /* Red-ish: rgb(255, 0, 0) or similar */
      var m = bg.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if(m && parseInt(m[1]) > 200 && parseInt(m[2]) < 80 && parseInt(m[3]) < 80) return true;
    } catch(e){}
    return false;
  }

  /* ── PLAY (highlight / auto) with RETRY on wrong answer ── */
  function tryPlay(){
    if(_processing) return;
    try {
      /* Find question */
      var qEls = document.querySelectorAll('[class*="question"], [class*="Question"], [data-testid*="question"], h1, h2, h3, .question-text, .prompt');
      var qEl = null;
      qEls.forEach(function(el){ if(el.textContent.trim().length > 10 && !qEl) qEl = el; });
      if(!qEl) return;

      var q = qEl.textContent.trim();

      /* If this is a NEW question (different from last), reset wrong history */
      if(q !== _lastQ && q !== _retryingQ){
        _lastQ = q;
        _retryingQ = '';
        _wrongIdxMap[q] = [];
      }

      /* If we are retrying this question, check if any option is now wrong */
      if(_retryingQ === q){
        /* Already handled – proceed to pick next option */
      } else if(q === _lastQ && !_retryingQ){
        /* First attempt for this question */
      } else {
        return; /* Same question already processed, not retrying */
      }

      _processing = true;

      /* Find answer options */
      var optEls = document.querySelectorAll('[class*="answer"], [class*="Answer"], [class*="option"], [class*="Option"], [class*="choice"], [data-testid*="answer"], button[class*="btn"]');
      if(optEls.length < 2){
        optEls = document.querySelectorAll('.option, .answer, [role="button"]');
      }
      var opts = [];
      optEls.forEach(function(el){ opts.push(el.textContent.trim()); });

      /* Build list of wrong indices by checking DOM state */
      if(!_wrongIdxMap[q]) _wrongIdxMap[q] = [];
      for(var wi = 0; wi < optEls.length; wi++){
        if(isOptionWrong(optEls[wi]) && _wrongIdxMap[q].indexOf(wi) < 0){
          _wrongIdxMap[q].push(wi);
        }
      }

      var wrongList = _wrongIdxMap[q] || [];
      var modeLabel = QSP_MODE === 'auto' ? '🎯 AUTO' : '🔍 CHỈ XEM';

      if(_retryingQ === q){
        log(modeLabel+' | 🔄 Sai rồi! Đang chọn lại... (loại '+wrongList.length+' đáp án sai)','#ff5722');
      } else {
        log(modeLabel+' | 🔍 Đang tìm đáp án...','#00bcd4');
      }

      /* Ask server */
      fetch(QSP_SERVER+'/ask', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Key':_key},
        body: JSON.stringify({q:q, opts:opts})
      }).then(r=>r.json()).then(function(raw){
        var d = decrypt(raw);
        if(!d){ log(modeLabel+' | ❌ Lỗi giải mã','#f44'); _processing=false; return; }
        
        var targetIdx = d.idx;
        
        /* If server's answer is in wrong list, pick the next available option */
        if(targetIdx >= 0 && wrongList.indexOf(targetIdx) > -1){
          targetIdx = -1; /* Server answer was already wrong, find another */
        }
        
        /* If no good answer from server, try remaining options */
        if(targetIdx < 0 || targetIdx >= optEls.length){
          for(var ci = 0; ci < optEls.length; ci++){
            if(wrongList.indexOf(ci) < 0 && !isOptionWrong(optEls[ci])){
              targetIdx = ci;
              break;
            }
          }
        }

        if(targetIdx >= 0 && targetIdx < optEls.length){
          /* Shorter delay on retry (2-4s), normal delay on first try (6-10s) */
          var isRetry = _retryingQ === q;
          var delay = isRetry ? (2000 + Math.floor(Math.random() * 2000)) : (6000 + Math.floor(Math.random() * 4000));
          var sec = (delay/1000).toFixed(1);
          log(modeLabel+' | ⏱️ '+(isRetry?'Chọn lại sau ':'Chờ ')+sec+'s...', isRetry ? '#ff9800' : '#ff9800');

          setTimeout(function(){
            /* Highlight the chosen answer */
            optEls[targetIdx].style.cssText += ';box-shadow:0 0 25px #00e676,0 0 50px rgba(0,230,118,.3)!important;border:3px solid #00e676!important;position:relative;z-index:9999;transition:.3s';
            log(modeLabel+' | '+(isRetry?'🔄':'✅')+' Đáp án #'+(targetIdx+1)+' | DB:'+d.total, isRetry?'#ff9800':'#00e676');

            if(QSP_MODE === 'auto'){
              /* Auto click after small extra delay */
              var clickDelay = 500 + Math.floor(Math.random() * 1500);
              setTimeout(function(){
                optEls[targetIdx].click();
                log(modeLabel+' | 🖱️ Đã click #'+(targetIdx+1)+'! Đang kiểm tra...','#00bcd4');
                
                /* After clicking, wait and check if the answer was wrong */
                setTimeout(function(){
                  var wasWrong = false;
                  /* Re-check the clicked option for wrong indicators */
                  if(isOptionWrong(optEls[targetIdx])){
                    wasWrong = true;
                  }
                  /* Also check for any general wrong feedback on page */
                  var wrongFeedback = document.querySelectorAll(
                    '[class*="incorrect"], [class*="wrong"], [class*="Wrong"], .incorrect, .wrong, [class*="fail"]'
                  );
                  if(wrongFeedback.length > 0) wasWrong = true;

                  if(wasWrong){
                    /* Mark this index as wrong */
                    if(_wrongIdxMap[q].indexOf(targetIdx) < 0) _wrongIdxMap[q].push(targetIdx);
                    
                    /* Check if all options exhausted */
                    if(_wrongIdxMap[q].length >= optEls.length){
                      log(modeLabel+' | ❌ Hết đáp án! Tất cả đều sai.','#f44');
                      _retryingQ = '';
                      _processing = false;
                      return;
                    }
                    
                    /* Set retry mode – keep same question, try next option */
                    _retryingQ = q;
                    _lastQ = q;
                    log(modeLabel+' | ❌ Sai! Sẽ chọn lại... ('+_wrongIdxMap[q].length+'/'+optEls.length+')','#f44');
                    _processing = false;
                    /* Engine will re-trigger tryPlay on next tick for same question */
                  } else {
                    /* Answer was correct! Auto-harvest to DB */
                    var correctText = optEls[targetIdx].textContent.trim().toLowerCase();
                    var harvestBatch = {};
                    harvestBatch[q.toLowerCase()] = [correctText];
                    fetch(QSP_SERVER+'/harvest', {
                      method:'POST',
                      headers:{'Content-Type':'application/json'},
                      body: JSON.stringify(harvestBatch)
                    }).then(r=>r.json()).then(function(hd){
                      log(modeLabel+' | ✅ Đúng! Đã ghi DB ('+hd.total+') | Chờ câu tiếp...','#00e676');
                    }).catch(function(){
                      log(modeLabel+' | ✅ Đúng rồi! Chờ câu tiếp...','#00e676');
                    });
                    _retryingQ = '';
                    _processing = false;
                  }
                }, 1500); /* Wait 1.5s for wrong/correct feedback to appear */
              }, clickDelay);
            } else {
              _processing = false;
            }
          }, delay);
        } else {
          log(modeLabel+' | ❓ Chưa có đáp án'+(wrongList.length>0?' (loại '+wrongList.length+' sai)':'') +' | DB:'+d.total,'#ff5722');
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
