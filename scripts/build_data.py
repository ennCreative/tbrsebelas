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
    # Avg funding melekat ke rekening: satu rekening bisa punya banyak MID.
    # Untuk total, hitung sekali per rekening (Count For Funding = 1), sama seperti Pivot di file Excel.
    df["_fdraw"] = df["_fd"]
    if "Count For Funding" in df.columns:
        first = (col("Count For Funding") == 1).astype(float)
        df["_fd"] = df["_fd"] * first
        df["_fdp"] = df["_fdp"] * first
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
    df["_lobd"] = df["LOB"].fillna("LAINNYA").astype(str).str.strip().replace({"0": "LAINNYA", "": "LAINNYA"})
    for (a, c, l), g in df.groupby(["_a", "_c", "_lobd"]):
        lob.append([a, c, l[:60], r(g["_merch"].sum()), r(g["_sv"].sum()), r(g["_svp"].sum()), r(g["_md"].sum())])
    top = df.nlargest(200, "_sv")
    tops = [dict(nm=str(x["mrchantdbaname"]).strip(), a=x["_a"], c=x["_c"], s=x["_s"], l=str(x.get("LOB", "") or "").strip(),
                 e=r(x["_edc"]), sv=r(x["_sv"]), svp=r(x["_svp"]), md=r(x["_md"]), tx=r(x["_tx"]), fd=r(x["_fdraw"]))
            for _, x in top.iterrows()]
    return dict(year=cy, week=w, cols=["a", "c", "s", "l", "tp"] + [m[1:] for m in meas],
                cube=cube, hist=hist, kuad=kuad, lob=lob, top=tops), build_merchants(df, cy, w)


def build_merchants(df, cy, w):
    """Data per MID untuk menu Cari Merchant (disimpan di file terenkripsi terpisah)."""
    def ids(col):
        return [code(v) if pd.notna(v) else "" for v in df[col]] if col in df.columns else [""] * len(df)

    def txt(col):
        return [str(v).strip() if pd.notna(v) and str(v).strip() not in ("0", "nan") else "" for v in df[col]] if col in df.columns else [""] * len(df)

    def mdr(col):
        if col not in df.columns:
            return [None] * len(df)
        return [round(float(v), 3) if pd.notna(v) else None for v in pd.to_numeric(df[col], errors="coerce")]

    years = sorted({int(m.group(2)) for c in df.columns if (m := re.match(r"YTD SV W(\d+) (\d{4})$", c))} - {cy})
    fy_years = [y for y in years if y < cy]

    def fycol(prefix, y):
        for wk in (52, 53):
            c = f"{prefix} W{wk} {y}"
            if c in df.columns:
                return c
        return None

    def series(cols):
        out = []
        for c in cols:
            out.append([r(v) if v else 0 for v in num(df[c])] if c and c in df.columns else None)
        return out

    lab = [str(y) for y in fy_years] + [f"YTD W{w} {cy-1}", f"YTD W{w} {cy}", f"W{w-1} {cy}", f"W{w} {cy}"]
    def pack(ytd, wk_prefix):
        cols = [fycol(ytd, y) for y in fy_years] + [f"{ytd} W{w} {cy-1}", f"{ytd} W{w} {cy}",
                                                     f"{wk_prefix} W{w-1} {cy}" if wk_prefix else None, f"{wk_prefix} W{w} {cy}" if wk_prefix else None]
        return series(cols)
    fund_cols = [fycol("Avg Fund", y) for y in fy_years] + [f"Avg Fund W{w} {cy-1}", f"Avg Fund W{w} {cy}", None, None]
    log(f"EDC: {len(df)} MID untuk menu Cari Merchant")
    return dict(year=cy, week=w, labels=lab, n=len(df),
                nm=txt("mrchantdbaname"), on=txt("merchantofficialname"), mid=ids("mid_gab"), rek=ids("norekening"),
                c=list(df["_c"]), a=list(df["_a"]), s=list(df["_s"]), l=txt("LOB"), l5=list(df["_l"]),
                mc=mdr("MDR\nOffUsCredit"), mq=mdr("MDR QRIS OFF US"), edc=[r(v) for v in df["_edc"]],
                sv=pack("YTD SV", "SV"), tx=pack("YTD TRX", "TRX"), md=pack("YTD MDFG", "MDFG"), fd=series(fund_cols))


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
                cube=cube, acq=acq, lob=lob, top=tops), build_lvm_merchants(df, asof)


def build_lvm_merchants(df, asof):
    """Data per merchant Livin' untuk menu Cari Merchant (file terenkripsi terpisah).
    Nama pemilik & alamat tidak ikut."""
    def cat(series):
        vals = series.fillna("-").astype(str).str.strip()
        labels = sorted(vals.unique())
        idx = {v: i for i, v in enumerate(labels)}
        return dict(k=labels, v=[idx[v] for v in vals])

    def ids(col):
        return [code(v) if pd.notna(v) else "" for v in df[col]]

    def nums(col):
        return [r(v) if v else 0 for v in num(df[col])] if col in df.columns else [0] * len(df)

    log(f"LVM: {len(df)} merchant untuk menu Cari Merchant")
    return dict(asof=asof.strftime("%Y-%m-%d"), n=len(df),
                nm=[str(v).strip() if pd.notna(v) else "" for v in df["store_name"]],
                mid=ids("mid_static"), mid2=ids("mid_dynamic"), rek=ids("account_number"),
                c=list(df["_c"]), a=cat(df["_a"]), lob=cat(df["lob_lm"]), g=cat(df["_g"]), st=cat(df["status_trx"]),
                u=list(df["_usak"]), sr=cat(df["status_rekening"]), ta=cat(df["tipe_akun"]), dg=cat(df["flag_card_dongle"]),
                ct=cat(df["companytype"]), kab=cat(df["kabupaten"]), tg=cat(df["_tg"]),
                d=[x.strftime("%Y-%m-%d") if pd.notna(x) else "" for x in df["_d"]],
                fqm=nums("freq_mtd"), svm=nums("sv_mtd"), fbm=nums("fbi_mtd"),
                fqy=nums("freq_ytd"), svy=nums("sv_ytd"), fby=nums("fbi_ytd"),
                dfqy=nums("freq_ytd_card_dongle"), dsvy=nums("sv_ytd_card_dongle"), dfby=nums("fbi_ytd_card_dongle"),
                bal=nums("Average Balance Tabungan"), balm=nums("growth_avgbal_rekening_mom"), baly=nums("growth_avgbal_rekening_yoy"),
                cif=nums("Average Balance CIF"), cifm=nums("growth_avgbal_cif_mom"), cify=nums("growth_avgbal_cif_yoy"))


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


def seal(dk, obj):
    """Enkripsi satu paket data dengan kunci data (dk). Hasil: (dict, sha256 ringkas)."""
    b64 = lambda b: base64.b64encode(b).decode()
    iv = secrets.token_bytes(12)
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    return dict(v=1, iv=b64(iv), ct=b64(AESGCM(dk).encrypt(iv, raw, None))), hashlib.sha256(raw).hexdigest()[:16]


def encrypt(payload, codes, dk):
    b64 = lambda b: base64.b64encode(b).decode()
    body, h = seal(dk, payload)
    iv, ct = body["iv"], body["ct"]
    salt = secrets.token_bytes(16)
    keys = []
    for c in codes:
        kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITER).derive(c["kode"].encode("utf-8"))
        kiv = secrets.token_bytes(12)
        inner = json.dumps(dict(k=b64(dk), n=c["nama"], s=c["akses"])).encode()
        keys.append(dict(iv=b64(kiv), ct=b64(AESGCM(kek).encrypt(kiv, inner, None))))
    secrets.SystemRandom().shuffle(keys)
    return dict(v=1, kdf=dict(alg="PBKDF2-SHA256", salt=b64(salt), iter=PBKDF2_ITER), keys=keys, iv=iv, ct=ct), h


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
        edc=None,
        lvm=None,
        targets=targets,
    )
    payload["edc"], merchants = build_edc(edc_f, names)
    payload["lvm"], lvm_merchants = build_lvm(lvm_f, names)
    payload["branches"] = {k: v for k, v in names.items() if k}
    codes = load_codes(a.codes)
    dk = AESGCM.generate_key(bit_length=256)
    enc, h = encrypt(payload, codes, dk)
    menc, mh = seal(dk, merchants)
    lenc, lh = seal(dk, lvm_merchants)
    h = hashlib.sha256((h + mh + lh).encode()).hexdigest()[:16]
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "lvm.enc.json"), "w", encoding="utf-8") as f:
        json.dump(lenc, f, separators=(",", ":"))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "merchant.enc.json"), "w", encoding="utf-8") as f:
        json.dump(menc, f, separators=(",", ":"))
    with open(os.path.join(a.out, "data.enc.json"), "w", encoding="utf-8") as f:
        json.dump(enc, f, separators=(",", ":"))
    with open(os.path.join(a.out, "version.json"), "w", encoding="utf-8") as f:
        json.dump(dict(updated=payload["generated"], hash=h), f)
    size = os.path.getsize(os.path.join(a.out, "data.enc.json")) / 1024
    msize = os.path.getsize(os.path.join(a.out, "merchant.enc.json")) / 1024
    lsize = os.path.getsize(os.path.join(a.out, "lvm.enc.json")) / 1024
    log(f"SELESAI -> data.enc.json ({size:,.0f} KB), merchant.enc.json ({msize:,.0f} KB), lvm.enc.json ({lsize:,.0f} KB); terenkripsi untuk {len(codes)} kode login")


if __name__ == "__main__":
    main()
