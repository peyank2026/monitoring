# Switch Monitor

Dashboard monitoring jaringan berbasis Node.js untuk memantau switch melalui SNMP dan host melalui ICMP. Aplikasi menampilkan status perangkat, trafik interface, optical power, latency, packet loss, serta grafik bergaya SmokePing.

## Fitur

- Dashboard switch dan dashboard latency yang terpisah.
- Polling SNMP untuk MikroTik CRS, Huawei, Cisco, dan Juniper.
- Trafik masuk/keluar per interface dengan rentang 6 jam sampai 2 tahun.
- Monitoring ICMP dengan latency minimum, rata-rata, maksimum, dan packet loss.
- Grafik latency bergaya SmokePing.
- User Management untuk menambah user, mengganti password sendiri, dan reset password oleh admin.
- Waktu database dan tampilan menggunakan WIB (UTC+7).
- Pembersihan otomatis data monitoring yang lebih lama dari 2 tahun.

## Persyaratan

- Node.js 18 atau lebih baru.
- MariaDB 10.5 atau lebih baru.
- Perintah `ping` tersedia pada server.
- Akses SNMP dari server ke perangkat yang akan dimonitor.

## Instalasi

1. Instal dependency:

   ```bash
   npm install
   ```

2. Salin contoh konfigurasi dan isi nilainya:

   ```bash
   cp .env.example .env
   ```

3. Buat database dan tabel:

   ```bash
   mariadb -u root -p < db/init.sql
   ```

4. Jalankan aplikasi:

   ```bash
   npm start
   ```

5. Buka `http://localhost:3000`.

### Upgrade database lama

Jika database dibuat sebelum fitur User Management tersedia, jalankan migrasi berikut satu kali:

```bash
mariadb -u root -p < db/migrations/001_user_management.sql
```

## Konfigurasi

Variabel lingkungan utama tersedia di `.env.example`:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME` untuk MariaDB.
- `SESSION_SECRET` untuk keamanan sesi login.
- `SNMP_POLL_INTERVAL` untuk jadwal polling switch (default setiap 5 menit).
- `ICMP_POLL_INTERVAL` untuk jadwal pemeriksaan host (default setiap 1 menit).

Format jadwal menggunakan cron expression.

## Keamanan

Installer database membuat login awal `admin` / `admin123`. Segera ganti password tersebut setelah instalasi dan jangan gunakan kredensial awal di lingkungan produksi.

File `.env` tidak disimpan di Git. Jangan memasukkan password database, session secret, atau SNMP community produksi ke repository.

## Pengembangan

Untuk menjalankan server dengan auto-reload:

```bash
npm run dev
```
