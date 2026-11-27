"""
Pantau upload baru dari menu "Update data" dan jalankan pengolahan segera (dijalankan .github/workflows/pantau.yml).

Jadwal bawaan GitHub (cron) sering telat sampai berjam-jam, jadi workflow ini berjaga ~50 menit,
mengecek Supabase tiap menit, lalu menjalankan workflow deploy.yml begitu ada upload yang selesai.
Setelah selesai berjaga, ia menjalankan dirinya lagi (pukul 06.00-22.00 WITA), sehingga penjagaan bersambung.
"""
import datetime as dt, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proses_upload as P   # memakai koneksi & secret yang sama (SB_SERVICE_KEY)

MENIT = int(os.environ.get("PANTAU_MENIT", "50"))
TENANG = 90        # detik: tunggu sampai upload terakhir berumur 90 detik, supaya beberapa file sekaligus diolah bersama
WITA = dt.timezone(dt.timedelta(hours=8))


def jalankan(wf):
    r = subprocess.run(["gh", "workflow", "run", wf, "--ref", os.environ.get("GITHUB_REF_NAME", "main")],
                       capture_output=True, text=True)
    print(f"menjalankan {wf}: {'ok' if r.returncode == 0 else 'gagal ' + r.stderr.strip()[:200]}")
    return r.returncode == 0


def main():
    akhir = time.time() + MENIT * 60
    terakhir = None
    while True:
        try:
            pend = P.rows("status=eq.menunggu&select=id,created_at")
        except Exception as e:
            print(f"cek gagal: {str(e)[:120]}")
            pend = []
        if pend:
            ids = frozenset(r["id"] for r in pend)
            terbaru = max(dt.datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) for r in pend)
            umur = (dt.datetime.now(dt.timezone.utc) - terbaru).total_seconds()
            if ids != terakhir and umur >= TENANG and jalankan("deploy.yml"):
                print(f"{len(ids)} upload baru -> pengolahan dijalankan")
                terakhir = ids
        if time.time() + 60 > akhir:
            break
        time.sleep(60)
    jam = dt.datetime.now(WITA).hour
    if os.environ.get("GITHUB_ACTIONS") and 6 <= jam < 22:
        jalankan("pantau.yml")
    else:
        print("di luar jam 06.00-22.00 WITA: penjagaan berhenti sampai jadwal pagi")


if __name__ == "__main__":
    main()
