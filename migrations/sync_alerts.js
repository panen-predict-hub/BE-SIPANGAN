import { pool } from '../src/config/database.js';
import { v4 as uuidv4 } from 'uuid';

const syncAlerts = async () => {
  console.log('Mulai proses sinkronisasi alert EWS...');
  let connection;
  try {
    connection = await pool.getConnection();
    
    // 1. Ambil semua pasangan komoditas dan wilayah yang memiliki data harga
    const [pairs] = await connection.query(`
      SELECT DISTINCT commodity_id, region_id 
      FROM prices
    `);
    
    console.log(`Ditemukan ${pairs.length} pasangan wilayah & komoditas. Memeriksa ambang batas...`);
    
    let createdCount = 0;
    let skippedCount = 0;

    for (const pair of pairs) {
      const { commodity_id, region_id } = pair;

      // 2. Ambil data harga terbaru untuk pasangan ini
      const [latestPriceRows] = await connection.query(`
        SELECT price, date 
        FROM prices 
        WHERE commodity_id = ? AND region_id = ? 
        ORDER BY date DESC LIMIT 1
      `, [commodity_id, region_id]);

      if (latestPriceRows.length === 0) continue;
      const { price, date } = latestPriceRows[0];

      // 3. Hitung rata-rata harga dari 12 data terakhir
      const [avgRows] = await connection.query(`
        SELECT AVG(price) as average_price FROM (
          SELECT price FROM prices 
          WHERE commodity_id = ? AND region_id = ?
          ORDER BY date DESC LIMIT 12
        ) as recent_prices
      `, [commodity_id, region_id]);
      
      const average_price = avgRows[0]?.average_price;
      if (!average_price) continue;

      // 4. Ambil ambang batas threshold komoditas
      const [thresholdRows] = await connection.query(`
        SELECT waspada_percentage, kritis_percentage, het_nominal 
        FROM commodity_thresholds 
        WHERE commodity_id = ?
      `, [commodity_id]);

      if (thresholdRows.length === 0) continue;
      const { waspada_percentage, kritis_percentage, het_nominal } = thresholdRows[0];

      // 5. Hitung rasio dan periksa apakah melebihi ambang batas
      const ratio = price / average_price;
      const waspadaThreshold = 1 + (parseFloat(waspada_percentage) / 100);
      const kritisThreshold = 1 + (parseFloat(kritis_percentage) / 100);

      let type = null;
      let title = '';
      let message = '';

      // Dapatkan nama wilayah
      const [regionRows] = await connection.query('SELECT name FROM regions WHERE id = ?', [region_id]);
      const regionName = regionRows.length > 0 ? regionRows[0].name : 'Wilayah Tidak Diketahui';

      // Dapatkan nama komoditas
      const [commodityRows] = await connection.query('SELECT name FROM commodities WHERE id = ?', [commodity_id]);
      const commodityName = commodityRows.length > 0 ? commodityRows[0].name : 'Komoditas';

      // Pengecekan HET atau Persentase Kenaikan
      if (het_nominal !== null && het_nominal !== undefined && price > parseFloat(het_nominal)) {
        type = 'critical';
        title = `Peringatan Kritis Harga ${commodityName} (Melebihi HET/HAP)`;
        message = `Harga ${commodityName} di wilayah ${regionName} sebesar Rp ${Math.round(price).toLocaleString('id-ID')} telah melebihi batas Harga Eceran Tertinggi (HET) / Harga Acuan Penjualan (HAP) nasional sebesar Rp ${Math.round(het_nominal).toLocaleString('id-ID')}.`;
      } else if (ratio > kritisThreshold) {
        type = 'critical';
        title = `Peringatan Kritis Harga ${commodityName}`;
        message = `Harga ${commodityName} di wilayah ${regionName} telah melonjak ${((ratio - 1) * 100).toFixed(2)}% melebihi rata-rata, melampaui batas kritis ${kritis_percentage}%.`;
      } else if (ratio > waspadaThreshold) {
        type = 'warning';
        title = `Peringatan Waspada Harga ${commodityName}`;
        message = `Harga ${commodityName} di wilayah ${regionName} mengalami kenaikan ${((ratio - 1) * 100).toFixed(2)}% melebihi rata-rata, melampaui batas waspada ${waspada_percentage}%.`;
      }

      // 6. Jika melebihi batas, masukkan ke dalam tabel alerts (jika belum ada)
      if (type) {
        const [existingAlert] = await connection.query(`
          SELECT id FROM alerts 
          WHERE commodity_id = ? AND region_id = ? AND price = ? AND type = ?
        `, [commodity_id, region_id, price, type]);

        if (existingAlert.length === 0) {
          const id = uuidv4();
          await connection.query(`
            INSERT INTO alerts (id, title, message, type, commodity_id, region_id, price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [id, title, message, type, commodity_id, region_id, price]);
          createdCount++;
          console.log(`[ALERT BARU] ${regionName} - ${commodityName}: ${type.toUpperCase()} (Harga: Rp ${Math.round(price)})`);
        } else {
          skippedCount++;
        }
      }
    }

    console.log(`\nSinkronisasi alert selesai.`);
    console.log(`Alert Dibuat: ${createdCount}`);
    console.log(`Alert Dilewati (Sudah Ada): ${skippedCount}`);

  } catch (error) {
    console.error('Terjadi kesalahan saat sinkronisasi alert:', error);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
};

syncAlerts();
