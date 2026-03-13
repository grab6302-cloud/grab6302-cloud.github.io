/* ==========================================
   🛡️ QSP SHIELD v2.0 — MAX PROTECTION
   ========================================== */
(function(){
  // 1. Block right-click
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  // 2. Block text selection
  document.addEventListener('selectstart', function(e){ e.preventDefault(); });
  var s = document.createElement('style');
  s.textContent = '*{-webkit-user-select:none!important;-moz-user-select:none!important;-ms-user-select:none!important;user-select:none!important} input,textarea{-webkit-user-select:text!important;-moz-user-select:text!important;user-select:text!important}';
  document.head.appendChild(s);

  // 3. Block ALL keyboard shortcuts
  document.addEventListener('keydown', function(e){
    if(e.key === 'F12') { e.preventDefault(); return false; }
    if(e.key === 'F5' && e.ctrlKey) { e.preventDefault(); return false; }
    if(e.ctrlKey && e.shiftKey && /[IiJjCc]/.test(e.key)) { e.preventDefault(); return false; }
    if(e.ctrlKey && /[UuSs]/.test(e.key)) { e.preventDefault(); return false; }
    if(e.ctrlKey && /[Aa]/.test(e.key) && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); return false; }
    if(e.ctrlKey && /[Cc]/.test(e.key) && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); return false; }
    if(e.ctrlKey && /[Pp]/.test(e.key)) { e.preventDefault(); return false; } // block print
  });

  // 4. Block drag
  document.addEventListener('dragstart', function(e){
    if(!e.target.classList || !e.target.classList.contains('bm')) { e.preventDefault(); }
  });

  // 5. Debugger trap — freezes DevTools if opened
  (function trap(){
    var t = new Date();
    debugger;
    if(new Date() - t > 100) {
      document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0a1a;color:#f44;font:bold 28px Inter,sans-serif;text-align:center;padding:40px;flex-direction:column;gap:20px"><div style="font-size:60px">⛔</div><div>PHÁT HIỆN DEBUGGER!</div><div style="font-size:16px;color:#888">Vui lòng đóng Developer Tools<br>và tải lại trang.</div></div>';
      return;
    }
    setTimeout(trap, 1000);
  })();

  // 6. DevTools detection (resize)
  var _dt = false;
  setInterval(function(){
    var w = window.outerWidth - window.innerWidth > 160;
    var h = window.outerHeight - window.innerHeight > 160;
    if(w || h){
      if(!_dt){
        _dt = true;
        document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0a1a;color:#f44;font:bold 28px Inter,sans-serif;text-align:center;padding:40px;flex-direction:column;gap:20px"><div style="font-size:60px">⛔</div><div>DevTools Detected!</div><div style="font-size:16px;color:#888">Đóng Developer Tools để tiếp tục.</div></div>';
      }
    } else {
      if(_dt){ _dt = false; location.reload(); }
    }
  }, 800);

  // 7. Override console methods
  var noop = function(){};
  try {
    Object.defineProperty(window, 'console', {
      get: function(){ return { log:noop, warn:noop, error:noop, info:noop, dir:noop, table:noop, trace:noop, assert:noop, clear:noop, count:noop, group:noop, groupEnd:noop, time:noop, timeEnd:noop }; },
      set: function(){}
    });
  } catch(e){}

  // 8. Block print
  window.addEventListener('beforeprint', function(e){
    document.body.style.display = 'none';
  });
  window.addEventListener('afterprint', function(){
    document.body.style.display = '';
  });

  // 9. Block view-source protocol
  if(location.protocol === 'view-source:'){
    location.href = 'about:blank';
  }

  // 10. Detect Firebug
  setInterval(function(){
    if(window.Firebug && window.Firebug.chrome && window.Firebug.chrome.isInitialized){
      document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0a1a;color:#f44;font:bold 28px Inter,sans-serif;text-align:center;padding:40px">⛔ Firebug Detected!</div>';
    }
  }, 2000);

  // 11. Block iframe embedding (anti-framing)
  if(window.top !== window.self){
    window.top.location = window.self.location;
  }
})();
