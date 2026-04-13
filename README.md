# Gazete Arşiv

Tarihi Türk gazeteleri için aranabilir bir arşiv uygulaması.

## Kurulum ve Başlatma

1.  **Vercel Postgres Kurulumu:** Vercel üzerinde bir Postgres veritabanı oluşturun ve bağlantı bilgilerini `.env.local` dosyasına ekleyin (`POSTGRES_URL`).
2.  **Bağımlılıkları Yükleyin:**
    ```bash
    npm install
    ```
3.  **Veritabanı Şemasını Oluşturun:**
    ```bash
    npm run setup-db
    ```
4.  **Uygulamayı Başlatın:**
    ```bash
    npm run dev
    ```

## Kullanım Adımları

1.  **Admin Paneline Gidin:** `/admin` sayfasına gidin.
2.  **Yeni Kaynak Ekle:** "Kaynaklar" sekmesinden gazete bilgilerini (Ad, URL, Selector vb.) girin ve kaydedin.
3.  **Selektörü Test Et:** "Test" butonu ile CSS selektörlerinin doğru çalışıp çalışmadığını (ilk 5 sonuç üzerinden) kontrol edin.
4.  **Scrape Et:** "Scrape" sekmesinden ilgili gazeteyi seçin ve "Linkleri Çek" butonu ile PDF bağlantılarını veritabanına kaydedin.
5.  **OCR İşle:** "OCR İşle" sekmesinden PDF'leri indirip metne dönüştürme işlemini başlatın.

## Önemli Notlar

-   **OCR için Gereksinimler:** Yerel çalışmada `pdf2pic` kütüphanesi için sisteminizde **Ghostscript** ve **ImageMagick/GraphicsMagick** yüklü olmalıdır.
-   **Vercel Dağıtımı:** Dağıtım sonrası Vercel üzerinde `POSTGRES_URL` ortam değişkeninin tanımlı olduğundan emin olun.
