# Arsitektur MVP & Strategi Pelacakan LINUSKU

## 1. Ringkasan Sistem
**LINUSKU** adalah aplikasi web/PWA ringan untuk memantau posisi dan estimasi waktu tiba (ETA) bus **Lintas USU (Linus)** antar fakultas dan halte di Kampus USU Padang Bulan pada jam operasional Senin-Jumat 07.00-17.00 WIB.

- **Frontend & PWA**: Next.js App Router + Tailwind CSS + Leaflet.
- **Distribusi posisi**: polling `/api/positions` setiap 4 detik dengan cache tiga detik dan jeda otomatis saat tab tidak aktif.
- **Database**: Supabase PostgreSQL (`buses`, `stops`, `bus_positions`, `crowd_reports`, `linusku_settings_v2`) plus admin audit and GPS history tables.
- **Pengelolaan**: `/admin` memakai Supabase Auth dan allowlist email server-side; mutasi dilakukan oleh API server, bukan dari browser dengan secret key.

## 2. Alur Data & Perhitungan ETA
1. **Tracker / Pengirim GPS (`/driver`)**:
   - Driver masuk dengan email/password atau Google. Opsi "Ingat saya" menyimpan sesi di local storage; jika dimatikan, sesi hanya bertahan di tab tersebut.
   - Pengguna dapat mengajukan akses driver, memantau status persetujuan, dan menerima penugasan armada secara langsung setelah admin menyetujuinya.
   - Preflight memeriksa HTTPS, koneksi, dukungan geolocation, dan izin browser sebelum pelacakan dimulai.
   - `DriverTrackingManager` menyimpan satu sampel per armada di outbox `localStorage`, melakukan retry dengan backoff, dan hanya menandai sampel terkirim setelah ACK server. Status koneksi dan antrean terlihat oleh driver.
   - Sesi driver dicatat melalui `driver_sessions`; RLS tetap memvalidasi bahwa akun hanya dapat menulis posisi bus yang ditugaskan kepadanya.
2. **Peta Penumpang (`/`)**:
   - Mahasiswa membuka halaman utama -> membaca `/api/positions`, daftar armada, halte, jadwal, dan geometri rute dari API publik.
   - Tautan `?stop=<id>` membuka halte tujuan langsung. Halte favorit tersimpan lokal dan menjadi target notifikasi keberangkatan.
   - Notifikasi browser memakai izin eksplisit, opt-in lokal, ambang ETA, dan deduplikasi. Batas kecepatan, stale threshold, jadwal, confidence, dan arrival time ditampilkan bersama arrival board.
   - GPS driver selalu menjadi sumber utama. Laporan mahasiswa hanya dipakai bila belum ada GPS driver aktif pada armada tersebut. Laporan dapat dikirim dari lokasi GPS atau satu tap pada halte yang dipilih.
   - Pengaturan admin menentukan batas umur GPS, mode simulasi, sumber peta, fitur laporan, dan notifikasi. Tanpa kredensial Supabase, aplikasi otomatis memakai **Mode Simulasi Lokal**.
3. **Perhitungan ETA Halte**:
   - Lokasi bus dan halte diproyeksikan ke geometri rute; kemajuan dan jarak dihitung menurut panjang kumulatif segmen, bukan jumlah segmen.
   - ETA menggabungkan jarak rute, kecepatan efektif, median kecepatan historis, pengali lalu lintas, durasi berhenti rata-rata, dan confidence berbasis freshness.
   - Jadwal keberangkatan mengikuti zona waktu admin. Urutan halte mengikuti data database ketika Supabase aktif, atau `USU_STOPS` di `src/data/usuRoutes.ts` pada mode lokal.

## 3. Panel Admin dan Otorisasi

- Admin masuk di `/admin` melalui email/password atau Google OAuth. Hanya `kampuskitaapp@gmail.com` dan `jualbeliusupolmed@gmail.com` yang diizinkan.
- Setiap endpoint `/api/admin/*` memverifikasi access token dan allowlist di server. Kunci Supabase server hanya digunakan di lingkungan server.
- Panel menampilkan data pengguna dan driver secara terpisah. Jenis akun disimpan pada `app_metadata` dan hanya dapat diubah admin; data profil pribadi tetap dikelola pengguna pada metadata profilnya.
- Panel memisahkan daftar Pengguna dan Driver. Hanya admin yang dapat mengubah jenis akun; data profil tetap dapat dikelola pemilik akun, sedangkan penugasan armada ditetapkan admin.
- Panel mengelola armada, profil, halte/rute, laporan komunitas, jadwal keberangkatan, ETA, penyedia peta, fitur, dan geofence. Pengaturan disimpan per kategori pada `linusku_settings_v2`; transaksi native PostgreSQL menjaga penyimpanan lintas kategori tetap konsisten.
- Panel menyediakan health check, pencarian/filter/paginasi tabel inti, bulk actions, import/export CSV/JSON, review permintaan driver, detail audit, serta visualisasi replay GPS.
- Perubahan admin dicatat di `admin_audit_log`; setiap pembaruan GPS diarsipkan ke `bus_position_history` dan dibersihkan otomatis sesuai retensi migrasi.
- Pendaftaran di `/driver` membuat akun pengguna biasa. Pengguna dapat mengajukan akses driver; admin menyetujui, menolak, dan menetapkan armada dari tab permintaan driver.

## 4. Perbandingan: Driver GPS vs Crowdsourcing Mahasiswa

| Faktor | Dedicated Tracker / HP Supir | Crowdsourcing Mahasiswa |
| :--- | :--- | :--- |
| **Akurasi & Kontinuitas** | Tinggi dan stabil sepanjang jam operasional (07.00–17.00 WIB). | Bergantung pada ada/tidaknya penumpang yang mau menyalakan GPS di dalam bus. |
| **Konsumsi Baterai** | Hanya ditanggung 1 perangkat per bus (bisa colok charger/powerbank di dashboard bus). | Menguras baterai HP mahasiswa jika tidak dibatasi auto-stop saat turun. |
| **Risiko Data Palsu (Troll)** | Lebih rendah karena akun Supabase Auth harus ditugaskan ke bus dan posisi divalidasi oleh RLS serta batas lokasi/kecepatan. | Tinggi jika tanpa validasi geofence/radius dan deteksi kecepatan (*anti-spoofing*). |
| **Biaya & Birokrasi Awal** | Butuh koordinasi izin dengan pengelola Linus / supir (atau biaya unit GPS ~Rp150–300rb/bus). | Nol birokrasi — bisa langsung diluncurkan oleh mahasiswa untuk mahasiswa. |

### Rekomendasi Strategi Hybrid untuk USU
1. **Fase 1 (Minggu 1–2 — Validasi Cepat)**: Mulai dengan **Crowdsourcing Terbatas** oleh relawan/mahasiswa yang sering naik Linus + fitur *tap* status kepadatan (`Lega / Sedang / Penuh`) di halte.
2. **Fase 2 (Bulan 1+ — Skala Penuh)**: Setelah trafik harian terbukti di mahasiswa USU, ajukan kerja sama ke Biro/Pengelola Linus USU untuk menaruh 1 HP Android bekas atau GPS *tracker* murah yang terpasang di dashboard setiap bus aktif.
