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


def find_file(src, keyword, exclude=(), required=True):
    """Cari file Excel yang namanya MENGANDUNG kata kunci (di posisi mana pun, huruf besar/kecil bebas).
    Contoh: 'LVM - YTD 10 NOVEMBER 2026.xlsx' dan 'Dashboard Monitoring LVM - 171126.xlsx' sama-sama cocok untuk LVM.
    Bila ada beberapa yang cocok, dipakai yang paling baru diubah."""
    files = []
    for f in glob.glob(os.path.join(src, "*.xls*")):
        name = os.path.basename(f).upper()
        if name.startswith("~$") or keyword.upper() not in name or any(x.upper() in name for x in exclude):
            continue
        files.append(f)
    if not files:
        if not required:
            log(f"(tidak ada file '{keyword}', dilewati)")
            return None
        sys.exit(f"File Excel yang namanya mengandung '{keyword}' tidak ditemukan di {src}")
    if len(files) > 1:
        log(f"Ada {len(files)} file '{keyword}', dipakai yang terbaru: {os.path.basename(max(files, key=os.path.getmtime))}")
    return max(files, key=os.path.getmtime)


def pick_sheet(path, preferred, must_have=None):
    """Pakai sheet bernama `preferred`; bila tidak ada, cari sheet yang namanya mirip
    atau yang baris judulnya berisi kolom `must_have`."""
    names = sheet_names(path)
    if preferred in names:
        return preferred
    low = {n.lower().strip(): n for n in names}
    if preferred.lower() in low:
        return low[preferred.lower()]
    for n in names:
        if preferred.lower() in n.lower():
            return n
    if must_have:
        for n in names:
            try:
                head = read_excel(path, n, header=None).head(15)
            except Exception:
                continue
            if any(str(v).strip() == must_have for v in head.values.ravel()):
                return n
    sys.exit(f"Sheet '{preferred}' tidak ditemukan di {os.path.basename(path)}. Sheet yang ada: {', '.join(names)}")


# ----------------------------------------------------------------- CABANG / TARGET
def build_targets(lvm_path):
    raw = read_excel(lvm_path, pick_sheet(lvm_path, "Target Cabang"))
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
def txt_or_blank(v):
    return str(v).strip() if v is not None and pd.notna(v) and str(v).strip() not in ("0", "nan", "-") else ""


def latlon(lat, lon):
    """Koordinat mesin; dibalik otomatis bila kolom tertukar. Hanya dipakai bila berada di wilayah Bali–Nusa Tenggara."""
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if -13 <= lo <= -5 and 110 <= la <= 127:
        la, lo = lo, la
    if -13 <= la <= -5 and 110 <= lo <= 127:
        return [round(la, 6), round(lo, 6)]
    return None

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
            qs=[txt_or_blank(row.get(f"Kuadran {m}")) or "-" for m in MONTHS[:last + 1]],
            al=txt_or_blank(row.get("Alamat")), jl=txt_or_blank(row.get("Jenis_Lokasi")),
            ll=latlon(row.get("Latitude"), row.get("Longitude")),
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
    # avg funding per jenis rekening (Giro/Tabungan/...) untuk Ringkasan KPI
    jr = df["jenis rekening"].fillna("Lainnya").astype(str).str.strip().str.title().replace({"": "Lainnya", "Nan": "Lainnya"}) if "jenis rekening" in df else pd.Series("Lainnya", index=df.index)
    cff = (col("Count For Funding") == 1) if "Count For Funding" in df.columns else pd.Series(True, index=df.index)
    df["_cff"] = cff.astype(int)
    df["_cfp"] = (cff & (df["_fd"] > 0)).astype(int)
    # [area, jenis, saldo, saldo tahun lalu, jumlah rekening (CFF=1), rekening bersaldo]
    fundj = [[a, j, r(g["_fd"].sum()), r(g["_fdp"].sum()), int(g["_cff"].sum()), int(g["_cfp"].sum())] for (a, j), g in df.groupby(["_a", jr])]
    nrows = {a: int(n) for a, n in df.groupby("_a").size().items()}
    # kubus ringkas untuk Ringkasan KPI Overview: area x segmen x jenis rekening
    df["_jr"] = jr
    df["_one"] = 1
    em = ["_sv", "_svp", "_tx", "_txp", "_md", "_mdp", "_fd", "_fdp", "_merch", "_edc", "_cff", "_cfp", "_one"]
    ecube = [[a, sg, j] + [r(v) for v in g[em].sum().tolist()] for (a, sg, j), g in df.groupby(["_a", "_s", "_jr"])]
    return dict(year=cy, week=w, cols=["a", "c", "s", "l", "tp"] + [m[1:] for m in meas],
                cube=cube, fundj=fundj, nrows=nrows, ecube=ecube, ecols=[c[1:] for c in em], hist=hist, kuad=kuad, lob=lob, top=tops), build_merchants(df, cy, w)


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
                nm=txt("mrchantdbaname"), on=txt("merchantofficialname"), mid=ids("mid_gab"), rek=ids("norekening"), al=txt("alamat"),
                c=list(df["_c"]), a=list(df["_a"]), s=list(df["_s"]), l=txt("LOB"), l5=list(df["_l"]),
                mc=mdr("MDR\nOffUsCredit"), mq=mdr("MDR QRIS OFF US"), edc=[r(v) for v in df["_edc"]],
                sv=pack("YTD SV", "SV"), tx=pack("YTD TRX", "TRX"), md=pack("YTD MDFG", "MDFG"), fd=series(fund_cols))


# ----------------------------------------------------------------- LVM
def build_lvm(path, branch_names):
    log(f"LVM: {os.path.basename(path)} | sheet Master All Merchant (bisa 1-3 menit)")
    df = with_header(read_excel(path, pick_sheet(path, "Master All Merchant", "store_id")), "store_id")
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
    """Data per merchant Livin' untuk menu Pencarian (file terenkripsi terpisah). Nama pemilik tidak ikut."""
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
                al=[str(v).strip() if pd.notna(v) and str(v).strip() not in ("0", "nan") else "" for v in df["address"]] if "address" in df.columns else [""] * len(df),
                kec=cat(df["kecamatan"]) if "kecamatan" in df.columns else cat(pd.Series("-", index=df.index)),
                c=list(df["_c"]), a=cat(df["_a"]), lob=cat(df["lob_lm"]), g=cat(df["_g"]), st=cat(df["status_trx"]),
                u=list(df["_usak"]), sr=cat(df["status_rekening"]), ta=cat(df["tipe_akun"]), dg=cat(df["flag_card_dongle"]),
                ct=cat(df["companytype"]), kab=cat(df["kabupaten"]), tg=cat(df["_tg"]),
                d=[x.strftime("%Y-%m-%d") if pd.notna(x) else "" for x in df["_d"]],
                fqm=nums("freq_mtd"), svm=nums("sv_mtd"), fbm=nums("fbi_mtd"),
                fqy=nums("freq_ytd"), svy=nums("sv_ytd"), fby=nums("fbi_ytd"),
                dfqy=nums("freq_ytd_card_dongle"), dsvy=nums("sv_ytd_card_dongle"), dfby=nums("fbi_ytd_card_dongle"),
                bal=nums("Average Balance Tabungan"), balm=nums("growth_avgbal_rekening_mom"), baly=nums("growth_avgbal_rekening_yoy"),
                cif=nums("Average Balance CIF"), cifm=nums("growth_avgbal_cif_mom"), cify=nums("growth_avgbal_cif_yoy"))


# ----------------------------------------------------------------- WPR (Weekly Performance Report)
def build_wpr(path, branch_names):
    """Performance 4 minggu terakhir + YTD per MID, DIPIVOT per nama merchant
    (MID berbeda dengan nama merchant yang sama digabung jadi satu baris)."""
    names = sheet_names(path)
    sh = "data" if "data" in names else pick_sheet(path, "data", "MID_New")
    df = with_header(read_excel(path, sh), "MID_New")
    df = df[df["MID_New"].notna()].copy()
    weeks = sorted({int(m.group(2)) for c in df.columns if (m := re.match(r"^(SV|FREQ|FBI)_(\d+)$", c))})
    wk = [int(str(w)[-2:]) for w in weeks]                       # 32643 -> minggu 43
    yr = int(m.group(1)) if (m := re.search(r"W\d+_(\d{4})", os.path.basename(path))) else dt.date.today().year
    log(f"WPR: {os.path.basename(path)} | {len(df)} MID, minggu {wk}")

    def t(c):
        return df[c].fillna("").astype(str).str.strip().replace({"nan": "", "0": ""}) if c in df.columns else pd.Series("", index=df.index)
    df["_nm"] = t("merchantdbaname")
    df["_key"] = df["_nm"].str.upper().str.replace(r"\s+", " ", regex=True)
    df.loc[df["_key"] == "", "_key"] = "MID " + df["MID_New"].map(code)
    df["_c"] = df["cd_cbg_new"].map(code) if "cd_cbg_new" in df.columns else ""
    df["_a"] = df["Area_new"].map(norm_area) if "Area_new" in df.columns else "LAINNYA"
    for c, n in zip(df["_c"], t("cbg_new")):
        if c and not branch_names.get(c) and n:
            branch_names[c] = n
    lob_col = "lob_new" if "lob_new" in df.columns else None
    meas = {}
    for k in ("SV", "FREQ", "FBI"):
        for w in weeks:
            meas[f"{k}_{w}"] = num(df[f"{k}_{w}"])
        meas[f"{k}_YTD"] = num(df[f"{k}_YTD"]) if f"{k}_YTD" in df.columns else pd.Series(0, index=df.index)
    for k, v in meas.items():
        df["_" + k] = v

    for c, k in (("merchantofficialname", "_on"), ("alamat", "_al"), ("segmen", "_s"), ("business_env", "_e"),
                 (lob_col or "-", "_l"), ("norekening", "_rek")):
        df[k] = t(c)
    df["_mid"] = df["MID_New"].map(code)
    g = df.groupby("_key", sort=False)
    top = df.loc[g["_SV_YTD"].idxmax()].set_index("_key")          # atribut diambil dari MID dengan SV terbesar
    keys = list(top.index)
    sums = g[[c for c in df.columns if c.startswith(("_SV_", "_FREQ_", "_FBI_"))]].sum().reindex(keys)
    env = g["_e"].agg(lambda x: "/".join(sorted(set(v for v in x if v)))).reindex(keys)
    mids = g["_mid"].agg(" ".join).reindex(keys)
    nrek = g["_rek"].agg(lambda x: len(set(v for v in x if v))).reindex(keys)
    nmid = g.size().reindex(keys)
    on = g["_on"].agg(lambda x: next((v for v in x if v), "")).reindex(keys)
    out = dict(nm=[v or k for k, v in zip(keys, top["_nm"])], on=[top.at[k, "_on"] or on[k] for k in keys],
               al=list(top["_al"]), c=list(top["_c"]), a=list(top["_a"]), s=list(top["_s"]), e=list(env), l=list(top["_l"]),
               nmid=[int(v) for v in nmid], nrek=[int(v) for v in nrek], mids=list(mids))
    series = {k: [[r(v) for v in sums[f"_{kk}_{w}"]] for w in weeks] for k, kk in (("sv", "SV"), ("fq", "FREQ"), ("fb", "FBI"))}
    ytd = {k: [r(v) for v in sums[f"_{kk}_YTD"]] for k, kk in (("sv", "SV"), ("fq", "FREQ"), ("fb", "FBI"))}
    log(f"WPR: {len(df)} MID dipivot menjadi {len(out['nm'])} merchant (nama sama digabung)")
    return dict(year=yr, weeks=wk, n=len(out["nm"]), nmids=len(df), **out, sv=series["sv"], fq=series["fq"], fb=series["fb"],
                svy=ytd["sv"], fqy=ytd["fq"], fby=ytd["fb"])


# ----------------------------------------------------------------- ENKRIPSI
# ----------------------------------------------------------------- Duta Transaksi & USAK (pegawai)
def short_unit(v):
    """'KANTOR CABANG PEMBANTU DENPASAR RENON' -> 'KCP Denpasar Renon'"""
    s = re.sub(r"\s+", " ", str(v or "").strip())
    if not s or s in ("-", "nan", "None"):
        return ""
    u = s.upper()
    for full, ab in (("KANTOR CABANG PEMBANTU ", "KCP "), ("KANTOR CABANG ", "KC ")):
        if u.startswith(full):
            return ab + s[len(full):].title()
    if re.match(r"^(KCP|KC) ", u):
        return u.split(" ", 1)[0] + " " + s.split(" ", 1)[1].title()
    s = s.title() if s.isupper() else s
    s = re.sub(r"\s*/\s*Bali\s*&\s*Nusa\s*Tenggara$", "", s, flags=re.I)
    return re.sub(r"\bXi\b", "XI", s)


def unit_area(v):
    """Area dari nama area/unit bisnis; unit di luar 4 area -> REGION."""
    s = str(v or "").upper()
    for a in AREA_BY_CODE.values():
        if a.split()[-1] in s:
            return a
    return "REGION"


def build_duta(path):
    log("Duta Transaksi:", os.path.basename(path))
    names = sheet_names(path)
    # tanggal posisi & catatan dari sheet "Report Kata"
    asof, notes = "", []
    m = re.search(r"POSISI\s+(\d{1,2}\s+\w+\s+\d{4})", os.path.basename(path), re.I)
    if m:
        asof = m.group(1).title()
    if "Report Kata" in names:
        lines = [str(x).strip() for x in read_excel(path, "Report Kata")[0].tolist() if pd.notna(x) and str(x).strip()]
        for ln in lines:
            m = re.search(r"Posisi Tanggal\s*:\s*\*?([^*]+)", ln, re.I)
            if m:
                asof = m.group(1).strip()
        if any(l.lower().startswith("catatan") for l in lines):
            i = next(i for i, l in enumerate(lines) if l.lower().startswith("catatan"))
            for l in lines[i + 1:]:
                if re.match(r"^\d+\.", l):
                    notes.append(re.sub(r"^\d+\.\s*", "", l).replace("*", ""))
    since = ""
    for n in notes:
        m = re.search(r"per tgl\s+(\d{1,2}\s+\w+\s+\d{4})", n, re.I)
        if m:
            since = m.group(1).title()

    def tidy(df):
        df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
        return df

    ind = tidy(read_excel(path, "Individu", header=0))
    ind = ind[ind["Nama Pegawai"].notna()]
    col = lambda df, k: num(df[k]) if k in df else pd.Series(0, index=df.index)
    peg = []
    for _, x in ind.iterrows():
        area_raw = str(x.get("Area", "") or "")
        unit = short_unit(x.get("Cabang", "")) or (short_unit(area_raw) if area_raw.strip() not in ("-", "") else "Tanpa unit")
        peg.append(None)
    ind = ind.assign(
        _on=col(ind, "Total Frek On Us - GMM"), _off=col(ind, "Total Frek Off Us - GMM"),
        _pct=col(ind, "%Frek On Us - GMM"), _poin=col(ind, "Total Poin Program"),
        _need=col(ind, "Kebutuhan Tambahan Transaksi On US"), _p90=col(ind, "Pegawai %On Us min 90%"))
    peg = []
    for _, x in ind.iterrows():
        area_raw = str(x.get("Area", "") or "").strip()
        unit = short_unit(x.get("Cabang", "")) or ("Kantor " + short_unit(area_raw) if area_raw not in ("-", "", "nan") else "Tanpa unit")
        peg.append([str(x["Nama Pegawai"]).strip().title(), unit_area(area_raw), unit,
                    1 if str(x.get("Flag Partisipasi", "")).upper().strip() == "PARTISIPASI" else 0,
                    int(x._on), int(x._off), round(float(x._pct), 4), int(x._poin), int(x._need), int(x._p90)])

    cab = tidy(read_excel(path, "Cabang", header=0))
    cab["_area"] = cab["Area/ Unit Kerja"].replace("-", pd.NA).ffill() if "Area/ Unit Kerja" in cab else ""
    units = []
    for _, x in cab.iterrows():
        if pd.isna(x.get("Total Pegawai")) or num(pd.Series([x.get("Total Pegawai")])).iloc[0] == 0:
            continue
        area_raw = str(x["_area"]) if pd.notna(x["_area"]) else "-"
        c = str(x.get("Cabang", "-")).strip()
        unit = short_unit(c) or ("Kantor " + short_unit(area_raw) if area_raw not in ("-", "nan") else "Tanpa unit")
        g = lambda k: float(num(pd.Series([x.get(k)])).iloc[0])
        units.append([unit_area(area_raw), unit, int(g("Total Pegawai")), int(g("Pegawai Partisipasi")),
                      int(g("Total Frek On Us - GMM")), int(g("Total Frek Off Us - GMM")), round(g("%Frek On Us - GMM"), 4),
                      r(g("SV On Us - GMM (Rp Jt)")), r(g("SV Off Us - GMM (Rp Jt)")),
                      int(g("Pegawai On Us min 90%")), round(g("%Pegawai On Us min 90%"), 4), int(g("Total Poin Program")),
                      int(g("Rank")) if g("Rank") else 0])

    ar = tidy(read_excel(path, "Area", header=0))
    key = "Area/Unit Bisnis" if "Area/Unit Bisnis" in ar else ar.columns[2]
    areas, tot = [], None
    for _, x in ar.iterrows():
        nm = str(x.get(key, "") or "").strip()
        if not nm or nm == "nan" or pd.isna(x.get("Total Pegawai")):
            continue
        g = lambda k: float(num(pd.Series([x.get(k)])).iloc[0])
        row = [nm, int(g("Total Pegawai")), int(g("Pegawai Partisipasi")), int(g("Total Frek On Us - GMM")),
               int(g("Total Frek Off Us - GMM")), r(g("SV On Us - GMM (Rp Jt)")), r(g("SV Off Us - GMM (Rp Jt)")),
               int(g("Pegawai on Us min 90%") if "Pegawai on Us min 90%" in ar else g("Pegawai On Us min 90%"))]
        if nm.upper().startswith("REGION XI"):
            tot = row
        else:
            areas.append([unit_area(nm) if unit_area(nm) != "REGION" else "REGION", short_unit(nm) if nm != "-" else "Tanpa unit"] + row[1:])
    if tot is None:
        tot = ["Region", sum(a[2] for a in areas), sum(a[3] for a in areas), sum(a[4] for a in areas), sum(a[5] for a in areas),
               sum(a[6] for a in areas), sum(a[7] for a in areas), sum(a[8] for a in areas)]
    log(f"  {len(peg)} pegawai, {len(units)} unit kerja, posisi {asof}")
    return dict(asof=asof, since=since, notes=notes, tot=tot[1:], areas=areas, units=units, peg=peg,
                file=os.path.basename(path))


def build_usak(path):
    log("USAK LVM pegawai:", os.path.basename(path))
    names = sheet_names(path)
    det_sheet = next((n for n in names if n.strip().lower() == "detail fase 3"), None) or \
        next(n for n in names if n.lower().startswith("detail"))
    dash_sheet = det_sheet.replace("Detail", "Dashboard") if det_sheet.replace("Detail", "Dashboard") in names else None
    d = read_excel(path, det_sheet, header=0)
    d.columns = [str(c).strip() for c in d.columns]
    d = d[d["nama merchant"].notna()]
    # info periode, nama & kelas cabang dari sheet dashboard
    info, gates, meta = "", [], {}
    if dash_sheet:
        raw = read_excel(path, dash_sheet)
        for _, row in raw.iterrows():
            vals = [v for v in row.tolist() if pd.notna(v) and str(v).strip()]
            if not vals:
                continue
            t = str(vals[0]).strip()
            if t.lower().startswith("fase") and "posisi" in t.lower() and not info:
                info = t
            if t.startswith("- Prio"):
                gates.append(t[2:].strip())
            if len(row) > 5 and code(row.iloc[3]) and pd.notna(row.iloc[4]):
                meta[code(row.iloc[3])] = (str(row.iloc[4]).strip(), str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else "")
    period, asof = "", ""
    m = re.search(r"Tanggal\s+(\d{1,2}\s+\w+\s+\d{4})\s*-\s*(\d{1,2}\s+\w+\s+\d{4})", info)
    if m:
        period = f"{m.group(1)} sd {m.group(2)}"
    m = re.search(r"Posisi USAK\s+(\d{1,2}\s+\w+\s+\d{4})", info)
    if m:
        asof = m.group(1)

    def unit_of(k, uk):
        c = code(k)
        if c:
            nm, kelas = meta.get(c, (short_unit(uk) or c, ""))
            return c, nm, kelas, AREA_BY_CODE.get(c[:3], "REGION")
        s = str(k).strip()
        if s.lower().startswith("area"):
            a = unit_area(s)
            return a, "Kantor " + a.title(), "", a
        return "REGION", "Kantor Region", "", "REGION"

    cabs, pegs, ms = {}, {}, []
    for _, x in d.iterrows():
        kode, nm, kelas, area = unit_of(x["kode_cab"], x.get("unit_kerja"))
        usak = 1 if str(x.get("USAK", "")).upper().strip() == "YES" else 0
        pr = int(re.sub(r"\D", "", str(x.get("Pipeline Prio", "3"))) or 3)
        sv, fr = float(num(pd.Series([x.get("sv")])).iloc[0]), int(num(pd.Series([x.get("frek")])).iloc[0])
        c = cabs.setdefault(kode, dict(nm=nm, kelas=kelas, area=area, n=[0, 0, 0], u=[0, 0, 0], sv=0.0, fr=0))
        c["n"][pr - 1] += 1; c["u"][pr - 1] += usak; c["sv"] += sv; c["fr"] += fr
        pk = str(x.get("nip", "")) + "|" + kode
        if pk not in pegs:
            pegs[pk] = [str(x.get("nama", "")).strip().title(), nm, area, str(x.get("type", "") or "").strip().upper(), 0, 0, 0.0, 0, kode]
        pg = pegs[pk]; pg[4] += 1; pg[5] += usak; pg[6] += sv; pg[7] += fr
        ms.append([str(x["nama merchant"]).strip(), code(x.get("MID Statis")), list(pegs).index(pk) if False else pk,
                   kode, usak, pr, fr, r(sv), int(num(pd.Series([x.get("kurang freq")])).iloc[0]),
                   int(num(pd.Series([x.get("kurang sv")])).iloc[0]), str(x.get("milestone", "") or "").strip() if str(x.get("milestone", "")) != "0" else "",
                   str(x.get("Alamat", "") or "").strip()[:120]])
    idx = {k: i for i, k in enumerate(pegs)}
    for m_ in ms:
        m_[2] = idx[m_[2]]
    import math
    cab = [[k, v["nm"], v["kelas"], v["area"], v["n"], v["u"], r(v["sv"]), v["fr"],
            math.ceil(sum(v["n"]) * 0.7 - 1e-9)] for k, v in cabs.items()]
    peg = [[p[0], p[1], p[2], p[3], p[4], p[5], r(p[6]), p[7], p[8]] for p in pegs.values()]
    log(f"  {len(ms)} merchant, {len(peg)} pegawai, {len(cab)} unit, posisi USAK {asof}")
    return dict(period=period, asof=asof, gates=gates, cab=cab, peg=peg, m=ms, file=os.path.basename(path))


def _rows(path, sheet):
    raw = read_excel(path, sheet)
    return [list(r) for r in raw.itertuples(index=False)]


def _n(v):
    try:
        f = float(v)
        return 0.0 if f != f else f
    except (TypeError, ValueError):
        return 0.0


def _report_notes(path, sheet, start_pat):
    """Ambil baris-baris catatan dari sheet laporan teks (WA) setelah baris yang cocok dengan start_pat."""
    if sheet not in sheet_names(path):
        return []
    lines = [str(x).strip() for x in read_excel(path, sheet)[0].tolist() if pd.notna(x) and str(x).strip()]
    out, on = [], False
    for l in lines:
        if re.match(start_pat, l.replace("*", "").strip(), re.I):
            on = True
            continue
        if on:
            t = l.replace("*", "").strip()
            if re.match(r"^(terima ?kasih|demikian)", t, re.I):
                break
            out.append(re.sub(r"^\d+\.\s*", "", t))
    return out


def build_senator(path):
    log("Senator:", os.path.basename(path))
    rows = _rows(path, "Dashboard")
    hdr = next(i for i, r in enumerate(rows) if any(str(v).strip() == "Total Universe Senator" for v in r))
    H = [str(v).strip() if pd.notna(v) else "" for v in rows[hdr]]
    if H[7] != "Total Universe Senator" or H[22] != "Jlh" or H[23] != "USAK":
        log("  PERINGATAN: susunan kolom sheet Dashboard berubah, halaman Senator dilewati")
        return None
    pos = {}
    for r in rows[:hdr]:
        for j, v in enumerate(r):
            t = str(v).strip() if pd.notna(v) else ""
            if t.lower().startswith("posisi") and j > 5 and "posisi" not in pos:
                pos["posisi"] = re.sub(r"^posisi\s*", "", t, flags=re.I)
            elif j == 22 and re.search(r"\d{4}", t):
                pos["cbg"] = t
    cab = []
    for r in rows[hdr + 1:]:
        k = code(r[2])
        if not (k and len(k) == 5 and pd.notna(r[5])):
            continue
        g = lambda j: _n(r[j])
        cab.append([k, str(r[5]).strip(), str(r[3] or "").strip().replace(".", ""), AREA_BY_CODE.get(k[:3], norm_area(r[1])),
                    str(r[4]).strip() if pd.notna(r[4]) else "",
                    int(g(7)), int(g(8)), int(g(11)), int(g(12)), int(g(15)), int(g(16)),
                    int(g(22)), int(g(23)), int(g(25)), r_(g(26)), r_(g(27)), r_(g(28)),
                    int(g(31)), int(g(34)), int(g(37)), int(g(40)), int(g(42)), int(g(43))])
    # universe (detail merchant sekitar cabang) -> box terpisah
    uni = []
    if "Detail Klaim Gold" in sheet_names(path):
        d = read_excel(path, "Detail Klaim Gold", header=0)
        for _, x in d.iterrows():
            nm = str(x.get("nearby_name", "") or "").strip()
            if not nm or nm == "nan":
                continue
            ty = str(x.get("nearby_types", "") or "").split(",")[0].strip()
            mid = code(x.get("MID"))
            uni.append([nm, code(x.get("kode_cabang")), 1 if _n(x.get("fg_gold_today")) else 0,
                        ty.replace("_", " ") if ty != "nan" else "", str(x.get("nearby_formatted_address", "") or "")[:110],
                        str(x.get("nearby_place_id", "") or ""), mid if mid not in ("0", "") else ""])
    notes = _report_notes(path, "Sheet1", r"^NOTES\s*:?")
    log(f"  {len(cab)} cabang, universe {sum(c[5] for c in cab)} merchant, gold {sum(c[6] for c in cab)}, detail {len(uni)}")
    plbl = [re.sub(r"\s+", " ", H[j]).strip().title().replace("Sept", "Sep") for j in (11, 12, 15, 16)]
    return dict(posisi=pos.get("posisi", ""), cbg=pos.get("cbg", ""), plbl=plbl, cab=cab, notes=notes, file=os.path.basename(path)), uni


def r_(x):
    return int(round(x))


def build_akuisisi_edc(path):
    log("Akuisisi EDC:", os.path.basename(path))
    rows = _rows(path, "EDC Per Area")
    posisi = ""
    for r in rows[:6]:
        for j, v in enumerate(r):
            if str(v).strip().lower() == "posisi" and j + 1 < len(r):
                dv = pd.to_datetime(r[j + 1], errors="coerce")
                posisi = dv.strftime("%Y-%m-%d") if pd.notna(dv) else str(r[j + 1])
    hdr = [i for i, r in enumerate(rows) if any(str(v).strip() in ("Des 25", "Jan") for v in r[5:8])]
    mon_hdr = [str(v).strip() for v in rows[hdr[-1]][5:18]] if hdr else []
    cab = []
    for r in rows:
        k = code(r[2])
        if not (k and len(k) == 5 and pd.notna(r[4])):
            continue
        g = lambda j: _n(r[j]) if j < len(r) else 0.0
        cab.append([k, re.sub(r"\s*\(NEW\)\s*$", "", str(r[4]).strip()), str(r[3] or "").strip().replace(".", ""), AREA_BY_CODE.get(k[:3], norm_area(r[1])),
                    [int(g(j)) for j in range(5, 18)], int(g(18)),
                    int(g(20)), int(g(21)), int(g(22)), int(g(23)),
                    int(g(37)), int(g(41)), int(g(42)),
                    r_(g(47)), r_(g(48)), r_(g(49)), r_(g(50)), int(g(56))])
    # tahun dari tanggal posisi
    yr = int(posisi[:4]) if re.match(r"\d{4}", posisi) else None
    log(f"  {len(cab)} cabang, MTD {sum(c[8] for c in cab)}, nett YTD {sum(c[11] for c in cab)}, posisi {posisi}")
    return dict(posisi=posisi, year=yr, months=mon_hdr, cab=cab, file=os.path.basename(path))


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


def _key_file(folder, name):
    path = os.path.join(folder, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return base64.b64decode(f.read().strip())
    dk = AESGCM.generate_key(bit_length=256)
    with open(path, "w", encoding="utf-8") as f:
        f.write(base64.b64encode(dk).decode())
    log(f"Kunci data BARU dibuat: {path}")
    return dk


def load_data_key(folder):
    """Dua kunci data TETAP (tidak berubah tiap update), disimpan di folder _rahasia di luar repo.
    - data_key.txt      (app_keys id 1): data dashboard lengkap (Overview, ATM, Merchant, LVM, WPR, Scorecard)
    - data_key_cari.txt (app_keys id 2): data menu Pencarian merchant (EDC & E-Commerce, Livin' Merchant)
    Pengguna biasa & admin menerima keduanya; peran Marketing Yokke / Outbranch hanya menerima kunci 2."""
    os.makedirs(folder, exist_ok=True)
    dk = _key_file(folder, "data_key.txt")
    dk2 = _key_file(folder, "data_key_cari.txt")
    sql = os.path.join(folder, "supabase_kunci.sql")
    with open(sql, "w", encoding="utf-8") as f:
        f.write("-- Jalankan di Supabase > SQL Editor (ulangi hanya jika file data_key*.txt diganti)\n")
        f.write(f"insert into public.app_keys (id, k) values (1, '{base64.b64encode(dk).decode()}')\n"
                "on conflict (id) do update set k = excluded.k;\n")
        f.write(f"insert into public.app_keys (id, k) values (2, '{base64.b64encode(dk2).decode()}')\n"
                "on conflict (id) do update set k = excluded.k;\n")
    return dk, dk2


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
    ap.add_argument("--secret", default=os.path.join(os.path.dirname(REPO), "_rahasia"),
                    help="Folder kunci data (DI LUAR folder repo, jangan pernah di-upload)")
    ap.add_argument("--out", default=os.path.join(REPO, "data"))
    a = ap.parse_args()

    OTHER = ("USAK", "DUTA", "SENATOR", "AKUISISI EDC")
    lvm_f = find_file(a.source, "LVM", exclude=OTHER)
    edc_f = find_file(a.source, "Merchant", exclude=("LVM",) + OTHER)
    atm_f = find_file(a.source, "ATM", exclude=("LVM", "Merchant", "WPR") + OTHER)
    wpr_f = find_file(a.source, "WPR", exclude=OTHER, required=False)
    duta_f = find_file(a.source, "Duta", required=False)
    usak_f = find_file(a.source, "USAK", exclude=("DUTA",), required=False)
    sen_f = find_file(a.source, "Senator", required=False)
    akq_f = find_file(a.source, "Akuisisi EDC", required=False)
    targets = build_targets(lvm_f)
    names = {k: v["nama"] for k, v in targets.items()}
    payload = dict(
        title="Transaction Banking Retail Region XI",
        generated=dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        sources=dict(atm=os.path.basename(atm_f), edc=os.path.basename(edc_f), lvm=os.path.basename(lvm_f), wpr=os.path.basename(wpr_f) if wpr_f else "",
                     duta=os.path.basename(duta_f) if duta_f else "", usak=os.path.basename(usak_f) if usak_f else "",
                     senator=os.path.basename(sen_f) if sen_f else "", akuisisi=os.path.basename(akq_f) if akq_f else ""),
        areas=sorted(set(AREA_BY_CODE.values())),
        atm=build_atm(atm_f, names),
        edc=None,
        lvm=None,
        targets=targets,
    )
    payload["edc"], merchants = build_edc(edc_f, names)
    payload["lvm"], lvm_merchants = build_lvm(lvm_f, names)
    wpr = build_wpr(wpr_f, names) if wpr_f else None
    payload["wpr"] = dict(year=wpr["year"], weeks=wpr["weeks"], n=wpr["n"], nmids=wpr["nmids"], file=os.path.basename(wpr_f)) if wpr else None
    payload["branches"] = {k: v for k, v in names.items() if k}
    payload["duta"] = build_duta(duta_f) if duta_f else None
    payload["usak"] = build_usak(usak_f) if usak_f else None
    sen = build_senator(sen_f) if sen_f else None
    payload["senator"], sen_uni = (sen if sen else (None, []))
    payload["akuisisi"] = build_akuisisi_edc(akq_f) if akq_f else None
    dk, dk2 = load_data_key(a.secret)
    enc, h = encrypt(payload, [], dk)
    menc, mh = seal(dk2, merchants)
    lenc, lh = seal(dk2, lvm_merchants)
    # data ringkas untuk peran khusus Pencarian (tanpa angka dashboard lain)
    cari = dict(title=payload["title"], generated=payload["generated"], areas=payload["areas"],
                branches=payload["branches"], sources=dict(edc=payload["sources"]["edc"], lvm=payload["sources"]["lvm"]),
                edc=dict(week=payload["edc"]["week"], year=payload["edc"]["year"]), lvm=dict(asof=payload["lvm"]["asof"]))
    cenc, ch = seal(dk2, cari)
    wh = ""
    if wpr:
        wenc, wh = seal(dk, wpr)
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, "wpr.enc.json"), "w", encoding="utf-8") as f:
            json.dump(wenc, f, separators=(",", ":"))
    sh = ""
    if sen_uni:
        senc, sh = seal(dk, dict(u=sen_uni))
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, "senator.enc.json"), "w", encoding="utf-8") as f:
            json.dump(senc, f, separators=(",", ":"))
    h = hashlib.sha256((h + mh + lh + wh + ch + sh).encode()).hexdigest()[:16]
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "cari.enc.json"), "w", encoding="utf-8") as f:
        json.dump(cenc, f, separators=(",", ":"))
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
    log(f"SELESAI -> data.enc.json ({size:,.0f} KB), merchant.enc.json ({msize:,.0f} KB), lvm.enc.json ({lsize:,.0f} KB); terenkripsi. Kunci data: {a.secret}")


if __name__ == "__main__":
    main()
