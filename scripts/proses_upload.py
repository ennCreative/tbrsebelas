"""
Dashboard TBR Region XI — proses upload data dari dashboard (dijalankan GitHub Actions).

  python scripts/proses_upload.py check   -> cek apakah ada upload baru (status 'menunggu')
  python scripts/proses_upload.py build   -> unduh file aktif, olah dengan build_data.py, perbarui status

Secret GitHub yang WAJIB (Settings > Secrets and variables > Actions):
  SB_SERVICE_KEY  service_role key / secret key Supabase (rahasia, HANYA di GitHub Secrets)
Opsional:
  SB_URL          URL project Supabase; bila kosong dibaca dari assets/config.js
  DATA_KEY, DATA_KEY_CARI  bila kosong diambil dari tabel app_keys di Supabase
"""
import datetime as dt, json, os, shutil, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUCKET = "data-upload"
WAJIB = {"atm": "ATM & CRM", "merchant": "Merchant (e-Channel)", "lvm": "Livin' Merchant"}
NAMA = dict(WAJIB, wpr="WPR", duta="Duta Transaksi", usak="USAK LVM pegawai", senator="Senator", akuisisi="Akuisisi EDC")


def env(k, required=True):
    v = os.environ.get(k, "").strip()
    if not v and required:
        sys.exit(f"Secret {k} belum diisi di GitHub (Settings > Secrets and variables > Actions).")
    return v


def url_from_config():
    import re
    try:
        txt = open(os.path.join(REPO, "assets", "config.js"), encoding="utf-8").read()
        m = re.search(r'supabaseUrl\s*:\s*"([^"]+)"', txt)
        return m.group(1) if m else ""
    except OSError:
        return ""


SB = (env("SB_URL", False) or url_from_config()).rstrip("/")
if not SB:
    sys.exit("URL Supabase tidak ditemukan: isi supabaseUrl di assets/config.js atau secret SB_URL.")
if "/rest/v1" in SB:
    SB = SB.split("/rest/v1")[0]
KEY = env("SB_SERVICE_KEY")
# kunci lama service_role berbentuk JWT (eyJ...) dipakai juga di Authorization;
# kunci baru (sb_secret_...) cukup di header apikey, gateway Supabase yang mengubahnya.
H = {"apikey": KEY, **({"Authorization": f"Bearer {KEY}"} if KEY.startswith("eyJ") else {})}
if KEY.startswith("sb_publishable_") or KEY.count(".") == 2 and '"anon"' in __import__("base64").urlsafe_b64decode(KEY.split(".")[1] + "==").decode("utf-8", "ignore"):
    sys.exit("SB_SERVICE_KEY berisi kunci publik (anon/publishable). Isi dengan service_role key atau secret key (sb_secret_...).")


def call(method, path, body=None, headers=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SB + path, data=data, method=method,
                                 headers={**H, **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            out = r.read()
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "ignore")[:300]
        if e.code in (401, 403):
            sys.exit(f"Supabase menolak akses ({e.code}). Periksa secret SB_SERVICE_KEY (harus service_role / secret key) dan SB_URL. {msg}")
        if e.code == 404 and "data_uploads" in path:
            sys.exit("Tabel data_uploads tidak ditemukan. Jalankan supabase_upload.sql di Supabase.")
        raise RuntimeError(f"HTTP {e.code} untuk {path.split('?')[0]}: {msg}")
    except urllib.error.URLError as e:
        sys.exit(f"Tidak bisa terhubung ke Supabase ({SB}). Periksa secret SB_URL. {e.reason}")
    return out if raw else (json.loads(out) if out else None)


def rows(query):
    return call("GET", "/rest/v1/data_uploads?" + query) or []


def patch(ids, **vals):
    if ids:
        call("PATCH", f"/rest/v1/data_uploads?id=in.({','.join(str(i) for i in ids)})", vals)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def output(**kv):
    f = os.environ.get("GITHUB_OUTPUT")
    for k, v in kv.items():
        print(f"{k}={v}")
        if f:
            with open(f, "a") as fh:
                fh.write(f"{k}={v}\n")


def remove_objects(r):
    names = [f"{r['path']}/part-{i:03d}" for i in range(r["bagian"])]
    try:
        call("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": names})
    except Exception as e:  # tidak fatal
        print(f"  (gagal menghapus file lama {r['nama_file']}: {e})")


def check():
    pend = rows("status=eq.menunggu&select=id")
    output(pending="true" if pend else "false")


def build():
    pend = rows("status=eq.menunggu&select=*&order=created_at.asc")
    if not pend:
        output(built="false")
        return
    aktif = rows("status=eq.aktif&select=*&order=created_at.desc")
    # file yang dipakai per jenis: upload menunggu terbaru, kalau tidak ada pakai yang aktif
    pakai = {}
    for r in sorted(pend, key=lambda r: r["created_at"], reverse=True) + aktif:
        pakai.setdefault(r["jenis"], r)
    kurang = [NAMA[j] for j in WAJIB if j not in pakai]
    if kurang:
        msg = "Menunggu file wajib yang belum pernah diupload: " + ", ".join(kurang) + "."
        patch([r["id"] for r in pend], pesan=msg)
        print("Menunggu file wajib: " + ", ".join(kurang))
        output(built="false")
        return

    ids = [r["id"] for r in pend]
    patch(ids, status="diproses", pesan="Sedang diolah GitHub Actions…")
    work = tempfile.mkdtemp()
    src, sec = os.path.join(work, "src"), os.path.join(work, "rahasia")
    os.makedirs(src); os.makedirs(sec)
    try:
        for j, r in pakai.items():
            dest = os.path.join(src, os.path.basename(r["nama_file"]))
            print(f"Unduh {NAMA[j]} ({r['ukuran']/1e6:.1f} MB)")
            with open(dest, "wb") as fh:
                for i in range(r["bagian"]):
                    fh.write(call("GET", f"/storage/v1/object/{BUCKET}/{r['path']}/part-{i:03d}", raw=True))
            if os.path.getsize(dest) != r["ukuran"]:
                raise RuntimeError(f"Ukuran {r['nama_file']} tidak cocok setelah diunduh; upload ulang file ini.")
        keys = {}
        if not (env("DATA_KEY", False) and env("DATA_KEY_CARI", False)):
            keys = {r["id"]: r["k"] for r in (call("GET", "/rest/v1/app_keys?select=id,k") or [])}
        k1, k2 = env("DATA_KEY", False) or keys.get(1, ""), env("DATA_KEY_CARI", False) or keys.get(2, "")
        if not (k1 and k2):
            raise RuntimeError("Kunci data (app_keys id 1 dan 2) tidak ditemukan di Supabase. Jalankan isi _rahasia/supabase_kunci.sql.")
        with open(os.path.join(sec, "data_key.txt"), "w") as fh:
            fh.write(k1.strip())
        with open(os.path.join(sec, "data_key_cari.txt"), "w") as fh:
            fh.write(k2.strip())
        p = subprocess.run([sys.executable, os.path.join(REPO, "scripts", "build_data.py"),
                            "--source", src, "--secret", sec, "--out", os.path.join(REPO, "data")],
                           capture_output=True, text=True)
        log = (p.stdout + "\n" + p.stderr).strip()
        # repo publik: log Actions bisa dibaca siapa saja, jadi rincian hanya disimpan di riwayat upload (khusus admin)
        print("Pengolahan data " + ("selesai." if p.returncode == 0 else "GAGAL, rincian ada di menu Update data."))
        if p.returncode != 0:
            raise RuntimeError("Gagal mengolah data:\n" + "\n".join(log.splitlines()[-12:]))
    except Exception as e:
        patch(ids, status="gagal", pesan=str(e)[:1800], processed_at=now())
        for r in pend:
            remove_objects(r)
        shutil.rmtree(work, ignore_errors=True)
        sys.exit("Pengolahan gagal; rincian ada di menu Update data (riwayat upload).")

    baris = [l.replace("[build]", "", 1).rstrip() for l in log.splitlines() if l.startswith("[build]")]
    ringkas = [l.strip() for l in baris if l.strip() and not l.strip().startswith("SELESAI")][:25]
    patch(ids, status="aktif", pesan="Berhasil diolah.\n" + "\n".join(ringkas)[:1800], processed_at=now())
    # upload lama untuk jenis yang sama diganti; upload menunggu yang lebih lama juga diganti oleh yang terbaru
    pakai_ids = {r["id"] for r in pakai.values()}
    lama = [r for r in aktif + pend if r["jenis"] in {x["jenis"] for x in pend} and r["id"] not in pakai_ids]
    patch([r["id"] for r in lama], status="diganti", processed_at=now())
    for r in lama:
        remove_objects(r)
    for r in rows("status=eq.dibatalkan&select=*"):
        remove_objects(r)
    shutil.rmtree(work, ignore_errors=True)
    output(built="true")


if __name__ == "__main__":
    {"check": check, "build": build}[sys.argv[1] if len(sys.argv) > 1 else "check"]()
