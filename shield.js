/* ==========================================
   🛡️ QSP SHIELD v1.0 — Anti-Copy Protection
   ========================================== */
(function(){
  // 1. Block right-click
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  // 2. Block text selection
  document.addEventListener('selectstart', function(e){ e.preventDefault(); });
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';
  document.body.style.msUserSelect = 'none';

  // 3. Block keyboard shortcuts (Ctrl+U, Ctrl+S, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+Shift+C)
  document.addEventListener('keydown', function(e){
    // F12
    if(e.key === 'F12') { e.preventDefault(); return false; }
    // Ctrl+Shift+I (DevTools)
    if(e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); return false; }
    // Ctrl+Shift+J (Console)
    if(e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) { e.preventDefault(); return false; }
    // Ctrl+Shift+C (Inspect)
    if(e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); return false; }
    // Ctrl+U (View Source)
    if(e.ctrlKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return false; }
    // Ctrl+S (Save)
    if(e.ctrlKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); return false; }
    // Ctrl+A (Select All) - ngoại trừ khi đang ở trong input/textarea
    if(e.ctrlKey && (e.key === 'A' || e.key === 'a') && !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      e.preventDefault(); return false;
    }
    // Ctrl+C (Copy) - ngoại trừ input/textarea
    if(e.ctrlKey && (e.key === 'C' || e.key === 'c') && !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      e.preventDefault(); return false;
    }
  });

  // 4. Block drag on images and links  
  document.addEventListener('dragstart', function(e){
    if(e.target.tagName !== 'A' || !e.target.classList.contains('bm')) {
      e.preventDefault();
    }
  });

  // 5. DevTools detection (resize trick)
  var threshold = 160;
  var devtoolsOpen = false;
  setInterval(function(){
    var w = window.outerWidth - window.innerWidth > threshold;
    var h = window.outerHeight - window.innerHeight > threshold;
    if(w || h){
      if(!devtoolsOpen){
        devtoolsOpen = true;
        document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0a0a1a;color:#f44;font:bold 24px Inter,sans-serif;text-align:center;padding:40px">⛔ DevTools Detected!<br><br>Vui lòng đóng Developer Tools để tiếp tục sử dụng.</div>';
      }
    } else {
      if(devtoolsOpen){
        devtoolsOpen = false;
        location.reload();
      }
    }
  }, 1000);

  // 6. Console warning
  console.log('%c⛔ DỪNG LẠI!', 'color:#f44;font-size:40px;font-weight:bold');
  console.log('%cĐây là chức năng dành cho nhà phát triển. Không ai yêu cầu bạn dán code ở đây cả!', 'color:#ff9800;font-size:16px');
})();
