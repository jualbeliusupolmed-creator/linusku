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

Tambahkan tiga variabel berikut untuk Production, Preview, dan Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

Nilai `SUPABASE_SECRET_KEY` hanya berada di Vercel dan server lokal. Variabel ini menyimpan laporan komunitas setelah API memeriksa rute dan pembatasan pengiriman. Jangan gunakan awalan `NEXT_PUBLIC_`.

## 3. Verifikasi setelah rilis

1. Buka `/api/health`; respons harus memuat `ok: true` dan jumlah bus terdaftar.
2. Masuk pada `/driver` sebagai akun yang telah ditugaskan, kemudian kirim GPS perangkat.
3. Buka halaman utama pada perangkat lain. Status harus berubah menjadi `Live Kampus` dan sumber posisi harus bertuliskan `GPS driver`.
4. Kirim laporan komunitas. Laporan boleh muncul sebagai `Laporan mahasiswa` hanya ketika GPS driver untuk bus tersebut tidak aktif.
