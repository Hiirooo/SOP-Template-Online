# SOP Studio

SOP Studio adalah editor berbasis web untuk menyusun tabel Prosedur Operasional Standar sekaligus menggambar alur proses di atasnya. Aplikasi berjalan langsung di browser tanpa backend dan dapat digunakan melalui GitHub Pages atau hosting statis lain.

## Fitur utama

- Editor tiga panel: palet bentuk, kanvas, dan inspector properti.
- Bentuk mulai/selesai, proses, keputusan, dokumen, teks, dan konektor berlabel.
- Drag-and-drop, resize, duplikat, pengaturan layer, grid, snapping, serta pan/zoom.
- Penambahan dan penghapusan baris kegiatan maupun kolom pelaksana.
- Penempatan objek otomatis ke sel pelaksana yang aktif.
- Penyuntingan langsung untuk judul, identitas instansi, metadata, tabel, dan catatan.
- Unggah logo instansi dengan optimasi ukuran otomatis.
- Undo/redo dan penyimpanan otomatis di browser.
- Impor dan ekspor proyek berformat `.sop.json`.
- Ekspor PNG resolusi tinggi.
- Ekspor DOCX berisi tampilan visual SOP dan salinan tabel yang tetap dapat diedit.
- Cetak langsung atau simpan sebagai PDF melalui browser.
- Migrasi otomatis dari format penyimpanan editor versi sebelumnya.

## Menjalankan

Tidak diperlukan proses build.

```bash
git clone https://github.com/Hiirooo/SOP-Template-Online.git
cd SOP-Template-Online
python3 -m http.server 8080
```

Buka `http://localhost:8080` pada browser. Aplikasi juga dapat dijalankan dengan membuka `index.html`, tetapi server lokal lebih disarankan agar seluruh fitur unduhan konsisten.

## Cara singkat

1. Klik atau seret bentuk dari palet kiri ke kanvas.
2. Klik ganda objek untuk mengubah teksnya.
3. Aktifkan **Konektor**, lalu klik objek awal dan objek tujuan.
4. Klik garis untuk mengatur label, warna, gaya, atau jalurnya.
5. Klik sel pelaksana untuk menjadikannya aktif; objek baru dapat ditempatkan otomatis ke sel tersebut.
6. Gunakan menu **Ekspor** untuk mengunduh PNG, DOCX, PDF, atau cadangan proyek.

## Penyimpanan dan privasi

Dokumen tersimpan di `localStorage` browser dan tidak dikirim ke server. Untuk memindahkan dokumen ke perangkat lain atau membuat cadangan, gunakan **Ekspor → Cadangan proyek**.

Ekspor gambar dan Word menggunakan dependensi browser yang dimuat dari CDN:

- [html2canvas](https://html2canvas.hertzen.com/)
- [docx](https://github.com/dolanmiu/docx)
- [FileSaver.js](https://github.com/eligrey/FileSaver.js)

## Dukungan browser

Direkomendasikan menggunakan versi terbaru Google Chrome, Microsoft Edge, Firefox, atau Safari. Ekspor DOCX dan PNG memerlukan koneksi internet ketika dependensi CDN belum tersimpan di cache browser.
