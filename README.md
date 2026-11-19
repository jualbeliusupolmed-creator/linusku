# LINUSKU — Pelacak Posisi Bus Lintas USU

[![CI](https://github.com/jualbeliusupolmed-creator/linusku/actions/workflows/ci.yml/badge.svg)](https://github.com/jualbeliusupolmed-creator/linusku/actions/workflows/ci.yml)

Aplikasi web & PWA ringan untuk memantau posisi dan estimasi waktu tiba (ETA) bus **Lintas USU (Linus)** antar fakultas dan halte di Kampus USU Padang Bulan.

## Cara kerja

1. **Edge & In-Memory Cached Polling (`/api/positions`)**:
   - Menggantikan koneksi WebSocket langsung per pengguna (yang dibatasi 200 koneksi di Supabase Free).
   - Server menyimpan *in-memory cache* selama **3 detik** + *request coalescing* (`inflightRequest`), ditambah header `Cache-Control: public, s-maxage=3, stale-while-revalidate=5` untuk Cloudflare CDN.
   - Cache ini mengurangi permintaan berulang dalam satu instance. Kapasitas produksi tetap perlu diuji pada lingkungan deployment yang digunakan.
2. **Peta Tahan Trafik Tinggi (`LinusMap.tsx`)**:
   - Menggunakan tile **CartoDB Voyager** secara default (bisa diganti ke **PMTiles Cloudflare R2** lewat `NEXT_PUBLIC_MAP_TILE_URL`) agar tidak terkena blokir `429` dari server OpenStreetMap standar.
3. **Keamanan Driver, Laporan, dan Geofence (`/driver` & `supabase/schema.sql`)**:
   - Autentikasi petugas menggunakan **Supabase Auth** (`buses.driver_id = auth.uid()`).
   - Validasi ganda di aplikasi dan PostgreSQL: menolak titik di luar koordinat Kampus USU Padang Bulan (`lat 3.550..3.575`, `lng 98.648..98.665`), waktu posisi lama/masa depan, atau lompatan kecepatan `> 80 km/jam`.
   - Laporan mahasiswa masuk melalui `/api/crowd`, dibatasi per pengirim, diperiksa terhadap rute, dan disimpan paling lama 24 jam. Laporan komunitas tidak pernah menggantikan posisi GPS driver.
   - Dilengkapi **Screen Wake Lock API** agar layar HP supir tidak mati otomatis saat bertugas.
4. **Anti Auto-Pause Supabase (`/api/health`)**:
   - Endpoint ringan untuk dipanggil *cron job* gratis setiap 2–3 hari agar proyek Supabase Free tidak *auto-pause* saat libur kuliah.

## Konfigurasi produksi

Gunakan proyek Supabase khusus LINUSKU. Jalankan `supabase/schema.sql` pada proyek tersebut, lalu tetapkan variabel berikut di Vercel dan lingkungan lokal:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

`SUPABASE_SECRET_KEY` hanya digunakan pada server untuk menyimpan laporan mahasiswa. Jangan beri awalan `NEXT_PUBLIC_` dan jangan masukkan nilainya ke repositori.

Panduan lengkap pembuatan database, penugasan akun driver, dan pemeriksaan pascarilis tersedia di [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Menjalankan & Menguji Proyek di Lokal

```bash
cd linusku
npm install
npm run check   # Menjalankan tsc --noEmit, vitest, dan next build
npm run dev     # Menjalankan server lokal di http://localhost:3000
```

Variabel publik opsional `NEXT_PUBLIC_CONTACT_URL` mengatur tautan "Lapor masalah / Kontak". Kosongkan nilainya agar tautan disembunyikan.

## Monitoring

Pasang monitor uptime seperti UptimeRobot untuk memanggil `https://<domain-linusku>/api/health` secara berkala. Gunakan interval yang wajar dan pantau respons `ok: true`. Hindari mengandalkan satu cron gratis saja: proyek Supabase pada paket gratis dapat masuk *auto-pause* saat tidak ada aktivitas yang cukup, termasuk jika monitor atau cron berhenti berjalan.
