import zipfile, re

zpath = r'C:\Users\FURSYS\Desktop\목재견적계산기\DD13R 멀티책상세트-STP 예시.zip'

X2_PAT = re.compile(r'\\X2\\([0-9A-Fa-f]+)\\X0\\')
def decode_x2(s):
    return X2_PAT.sub(lambda m: bytes.fromhex(m.group(1)).decode('utf-16-be', 'replace'), s)

def get_descs(data):
    return re.findall(
        r"DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)",
        data, re.IGNORECASE)

with zipfile.ZipFile(zpath) as zf:
    names = zf.namelist()

    # ── edge file ──────────────────────────────────────────────────
    ef = [n for n in names if 'door_l_e_prt' in n.lower()][0]
    data_e = zf.read(ef).decode('utf-8', errors='ignore')
    print('=== EDGE FILE:', ef)
    for k, v in get_descs(data_e):
        if any(x in k.upper() for x in ['MATERIAL','EDGE','THICK','PART','ITEM','NAME','TYPE']):
            print(f'  {k!r:30s} -> {decode_x2(v)!r}')

    # ── back_bot board CIRCLE breakdown ───────────────────────────
    bf = [n for n in names if 'back_bot_prt.stp' in n.lower()][0]
    data_b = zf.read(bf).decode('utf-8', errors='ignore')
    c_only  = [float(r) for r in re.findall(r"CIRCLE\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*([\d.E+\-]+)\s*\)", data_b, re.IGNORECASE)]
    cy_only = [float(r) for r in re.findall(r"CYLINDRICAL_SURFACE\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*([\d.E+\-]+)\s*\)", data_b, re.IGNORECASE)]
    print(f'\n=== back_bot CIRCLE r=2-6: {sum(1 for r in c_only if 2<=r<=6)}  unique:{sorted(set(round(r,2) for r in c_only if 2<=r<=6))}')
    print(f'    CYLINDRICAL r=2-6: {sum(1 for r in cy_only if 2<=r<=6)}')
    for k,v in get_descs(data_b):
        if 'HOLE' in k.upper() or 'BORING' in k.upper():
            print(f'  HOLE desc: {k!r} -> {v!r}')

    # ── PART_NAME decode for 3 files ─────────────────────────────
    for fn_key in ['back_bot_prt.stp', 'door_l_prt.stp', 'felt-brd-1_prt.stp']:
        matches = [n for n in names if fn_key.lower() in n.lower()]
        if not matches:
            continue
        data_x = zf.read(matches[0]).decode('utf-8', errors='ignore')
        for k,v in get_descs(data_x):
            if k in ('PART_NAME', 'ITEM_NAME', 'MATERIAL', 'NAME'):
                print(f'\n[{fn_key}] {k}: {decode_x2(v)!r}')
