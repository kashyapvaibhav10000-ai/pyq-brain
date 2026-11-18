#!/usr/bin/env python3
"""One-time OCR of scanned Noteskart notes -> data/notes.sql (import into D1 `notes`).

Runs on your PC, not in the Worker (no PDF/image work in the Worker).
Needs: poppler (pdftoppm, pdfinfo), tesseract + .tessdata/eng.traineddata.

  python3 scripts/notes_ocr.py            # OCR every PDF under noteskart/
  npm run notes:import:local              # load into local D1 (…:remote for Cloudflare)

Folder name -> subject code below. Unit from the "UNIT-n" in the file name.
Output text is cleaned of the Noteskarts header/footer/watermark lines.
"""
import os, re, subprocess, sys, tempfile, json
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTES = os.path.join(ROOT, 'noteskart')
OUT = os.path.join(ROOT, 'data', 'notes.sql')
TESSDATA = os.path.join(ROOT, '.tessdata')
USER = 'me'
FOLDERS = {
    'medicinal chemistry': 'BP501T',
    'industrial-pharmacy': 'BP502T',
    'pharmacology': 'BP503T',
    'pharmacognosy': 'BP504T',
    'jurisprudence': 'BP505T',
}
JUNK = re.compile(
    r'noteskart|subscribe\s*&|visit our website|for notes regular|page\s*\|\s*\d+|^\s*unit\s*-?\s*\d\s*$',
    re.I,
)


def clean(text: str) -> str:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s or JUNK.search(s):
            out.append('')
            continue
        if sum(ch.isalnum() for ch in s) < 3:  # OCR noise from drawn structures/arrows
            continue
        s = re.sub(r'^[«•●▪◦eo©®*]\s+', '- ', s)  # bullets tesseract misreads
        out.append(s)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()


def ocr_page(pdf: str, page: int) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'p')
        subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-r', '200', '-gray', '-png', '-singlefile', pdf, base], check=True)
        r = subprocess.run(
            ['tesseract', base + '.png', '-', '-l', 'eng', '--psm', '4'],
            capture_output=True, text=True, env={**os.environ, 'TESSDATA_PREFIX': TESSDATA, 'OMP_THREAD_LIMIT': '1'},
        )
        return clean(r.stdout)


def pages(pdf: str) -> int:
    info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True, check=True).stdout
    return int(re.search(r'^Pages:\s+(\d+)', info, re.M).group(1))


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main():
    jobs = []
    for folder, code in FOLDERS.items():
        d = os.path.join(NOTES, folder)
        if not os.path.isdir(d):
            print(f'skip missing folder: {folder}', file=sys.stderr)
            continue
        for f in sorted(os.listdir(d)):
            m = re.search(r'UNIT-(\d)', f, re.I)
            if not f.lower().endswith('.pdf') or not m:
                continue
            pdf = os.path.join(d, f)
            for p in range(1, pages(pdf) + 1):
                jobs.append((code, int(m.group(1)), f, pdf, p))
    print(f'{len(jobs)} pages to OCR', flush=True)
    done = [0]

    def run(job):
        code, unit, name, pdf, p = job
        text = ocr_page(pdf, p)
        done[0] += 1
        if done[0] % 25 == 0:
            print(f'{done[0]}/{len(jobs)}', flush=True)
        return (code, unit, p, name, text)

    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        rows = list(ex.map(run, jobs))

    rows = [r for r in rows if len(r[4]) >= 40]  # drop blank/cover pages
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        fh.write(f"DELETE FROM notes WHERE user_id = '{USER}';\n")
        for code, unit, p, name, text in rows:
            fh.write(
                f'INSERT INTO notes (user_id, subject_code, unit, page_no, source, text) VALUES '
                f"('{USER}', '{code}', {unit}, {p}, {sql_str(name)}, {sql_str(text)});\n"
            )
    summary = {}
    for code, unit, *_ in rows:
        summary.setdefault(code, {}).setdefault(unit, 0)
        summary[code][unit] += 1
    print(json.dumps(summary, indent=1, sort_keys=True))
    print(f'wrote {len(rows)} pages -> {OUT}')


if __name__ == '__main__':
    main()
