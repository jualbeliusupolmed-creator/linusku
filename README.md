# LINUSKU — Live Tracker Bus Lintas USU (Production-Ready)

Aplikasi web & PWA ringan untuk memantau posisi *real-time* dan estimasi waktu tiba (ETA) bus **Lintas USU (Linus)** antar fakultas dan halte di Kampus USU Padang Bulan, dirancang sanggup melayani **10.000 mahasiswa aktif bersamaan** dengan biaya infrastruktur Rp0.

## Arsitektur Hemat Kuota (Skala 10.000+ Mahasiswa Aktif)

1. **Edge & In-Memory Cached Polling (`/api/positions`)**:
   - Menggantikan koneksi WebSocket langsung per pengguna (yang dibatasi 200 koneksi di Supabase Free).
   - Server menyimpan *in-memory cache* selama **3 detik** + *request coalescing* (`inflightRequest`), ditambah header `Cache-Control: public, s-maxage=3, stale-while-revalidate=5` untuk Cloudflare CDN.
   - Hasilnya: 10.000 mahasiswa yang membuka peta bersamaan hanya memicu **1 query database setiap 3 detik**.
2. **Peta Tahan Trafik Tinggi (`LinusMap.tsx`)**:
   - Menggunakan tile **CartoDB Voyager** secara default (bisa diganti ke **PMTiles Cloudflare R2** lewat `NEXT_PUBLIC_MAP_TILE_URL`) agar tidak terkena blokir `429` dari server OpenStreetMap standar.
3. **Keamanan Driver & Geofence Kampus (`/driver` & `supabase/schema.sql`)**:
   - Autentikasi petugas menggunakan **Supabase Auth** (`buses.driver_id = auth.uid()`).
   - Validasi ganda di aplikasi dan *constraint* PostgreSQL: menolak titik di luar koordinat Kampus USU Padang Bulan (`lat 3.550..3.575`, `lng 98.648..98.665`) atau lompatan kecepatan `> 80 km/jam`.
   - Dilengkapi **Screen Wake Lock API** agar layar HP supir tidak mati otomatis saat bertugas.
4. **Anti Auto-Pause Supabase (`/api/health`)**:
   - Endpoint ringan untuk dipanggil *cron job* gratis setiap 2–3 hari agar proyek Supabase Free tidak *auto-pause* saat libur kuliah.

## Menjalankan & Menguji Proyek di Lokal

```bash
cd /Users/ayhoo/Projects/LINUSKU
npm install
npm run check   # Menjalankan tsc --noEmit, vitest, dan next build
npm run dev     # Menjalankan server lokal di http://localhost:3000
```
