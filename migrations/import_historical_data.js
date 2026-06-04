import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../src/config/database.js';

const toTitleCase = (str) => {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const importHistoricalData = async () => {
  const connection = await pool.getConnection();
  console.log('Mulai proses import data history dari CSV...');

  try {
    const filePath = path.resolve(process.cwd(), 'data/data_final.csv');
    if (!fs.existsSync(filePath)) {
      console.error(`File CSV tidak ditemukan di path: ${filePath}`);
      process.exit(1);
    }

    // 1. Load data region yang sudah ada
    const [existingRegions] = await connection.query('SELECT id, name FROM regions');
    const regionMap = {};
    for (const reg of existingRegions) {
      regionMap[reg.name.toLowerCase()] = reg.id;
    }

    // 2. Load data commodity yang sudah ada
    const [existingCommodities] = await connection.query('SELECT id, name FROM commodities');
    const commodityMap = {};
    for (const comm of existingCommodities) {
      commodityMap[comm.name.toLowerCase()] = comm.id;
    }

    // 3. Load data harga yang sudah ada untuk menghindari duplikasi
    console.log('Memuat data harga yang sudah ada untuk pengecekan duplikasi...');
    const [existingPrices] = await connection.query(
      "SELECT commodity_id, region_id, DATE_FORMAT(date, '%Y-%m-%d') as date_str FROM prices"
    );
    const existingPricesSet = new Set(
      existingPrices.map(p => `${p.commodity_id}_${p.region_id}_${p.date_str}`)
    );
    console.log(`Ditemukan ${existingPricesSet.size} record harga di database.`);

    // 4. Baca CSV baris per baris
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let isHeader = true;
    let newRegionsCount = 0;
    let newCommoditiesCount = 0;
    let insertedPricesCount = 0;
    let skippedPricesCount = 0;
    let batchPrices = [];
    const BATCH_SIZE = 1000;

    for await (const line of rl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }

      if (!line.trim()) continue;

      // Header: series_id,nama_kabupaten_kota,periode_update,kategori,jumlah
      const [series_id, nama_kabupaten_kota, periode_update, kategori, jumlah] = line.split(',');

      if (!nama_kabupaten_kota || !periode_update || !kategori || !jumlah) {
        continue;
      }

      const rawRegionName = nama_kabupaten_kota.trim();
      const rawCommName = kategori.trim();
      const priceValue = parseFloat(jumlah);
      const dateValue = periode_update.trim(); // format YYYY-MM-DD

      if (isNaN(priceValue)) continue;

      // Proses Region
      const regionKey = rawRegionName.toLowerCase();
      let regionId = regionMap[regionKey];
      if (!regionId) {
        regionId = uuidv4();
        const formattedRegName = toTitleCase(rawRegionName);
        await connection.query('INSERT INTO regions (id, name) VALUES (?, ?)', [
          regionId,
          formattedRegName,
        ]);
        regionMap[regionKey] = regionId;
        newRegionsCount++;
        console.log(`Region baru ditambahkan: ${formattedRegName}`);
      }

      // Proses Commodity
      const commKey = rawCommName.toLowerCase();
      let commId = commodityMap[commKey];
      if (!commId) {
        commId = uuidv4();
        const formattedCommName = toTitleCase(rawCommName);
        const unit = 'kg';

        await connection.query('INSERT INTO commodities (id, name, unit) VALUES (?, ?, ?)', [
          commId,
          formattedCommName,
          unit,
        ]);
        // Tambahkan threshold default
        await connection.query(
          'INSERT INTO commodity_thresholds (id, commodity_id, waspada_percentage, kritis_percentage) VALUES (?, ?, ?, ?)',
          [uuidv4(), commId, 10.00, 25.00]
        );
        commodityMap[commKey] = commId;
        newCommoditiesCount++;
        console.log(`Commodity baru ditambahkan: ${formattedCommName}`);
      }

      // Cek Duplikasi Harga
      const priceUniqueKey = `${commId}_${regionId}_${dateValue}`;
      if (existingPricesSet.has(priceUniqueKey)) {
        skippedPricesCount++;
        continue;
      }

      const priceId = uuidv4();
      batchPrices.push([priceId, commId, regionId, priceValue, dateValue]);
      existingPricesSet.add(priceUniqueKey);

      // Insert per Batch
      if (batchPrices.length >= BATCH_SIZE) {
        await connection.query(
          'INSERT INTO prices (id, commodity_id, region_id, price, date) VALUES ?',
          [batchPrices]
        );
        insertedPricesCount += batchPrices.length;
        batchPrices = [];
        console.log(`Berhasil insert ${insertedPricesCount} data harga...`);
      }
    }

    // Insert sisa batch yang kurang dari BATCH_SIZE
    if (batchPrices.length > 0) {
      await connection.query(
        'INSERT INTO prices (id, commodity_id, region_id, price, date) VALUES ?',
        [batchPrices]
      );
      insertedPricesCount += batchPrices.length;
    }

    console.log('\n--- RINGKASAN IMPORT DATA ---');
    console.log(`Region baru ditambahkan     : ${newRegionsCount}`);
    console.log(`Commodity baru ditambahkan  : ${newCommoditiesCount}`);
    console.log(`Data harga berhasil diinsert: ${insertedPricesCount}`);
    console.log(`Data harga dilewati (duplikat): ${skippedPricesCount}`);
    console.log('Proses import selesai dengan sukses!');
  } catch (error) {
    console.error('Terjadi kesalahan saat import data:', error);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
};

importHistoricalData();
