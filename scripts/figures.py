"""Build answer figures (chemical structures + synthesis schemes) as SVG into public/fig/.

Dev tool, run locally (needs RDKit in a venv; not an app dependency):
    python3 -m venv /tmp/figvenv && /tmp/figvenv/bin/pip install rdkit
    /tmp/figvenv/bin/python scripts/figures.py            # all figures in data/figures.json
    /tmp/figvenv/bin/python scripts/figures.py slug1 slug2  # only these

Every molecule is looked up on PubChem by name (the only data sent out is the drug name) and must match the
molecular formula written in the manifest ("formula"), so a wrong name or a wrong PubChem hit fails loudly.
Structures are computed from PubChem's SMILES and drawn by RDKit, never traced from the (often imperfect) notes.
Reagents/conditions on scheme arrows come from the student's notes (cited in the manifest "src").

Hand-drawn diagrams (kind "svg") are written directly as public/fig/<slug>.svg and are only checked here.
Colors: every SVG uses var(--i) (ink) with a light/dark <style>, so it reads in both themes as an <img>.
"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Chem.rdMolDescriptors import CalcMolFormula

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data' / 'figures.json'
OUT = ROOT / 'public' / 'fig'
CACHE = ROOT / 'data' / 'pubchem-cache.json'  # name -> {cid, smiles, formula}; keeps reruns offline and stable
STYLE = ('<style>:root{--i:#2a2420;--a:#c2412d;--b:#2c4f9e;--g:#3b7a4b}'
         '@media (prefers-color-scheme:dark){:root{--i:#ece4d6;--a:#ff917c;--b:#9fb8f2;--g:#86cf98}}'
         'text{font-family:"Helvetica Neue",Arial,sans-serif;fill:var(--i)}</style>')
FONT = 13

rdDepictor.SetPreferCoordGen(True)
cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}


def pubchem(name: str) -> dict:
    if name in cache:
        return cache[name]
    url = ('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + urllib.parse.quote(name)
           + '/property/SMILES,IsomericSMILES,MolecularFormula/JSON')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'figures-script'}), timeout=30) as r:
        p = json.load(r)['PropertyTable']['Properties'][0]
    time.sleep(0.25)  # PubChem asks for <= 5 requests/second
    cache[name] = {'cid': p['CID'], 'smiles': p.get('SMILES') or p['IsomericSMILES'], 'formula': p['MolecularFormula']}
    CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True))
    return cache[name]


def mol_svg(m: dict) -> tuple[str, float, float]:
    """One molecule → (inner svg, width, height). m: {name, pubchem?, formula, smiles?, label?}."""
    if 'smiles' in m:  # rare: a fragment/intermediate that PubChem names badly; still formula-checked
        smi, cid = m['smiles'], 'manual'
    else:
        hit = pubchem(m.get('pubchem', m['name']))
        smi, cid = hit['smiles'], hit['cid']
    mol = Chem.MolFromSmiles(smi)
    frags = Chem.GetMolFrags(mol, asMols=True)
    mol = max(frags, key=lambda f: f.GetNumHeavyAtoms())  # drop salt / counter-ion (HCl, Na+, …)
    for a in mol.GetAtoms():
        if a.GetAtomicNum() == 0:  # "*" = attachment point, drawn with a text label (e.g. "DNA", "R")
            a.SetProp('atomLabel', m.get('dummy', 'R'))
        if m.get('numbering'):  # steroid numbering: SMILES atom order == C1, C2, …
            a.SetProp('atomNote', str(a.GetIdx() + 1))
    got = CalcMolFormula(mol)
    if m.get('formula') and got != m['formula']:
        sys.exit(f"FORMULA MISMATCH {m['name']}: PubChem CID {cid} gives {got}, manifest expects {m['formula']}")
    if m.get('nostereo'):  # crowded polycycles (e.g. digoxin): stereo-H labels collide; exam drawings omit them
        Chem.RemoveStereochemistry(mol)
    rdDepictor.Compute2DCoords(mol)
    d = rdMolDraw2D.MolDraw2DSVG(-1, -1)
    o = d.drawOptions()
    o.clearBackground = False
    o.useBWAtomPalette()
    o.fixedBondLength = m.get('bond', 24)
    o.bondLineWidth = 1.4
    o.minFontSize = 11
    o.padding = 0.06
    o.annotationFontScale = 0.75
    d.DrawMolecule(mol)
    d.FinishDrawing()
    s = d.GetDrawingText()
    w, h = (float(x) for x in re.search(r"width='([\d.]+)px' height='([\d.]+)px'", s).groups())
    inner = re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', s, flags=re.S)
    inner = re.sub(r'<\?xml[^>]*>|<!--.*?-->|<rect[^>]*/>', '', inner, flags=re.S)
    inner = re.sub(r'#[0-9A-Fa-f]{6}', 'var(--i)', inner)  # one ink for everything (themes via --i)
    print(f"  {m['name']}: CID {cid}, {got} ✓")
    return inner, w, h


def text(x, y, s, size=FONT, anchor='middle', cls=''):
    s = str(s)
    s = s.replace('&', '&amp;').replace('<', '&lt;')
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" text-anchor="{anchor}"{cls}>{s}</text>'


def tw(s: str, size=12) -> float:
    """Rough text width (Helvetica-ish): keeps labels inside the picture."""
    return len(s) * size * 0.56


def wrap(name: str, width: float) -> list[str]:
    """Split a long compound name over lines no wider than `width` (breaks at spaces, then after hyphens)."""
    if tw(name) <= width:
        return [name]
    words, lines, cur = re.split(r'(?<=[ -])', name), [], ''
    for w_ in words:
        if cur and tw(cur + w_) > width:
            lines.append(cur.rstrip()); cur = w_
        else:
            cur += w_
    return lines + [cur.rstrip()] if cur else lines


def label(x, y, name, width):
    lines = wrap(name, width)
    return ''.join(text(x, y + i * 14, ln, 12) for i, ln in enumerate(lines)), len(lines)


def place(inner, x, y, w, h):
    return f'<svg x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" viewBox="0 0 {w:.1f} {h:.1f}" overflow="visible">{inner}</svg>'


def row(items: list, gap=18):
    """Molecules side by side ('+' between when plus=True) with names under them. Returns (svg, w, h)."""
    parts, x, H, extra = [], 0.0, 0.0, 0
    drawn = [(mol_svg(m), m) for m in items]
    H = max(h for (_, _, h), _ in drawn)
    for i, ((inner, w, h), m) in enumerate(drawn):
        if i:
            parts.append(text(x + gap / 2 + 4, H / 2 + 5, '+', 18)); x += gap + 8
        name = m.get('label', m['name'])
        slot = max(w, min(tw(name), max(w, 170)) + 6)  # long names wrap (max ~170px) instead of widening forever
        parts.append(place(inner, x + (slot - w) / 2, (H - h) / 2, w, h))
        if name:
            svg, n = label(x + slot / 2, H + 16, name, slot)
            parts.append(svg); extra = max(extra, n - 1)
        x += slot
    return ''.join(parts), x, H + 22 + 14 * extra


def arrow(width, y, label_top='', label_bottom='', down=True):
    """Vertical reaction arrow with conditions beside it (phone-friendly vertical schemes)."""
    cx = width / 2
    s = (f'<line x1="{cx}" y1="{y}" x2="{cx}" y2="{y + 44}" stroke="var(--i)" stroke-width="1.6"/>'
         f'<path d="M{cx - 5} {y + 37} L{cx} {y + 46} L{cx + 5} {y + 37}" fill="none" stroke="var(--i)" stroke-width="1.6"/>')
    if label_top:
        s += text(cx + 12, y + 20, label_top, 12, 'start')
    if label_bottom:
        s += text(cx + 12, y + 36, label_bottom, 12, 'start')
    return s, 52


COL = {'r': 'var(--a)', 'b': 'var(--b)', 'g': 'var(--g)'}


def lines_svg(x, y, lines, size=12, anchor='middle', color=None, weight=None, lh=None):
    lh = lh or size + 3
    attrs = (f' style="fill:{color}"' if color else '') + (f' font-weight="{weight}"' if weight else '')
    return ''.join(text(x, y + i * lh, ln, size, anchor, attrs) for i, ln in enumerate(lines))


def flow(fig: dict):
    """Vertical flowchart for phones: boxes joined by arrows; 'via' = label on the arrow into a box,
    'side' = note to the right of a box, 'hl' = r/g/b emphasis, optional 'fan' = boxes the last step splits into."""
    W = 360
    steps = [st if isinstance(st, dict) else {'t': st} for st in fig['steps']]
    has_side = any('side' in st for st in steps)
    BW = 200 if has_side else 300
    x0 = 8 if has_side else (W - BW) / 2
    cx = x0 + BW / 2
    parts, y = [], 4.0
    for i, st in enumerate(steps):
        if i:
            via = wrap(st['via'], W - cx - 14) if st.get('via') else []
            gap = max(28, 15 * len(via) + 14)
            parts.append(f'<line x1="{cx}" y1="{y}" x2="{cx}" y2="{y + gap - 2}" stroke="var(--i)" stroke-width="1.5"/>'
                         f'<path d="M{cx - 5} {y + gap - 9} L{cx} {y + gap - 1} L{cx + 5} {y + gap - 9}" fill="none" stroke="var(--i)" stroke-width="1.5"/>')
            if via:
                parts.append(lines_svg(cx + 8, y + (gap - 15 * len(via)) / 2 + 11, via, 11, 'start', 'var(--b)'))
            y += gap
        ls = wrap(st['t'], BW - 16)
        sd = (st['side'] if isinstance(st['side'], dict) else {'t': st['side']}) if st.get('side') else None
        sl = wrap(sd['t'], W - x0 - BW - 20) if sd else []
        h = max(12 + 15 * len(ls), 15 * len(sl) + 8)  # box grows to its side note, so arrows stay attached
        stroke = COL.get(st.get('hl'), 'var(--i)')
        parts.append(f'<rect x="{x0}" y="{y:.1f}" width="{BW}" height="{h}" rx="6" fill="none" stroke="{stroke}" stroke-width="{2.2 if st.get("hl") else 1.5}"/>')
        parts.append(lines_svg(cx, y + h / 2 - 15 * len(ls) / 2 + 11, ls, 12, 'middle', COL.get(st.get('hl')), 700 if st.get('bold') else None))
        if sd:
            parts.append(f'<line x1="{x0 + BW}" y1="{y + h / 2:.1f}" x2="{x0 + BW + 8}" y2="{y + h / 2:.1f}" stroke="{COL.get(sd.get("c"), "var(--i)")}" stroke-width="1.3" stroke-dasharray="3 2"/>')
            parts.append(lines_svg(x0 + BW + 12, y + h / 2 - 15 * len(sl) / 2 + 11, sl, 11, 'start', COL.get(sd.get('c'))))
        y += h
    if fig.get('fan'):
        n = len(fig['fan']); fw = (W - 16 - 8 * (n - 1)) / n; top = y + 34
        fls = [wrap(t, fw - 12) for t in fig['fan']]; fh = 12 + 15 * max(len(l) for l in fls)
        for k, ls in enumerate(fls):
            fx = 8 + k * (fw + 8); fcx = fx + fw / 2
            parts.append(f'<path d="M{cx} {y} L{fcx:.1f} {top - 2}" stroke="var(--i)" stroke-width="1.3" fill="none"/>'
                         f'<circle cx="{fcx:.1f}" cy="{top - 2}" r="2" fill="var(--i)"/>'
                         f'<rect x="{fx:.1f}" y="{top}" width="{fw:.1f}" height="{fh}" rx="6" fill="none" stroke="var(--i)" stroke-width="1.5"/>'
                         + lines_svg(fcx, top + 18, ls, 11.5))
        y = top + fh
    return ''.join(parts), W, y + 4


def tree(fig: dict):
    """Classification chart: root title, then group cards in two masonry columns."""
    W, gap = 360, 10
    cw = (W - 16 - gap) / 2
    rl = wrap(fig['root'], W - 40)
    parts = [f'<rect x="8" y="2" width="{W - 16}" height="{12 + 15 * len(rl)}" rx="6" fill="var(--b)" fill-opacity=".14" stroke="var(--b)" stroke-width="1.5"/>',
             lines_svg(W / 2, 20, rl, 13, 'middle', None, 700)]
    colY = [24 + 15 * len(rl)] * 2
    for g in fig['groups']:
        c = 0 if colY[0] <= colY[1] else 1
        x, y = 8 + c * (cw + gap), colY[c]
        hl = wrap(g['name'], cw - 12)
        items = [ln for it in g['items'] for ln in (lambda w: [('• ' + w[0])] + ['  ' + r for r in w[1:]])(wrap(it, cw - 22))]
        hh = 8 + 14 * len(hl); h = hh + 8 + 14 * len(items)
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cw:.1f}" height="{h}" rx="6" fill="none" stroke="var(--i)" stroke-width="1.4"/>'
                     f'<path d="M{x:.1f} {y + hh:.1f} H{x + cw:.1f}" stroke="var(--i)" stroke-width="1"/>'
                     + lines_svg(x + cw / 2, y + 16, hl, 12, 'middle', 'var(--b)', 700, 14)
                     + lines_svg(x + 7, y + hh + 15, items, 11.5, 'start', None, None, 14))
        colY[c] = y + h + gap
    return ''.join(parts), W, max(colY)


def bars(fig: dict):
    """Horizontal range bars (e.g. % composition)."""
    W, lx, bx = 360, 8, 150
    mx = fig.get('max', max(it['hi'] for it in fig['items']))
    parts, y = [], 4
    for it in fig['items']:
        ls = wrap(it['label'], bx - lx - 6)
        h = max(24, 15 * len(ls) + 8)
        x1 = bx + (W - bx - 60) * it['lo'] / mx; x2 = bx + (W - bx - 60) * it['hi'] / mx
        parts.append(lines_svg(lx, y + h / 2 - 15 * len(ls) / 2 + 11, ls, 11.5, 'start')
                     + f'<rect x="{bx}" y="{y + h / 2 - 7:.1f}" width="{x1 - bx:.1f}" height="14" fill="var(--b)" fill-opacity=".25"/>'
                     f'<rect x="{x1:.1f}" y="{y + h / 2 - 7:.1f}" width="{max(x2 - x1, 2):.1f}" height="14" fill="var(--b)" fill-opacity=".6"/>'
                     + text(x2 + 6, y + h / 2 + 4, f"{it['lo']}–{it['hi']}{fig.get('unit', '%')}" if it['lo'] != it['hi'] else f"{it['hi']}{fig.get('unit', '%')}", 11, 'start'))
        y += h + 4
    return ''.join(parts), W, y


def build(fig: dict) -> str:
    if fig['kind'] in ('flow', 'tree', 'bars'):
        body, W, H = {'flow': flow, 'tree': tree, 'bars': bars}[fig['kind']](fig)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H:.0f}" width="{W}" height="{H:.0f}" role="img" '
                f'aria-label="{fig["caption"].replace("&", "&amp;").replace(chr(34), "&quot;")}">{STYLE}{body}</svg>\n')
    blocks, W, y = [], 0.0, 0.0
    if fig['kind'] == 'mols':  # grid of named structures, 2 per row
        rows = [fig['mols'][i:i + fig.get('per_row', 2)] for i in range(0, len(fig['mols']), fig.get('per_row', 2))]
        for r in rows:
            parts, x, H = [], 0.0, 0.0
            for m in r:
                inner, w, h = mol_svg(m)
                parts.append((inner, x, w, h, m)); x += w + 28; H = max(H, h)
            extra = 0
            for inner, px, w, h, m in parts:
                blocks.append(place(inner, px, y + (H - h) / 2, w, h))
                svg, n = label(px + w / 2, y + H + 16, m.get('label', m['name']), max(w, 170))
                blocks.append(svg); extra = max(extra, n - 1)
            y += 14 * extra
            W = max(W, x - 28); y += H + 34
    elif fig['kind'] == 'scheme':  # steps: {"mols":[...]} or {"arrow":"top|bottom"}
        pending = []
        for st in fig['steps']:
            if 'mols' in st:
                svg, w, h = row(st['mols'])
                pending.append(('row', svg, w, h))
            else:
                top, _, bottom = st['arrow'].partition('|')
                pending.append(('arrow', top, bottom))
        W = max(p[2] for p in pending if p[0] == 'row')
        for p in pending:  # arrow conditions sit right of the centre arrow: make room so they never clip
            if p[0] == 'arrow':
                W = max(W, 2 * (12 + max(tw(p[1]), tw(p[2]))) + 8)
        for p in pending:
            if p[0] == 'row':
                blocks.append(f'<g transform="translate({(W - p[2]) / 2:.1f},{y:.1f})">{p[1]}</g>'); y += p[3] + 4
            else:
                s, h = arrow(W, y, p[1], p[2]); blocks.append(s); y += h
    else:
        raise SystemExit(f"unknown kind {fig['kind']}")
    pad = 8
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W + 2 * pad:.0f} {y + pad:.0f}" '
            f'width="{W + 2 * pad:.0f}" height="{y + pad:.0f}" role="img" aria-label="{fig["caption"].replace("&", "&amp;").replace(chr(34), "&quot;")}">'
            f'{STYLE}{"".join(blocks)}</svg>\n')


def main():
    figs = json.loads(MANIFEST.read_text())
    only = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, fig in figs.items():
        if only and slug not in only:
            continue
        if fig['kind'] == 'svg':  # hand-drawn diagram: must exist and use the theme variables
            f = OUT / f'{slug}.svg'
            ok = f.exists() and 'var(--i)' in f.read_text()
            print(f'{slug}: hand-drawn diagram {"✓" if ok else "MISSING or not themed"}')
            continue
        print(f'{slug}:')
        (OUT / f'{slug}.svg').write_text(build(fig))
    print('done')


if __name__ == '__main__':
    main()
