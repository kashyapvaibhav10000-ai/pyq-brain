// Subject search on the Priority page. Searches every question + its inline answer already in the page:
// no server call, works offline. Results list → one tap opens that question, scrolls to it, highlights matches.
// Highlighting uses the CSS Custom Highlight API (no DOM changes); older browsers just skip the colouring.
(function () {
  var input = document.getElementById('q-search');
  var out = document.getElementById('q-results');
  if (!input || !out) return;
  var hl = window.CSS && CSS.highlights && window.Highlight ? new Highlight() : null;
  if (hl) CSS.highlights.set('search', hl);
  var timer;

  function items() { return Array.prototype.slice.call(document.querySelectorAll('details.qi')); }
  function norm(s) { return s.toLowerCase(); }

  function ranges(root, term) {
    var res = [], walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = walk.nextNode())) {
      var t = norm(n.data), i = t.indexOf(term);
      while (i !== -1) {
        var r = new Range(); r.setStart(n, i); r.setEnd(n, i + term.length); res.push(r);
        i = t.indexOf(term, i + term.length);
      }
    }
    return res;
  }

  function paint(term) {
    if (!hl) return;
    hl.clear();
    if (!term) return;
    items().forEach(function (d) { ranges(d, term).forEach(function (r) { hl.add(r); }); });
  }

  function snippet(text, term) {
    var i = norm(text).indexOf(term);
    if (i < 0) return '';
    var a = Math.max(0, i - 40), b = Math.min(text.length, i + term.length + 60);
    return (a ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
  }

  function go(d, term) {
    // clear unit/marks filters so the question is visible, then open + scroll
    ['fu-all', 'fm-all'].forEach(function (id) { var r = document.getElementById(id); if (r) r.checked = true; });
    d.open = true;
    var first = term && ranges(d, term)[0];
    var target = first ? first.startContainer.parentElement : d;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    d.classList.add('hit');
    setTimeout(function () { d.classList.remove('hit'); }, 1600);
  }

  function run() {
    var term = norm(input.value.trim());
    out.textContent = '';
    paint(term.length > 1 ? term : '');
    if (term.length < 2) return;
    var hits = items().filter(function (d) { return norm(d.textContent).indexOf(term) !== -1; });
    var head = document.createElement('p');
    head.className = 'muted small';
    head.textContent = hits.length ? hits.length + (hits.length === 1 ? ' question matches' : ' questions match') : 'No match in this subject.';
    out.appendChild(head);
    hits.slice(0, 40).forEach(function (d) {
      var q = d.querySelector('.qt').textContent;
      var inQ = norm(q).indexOf(term) !== -1;
      var body = d.querySelector('.qbody');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hitrow';
      var t = document.createElement('span'); t.className = 'ht'; t.textContent = q;
      var m = document.createElement('span'); m.className = 'hm';
      var badge = d.querySelector('.badge');
      m.textContent = (badge ? badge.textContent.trim() + ' · ' : '') + (inQ ? 'in question' : 'in answer') +
        (!inQ && body ? ': ' + snippet(body.textContent, term) : '');
      b.appendChild(t); b.appendChild(m);
      b.addEventListener('click', function () { out.textContent = ''; input.blur(); go(d, term); }); // close list, keep highlights
      out.appendChild(b);
    });
  }

  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 150); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); var f = out.querySelector('.hitrow'); if (f) f.click(); }
    if (e.key === 'Escape') { input.value = ''; run(); }
  });
  document.body.addEventListener('htmx:afterSwap', run); // re-apply after Regroup / new answer
})();
