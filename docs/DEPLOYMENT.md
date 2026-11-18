# Menyiapkan LINUSKU untuk produksi

LINUSKU dapat memakai proyek Supabase yang sudah ada jika proyek itu dikelola oleh pemilik LINUSKU dan tabel/policy-nya tidak berbenturan dengan aplikasi lain. Proyek khusus tetap pilihan paling terisolasi. Skema LINUSKU hanya mengelola tabel `buses`, `stops`, `bus_positions`, dan `crowd_reports`; jangan jalankan migrasi sebelum memastikan tabel-tabel tersebut memang milik LINUSKU dan membuat cadangan.

## 1. Siapkan database

1. Verifikasi Project URL pada Supabase cocok dengan `NEXT_PUBLIC_SUPABASE_URL` yang digunakan LINUSKU.
2. Periksa isi tabel LINUSKU yang sudah ada dan buat cadangan sebelum migrasi.
3. Jalankan `supabase/schema.sql` di SQL Editor. Skrip membuat tabel bila belum ada, menerapkan policy/constraint LINUSKU, dan menyelaraskan seed halte; skrip tidak menghapus tabel aplikasi lain.
4. Buat akun Supabase Auth untuk tiap petugas yang menjalankan tracker.
5. Hubungkan akun petugas ke bus yang ditugaskan:

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
LINUSKU_ADMIN_EMAILS
```

Isi `LINUSKU_ADMIN_EMAILS` dengan satu atau lebih email akun Supabase Auth yang boleh mengelola `/admin`, dipisahkan koma. Jika kosong, server memakai `kampuskitaapp@gmail.com` sebagai superadmin bawaan. Email admin harus sudah diverifikasi. Jangan menaruh email admin di variabel `NEXT_PUBLIC_*`.

Nilai `SUPABASE_SECRET_KEY` hanya berada di Vercel dan server lokal. API menggunakannya di server untuk laporan komunitas serta operasi admin. Jangan gunakan awalan `NEXT_PUBLIC_`, jangan masukkan nilainya ke Git, dan jangan kirim ke browser. `SUPABASE_SERVICE_ROLE_KEY` tetap didukung untuk proyek lama.

### Login Google

1. Di Supabase, buka **Authentication → Sign In / Providers → Google**, aktifkan provider, lalu isi OAuth Client ID dan Client Secret dari Google Cloud.
2. Pada konfigurasi OAuth Google, daftarkan callback Supabase yang ditampilkan di halaman provider, biasanya `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Di **Authentication → URL Configuration**, jadikan URL aplikasi LINUSKU sebagai **Site URL** (bukan homepage situs induk KampusKita), lalu tambahkan URL login yang tepat ke **Redirect URLs**:
   - `https://<domain>/admin`
   - `https://<domain>/driver`
   - URL lokal `http://localhost:3000/admin` dan `http://localhost:3000/driver` bila dipakai.
   Jika LINUSKU dipasang di subpath, sertakan subpath itu pada kedua URL. Supabase akan kembali ke Site URL bila URL redirect tidak masuk allowlist.
4. Akun admin Google harus memakai email yang tercantum di `LINUSKU_ADMIN_EMAILS`. Driver dapat masuk dengan Google atau email/password.

Pendaftaran driver mandiri bersifat opsional melalui `/driver`. Driver dapat masuk dengan email/password atau Google, memilih "Ingat saya" untuk mempertahankan sesi lintas tab/browser, dan mengubah nama, password baru, serta status kepadatan dari profilnya. Jika "Ingat saya" dimatikan, sesi hanya disimpan pada tab saat ini. Akun baru belum memiliki hak mengirim GPS sampai admin menugaskan akun itu ke armada aktif di `/admin`; penugasan bus tetap hanya dapat diubah admin. Admin dapat mengatur status kepadatan pilihan driver dari panel. Password akun tidak dapat dibaca kembali; admin hanya dapat menetapkan password baru.

## 3. Gunakan panel admin

1. Pastikan migrasi terbaru dari `supabase/schema.sql` telah diterapkan, termasuk tabel `linusku_settings` dan fungsi `admin_reorder_stops`.
2. Masuk ke `/admin` memakai akun yang terdaftar di `LINUSKU_ADMIN_EMAILS`.
3. Tambahkan atau pilih armada, buat akun driver bila perlu, lalu tetapkan satu driver ke satu bus.
4. Atur hari dan jam layanan serta koordinat dan urutan halte. Perubahan halte dan pengaturan dibaca oleh peta publik dan kalkulasi ETA.
5. Panel menampilkan posisi GPS yang diperbarui setiap 10 detik dan laporan kepadatan yang masuk dalam 24 jam terakhir.

## 4. Verifikasi setelah rilis

1. Buka `/api/health`; respons harus memuat `ok: true` dan jumlah bus terdaftar.
2. Masuk pada `/driver` sebagai akun yang telah ditugaskan, kemudian kirim GPS perangkat. Akun yang belum memiliki penugasan tidak dapat memulai pelacakan.
3. Buka halaman utama pada perangkat lain. Status harus berubah menjadi `Live Kampus` dan sumber posisi harus bertuliskan `GPS driver`.
4. Kirim laporan komunitas. Laporan boleh muncul sebagai `Laporan mahasiswa` hanya ketika GPS driver untuk bus tersebut tidak aktif.
5. Masuk ke `/admin` dan pastikan posisi, armada, halte, pengguna, laporan, serta pengaturan operasional terbaca.
