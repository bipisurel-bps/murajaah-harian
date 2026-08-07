# Tahfiz Pro - Portal Murajaah Santri & Panel Ustadz

Aplikasi web berbasis Node.js (Express) & SQLite yang dirancang untuk mempermudah pencatatan, penyetoran, dan pemantauan murajaah hafalan Al-Qur'an santri secara real-time. Dilengkapi dengan fitur rekaman suara langsung dari browser santri dan dashboard monitoring ustadz yang interaktif.

Aplikasi dirancang sederhana agar dapat diimplementasikan siapa saja dengan tingkat kesulitan rendah

---

## Fitur Utama

### 1. Portal Santri
* **Autentikasi Aman**: Log masuk menggunakan Username dan Password unik yang didaftarkan oleh admin/Ustadz.
* **Target Juz 1-30 Dinamis**: Pilihan target Juz yang melacak pencapaian total ayat hafalan secara akurat sesuai jumlah ayat standar Al-Qur'an pada Juz bersangkutan (misal Juz 30 = 564 ayat, Juz 1 = 148 ayat).
* **Dropdown Nama Surah Terfilter**: Dropdown surah yang otomatis tersaring menampilkan surah yang ada di dalam nomor Juz yang sedang disetor.
* **Perekam Suara (Voice Note)**: Perekam suara berbasis MediaRecorder API langsung di dalam browser santri, lengkap dengan pratinjau audio sebelum setoran dikirimkan.
* **Progress Tracker**: Progress bar kemajuan setoran dalam persentase Juz yang ditargetkan.

### 2. Panel Monitoring Ustadz (Admin)
* **Registrasi Akun Terpusat**: Ustadz dapat menambahkan santri baru, menentukan asal sekolah, serta membuat username dan password login mereka secara langsung.
* **Credential Listings**: Tabel penampil daftar akun login santri untuk mempermudah pencatatan dan distribusi kredensial.
* **Daftar Log Setoran**: Tabel rekapitulasi setoran yang memuat Nama, Sekolah, Juz, Surah, Rentang Ayat, Jumlah Ayat, Tanggal Setor, dan Audio Player untuk memutar rekaman suara santri.
* **Filter Pencarian**: Kolom pencarian dinamis untuk memfilter data berdasarkan nama santri, sekolah, juz, atau surah.

---

## Struktur Proyek

```
tahfiz-app/
├── public/                 # File statis frontend
│   ├── uploads/            # Direktori penyimpanan rekaman suara santri (webm)
│   ├── index.html          # Portal UI Santri (Login & Dashboard)
│   ├── admin.html          # Dashboard UI Ustadz (Registrasi & Monitoring)
│   ├── manifest.json       # Aset PWA Manifest
│   └── sw.js               # Service Worker placeholder
├── server.js               # Backend API Express & SQLite Database
├── package.json            # Konfigurasi dependensi project
└── README.md               # Panduan dokumentasi
```

---

## Cara Instalasi & Menjalankan Lokal

### Prasyarat
* Pastikan Anda sudah menginstal [Node.js](https://nodejs.org/) di komputer atau VPS Anda.

### Langkah-langkah
1. **Clone Repositori**:
   ```bash
   git clone https://github.com/bipisurel-bps/murajaah-harian.git
   cd murajaah-harian
   ```

2. **Instal Dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan Aplikasi**:
   ```bash
   node server.js
   ```

4. **Akses di Browser**:
   * **Portal Santri (Login)**: `http://localhost:3000`
   * **Dashboard Ustadz (Admin)**: `http://localhost:3000/admin.html`

---

## Panduan Deployment ke VPS Linux

1. **Salin Kode**: Tarik kode dari repositori GitHub di VPS Anda:
   ```bash
   git clone https://github.com/bipisurel-bps/murajaah-harian.git /var/www/tahfiz-app
   cd /var/www/tahfiz-app
   npm install
   ```

2. **Gunakan Process Manager (PM2)**: Agar aplikasi tetap berjalan di background dan otomatis restart ketika server reboot:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "tahfiz-app"
   pm2 save
   pm2 startup
   ```

3. **Konfigurasi Port Dinamis (Opsional)**: Anda dapat mengganti port port server melalui environment variable:
   ```bash
   PORT=8080 pm2 start server.js --name "tahfiz-app"
   ```

4. **Konfigurasi Nginx & SSL (Sangat Direkomendasikan)**: 
   Agar dapat diakses dengan domain (HTTPS), arahkan Nginx reverse proxy ke port Node.js Anda (default: `3000`) dan instal SSL gratis menggunakan Let's Encrypt / Certbot.
