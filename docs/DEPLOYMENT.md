# Menyiapkan LINUSKU untuk produksi

LINUSKU dapat memakai proyek Supabase yang sudah ada jika proyek itu dikelola oleh pemilik LINUSKU dan tabel/policy-nya tidak berbenturan dengan aplikasi lain. Proyek khusus tetap pilihan paling terisolasi. Skema LINUSKU hanya mengelola tabel `buses`, `stops`, `bus_positions`, dan `crowd_reports`; jangan jalankan migrasi sebelum memastikan tabel-tabel tersebut memang milik LINUSKU dan membuat cadangan.

## 1. Siapkan database

1. Verifikasi Project URL pada Supabase cocok dengan `NEXT_PUBLIC_SUPABASE_URL` yang digunakan LINUSKU.
2. Periksa isi tabel LINUSKU yang sudah ada dan buat cadangan sebelum migrasi.
3. Jalankan `supabase/schema.sql` di SQL Editor. Skrip membuat tabel bila belum ada, menerapkan policy/constraint LINUSKU, dan menyelaraskan seed halte; skrip tidak menghapus tabel aplikasi lain.
4. Setelah membuat cadangan, jalankan `supabase/migrations/20261118_improvements.sql`. Migrasi menyiapkan pengaturan V2, audit admin, riwayat GPS, validasi geofence dinamis, serta retensi otomatis melalui `pg_cron`.
5. Jalankan `supabase/migrations/20261119_product_ux.sql` untuk tabel permintaan driver dan push subscription, unique assignment armada, pengaturan jadwal/ETA baru, serta fungsi transaksi pengaturan.
6. Pastikan migrasi berhasil dengan memeriksa `linusku_settings_v2`, `admin_audit_log`, `bus_position_history`, `driver_sessions`, `driver_access_requests`, `push_subscriptions`, dan jadwal `linusku-*` pada `cron.job`.
7. Buat akun Supabase Auth untuk tiap petugas yang menjalankan tracker.
8. Hubungkan akun petugas ke bus yang ditugaskan:

```sql
update public.buses
set driver_id = 'UUID_AKUN_PETUGAS'
where id = 'LINUS-01';
```

Ulangi langkah terakhir untuk setiap bus yang diaktifkan. Hanya akun yang tercatat sebagai `driver_id` untuk bus aktif yang dapat menulis lokasi GPS.

## 2. Atur Vercel

Tambahkan variabel berikut untuk Production, Preview, dan Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

Panel `/admin` hanya mengizinkan `kampuskitaapp@gmail.com` dan `jualbeliusupolmed@gmail.com`; kedua email harus sudah diverifikasi di Supabase Auth. Allowlist ditetapkan di server dan tidak dapat diganti oleh environment variable.

Nilai `SUPABASE_SECRET_KEY` hanya berada di Vercel dan server lokal. API menggunakannya di server untuk laporan komunitas serta operasi admin. Jangan gunakan awalan `NEXT_PUBLIC_`, jangan masukkan nilainya ke Git, dan jangan kirim ke browser. `SUPABASE_SERVICE_ROLE_KEY` tetap didukung untuk proyek lama.

`NEXT_PUBLIC_MAP_TILE_URL` bersifat opsional dan hanya diperlukan bila memilih penyedia peta khusus (`pmtiles_r2`) di pengaturan admin.

### Login Google

1. Di Supabase, buka **Authentication → Sign In / Providers → Google**, aktifkan provider, lalu isi OAuth Client ID dan Client Secret dari Google Cloud.
2. Pada konfigurasi OAuth Google, daftarkan callback Supabase yang ditampilkan di halaman provider, biasanya `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Di **Authentication → URL Configuration**, jadikan URL aplikasi LINUSKU sebagai **Site URL** (bukan homepage situs induk KampusKita), lalu tambahkan URL login yang tepat ke **Redirect URLs**:
   - `https://<domain>/admin`
   - `https://<domain>/driver`
   - URL lokal `http://localhost:3000/admin` dan `http://localhost:3000/driver` bila dipakai.
   Jika LINUSKU dipasang di subpath, sertakan subpath itu pada kedua URL. Supabase akan kembali ke Site URL bila URL redirect tidak masuk allowlist.
4. Akun admin Google harus memakai salah satu dari dua email yang diizinkan. Driver dapat masuk dengan Google atau email/password.

Pendaftaran melalui `/driver` membuat akun pengguna biasa. Pengguna dapat mengajukan akses driver dari profil, memantau status persetujuan, dan mengubah nama/password. Admin meninjau permintaan, menetapkan armada, dan dapat mengubah jenis akun dari panel. Driver dapat mengubah status kepadatan dengan cepat saat pelacakan; penugasan armada tetap dikelola admin. Akun driver harus ditugaskan ke armada aktif sebelum GPS dapat dikirim. Outbox lokal menahan sampel saat offline dan mengirim ulang setelah koneksi pulih. Pilihan "Ingat saya" mempertahankan sesi lintas tab/browser; jika dimatikan, sesi hanya disimpan pada tab saat ini. Password akun tidak dapat dibaca kembali; admin hanya dapat menetapkan password baru.

## 3. Gunakan panel admin

1. Pastikan `schema.sql` dan migrasi perbaikan telah diterapkan. Migrasi V2 harus berhasil sebelum panel admin memakai semua pengaturan dan tab audit/riwayat.
2. Masuk ke `/admin` memakai `kampuskitaapp@gmail.com` atau `jualbeliusupolmed@gmail.com`.
3. Tambahkan atau pilih armada, buat akun driver bila perlu, lalu tetapkan satu driver ke satu bus.
4. Tinjau tab **Permintaan driver**, pilih armada yang tersedia, lalu setujui atau tolak pengajuan.
5. Atur hari/jam operasional, jadwal keberangkatan, parameter ETA, batas geofence, peta, dan fitur. Perubahan geofence berlaku pada validasi API serta trigger database.
6. Gunakan filter tabel, bulk actions, template CSV, import CSV/JSON, dan ekspor sesuai kebijakan operasional.
7. Panel menampilkan health check, posisi GPS, laporan 24 jam, detail audit, riwayat posisi, dan replay rute.

## 4. Verifikasi setelah rilis

1. Buka `/api/health`; respons harus memuat `ok: true` dan jumlah bus terdaftar.
2. Masuk pada `/driver` sebagai akun yang telah ditugaskan, kemudian kirim GPS perangkat. Akun yang belum memiliki penugasan tidak dapat memulai pelacakan.
3. Buka halaman utama pada perangkat lain saat jam operasional. Status segar sebaiknya menampilkan sumber posisi `GPS driver`.
4. Kirim laporan komunitas. Laporan boleh muncul sebagai `Laporan mahasiswa` hanya ketika GPS driver untuk bus tersebut tidak aktif.
5. Masuk ke `/admin` dan pastikan health check, posisi, armada, halte, akun, permintaan driver, laporan, pengaturan, audit, replay, dan riwayat GPS terbaca.
6. Uji mode offline pada tracker: status harus menunjukkan offline/queued, sampel harus tetap antre, dan pengiriman harus pulih otomatis ketika jaringan kembali.
7. Uji notifikasi penumpang: aktifkan izin browser dan opt-in, pilih halte favorit, lalu pastikan notifikasi hanya dikirim saat ETA melewati ambang.

## Monitoring uptime

Pasang UptimeRobot atau monitor uptime lain ke `https://<domain-linusku>/api/health`. Atur pemeriksaan dari interval yang wajar dan pastikan respons memuat `ok: true`. Cukup satu monitor untuk menjaga ketersediaan; monitor gratis yang mati atau terhenti dapat membuat pemantauan tidak berjalan dan berisiko membiarkan proyek Supabase paket gratis masuk mode *auto-pause*.
