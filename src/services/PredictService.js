import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import redisClient from '../config/redis.js';
import ServiceUnavailableError from '../utils/exceptions/ServiceUnavailableError.js';

class PredictService {
  constructor() {
    this._pool = pool;
    const rawUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
    this._fastApiUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  }

  async getPrediction(commodityName, regionName, commodityId = null, regionId = null, force = false) {
    let currentCommodityId = commodityId;
    let currentRegionId = regionId;

    // 1. Resolve IDs if they are not provided
    if (!currentCommodityId || !currentRegionId) {
      try {
        const [commRows] = await this._pool.query('SELECT id FROM commodities WHERE name = ?', [commodityName]);
        const [regRows] = await this._pool.query('SELECT id FROM regions WHERE name = ?', [regionName]);
        if (commRows.length > 0) currentCommodityId = commRows[0].id;
        if (regRows.length > 0) currentRegionId = regRows[0].id;
      } catch (dbError) {
        console.error('Failed to resolve IDs in PredictService:', dbError);
      }
    }

    if (!currentCommodityId || !currentRegionId) {
      console.warn(`Could not resolve IDs for commodity: ${commodityName}, region: ${regionName}`);
      return {
        status: 'success',
        predictions: []
      };
    }

    // 2. Fetch the latest price date to determine target forecasting month
    let latestPriceDate = new Date();
    try {
      const [latestPriceRows] = await this._pool.query(
        'SELECT date FROM prices WHERE commodity_id = ? AND region_id = ? ORDER BY date DESC LIMIT 1',
        [currentCommodityId, currentRegionId]
      );

      if (latestPriceRows.length > 0) {
        latestPriceDate = new Date(latestPriceRows[0].date);
      }
    } catch (dateError) {
      console.error('Failed to fetch latest price date in PredictService:', dateError);
    }

    // Calculate next month's prediction date, normalized to the 1st of the month
    const nextDate = new Date(latestPriceDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    nextDate.setDate(1); // Set to 1st of the month to prevent duplicate records per month
    const nextDateStr = nextDate.toISOString().split('T')[0];
    const targetMonthStr = nextDateStr.substring(0, 7); // 'YYYY-MM'

    const redisKey = `predict:${currentCommodityId}:${currentRegionId}:${targetMonthStr}`;

    // 3. Try to check Redis Cache first (skip if force is true)
    if (!force && redisClient.isOpen) {
      try {
        const cached = await redisClient.get(redisKey);
        if (cached) {
          console.log(`Prediction cache hit for ${redisKey}`);
          return JSON.parse(cached);
        }
      } catch (redisErr) {
        console.error('Redis get error in PredictService:', redisErr);
      }
    }

    // 4. Try to find prediction in DB for this target month (skip if force is true)
    if (!force) {
      try {
        const [rows] = await this._pool.query(
          "SELECT price, prediction_date FROM predictions WHERE commodity_id = ? AND region_id = ? AND DATE_FORMAT(prediction_date, '%Y-%m') = ? LIMIT 1",
          [currentCommodityId, currentRegionId, targetMonthStr]
        );

        if (rows.length > 0) {
          const result = {
            status: 'success',
            predictions: rows.map(r => ({
              date: r.prediction_date instanceof Date ? r.prediction_date.toISOString().split('T')[0] : r.prediction_date,
              price: parseFloat(r.price)
            }))
          };

          // Cache back to Redis to keep it in sync
          if (redisClient.isOpen) {
            try {
              await redisClient.set(redisKey, JSON.stringify(result));
            } catch (redisErr) {
              console.error('Redis set error in PredictService:', redisErr);
            }
          }

          return result;
        }
      } catch (dbError) {
        console.error('Database error in PredictService while fetching prediction:', dbError);
      }
    }

    // 5. Fetch last 36 months of price history from DB for forecasting
    let historyPrices = [];
    try {
      const [historyRows] = await this._pool.query(
        `SELECT p.price, p.date FROM prices p
         WHERE p.commodity_id = ? AND p.region_id = ?
         ORDER BY p.date DESC
         LIMIT 36`,
        [currentCommodityId, currentRegionId]
      );

      if (historyRows.length < 36) {
        console.warn(`History data for ${commodityName} in ${regionName} is less than 36 months (${historyRows.length} found).`);
        return {
          status: 'success',
          predictions: []
        };
      }

      // Reverse history rows to make them chronological (oldest to newest)
      const reversedRows = [...historyRows].reverse();
      historyPrices = reversedRows.map(r => parseFloat(r.price));
    } catch (historyError) {
      console.error('Failed to fetch history for prediction:', historyError);
      throw new ServiceUnavailableError('Failed to fetch history data for prediction');
    }

    // 6. Fetch prediction from FastAPI by POSTing the historical prices
    try {
      const response = await fetch(`${this._fastApiUrl}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          history: historyPrices,
          kabupaten: regionName,
          komoditas: commodityName
        })
      });

      if (!response.ok) {
        const errorDetail = await response.text();
        throw new Error(`AI Service returned ${response.status}: ${errorDetail}`);
      }

      const data = await response.json();

      const result = {
        status: 'success',
        predictions: [
          {
            price: data.forecast_rp,
            date: nextDateStr
          }
        ]
      };

      // 7. Save to DB with ON DUPLICATE KEY UPDATE
      try {
        await this._pool.query(
          `INSERT INTO predictions (id, commodity_id, region_id, price, prediction_date) 
           VALUES (?, ?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE price = VALUES(price)`,
          [uuidv4(), currentCommodityId, currentRegionId, result.predictions[0].price, result.predictions[0].date]
        );
      } catch (saveError) {
        console.error('Failed to save predictions to DB:', saveError);
      }

      // 8. Cache to Redis
      if (redisClient.isOpen) {
        try {
          await redisClient.set(redisKey, JSON.stringify(result));
        } catch (redisErr) {
          console.error('Redis set error in PredictService:', redisErr);
        }
      }

      return result;
    } catch (err) {
      if (err instanceof ServiceUnavailableError) throw err;
      throw new ServiceUnavailableError('AI Prediction service currently unavailable');
    }
  }
}

export default PredictService;

