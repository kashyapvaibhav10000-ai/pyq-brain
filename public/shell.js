// Sidebar: hover/focus expands the rail (CSS); this file adds the pin (remembered) and the phone drawer.
(function () {
  var root = document.documentElement, side = document.getElementById('side');
  var pin = document.getElementById('pin-btn'), menu = document.getElementById('menu-btn'), scrim = document.getElementById('scrim');
  if (!side) return;
  function setPin(on) {
    root.classList.toggle('pinned', on);
    pin.setAttribute('aria-pressed', on ? 'true' : 'false');
    pin.title = on ? 'Unpin sidebar' : 'Pin sidebar open';
    try { localStorage.setItem('pyq-pin', on ? '1' : '0'); } catch (e) {}
  }
  pin.setAttribute('aria-pressed', root.classList.contains('pinned') ? 'true' : 'false');
  pin.addEventListener('click', function () { setPin(!root.classList.contains('pinned')); });
  function drawer(open) {
    side.classList.toggle('open', open); scrim.hidden = !open;
    menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var a = side.querySelector('nav a'); if (a) a.focus(); }
  }
  menu.addEventListener('click', function () { drawer(!side.classList.contains('open')); });
  scrim.addEventListener('click', function () { drawer(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && side.classList.contains('open')) { drawer(false); menu.focus(); } });
})();

// Samjhao "Suno": read the Hinglish explanation aloud with the browser's own voice (Web Speech API; free, often offline).
// Prefers an Indian English voice (reads Roman Hinglish best), then Hindi. Long text is queued in short chunks
// because some browsers stop a single long utterance after ~15 s. Buttons stay hidden where speech is unsupported.
(function () {
  var ss = window.speechSynthesis;
  if (!ss || !window.SpeechSynthesisUtterance) return;
  var btns = document.querySelectorAll('[data-suno]');
  for (var i = 0; i < btns.length; i++) btns[i].hidden = false;
  var current = null, LABEL = 'Suno (read aloud)', KEY = 'pyq-voice';
  // Rank voices: cloud "Natural/Neural/Online" voices (Edge: Microsoft Neerja/Prabhat/Swara; Chrome: Google) sound human,
  // local eSpeak-style voices sound robotic. en-IN reads Roman Hinglish best, then hi-IN, then any English.
  function score(v) {
    var l = v.lang.replace('_', '-').toLowerCase(), n = v.name, s = 0;
    if (l.indexOf('en-in') === 0) s += 3; else if (l.indexOf('hi') === 0) s += 2; else if (l.indexOf('en') === 0) s += 0; else return -1;
    if (/natural|neural|online|network|enhanced|premium|wavenet/i.test(n)) s += 10;
    if (/google/i.test(n)) s += 5;
    if (!v.localService) s += 2;
    if (/espeak|robot/i.test(n)) s -= 5;
    return s;
  }
  function ranked() {
    return ss.getVoices().filter(function (v) { return score(v) >= 0; }).sort(function (a, b) { return score(b) - score(a); });
  }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function voice() {
    var vs = ranked(), want = saved();
    for (var j = 0; j < vs.length; j++) if (vs[j].name === want) return vs[j];
    return vs[0] || null;
  }
  // Voice picker next to each Suno button (filled once the browser has listed its voices).
  function pickers() {
    var vs = ranked(), cur = voice();
    if (vs.length < 2) return;
    for (var i = 0; i < btns.length; i++) {
      var sel = btns[i].parentNode.querySelector('select.voice');
      if (!sel) {
        sel = document.createElement('select'); sel.className = 'voice'; sel.setAttribute('aria-label', 'Voice');
        btns[i].after(sel);
      }
      sel.innerHTML = '';
      vs.slice(0, 12).forEach(function (v) {
        var o = document.createElement('option'); o.value = v.name; o.textContent = v.name.replace(/^Microsoft /, '') + ' (' + v.lang + ')';
        if (cur && v.name === cur.name) o.selected = true;
        sel.appendChild(o);
      });
    }
  }
  pickers();
  if (ss.addEventListener) ss.addEventListener('voiceschanged', pickers);
  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('select.voice')) return;
    try { localStorage.setItem(KEY, e.target.value); } catch (x) {}
    var all = document.querySelectorAll('select.voice');
    for (var i = 0; i < all.length; i++) all[i].value = e.target.value;
    if (current) { var b = current; stop(); b.click(); }
  });
  function chunks(t) {
    var parts = t.replace(/[💡🏠✎⚑]/gu, '').split(/\n+|(?<=[.!?।])\s+/), out = [], buf = '';
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k].trim();
      if (!p) continue;
      if (buf && (buf + ' ' + p).length > 220) { out.push(buf); buf = p; } else buf = buf ? buf + ' ' + p : p;
    }
    if (buf) out.push(buf);
    return out;
  }
  function stop() {
    ss.cancel();
    if (current) { current.setAttribute('aria-pressed', 'false'); current.textContent = LABEL; current = null; }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-suno]');
    if (!b) return;
    var again = b === current;
    stop();
    if (again) return;
    var box = b.closest('.sj').querySelector('.answer').cloneNode(true);
    var figs = box.querySelectorAll('.fig');
    for (var f = 0; f < figs.length; f++) figs[f].remove();
    var parts = chunks(box.innerText || box.textContent), v = voice();
    if (!parts.length) return;
    current = b; b.setAttribute('aria-pressed', 'true'); b.textContent = 'Stop';
    parts.forEach(function (p, n) {
      var u = new SpeechSynthesisUtterance(p);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
      u.rate = 1;
      if (n === parts.length - 1) u.onend = function () { if (current === b) stop(); };
      ss.speak(u);
    });
  });
  // closing the fold or leaving the page stops the voice
  document.addEventListener('toggle', function (e) { if (current && !e.target.open && e.target.contains(current)) stop(); }, true);
  window.addEventListener('pagehide', stop);
})();
