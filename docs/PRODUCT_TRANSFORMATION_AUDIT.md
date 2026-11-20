# LINUSKU Product Transformation Audit

## Ringkasan

Audit awal berfokus pada alur utama mahasiswa: buka aplikasi, pilih halte, memahami status bus, melihat perkiraan kedatangan, dan melaporkan kepadatan.

## Temuan awal

### Tinggi

- Respons `/api/positions` sebelumnya dapat kembali dengan payload lama saat upstream gagal, sehingga status posisi berisiko dianggap tetap mutakhir.
- Service worker dapat menyimpan shell dan rute API, termasuk alur yang berhubungan dengan posisi.
- Status `live`, `delayed`, `offline`, dan `simulation` belum selalu dibedakan secara jelas di peta.
- Pelaporan berada dalam satu blok panjang, sehingga pilihan utama mahasiswa sulit dipindai.
- Bantuan panduan tampil sebagai beberapa elemen yang berulang.

### Sedang

- Status pemuatan belum ada pada area estimasi kedatangan.
- Jalur rute fallback straight-line belum diberi status di pengalaman pengguna.
- Status kepadatan dan sumber laporan perlu selalu dibedakan dari GPS driver.

### Rendah

- Beberapa kontrol lama memakai teks/ikon yang tidak konsisten untuk status.

## Perbaikan yang telah diterapkan

- Respons posisi sekarang memakai `Cache-Control: no-store`.
- Service worker tidak lagi menerima cache untuk `/api/positions` dan endpoint laporan/driver.
- Saat pengambilan posisi gagal, aplikasi menampilkan `offline` tanpa payload lama sebagai fallback.
- Peta menampilkan chip: pemuatan, posisi segar, posisi tertunda, laporan mahasiswa, GPS tidak tersedia, atau demo/simulasi.
- Pilihan pelaporan mobile dipindah ke panel ringkas yang tertutup sampai dibutuhkan.
- Tautan panduan duplikat dihapus.
- Panel panduan dapat dibuka dengan keyboard.
- Polling sekarang berhenti saat di luar jam operasional.
- Jalur fallback rute menampilkan peringatan bahwa estimasi dapat kurang akurat.
- Lokasi pengguna tidak diminta otomatis saat halaman dibuka; permintaan hanya terjadi setelah aksi pengguna.
- Polling berhenti pada tab yang kembali aktif di luar jam operasional.
- Pengambilan posisi gagal sekarang mengosongkan data lama dan menghapus waktu sinkronisasi lama.
- Peta menampilkan mask area luar kampus.
- Laporan crowd tidak lagi melewati validasi kedekatan rute hanya karena `stopId` ada.
- Sinkronisasi favorit menampilkan pesan saat akun gagal menyimpan preferensi.
- Ikon PWA PNG 512x512 ditambahkan ke manifest dan metadata aplikasi.
- Jadwal operasional tetap dipaksakan menjadi Senin-Jumat 07.00-17.00 WIB pada API admin dan UI admin.

## Batas yang memerlukan verifikasi manusia

- Ketersediaan, kualitas, dan kewajaran data GPS driver membutuhkan data produksi nyata.
- Rute resmi dan urutan halte tetap harus dikonfirmasi oleh pengelola transportasi USU.
- Jadwal operasional tetap membutuhkan sumber resmi.
- Notifikasi push membutuhkan izin browser dan infrastruktur pengiriman push aktif.
- Ketersediaan laporan kepadatan bergantung pada konfigurasi Supabase.
