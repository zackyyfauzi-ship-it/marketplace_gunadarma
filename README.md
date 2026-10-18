# PasarKampus Gunadarma

Marketplace lokal untuk jual beli barang preloved antar mahasiswa Universitas Gunadarma. Transaksi tidak memakai payment gateway: pembeli dan penjual menyepakati meetup melalui chat.

## Kebutuhan

- Node.js 20 atau lebih baru
- PostgreSQL 13 atau lebih baru

## Menjalankan di Windows

1. Buat database PostgreSQL `marketplace_gunadarma_app`.
2. Dari PowerShell pada folder proyek, muat skema:

   ```powershell
   psql -U postgres -d marketplace_gunadarma_app -f .\schema.sql
   ```

3. Salin `.env.example` menjadi `.env`, lalu sesuaikan `DATABASE_URL` dan `SESSION_SECRET`.
4. Pasang dependency dan jalankan server:

   ```powershell
   npm install
   npm start
   ```

5. Buka `http://localhost:3000`.

Server menyimpan foto pada folder `uploads/`. Untuk penggunaan di luar komputer lokal, ganti `SESSION_SECRET`, aktifkan HTTPS, dan tinjau kembali kebijakan penyimpanan foto serta backup database.

## Validasi NPM

Pendaftaran dan login memeriksa NPM delapan digit, kode program tiga digit yang terdaftar, tahun masuk yang tidak di masa depan, dan nomor urut yang bukan `000` di backend. Database mengulang validasi format/tahun/nomor urut, serta memakai foreign key dari tiga digit kode program ke tabel `study_programs`. Daftar fakultas dan program tersimpan di `schema.sql`.

## Fitur

- Daftar dan masuk memakai NPM serta kata sandi.
- Profil nama, username opsional, foto, NPM, dan nomor telepon privat.
- Listing foto (maksimal empat), kategori, harga, deskripsi, kondisi, dan lokasi meetup.
- Chat antar pengguna untuk menyepakati transaksi dan meetup.
- Penjual dapat menandai barang terjual; listing terhapus otomatis setelah tiga hari.
