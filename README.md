# Dashboard Transaction Banking Retail Region XI

Dashboard performance produk TBR (**ATM/CRM, EDC Merchant, Livin' Merchant**) Region XI – Bali & Nusa Tenggara,
dengan **Kode Login (otorisasi)** dan data **terenkripsi**, di-hosting gratis melalui **GitHub Pages**.

## Isi dashboard
| Menu | Isi |
|---|---|
| Ringkasan | KPI utama 3 produk, total Fee Based Income TBR, FBI per area, pencapaian target LVM, tabel kinerja per area |
| ATM / CRM | Transaksi, Volume, FBI, Setor Tunai YTD + YoY & MoM, tren bulanan vs tahun lalu, kuadran CRM & tiering ATM, daftar seluruh mesin |
| EDC Merchant | Merchant & mesin EDC, merchant baru, SV / MDFG / Trx / Avg Fund YTD + YoY, SV mingguan, historis SV 2019–sekarang, segmen, kuadran, Top 200 merchant, kinerja per LOB |
| Livin' Merchant | Merchant terdaftar & aktif, akuisisi YTD/MTD vs target, USAK vs target, SV/FBI, akuisisi per bulan, grading, ranking cabang, LOB, Top merchant |
| Scorecard Cabang | Satu tabel per cabang lintas produk (ATM, EDC, LVM) |
| Cari Merchant | 3 sub-menu: Merchant EDC & E-Commerce (nama merchant, official name dengan total per grup, MID, no. rekening), Merchant LVM (nama, MID, no. rekening), dan ATM (ID mesin, nama lokasi); klik hasil untuk performance lengkap |

Semua tabel bisa dicari, diurutkan (klik judul kolom) dan diunduh ke CSV. Filter Area berlaku di semua menu.

## Struktur folder
```
E:\Database TBR\
├── ATM - YTD ....xlsx            <- file sumber (TIDAK ikut ke GitHub)
├── LVM - YTD ....xlsx
├── Merchant W.. ....xlsx
└── Dashboard_TBR\                <- folder ini = repository GitHub
    ├── index.html                 halaman login + dashboard
    ├── assets\                    tampilan, grafik & logika (tanpa library eksternal)
    ├── data\data.enc.json         data olahan TERENKRIPSI (AES-256-GCM)
    ├── data\merchant.enc.json     data per MID EDC untuk menu Cari Merchant (terenkripsi, ±5 MB)
    ├── data\lvm.enc.json          data per merchant Livin' untuk menu Cari Merchant (terenkripsi, ±11 MB)
    ├── data\version.json          penanda versi (untuk notifikasi data baru)
    ├── scripts\build_data.py      pengolah Excel -> data terenkripsi
    ├── access_codes.csv           DAFTAR KODE LOGIN (lokal saja, di-.gitignore)
    ├── update_dashboard.bat       klik 2x untuk update data + upload ke GitHub
    └── preview_lokal.bat          lihat dashboard di komputer sendiri
```

## Instalasi awal (sekali saja)
1. Pasang **Python 3.10+** (centang *Add to PATH*) dan **Git for Windows**.
2. Buka Command Prompt di folder `Dashboard_TBR`, lalu:
   ```
   pip install -r requirements.txt
   ```
3. Buat repository baru di GitHub (disarankan **Private** jika akun mendukung Pages untuk private repo; Public juga aman karena data terenkripsi).
4. Hubungkan folder ini ke repository:
   ```
   git init
   git branch -M main
   git remote add origin https://github.com/<akun>/<nama-repo>.git
   git add -A
   git commit -m "Dashboard TBR Region XI"
   git push -u origin main
   ```
5. Di GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / root → Save**.
   Dalam 1–2 menit dashboard tersedia di `https://<akun>.github.io/<nama-repo>/`.

## Update data (rutin)
1. Ganti / timpa file Excel di `E:\Database TBR\` dengan versi terbaru. Nama file boleh berubah selama diawali
   `ATM`, `Merchant`, dan `LVM` (yang dipakai adalah file terbaru).
2. Klik dua kali **`update_dashboard.bat`**.
3. Selesai — dashboard online ikut berubah ±1–2 menit. Pengguna yang sedang membuka dashboard akan melihat
   notifikasi **"Data baru tersedia"** (dicek otomatis tiap 5 menit).

Agar benar-benar otomatis, jadwalkan `update_dashboard.bat auto` lewat **Windows Task Scheduler** (mis. tiap pagi 08.00).

## Kode Login
- Diatur di `access_codes.csv` (kolom `kode,nama,akses`). Saat pertama dijalankan dibuat otomatis 5 kode:
  1 Admin Region (lihat semua area) + 1 per Area.
- `akses` = `REGION` (semua area) atau nama area, mis. `AREA DENPASAR` (tampilan terkunci ke area itu).
- Tambah/hapus/ganti kode → simpan file → jalankan `update_dashboard.bat`. Kode lama otomatis tidak berlaku.
- Kode minimal 8 karakter. **Jangan pernah upload `access_codes.csv`** (sudah dikecualikan lewat `.gitignore`).

## Keamanan
- Data di GitHub hanya berupa ciphertext AES-256-GCM. Kunci data dibungkus per kode login (PBKDF2-SHA256, 310.000 iterasi),
  sehingga tanpa kode yang valid data tidak bisa dibaca walau repository publik.
- File Excel mentah, nama pemilik, alamat & no. telepon **tidak** ikut di-upload. Nama merchant, MID dan nomor rekening ikut (terenkripsi) untuk menu Cari Merchant.
- Pembatasan per-area adalah pembatasan tampilan: semua kode membuka paket data yang sama. Jika suatu area benar-benar
  tidak boleh melihat area lain, buat repository/dashboard terpisah per area.
- Login tersimpan per tab browser (sessionStorage) dan hilang saat tab ditutup atau klik **Keluar**.
