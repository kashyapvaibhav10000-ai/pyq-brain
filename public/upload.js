// PYQ Brain upload: resize images / render PDF pages client-side, then POST one page per request.
(() => {
  const MAX_EDGE = 1600, QUALITY = 0.7;
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/'; // version also in CSP (src/index.tsx PDFJS_SRC)
  const form = document.getElementById('up');
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const bar = $('bar'), log = $('log'), go = $('go'), retryBtn = $('retry');
  let paperId = 0, subject = '', failed = [], producers = [];

  const say = (msg, cls) => { const li = document.createElement('li'); li.textContent = msg; if (cls) li.className = cls; log.append(li); return li; };

  const toJpeg = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
  function canvasFor(w, h) {
    const s = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    return [c, ctx, s];
  }
  async function imagePage(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const [c, ctx] = canvasFor(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    return toJpeg(c);
  }
  let pdfjs;
  async function loadPdf() { // lazy: only fetched when a PDF is chosen
    if (!pdfjs) { pdfjs = await import(PDFJS + 'pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; }
    return pdfjs;
  }
  async function pdfPage(doc, i) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = MAX_EDGE / Math.max(v1.width, v1.height);
    const vp = page.getViewport({ scale });
    const [c, ctx] = canvasFor(vp.width, vp.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
    return toJpeg(c);
  }

  async function sendPage(i) {
    const li = say(`Page ${i + 1}/${producers.length}: preparing…`);
    try {
      const blob = await producers[i]();
      li.textContent = `Page ${i + 1}: uploading ${Math.round(blob.size / 1024)} KB, extracting…`;
      const res = await fetch(`/api/papers/${paperId}/pages/${i + 1}`, { method: 'POST', body: blob, headers: { 'content-type': 'image/jpeg' } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      li.textContent = `Page ${i + 1}: ${j.count} questions` + (j.low ? ` (${j.low} need review)` : '');
      return true;
    } catch (e) {
      li.textContent = `Page ${i + 1} failed: ${e.message}`; li.className = 'err';
      return false;
    }
  }

  async function run(indexes) {
    go.disabled = retryBtn.hidden = true; bar.hidden = false; bar.max = indexes.length; bar.value = 0;
    failed = [];
    for (const i of indexes) { if (!(await sendPage(i))) failed.push(i); bar.value++; }
    if (failed.length) { retryBtn.hidden = false; say(`${failed.length} page(s) failed. Retry, or continue anyway.`, 'err'); }
    const g = say('Grouping repeated questions…');
    const res = await fetch(`/subjects/${subject}/regroup`, { method: 'POST' });
    const txt = await res.text();
    g.textContent = txt.includes('Regroup failed') ? 'Grouping failed — use Regroup on Priority page.' : 'Grouping done.';
    const a = document.createElement('a'); a.href = `/review/${subject}?paper=${paperId}`; a.textContent = 'Review questions →';
    say('').append(a);
    go.disabled = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form), files = [...form.files.files];
    if (!files.length) return;
    log.textContent = ''; go.disabled = true; producers = [];
    subject = fd.get('subject');
    try {
      for (const f of files) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          say(`Loading PDF reader…`);
          const lib = await loadPdf();
          const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let i = 1; i <= doc.numPages; i++) producers.push(() => pdfPage(doc, i));
        } else producers.push(() => imagePage(f));
      }
      const body = new FormData();
      body.set('subject', subject); body.set('year', fd.get('year')); body.set('session', fd.get('session')); body.set('pages', producers.length);
      const res = await fetch('/api/papers', { method: 'POST', body });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      paperId = j.id;
    } catch (err) { say(`Error: ${err.message}`, 'err'); go.disabled = false; return; }
    await run(producers.map((_, i) => i));
  });
  retryBtn.addEventListener('click', () => run(failed));
})();
