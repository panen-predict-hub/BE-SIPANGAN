import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import NotFoundError from '../utils/exceptions/NotFoundError.js';

class HistoryService {
  constructor(predictService, logService, alertsService) {
    this._pool = pool;
    this._predictService = predictService;
    this._logService = logService;
    this._alertsService = alertsService;
  }

  async getHistory({ commodity, region, start_date, end_date, page = 1, limit = 20 }) {
    let baseQuery = `
      SELECT p.id, p.commodity_id, p.region_id, p.price, p.date, c.name as commodity, c.unit, r.name as region
      FROM prices p
      JOIN commodities c ON p.commodity_id = c.id
      JOIN regions r ON p.region_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (commodity) {
      params.push(`%${commodity}%`);
      baseQuery += ` AND LOWER(c.name) LIKE LOWER(?)`;
    }

    if (region) {
      params.push(`%${region}%`);
      baseQuery += ` AND LOWER(r.name) LIKE LOWER(?)`;
    }

    if (start_date) {
      params.push(start_date);
      baseQuery += ` AND p.date >= ?`;
    }

    if (end_date) {
      params.push(end_date);
      baseQuery += ` AND p.date <= ?`;
    }

    // Count total rows for pagination metadata
    const [countRows] = await this._pool.query(
      `SELECT COUNT(*) as count FROM (${baseQuery}) AS total_count`,
      params
    );
    const total = parseInt(countRows[0].count, 10);

    // Apply ordering and pagination
    const limitNum = Number(limit);
    const offsetNum = (Number(page) - 1) * limitNum;

    const finalQuery = baseQuery + ` ORDER BY p.date DESC LIMIT ? OFFSET ?`;
    const finalParams = [...params, limitNum, offsetNum];

    const [rows] = await this._pool.query(finalQuery, finalParams);

    return {
      items: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOverview(commodityName) {
    let whereClause = '';
    const params = [];

    if (commodityName) {
      whereClause = 'WHERE c.name = ?';
      params.push(commodityName);
    }

    const query = `
      WITH RankedPrices AS (
        SELECT
            p.commodity_id,
            p.region_id,
            p.price,
            p.date,
            c.name as commodity_name,
            r.name as region_name,
            ROW_NUMBER() OVER(PARTITION BY p.commodity_id, p.region_id ORDER BY p.date DESC) as rn
        FROM prices p
        JOIN commodities c ON p.commodity_id = c.id
        JOIN regions r ON p.region_id = r.id
        ${whereClause}
      ),
      AveragePrices AS (
        SELECT
            commodity_id,
            region_id,
            AVG(price) as average_price
        FROM (
            SELECT
                commodity_id,
                region_id,
                price,
                ROW_NUMBER() OVER(PARTITION BY commodity_id, region_id ORDER BY date DESC) as rank_num
            FROM prices
        ) as ranked_prices
        WHERE rank_num <= 12
        GROUP BY commodity_id, region_id
      )
      SELECT
          rp1.region_id,
          rp1.region_name,
          rp1.commodity_name,
          rp1.price as current_price,
          rp1.date as last_update,
          rp2.price as previous_price,
          ap.average_price,
          ct.waspada_percentage,
          ct.kritis_percentage,
          ct.het_nominal
      FROM RankedPrices rp1
      LEFT JOIN RankedPrices rp2 ON rp1.commodity_id = rp2.commodity_id AND rp1.region_id = rp2.region_id AND rp2.rn = 2
      LEFT JOIN AveragePrices ap ON rp1.commodity_id = ap.commodity_id AND rp1.region_id = ap.region_id
      LEFT JOIN commodity_thresholds ct ON rp1.commodity_id = ct.commodity_id
      WHERE rp1.rn = 1
    `;

    const [rows] = await this._pool.query(query, params);

    const result = await Promise.all(rows.map(async (row) => {
      let predictedPrice = null;

      if (this._predictService) {
        try {
          const prediction = await this._predictService.getPrediction(
            row.commodity_name, 
            row.region_name, 
            row.commodity_id, 
            row.region_id
          );
          if (prediction && prediction.predictions && prediction.predictions.length > 0) {
            predictedPrice = prediction.predictions[0].price;
          }
        } catch (error) {
          // Prediction is optional
        }
      }

      const current = parseFloat(row.current_price);
      const previous = row.previous_price ? parseFloat(row.previous_price) : current;
      const average = parseFloat(row.average_price || current);

      // Trend Calculation Logic
      const diff = current - previous;
      const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;
      
      let trend = 'stable';
      if (!row.current_price || isNaN(current) || current === 0) {
        trend = 'none';
      } else if (percentChange > 2) {
        trend = 'up';
      } else if (percentChange < -2) {
        trend = 'down';
      }

      // Status Calculation
      const rawStatus = this._calculateStatus(
        current, 
        predictedPrice, 
        average, 
        row.waspada_percentage, 
        row.kritis_percentage,
        row.het_nominal
      );
      
      // Map to user-requested status: tanpa data, aman, waspada, kritis
      let status = 'tanpa data';
      if (rawStatus === 'kritis') status = 'kritis';
      else if (rawStatus === 'waspada') status = 'waspada';
      else if (rawStatus === 'aman' || rawStatus === 'normal') status = 'aman';

      return {
        region_id: row.region_id,
        region_name: row.region_name,
        commodity_name: row.commodity_name,
        current_price: Math.round(current),
        previous_price: Math.round(previous),
        trend,
        percent_change: parseFloat(percentChange.toFixed(2)),
        status,
        last_update: row.last_update,
      };
    }));

    return result;
  }

  _calculateStatus(current, predicted, average, waspadaPct = 10, kritisPct = 25, hetNominal = null) {
    if (!average || isNaN(average) || average === 0 || isNaN(current) || current === 0) return 'tanpa data';

    const getLevel = (price, avg) => {
      if (price === null || price === undefined || isNaN(price) || price === 0) return -1; // Ignore if no data
      
      // Check nominal HET first
      if (hetNominal !== null && hetNominal !== undefined && !isNaN(hetNominal) && hetNominal > 0) {
        if (price > parseFloat(hetNominal)) return 3; // kritis
      }

      const ratio = price / avg;
      
      const waspadaThreshold = 1 + (parseFloat(waspadaPct) / 100);
      const kritisThreshold = 1 + (parseFloat(kritisPct) / 100);

      if (ratio <= 1.0) return 0; // aman (<= average)
      if (ratio <= waspadaThreshold) return 1; // normal
      if (ratio <= kritisThreshold) return 2; // waspada
      return 3; // kritis
    };

    const currentLevel = getLevel(current, average);
    const predictedLevel = getLevel(predicted, average);

    // Logic: "highest-risk-level". If predicted is null (-1), it won't affect the max.
    const highestLevel = Math.max(currentLevel, predictedLevel);

    const statuses = ['aman', 'normal', 'waspada', 'kritis'];
    // Fallback to 'tanpa data' if for some reason highestLevel is -1
    return statuses[highestLevel] || 'tanpa data';
  }

  async addPrice({ commodity_id, region_id, price, date }, userId) {
    const id = uuidv4();
    const query = `INSERT INTO prices (id, commodity_id, region_id, price, date) VALUES (?, ?, ?, ?, ?)`;
    await this._pool.query(query, [id, commodity_id, region_id, price, date]);
    
    if (this._logService && userId) {
      await this._logService.addLog({
        userId,
        action: 'ADD_PRICE',
        targetId: id,
        details: { commodity_id, region_id, price, date }
      });
    }
    
    // trigger alert check
    if (this._alertsService) {
      try {
        const avgQuery = `
          SELECT AVG(price) as average_price FROM (
            SELECT price FROM prices 
            WHERE commodity_id = ? AND region_id = ?
            ORDER BY date DESC LIMIT 12
          ) as recent_prices
        `;
        const [avgRows] = await this._pool.query(avgQuery, [commodity_id, region_id]);
        const average_price = avgRows[0]?.average_price;
        
        await this._alertsService.checkAndCreateAlert(commodity_id, region_id, price, average_price);
      } catch (error) {
        console.error('Failed to process alert:', error);
      }
    }
    
    return id;
  }

  async updatePrice(id, { commodity_id, region_id, price, date }, userId) {
    await this.verifyPriceExistence(id);
    const query = `UPDATE prices SET commodity_id = ?, region_id = ?, price = ?, date = ? WHERE id = ?`;
    await this._pool.query(query, [commodity_id, region_id, price, date, id]);

    if (this._logService && userId) {
      await this._logService.addLog({
        userId,
        action: 'UPDATE_PRICE',
        targetId: id,
        details: { commodity_id, region_id, price, date }
      });
    }

    // trigger alert check
    if (this._alertsService) {
      try {
        const avgQuery = `
          SELECT AVG(price) as average_price FROM (
            SELECT price FROM prices 
            WHERE commodity_id = ? AND region_id = ?
            ORDER BY date DESC LIMIT 12
          ) as recent_prices
        `;
        const [avgRows] = await this._pool.query(avgQuery, [commodity_id, region_id]);
        const average_price = avgRows[0]?.average_price;
        
        await this._alertsService.checkAndCreateAlert(commodity_id, region_id, price, average_price);
      } catch (error) {
        console.error('Failed to process alert:', error);
      }
    }
  }

  async deletePrice(id, userId) {
    await this.verifyPriceExistence(id);
    const query = `DELETE FROM prices WHERE id = ?`;
    await this._pool.query(query, [id]);

    if (this._logService && userId) {
      await this._logService.addLog({
        userId,
        action: 'DELETE_PRICE',
        targetId: id
      });
    }
  }

  async verifyPriceExistence(id) {
    const query = `SELECT id FROM prices WHERE id = ?`;
    const [rows] = await this._pool.query(query, [id]);

    if (!rows.length) {
      throw new NotFoundError('Data harga tidak ditemukan');
    }
  }
}

export default HistoryService;
