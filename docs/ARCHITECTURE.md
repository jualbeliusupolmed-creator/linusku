# Arsitektur MVP & Strategi Pelacakan LINUSKU

## 1. Ringkasan Sistem
**LINUSKU** adalah aplikasi web/PWA ringan untuk memantau posisi dan estimasi waktu tiba (ETA) bus **Lintas USU (Linus)** antar fakultas dan halte di Kampus USU Padang Bulan secara *real-time*.

- **Frontend & PWA**: Next.js App Router + Tailwind CSS + Leaflet.
- **Distribusi posisi**: polling `/api/positions` setiap 4 detik dengan cache tiga detik dan jeda otomatis saat tab tidak aktif.
- **Database**: Supabase PostgreSQL (`buses`, `stops`, `bus_positions`, `crowd_reports`, `linusku_settings`).
- **Pengelolaan**: `/admin` memakai Supabase Auth dan allowlist email server-side; mutasi dilakukan oleh API server, bukan dari browser dengan secret key.

## 2. Alur Data & Perhitungan ETA
1. **Tracker / Pengirim GPS (`/driver`)**:
   - Driver masuk dengan email/password atau Google. Opsi "Ingat saya" menyimpan sesi di local storage; jika dimatikan, sesi hanya bertahan di tab tersebut.
   - Profil driver mengelola nama, password baru, dan preferensi kepadatan. Penugasan bus tetap dikelola admin; akun tanpa penugasan aktif tidak dapat memulai pelacakan.
   - Browser HP di bus mengambil koordinat lewat `navigator.geolocation.watchPosition` dan menulis `(bus_id, lat, lng, speed_kmh, occupancy, updated_at)` ke `bus_positions`.
   - RLS memvalidasi bahwa akun hanya dapat menulis posisi bus yang ditugaskan kepadanya.
2. **Peta Penumpang (`/`)**:
   - Mahasiswa membuka halaman utama -> membaca `/api/positions`.
   - GPS driver selalu menjadi sumber utama. Laporan mahasiswa hanya dipakai bila belum ada GPS driver aktif pada armada tersebut.
   - Daftar armada aktif, halte, jam layanan, dan geometri rute dibaca dari API publik.
   - Jika variabel lingkungan Supabase belum diisi, aplikasi otomatis berjalan dalam **Mode Simulasi Lokal** agar UI/UX dan perhitungan ETA tetap bisa diuji.
3. **Perhitungan ETA Halte**:
   - Lokasi bus dan halte diproyeksikan ke geometri rute; kemajuan dan jarak dihitung menurut panjang kumulatif segmen, bukan jumlah segmen.
   - `ETA (menit) = jarak rute / kecepatan efektif * 60`, dengan batas bawah kecepatan 12 km/jam. Perkiraan belum memperhitungkan kemacetan atau waktu berhenti.
   - Urutan halte mengikuti data database ketika Supabase aktif, atau `USU_STOPS` di `src/data/usuRoutes.ts` pada mode lokal.

## 3. Panel Admin dan Otorisasi

- Admin masuk di `/admin` melalui email/password atau Google OAuth. Hanya `kampuskitaapp@gmail.com` dan `jualbeliusupolmed@gmail.com` yang diizinkan.
- Setiap endpoint `/api/admin/*` memverifikasi access token dan allowlist di server. Kunci Supabase server hanya digunakan di lingkungan server.
- Panel mengelola armada, akun dan penugasan driver, status kepadatan pilihan driver, halte dan urutannya, laporan crowd, serta hari dan jam layanan.
- Pengaturan layanan disimpan pada `linusku_settings`. Perubahan halte dan urutannya digunakan oleh endpoint rute publik dan kalkulasi ETA.
- Pendaftaran driver mandiri di `/driver` bersifat opsional. Akun baru belum dapat mengirim posisi sebelum ditugaskan oleh admin.

## 4. Perbandingan: Driver GPS vs Crowdsourcing Mahasiswa

| Faktor | Dedicated Tracker / HP Supir | Crowdsourcing Mahasiswa |
| :--- | :--- | :--- |
| **Akurasi & Kontinuitas** | Tinggi dan stabil sepanjang jam operasional (07.00–17.00 WIB). | Bergantung pada ada/tidaknya penumpang yang mau menyalakan GPS di dalam bus. |
| **Konsumsi Baterai** | Hanya ditanggung 1 perangkat per bus (bisa colok charger/powerbank di dashboard bus). | Menguras baterai HP mahasiswa jika tidak dibatasi auto-stop saat turun. |
| **Risiko Data Palsu (Troll)** | Lebih rendah karena akun Supabase Auth harus ditugaskan ke bus dan posisi divalidasi oleh RLS serta batas lokasi/kecepatan. | Tinggi jika tanpa validasi geofence/radius dan deteksi kecepatan (*anti-spoofing*). |
| **Biaya & Birokrasi Awal** | Butuh koordinasi izin dengan pengelola Linus / supir (atau biaya unit GPS ~Rp150–300rb/bus). | Nol birokrasi — bisa langsung diluncurkan oleh mahasiswa untuk mahasiswa. |

### Rekomendasi Strategi Hybrid untuk USU
1. **Fase 1 (Minggu 1–2 — Validasi Cepat)**: Mulai dengan **Crowdsourcing Terbatas** oleh relawan/mahasiswa yang sering naik Linus + fitur *tap* status kepadatan (`Lega / Sedang / Penuh`) di halte.
2. **Fase 2 (Bulan 1+ — Skala Penuh)**: Setelah trafik harian terbukti di mahasiswa USU (bisa ditarik/diintegrasikan dengan ekosistem **StudentPlace**), ajukan kerja sama ke Biro/Pengelola Linus USU untuk menaruh 1 HP Android bekas atau GPS *tracker* murah yang terpasang di dashboard setiap bus aktif.
