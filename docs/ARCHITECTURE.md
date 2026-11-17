# Arsitektur MVP & Strategi Pelacakan LINUSKU

## 1. Ringkasan Sistem
**LINUSKU** adalah aplikasi web/PWA ringan untuk memantau posisi dan estimasi waktu tiba (ETA) bus **Lintas USU (Linus)** antar fakultas dan halte di Kampus USU Padang Bulan secara *real-time*.

- **Frontend & PWA**: Next.js 14 (App Router) + Tailwind CSS + Leaflet (OpenStreetMap — gratis tanpa batas kuota API Maps).
- **Real-Time Engine**: Supabase Realtime (`postgres_changes` pada tabel `bus_positions` + opsional *Broadcast Channel* `linus:live`).
- **Database**: Supabase PostgreSQL (`buses`, `stops`, `bus_positions`, `crowd_reports`).

## 2. Alur Data & Perhitungan ETA
1. **Tracker / Pengirim GPS (`/driver`)**:
   - Browser HP di bus mengambil koordinat lewat `navigator.geolocation.watchPosition` setiap 3–5 detik.
   - Data `(bus_id, lat, lng, speed_kmh, occupancy, updated_at)` di-*upsert* ke tabel `bus_positions`.
2. **Peta Penumpang (`/`)**:
   - Mahasiswa membuka halaman utama -> langsung subscribe ke Supabase Realtime `bus_positions`.
   - Jika variabel lingkungan Supabase belum diisi, aplikasi otomatis berjalan dalam **Mode Simulasi Lokal** agar UI/UX dan perhitungan ETA tetap bisa diuji.
3. **Perhitungan ETA Halte**:
   - Jarak bus ke setiap halte dihitung dengan rumus **Haversine** mengikuti segmen rute melingkar Kampus Padang Bulan (Pintu 1 → Hukum → FISIP → Perpustakaan → Biro/Pancasila → FEB → FMIPA → Vokasi/Pintu 4 → Teknik → Kedokteran/RS USU → kembali ke Pintu 1).
   - `ETA (menit) = (Jarak Rute dalam km / Kecepatan Rata-rata 18 km/jam) * 60 + (Jumlah Halte Dilewati * 0,4 menit)`.

## 3. Perbandingan: Driver GPS vs Crowdsourcing Mahasiswa

| Faktor | Dedicated Tracker / HP Supir | Crowdsourcing Mahasiswa |
| :--- | :--- | :--- |
| **Akurasi & Kontinuitas** | Tinggi dan stabil sepanjang jam operasional (07.00–17.00 WIB). | Bergantung pada ada/tidaknya penumpang yang mau menyalakan GPS di dalam bus. |
| **Konsumsi Baterai** | Hanya ditanggung 1 perangkat per bus (bisa colok charger/powerbank di dashboard bus). | Menguras baterai HP mahasiswa jika tidak dibatasi auto-stop saat turun. |
| **Risiko Data Palsu (Troll)** | Sangat rendah karena akses halaman `/driver` dikunci PIN/akun petugas. | Tinggi jika tanpa validasi geofence/radius dan deteksi kecepatan (*anti-spoofing*). |
| **Biaya & Birokrasi Awal** | Butuh koordinasi izin dengan pengelola Linus / supir (atau biaya unit GPS ~Rp150–300rb/bus). | Nol birokrasi — bisa langsung diluncurkan oleh mahasiswa untuk mahasiswa. |

### Rekomendasi Strategi Hybrid untuk USU
1. **Fase 1 (Minggu 1–2 — Validasi Cepat)**: Mulai dengan **Crowdsourcing Terbatas** oleh relawan/mahasiswa yang sering naik Linus + fitur *tap* status kepadatan (`Lega / Sedang / Penuh`) di halte.
2. **Fase 2 (Bulan 1+ — Skala Penuh)**: Setelah trafik harian terbukti di mahasiswa USU (bisa ditarik/diintegrasikan dengan ekosistem **StudentPlace**), ajukan kerja sama ke Biro/Pengelola Linus USU untuk menaruh 1 HP Android bekas atau GPS *tracker* murah yang terpasang di dashboard setiap bus aktif.
