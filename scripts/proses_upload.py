"""
Dashboard TBR Region XI — proses upload data dari dashboard (dijalankan GitHub Actions).

  python scripts/proses_upload.py check   -> cek apakah ada upload baru (status 'menunggu')
  python scripts/proses_upload.py build   -> unduh file aktif, olah dengan build_data.py, perbarui status

Variabel lingkungan (GitHub > Settings > Secrets and variables > Actions):
  SB_URL          URL project Supabase, mis. https://xxxx.supabase.co
  SB_SERVICE_KEY  service_role key Supabase (rahasia, HANYA di GitHub Secrets)
  DATA_KEY        isi file _rahasia/data_key.txt
  DATA_KEY_CARI   isi file _rahasia/data_key_cari.txt
"""
import datetime as dt, json, os, shutil, subprocess, sys, tempfile, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUCKET = "data-upload"
WAJIB = {"atm": "ATM & CRM", "merchant": "Merchant (e-Channel)", "lvm": "Livin' Merchant"}
NAMA = dict(WAJIB, wpr="WPR", duta="Duta Transaksi", usak="USAK LVM pegawai", senator="Senator", akuisisi="Akuisisi EDC")


def env(k):
    v = os.environ.get(k, "").strip()
    if not v:
        sys.exit(f"Secret {k} belum diisi di GitHub (Settings > Secrets and variables > Actions).")
    return v


SB = env("SB_URL").rstrip("/")
if "/rest/v1" in SB:
    SB = SB.split("/rest/v1")[0]
KEY = env("SB_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def call(method, path, body=None, headers=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SB + path, data=data, method=method,
                                 headers={**H, **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
    with urllib.request.urlopen(req, timeout=300) as r:
        out = r.read()
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
        with open(os.path.join(sec, "data_key.txt"), "w") as fh:
            fh.write(env("DATA_KEY"))
        with open(os.path.join(sec, "data_key_cari.txt"), "w") as fh:
            fh.write(env("DATA_KEY_CARI"))
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
