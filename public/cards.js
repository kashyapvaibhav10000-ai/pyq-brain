// Flashcards (2-mark questions). Leitner boxes, saved in localStorage per subject; works offline.
// Box 1 = due again this session; "knew it" moves up a box: 1 day, 3, 7, 14 days. "Didn't know" → box 1.
(function () {
  var deck = document.getElementById('deck');
  if (!deck) return;
  var KEY = 'pyq-cards-' + deck.dataset.code;
  var DAYS = [0, 0, 1, 3, 7, 14]; // index = box
  var cards = Array.prototype.slice.call(deck.querySelectorAll('.fcard'));
  var flip = document.getElementById('btn-flip'), hit = document.getElementById('btn-hit'), miss = document.getElementById('btn-miss');
  var stats = document.getElementById('deck-stats'), done = document.getElementById('deck-done');
  var unit = 'all', queue = [], cur = null, practiseAll = false;
  var st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function rec(c) { return st[c.dataset.id] || { box: 0, due: 0 }; }
  function inUnit(c) { return unit === 'all' || c.dataset.unit === unit; }
  function due(c) { return practiseAll || rec(c).due <= Date.now(); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function build() {
    var pool = cards.filter(function (c) { return inUnit(c) && due(c); });
    // missed/learning first, then new, each shuffled
    var learn = pool.filter(function (c) { var r = rec(c); return r.box > 0; });
    var fresh = pool.filter(function (c) { return rec(c).box === 0; });
    queue = shuffle(learn).sort(function (a, b) { return rec(a).box - rec(b).box; }).concat(shuffle(fresh));
  }
  function count() {
    var mine = cards.filter(inUnit), m = 0, l = 0, n = 0;
    mine.forEach(function (c) { var b = rec(c).box; if (b >= 4) m++; else if (b > 0) l++; else n++; });
    stats.textContent = queue.length + ' to go · ' + m + ' mastered · ' + l + ' learning · ' + n + ' new';
  }
  function show() {
    cards.forEach(function (c) { c.hidden = true; c.classList.remove('flipped', 'deal'); });
    cur = queue.shift() || null;
    done.hidden = !!cur;
    flip.disabled = !cur; hit.disabled = miss.disabled = true;
    if (cur) { cur.hidden = false; void cur.offsetWidth; cur.classList.add('deal'); }
    count();
  }
  function turn() {
    if (!cur) return;
    var f = cur.classList.toggle('flipped');
    hit.disabled = miss.disabled = !f;
    flip.textContent = f ? 'Flip back' : 'Flip';
  }
  function grade(ok) {
    if (!cur || !cur.classList.contains('flipped')) return;
    var r = rec(cur), box = ok ? Math.min(5, Math.max(1, r.box) + 1) : 1;
    st[cur.dataset.id] = { box: box, due: Date.now() + DAYS[box] * 864e5 };
    save();
    if (!ok) queue.splice(Math.min(3, queue.length), 0, cur); // see it again soon in this session
    var leaving = cur; leaving.classList.add(ok ? 'toss-r' : 'toss-l');
    flip.textContent = 'Flip';
    setTimeout(function () { leaving.classList.remove('toss-r', 'toss-l'); show(); }, 260);
  }
  cards.forEach(function (c) { c.querySelector('.fcard-in').addEventListener('click', turn); });
  flip.addEventListener('click', turn);
  hit.addEventListener('click', function () { grade(true); });
  miss.addEventListener('click', function () { grade(false); });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); turn(); }
    if (e.key === '1') grade(false);
    if (e.key === '2') grade(true);
  });
  Array.prototype.forEach.call(deck.querySelectorAll('.chipbtn'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(deck.querySelectorAll('.chipbtn'), function (x) { x.classList.toggle('on', x === b); });
      unit = b.dataset.unit; practiseAll = false; build(); show();
    });
  });
  document.getElementById('deck-more').addEventListener('click', function () { practiseAll = true; build(); show(); });
  document.getElementById('deck-reset').addEventListener('click', function () {
    if (!confirm('Reset flashcard progress for this subject?')) return;
    st = {}; save(); practiseAll = false; build(); show();
  });
  build(); show();
})();
