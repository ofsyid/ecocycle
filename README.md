# SmartBin — Panduan Setup Lengkap

## Perangkat yang Dibutuhkan
| Perangkat | Fungsi |
|-----------|--------|
| ESP32 DevKit | Sensor utama (suhu, gas, berat) |
| BME280 | Suhu + Kelembapan |
| MQ-135 | Gas / CO₂ |
| HX711 + Load Cell | Berat sampah (pilih salah satu) |
| HC-SR04 | Tinggi sampah ultrasonik (pilih salah satu) |
| Relay 1-channel | Mekanisme press |
| ESP32-CAM OV2640 | Kamera pengawas |

---

## Wiring ESP32 DevKit (Sensor)

```
BME280:
  SDA  → GPIO 21
  SCL  → GPIO 22
  VCC  → 3.3V
  GND  → GND

MQ-135:
  AOUT → GPIO 34
  VCC  → 5V
  GND  → GND

HX711 (Load Cell):
  DOUT → GPIO 16
  SCK  → GPIO 17
  VCC  → 3.3V
  GND  → GND

HC-SR04 (Ultrasonik):
  TRIG → GPIO 18
  ECHO → GPIO 19  (via resistor 1kΩ atau voltage divider ke 3.3V)
  VCC  → 5V
  GND  → GND

Relay:
  IN   → GPIO 25
  VCC  → 5V / 3.3V (sesuai modul relay)
  GND  → GND
```

---

## Library Arduino yang Diperlukan

Install via **Tools → Manage Libraries**:
1. `Adafruit BME280 Library`
2. `Adafruit Unified Sensor`
3. `HX711 Arduino Library` (by Bogdan Necula)
4. `ArduinoJson` (by Benoit Blanchon)

---

## Langkah Upload

### ESP32 DevKit (Sensor):
1. Buka folder `ESP32_Sensor_Main/`
2. Edit `WIFI_SSID` dan `WIFI_PASSWORD`
3. Pilih board: **ESP32 Dev Module**
4. Upload → buka Serial Monitor (115200 baud)
5. **Catat IP yang muncul**, contoh: `192.168.1.105`

### ESP32-CAM:
1. Buka folder `ESP32CAM_Stream/`
2. Edit `WIFI_SSID` dan `WIFI_PASSWORD`
3. Pilih board: **AI Thinker ESP32-CAM**
4. Sambungkan IO0 ke GND saat upload
5. Upload → lepas IO0 → tekan RESET
6. Buka Serial Monitor → **catat IP kamera**

---

## Konfigurasi Dashboard (script.js)

```javascript
// Baris 3 — IP ESP32 Sensor
const ESP32_IP = "192.168.1.105";  // ← ganti dengan IP dari Serial Monitor

// Baris terakhir — IP ESP32-CAM
const CAM_IP = "192.168.1.106";    // ← ganti dengan IP kamera
```

---

## Kalibrasi Load Cell

Setelah upload, buka Serial Monitor:
1. Pastikan load cell kosong (terbaca ~0 kg)
2. Letakkan benda dengan berat yang diketahui, misal 1 kg
3. Lihat nilai Serial: `T=xx H=xx Gas=xx Fill=xx%`
4. Jika berat tidak akurat, ubah `CALIBRATION_FACTOR` di baris:
   ```cpp
   float CALIBRATION_FACTOR = 420.0f;  // naik/turun sampai akurat
   ```
5. Upload ulang

---

## Mode Sensor Level

Di `ESP32_Sensor_Main.ino` baris 40:
```cpp
#define USE_LOADCELL true   // true = HX711, false = Ultrasonik HC-SR04
```

---

## Endpoint API ESP32

| Endpoint | Method | Keterangan |
|----------|--------|------------|
| `/data` | GET | JSON sensor (temp, humidity, gas, fillPct, isPress, isFull) |
| `/press` | POST/GET | Aktifkan/hentikan relay press |

### Contoh Response `/data`:
```json
{
  "temp": 28.5,
  "humidity": 65.2,
  "gas": 420,
  "fillPct": 73,
  "isPress": false,
  "isFull": false,
  "bmeOk": true
}
```

---

## Threshold Notifikasi (sinkron dashboard)

| Kondisi | Threshold | Dashboard |
|---------|-----------|-----------|
| Suhu tinggi | > 35°C | ⚠ Panas |
| Kelembapan rendah | < 60% | ⚠ Terlalu kering |
| Kelembapan tinggi | > 70% | ⚠ Terlalu lembap |
| Gas bahaya | > 700 ppm | ⚠ BAHAYA |
| Sampah hampir penuh | ≥ 75% | ⚠ HAMPIR PENUH |
| Sampah penuh | ≥ 95% | 🚨 PENUH — alert banner muncul |
