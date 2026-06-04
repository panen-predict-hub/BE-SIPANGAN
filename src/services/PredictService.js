import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import ServiceUnavailableError from '../utils/exceptions/ServiceUnavailableError.js';

class PredictService {
  constructor() {
    this._pool = pool;
    this._fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
  }

  async getPrediction(commodityName, regionName, commodityId = null, regionId = null) {
    // 1. Try to find prediction in DB first (for today or upcoming dates)
    if (commodityId && regionId) {
      try {
        const [rows] = await this._pool.query(
          'SELECT price, prediction_date FROM predictions WHERE commodity_id = ? AND region_id = ? AND prediction_date >= CURDATE() ORDER BY prediction_date ASC LIMIT 1',
          [commodityId, regionId]
        );

        if (rows.length > 0) {
          return {
            status: 'success',
            predictions: rows.map(r => ({
              date: r.prediction_date,
              price: parseFloat(r.price)
            }))
          };
        }
      } catch (dbError) {
        console.error('Database error in PredictService:', dbError);
        // Continue to API if DB fails
      }
    }

    // 2. Fetch last 36 months of price history from DB for forecasting
    let historyPrices = [];
    let lastDate = new Date();

    try {
      const [historyRows] = await this._pool.query(
        `SELECT p.price, p.date FROM prices p
         JOIN commodities c ON p.commodity_id = c.id
         JOIN regions r ON p.region_id = r.id
         WHERE c.name = ? AND r.name = ?
         ORDER BY p.date DESC
         LIMIT 36`,
        [commodityName, regionName]
      );

      if (historyRows.length < 36) {
        console.warn(`History data for ${commodityName} in ${regionName} is less than 36 months (${historyRows.length} found).`);
        // If history is insufficient, we cannot predict using the 36-window BiLSTM model
        return {
          status: 'success',
          predictions: []
        };
      }

      // Reverse history rows to make them chronological (oldest to newest)
      const reversedRows = [...historyRows].reverse();
      historyPrices = reversedRows.map(r => parseFloat(r.price));
      lastDate = new Date(reversedRows[reversedRows.length - 1].date);
    } catch (historyError) {
      console.error('Failed to fetch history for prediction:', historyError);
      throw new ServiceUnavailableError('Failed to fetch history data for prediction');
    }

    // Calculate next month's prediction date
    const nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];

    // 3. Fetch prediction from FastAPI by POSTing the historical prices
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

      // Construct output in format expected by sipangan-backend
      const result = {
        status: 'success',
        predictions: [
          {
            price: data.forecast_rp,
            date: nextDateStr
          }
        ]
      };

      // 4. Save to DB if we have IDs
      if (commodityId && regionId && result.predictions.length > 0) {
        try {
          const predictionsToSave = result.predictions.map(p => [
            uuidv4(),
            commodityId,
            regionId,
            p.price,
            p.date
          ]);

          await this._pool.query(
            'INSERT IGNORE INTO predictions (id, commodity_id, region_id, price, prediction_date) VALUES ?',
            [predictionsToSave]
          );
        } catch (saveError) {
          console.error('Failed to save predictions to DB:', saveError);
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

