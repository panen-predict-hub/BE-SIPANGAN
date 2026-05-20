import { query, pool } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

class AlertsService {
  async getAlerts(queryObj) {
    let queryText = 'SELECT id, title, message, type, created_at, commodity_id, region_id, price FROM alerts';
    const queryParams = [];

    let whereClauses = [];

    // Filter based on region
    if (queryObj.regionId) {
      whereClauses.push('region_id = ?');
      queryParams.push(queryObj.regionId);
    }

    // Filter based on commodity
    if (queryObj.commodityId) {
      whereClauses.push('commodity_id = ?');
      queryParams.push(queryObj.commodityId);
    }

    // Filter by price threshold
    if (queryObj.priceThreshold) {
      whereClauses.push('price >= ?');
      queryParams.push(queryObj.priceThreshold);
    }

    if (whereClauses.length > 0) {
      queryText += ' WHERE ' + whereClauses.join(' AND ');
    }

    queryText += ' ORDER BY created_at DESC';
    
    if (queryObj.limit) {
      const limit = parseInt(queryObj.limit, 10) || 20;
      queryText += ` LIMIT ${limit}`;
    }

    const { rows } = await query(queryText, queryParams);
    return rows;
  }

  async createAlert({ title, message, type, commodity_id, region_id, price }) {
    const id = uuidv4();
    const queryText = `
      INSERT INTO alerts (id, title, message, type, commodity_id, region_id, price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.query(queryText, [id, title, message, type, commodity_id, region_id, price]);
    return id;
  }
  
  async checkAndCreateAlert(commodity_id, region_id, price, average_price) {
    // get threshold
    const thresholdQuery = 'SELECT waspada_percentage, kritis_percentage, het_nominal FROM commodity_thresholds WHERE commodity_id = ?';
    const { rows } = await query(thresholdQuery, [commodity_id]);
    
    if (rows.length === 0 || !average_price) return null;
    
    const { waspada_percentage, kritis_percentage, het_nominal } = rows[0];
    const ratio = price / average_price;
    const waspadaThreshold = 1 + (parseFloat(waspada_percentage) / 100);
    const kritisThreshold = 1 + (parseFloat(kritis_percentage) / 100);
    
    let type = 'info';
    let title = '';
    let message = '';
    
    const regionQuery = 'SELECT name FROM regions WHERE id = ?';
    const { rows: regionRows } = await query(regionQuery, [region_id]);
    const regionName = regionRows.length > 0 ? regionRows[0].name : 'Wilayah Tidak Diketahui';

    const commodityQuery = 'SELECT name FROM commodities WHERE id = ?';
    const { rows: commodityRows } = await query(commodityQuery, [commodity_id]);
    const commodityName = commodityRows.length > 0 ? commodityRows[0].name : 'Komoditas';

    // FIRST check if the price exceeds the national HET/HAP limit:
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
    } else {
       return null; // no alert needed
    }
    
    return this.createAlert({ title, message, type, commodity_id, region_id, price });
  }
}

export default AlertsService;
