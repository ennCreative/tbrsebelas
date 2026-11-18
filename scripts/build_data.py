#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build data Dashboard Transaction Banking Retail (TBR) Region XI.

Membaca 3 file Excel produk TBR (ATM, EDC/Merchant, LVM) dari folder sumber,
mengolahnya menjadi data ringkas, lalu MENGENKRIPSI hasilnya (AES-256-GCM)
sehingga data di GitHub hanya bisa dibuka dengan Kode Login yang valid.

Pemakaian:
    python scripts/build_data.py                    # sumber = folder induk repo
    python scripts/build_data.py --source "E:\\Database TBR"

File yang dicari otomatis (berdasarkan nama, diambil yang paling baru):
    ATM*.xlsx       -> sheet Series_ATM_<tahun>
    Merchant*.xlsx  -> sheet MASTER            (EDC)
    LVM*.xlsx       -> sheet Master All Merchant & Target Cabang
"""
import argparse, base64, calendar, csv, datetime as dt, glob, gzip, hashlib, json, os, re, secrets, sys

import pandas as pd

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
except ImportError:
    sys.exit("Library 'cryptography' belum terpasang. Jalankan: pip install -r requirements.txt")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
AREA_BY_CODE = {"145": "AREA DENPASAR", "161": "AREA MATARAM", "175": "AREA KUTA", "181": "AREA KUPANG"}
PBKDF2_ITER = 310000


def log(*a):
    print("[build]", *a, flush=True)


def read_excel(path, sheet, header=None):
    for eng in ("calamine", "openpyxl"):
        try:
            return pd.read_excel(path, sheet_name=sheet, header=header, engine=eng)
        except ImportError:
            continue
    raise RuntimeError("Butuh python-calamine atau openpyxl")


def sheet_names(path):
    try:
        from python_calamine import CalamineWorkbook
        return CalamineWorkbook.from_path(path).sheet_names
    except ImportError:
        import openpyxl
        return openpyxl.load_workbook(path, read_only=True).sheetnames


def with_header(raw, key):
    """Cari baris yang mengandung `key` lalu jadikan header."""
    for i in range(min(30, len(raw))):
        if key in [str(x).strip() for x in raw.iloc[i].tolist()]:
            cols, seen = [], {}
            for c in raw.iloc[i].tolist():
                c = str(c).strip() if c is not None and str(c) != "nan" else "_"
                if c in seen:
                    seen[c] += 1
                    c = f"{c}.{seen[c]}"
                else:
                    seen[c] = 0
                cols.append(c)
            df = raw.iloc[i + 1:].copy()
            df.columns = cols
            return df.reset_index(drop=True)
    raise ValueError(f"Header '{key}' tidak ditemukan")


def num(s):
    return pd.to_numeric(s, errors="coerce").fillna(0)


def code(v):
    try:
        return str(int(float(v)))
    except (TypeError, ValueError):
        return ""


def r(x):
    x = float(x)
    return int(round(x)) if abs(x) >= 100 else round(x, 2)


def find_file(src, pattern):
    files = [f for f in glob.glob(os.path.join(src, pattern)) if not os.path.basename(f).startswith("~$")]
    if not files:
        sys.exit(f"File '{pattern}' tidak ditemukan di {src}")
    return max(files, key=os.path.getmtime)


# ----------------------------------------------------------------- CABANG / TARGET
def build_targets(lvm_path):
    raw = read_excel(lvm_path, "Target Cabang")
    branches, area_tgt = {}, {}
    for _, row in raw.iterrows():
        v = row.tolist()
        k = code(v[2]) if len(v) > 2 else ""
        if not k:
            continue
        if len(k) == 5 and str(v[0]).strip().isdigit():
            branches[k] = dict(area=str(v[1]).strip().upper(), kelas=str(v[3]).strip(), nama=str(v[4]).strip(),
                               tAkMtd=float(num(pd.Series([v[6]]))[0]), tEdcMtd=float(num(pd.Series([v[7]]))[0]),
                               tAkFy=float(num(pd.Series([v[8]]))[0]), tEdcFy=float(num(pd.Series([v[9]]))[0]),
                               tUsak=float(num(pd.Series([v[10]]))[0]))
        elif len(k) == 3:
            area_tgt[k] = str(v[4]).strip().upper()
    AREA_BY_CODE.update(area_tgt)
    return branches


def norm_area(v):
    s = str(v).upper().strip()
    m = re.match(r"(\d{3})", s)
    if m and m.group(1) in AREA_BY_CODE:
        return AREA_BY_CODE[m.group(1)]
    for a in AREA_BY_CODE.values():
        if a.split()[-1] in s:
            return a
    return s if s and s != "NAN" else "LAINNYA"


# ----------------------------------------------------------------- ATM
def build_atm(path, branch_names):
    names = sheet_names(path)
    years = sorted(int(m.group(1)) for n in names if (m := re.match(r"Series_ATM_(\d{4})$", n)))
    cy = years[-1]
    log(f"ATM: {os.path.basename(path)} | sheet Series_ATM_{cy}")
    df = with_header(read_excel(path, f"Series_ATM_{cy}"), "ID_Mesin")
    df = df[df["ID_Mesin"].notna() & (df["ID_Mesin"].astype(str).str.strip() != "")]
    area_col = "Area2" if "Area2" in df.columns else "Area"
    name_col = "Nama_Lokasi.1" if "Nama_Lokasi.1" in df.columns else "Nama_Lokasi"

    def mcol(prefix, m):
        c = f"{prefix} {m}"
        return num(df[c]) if c in df.columns else pd.Series(0, index=df.index)

    trx = {m: mcol("Trx", m) for m in MONTHS}
    last = max([i for i, m in enumerate(MONTHS) if trx[m].sum() > 0] or [0])
    machines = []
    for idx, row in df.iterrows():
        k = code(row.get("Cab_Mapping"))
        branch_names.setdefault(k, "")
        kq = row.get(f"Kuadran {MONTHS[last]}")
        machines.append(dict(
            id=str(row["ID_Mesin"]).strip(), nm=str(row.get(name_col, "")).strip(),
            j=str(row.get("Jenis_ATM", "")).strip(), ms=str(row.get("Jenis_Mesin", "")).strip(),
            g=str(row.get("Group_Lokasi", "")).strip(), kt=str(row.get("Kota", "")).strip(),
            a=norm_area(row.get(area_col)), c=k,
            q=str(kq).strip() if pd.notna(kq) else "-",
            t=[r(trx[m][idx]) for m in MONTHS[:last + 1]],
            v=[r(mcol("Volume", m)[idx]) for m in MONTHS[:last + 1]],
            f=[r(mcol("FBI", m)[idx]) for m in MONTHS[:last + 1]],
            ts=[r(mcol("Trx Setor Tunai", m)[idx]) for m in MONTHS[:last + 1]],
            vs=[r(mcol("Volume Setor Tunai", m)[idx]) for m in MONTHS[:last + 1]],
        ))
    prev = []
    if cy - 1 in years:
        p = with_header(read_excel(path, f"Series_ATM_{cy-1}"), "ID_Mesin")
        p = p[p["ID_Mesin"].notna()]
        p["_a"] = p["Area2" if "Area2" in p.columns else "Area"].map(norm_area)
        p["_j"] = p["Jenis_ATM"].astype(str).str.strip()
        p["_g"] = p["Group_Lokasi"].astype(str).str.strip()
        for (a, j, g), grp in p.groupby(["_a", "_j", "_g"]):
            prev.append(dict(a=a, j=j, g=g,
                             t=[r(num(grp[f"Trx {m}"]).sum()) if f"Trx {m}" in grp else 0 for m in MONTHS],
                             v=[r(num(grp[f"Volume {m}"]).sum()) if f"Volume {m}" in grp else 0 for m in MONTHS],
                             f=[r(num(grp[f"FBI {m}"]).sum()) if f"FBI {m}" in grp else 0 for m in MONTHS],
                             n=int(len(grp))))
    log(f"ATM: {len(machines)} mesin, data s.d. {MONTHS[last]} {cy}")
    return dict(year=cy, last=last, machines=machines, prev=prev)


# ----------------------------------------------------------------- EDC
def build_edc(path, branch_names):
    log(f"EDC: {os.path.basename(path)} | sheet MASTER")
    df = with_header(read_excel(path, "MASTER"), "norekening")
    df = df[df["area"].notna() & (df["area"].astype(str).str.strip() != "")].copy()
    wk = sorted((int(m.group(2)), int(m.group(1))) for c in df.columns if (m := re.match(r"YTD SV W(\d+) (\d{4})$", c)) and m.group(1) != "52")
    cy, w = wk[-1]
    py = cy - 1
    log(f"EDC: {len(df)} rekening, data YTD W{w} {cy}")

    def col(name):
        return num(df[name]) if name in df.columns else pd.Series(0.0, index=df.index)

    M = {
        "sv": col(f"YTD SV W{w} {cy}"), "svp": col(f"YTD SV W{w} {py}"),
        "md": col(f"YTD MDFG W{w} {cy}"), "mdp": col(f"YTD MDFG W{w} {py}"),
        "tx": col(f"YTD TRX W{w} {cy}"), "txp": col(f"YTD TRX W{w} {py}"),
        "fd": col(f"Avg Fund W{w} {cy}"), "fdp": col(f"Avg Fund W{w} {py}"),
        "sw": col(f"SV W{w} {cy}"), "swp": col(f"SV W{w-1} {cy}"),
    }
    df["_merch"] = col("merch")
    df["_edc"] = col("edc")
    df["_new"] = ((col("active") == cy) & (df["_merch"] > 0)).astype(int)
    for k, s in M.items():
        df["_" + k] = s
    df["_a"] = df["area"].map(norm_area)
    df["_c"] = df["cd_cbg"].map(code)
    df["_s"] = df["Segmen TBRS"].fillna("Lainnya").astype(str).str.replace(r"^\d+\.\s*", "", regex=True).str.strip().str.upper()
    lobf = "LOB (5 FOCUS URBAN LIFESTYLE)"
    df["_l"] = df[lobf].fillna("Lainnya").astype(str).str.replace(r"^\d+\.\s*", "", regex=True).str.strip() if lobf in df else "Lainnya"
    df["_tp"] = df["Tipe Perusahaan"].fillna("-").astype(str)
    for c, n in zip(df["_c"], df["cbg"]):
        if c and not branch_names.get(c) and pd.notna(n):
            branch_names[c] = str(n).strip()

    meas = ["_merch", "_edc", "_new"] + ["_" + k for k in M]
    cube = []
    for key, g in df.groupby(["_a", "_c", "_s", "_l", "_tp"]):
        s = g[meas].sum()
        cube.append([*key] + [r(s[m]) for m in meas])
    hist = {}
    for yc in sorted(c for c in df.columns if re.match(r"YTD SV W52 \d{4}$", c)):
        yr = yc[-4:]
        hist[yr] = {a: r(v) for a, v in num(df[yc]).groupby(df["_a"]).sum().items()}
    hist[f"{cy} YTD"] = {a: r(v) for a, v in df["_sv"].groupby(df["_a"]).sum().items()}
    kq = "Kuadran\n(SV&Fund)"
    kuad = []
    if kq in df.columns:
        mm = df[df["_merch"] > 0]
        for (a, q), g in mm.groupby(["_a", mm[kq].fillna("-")]):
            kuad.append([a, str(q), int(len(g))])
    lob = []
    for (a, l), g in df.groupby(["_a", df["LOB"].fillna("LAINNYA").astype(str).str.strip()]):
        lob.append([a, l[:60], r(g["_merch"].sum()), r(g["_sv"].sum()), r(g["_svp"].sum()), r(g["_md"].sum())])
    top = df.nlargest(200, "_sv")
    tops = [dict(nm=str(x["mrchantdbaname"]).strip(), a=x["_a"], c=x["_c"], s=x["_s"], l=str(x.get("LOB", "") or "").strip(),
                 e=r(x["_edc"]), sv=r(x["_sv"]), svp=r(x["_svp"]), md=r(x["_md"]), tx=r(x["_tx"]), fd=r(x["_fd"]))
            for _, x in top.iterrows()]
    return dict(year=cy, week=w, cols=["a", "c", "s", "l", "tp"] + [m[1:] for m in meas],
                cube=cube, hist=hist, kuad=kuad, lob=lob, top=tops)


# ----------------------------------------------------------------- LVM
def build_lvm(path, branch_names):
    log(f"LVM: {os.path.basename(path)} | sheet Master All Merchant (bisa 1-3 menit)")
    df = read_excel(path, "Master All Merchant", header=0)
    df = df[df["store_id"].notna()].copy()
    df["_d"] = pd.to_datetime(df["createddate"], errors="coerce")
    asof = df["_d"].max()
    cy = asof.year
    log(f"LVM: {len(df)} merchant, data s.d. {asof:%d-%m-%Y}")
    df["_c"] = df["kode_cabang_final"].map(code)
    df["_a"] = df["nama_area_final"].map(norm_area)
    for c, n in zip(df["_c"], df["nama_cabang_final"]):
        if c and not branch_names.get(c) and pd.notna(n):
            branch_names[c] = str(n).strip()
    df["_g"] = df["grading_trx"].astype(str).replace({"0": "N/A"})
    df["_tg"] = df["Tagging Akuisisi"].fillna("-").astype(str)
    df["_act"] = (df["status_trx"].astype(str).str.upper() == "ACTIVE").astype(int)
    df["_usak"] = (df["USAK/Non USAK"].astype(str).str.upper() == "USAK").astype(int)
    df["_cls"] = (df["status_rekening"].astype(str).str.upper() == "CLOSED").astype(int)
    for c in ["freq_mtd", "sv_mtd", "fbi_mtd", "freq_ytd", "sv_ytd", "fbi_ytd", "Average Balance Tabungan"]:
        df[c] = num(df[c])
    meas = ["_act", "_usak", "_cls", "freq_mtd", "sv_mtd", "fbi_mtd", "freq_ytd", "sv_ytd", "fbi_ytd", "Average Balance Tabungan"]
    cube = []
    for key, g in df.groupby(["_a", "_c", "_g", "_tg"]):
        s = g[meas].sum()
        cube.append([*key, int(len(g))] + [r(s[m]) for m in meas])
    acq = []
    rec = df[df["_d"].dt.year >= cy - 1]
    for (c, y, m), g in rec.groupby(["_c", rec["_d"].dt.year, rec["_d"].dt.month]):
        acq.append([c, int(y), int(m), int(len(g)), int(g["_usak"].sum()), int(g["_act"].sum())])
    lob = []
    for (a, l), g in df.groupby(["_a", df["lob_lm"].fillna("Lainnya").astype(str)]):
        lob.append([a, l, int(len(g)), int(g["_act"].sum()), int(g["_usak"].sum()), r(g["sv_ytd"].sum())])
    top = df.nlargest(100, "sv_ytd")
    tops = [dict(nm=str(x["store_name"]).strip(), a=x["_a"], c=x["_c"], l=str(x["lob_lm"]), g=x["_g"],
                 sv=r(x["sv_ytd"]), fb=r(x["fbi_ytd"]), svm=r(x["sv_mtd"]), d=x["_d"].strftime("%Y-%m-%d") if pd.notna(x["_d"]) else "")
            for _, x in top.iterrows()]
    return dict(asof=asof.strftime("%Y-%m-%d"), year=cy,
                cols=["a", "c", "g", "tg", "n", "act", "usak", "cls", "fqm", "svm", "fbm", "fqy", "svy", "fby", "bal"],
                cube=cube, acq=acq, lob=lob, top=tops)


# ----------------------------------------------------------------- ENKRIPSI
def load_codes(path):
    if not os.path.exists(path):
        rows = [("REGION", "Admin Region XI")] + [(a, a.title()) for a in AREA_BY_CODE.values()]
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["kode", "nama", "akses"])
            for akses, nama in rows:
                w.writerow([f"TBR-{secrets.token_hex(3).upper()}-{secrets.token_hex(2).upper()}", nama, akses])
        log(f"File kode login baru dibuat: {path}  (simpan baik-baik, JANGAN di-upload)")
    codes = []
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            k = (row.get("kode") or "").strip()
            if not k:
                continue
            if len(k) < 8:
                sys.exit(f"Kode '{k}' terlalu pendek (minimal 8 karakter)")
            codes.append(dict(kode=k, nama=(row.get("nama") or "").strip(), akses=(row.get("akses") or "REGION").strip().upper()))
    if not codes:
        sys.exit("access_codes.csv tidak berisi kode")
    return codes


def encrypt(payload, codes):
    b64 = lambda b: base64.b64encode(b).decode()
    dk = AESGCM.generate_key(bit_length=256)
    iv = secrets.token_bytes(12)
    raw = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    ct = AESGCM(dk).encrypt(iv, raw, None)
    salt = secrets.token_bytes(16)
    keys = []
    for c in codes:
        kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITER).derive(c["kode"].encode("utf-8"))
        kiv = secrets.token_bytes(12)
        inner = json.dumps(dict(k=b64(dk), n=c["nama"], s=c["akses"])).encode()
        keys.append(dict(iv=b64(kiv), ct=b64(AESGCM(kek).encrypt(kiv, inner, None))))
    secrets.SystemRandom().shuffle(keys)
    return dict(v=1, kdf=dict(alg="PBKDF2-SHA256", salt=b64(salt), iter=PBKDF2_ITER), keys=keys,
                iv=b64(iv), ct=b64(ct)), hashlib.sha256(raw).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.path.dirname(REPO), help="Folder berisi file Excel")
    ap.add_argument("--codes", default=os.path.join(REPO, "access_codes.csv"))
    ap.add_argument("--out", default=os.path.join(REPO, "data"))
    a = ap.parse_args()

    atm_f = find_file(a.source, "ATM*.xlsx")
    edc_f = find_file(a.source, "Merchant*.xlsx")
    lvm_f = find_file(a.source, "LVM*.xlsx")
    targets = build_targets(lvm_f)
    names = {k: v["nama"] for k, v in targets.items()}
    payload = dict(
        title="Transaction Banking Retail Region XI",
        generated=dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        sources=dict(atm=os.path.basename(atm_f), edc=os.path.basename(edc_f), lvm=os.path.basename(lvm_f)),
        areas=sorted(set(AREA_BY_CODE.values())),
        atm=build_atm(atm_f, names),
        edc=build_edc(edc_f, names),
        lvm=build_lvm(lvm_f, names),
        targets=targets,
    )
    payload["branches"] = {k: v for k, v in names.items() if k}
    codes = load_codes(a.codes)
    enc, h = encrypt(payload, codes)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "data.enc.json"), "w", encoding="utf-8") as f:
        json.dump(enc, f, separators=(",", ":"))
    with open(os.path.join(a.out, "version.json"), "w", encoding="utf-8") as f:
        json.dump(dict(updated=payload["generated"], hash=h), f)
    size = os.path.getsize(os.path.join(a.out, "data.enc.json")) / 1024
    log(f"SELESAI -> data/data.enc.json ({size:,.0f} KB, terenkripsi untuk {len(codes)} kode login)")


if __name__ == "__main__":
    main()
