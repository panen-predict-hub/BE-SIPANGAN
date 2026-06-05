import { pool } from '../config/database.js';

class PredictionScheduler {
  constructor(predictService) {
    this._predictService = predictService;
    this._pool = pool;
    this._intervalId = null;
    // Default interval: 12 hours (12 * 60 * 60 * 1000)
    this._intervalTime = parseInt(process.env.PREDICTION_CHECK_INTERVAL_MS, 10) || 12 * 60 * 60 * 1000;
  }

  start() {
    console.log('PredictionScheduler: Starting background scheduler...');
    
    // Run the check after 10 seconds of startup to avoid slowing down server boot
    setTimeout(() => {
      this.runPredictionCheck().catch(err => {
        console.error('PredictionScheduler: Error in initial prediction check:', err);
      });
    }, 10000);

    // Setup periodic checking
    this._intervalId = setInterval(() => {
      this.runPredictionCheck().catch(err => {
        console.error('PredictionScheduler: Error in periodic prediction check:', err);
      });
    }, this._intervalTime);
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      console.log('PredictionScheduler: Stopped background scheduler.');
    }
  }

  async runPredictionCheck() {
    console.log('PredictionScheduler: Running prediction check for all active commodity-region pairs...');
    
    try {
      // Find all unique active commodity and region pairs from prices
      const [pairs] = await this._pool.query(
        'SELECT DISTINCT commodity_id, region_id FROM prices'
      );

      console.log(`PredictionScheduler: Found ${pairs.length} commodity-region pair(s) to check.`);

      for (const pair of pairs) {
        const { commodity_id, region_id } = pair;
        try {
          // Call getPrediction with force = false to verify if target month prediction exists.
          // If not in DB/caching, it fetches from AI FastAPI and saves it.
          // We pass null for names since the service now resolves them from IDs.
          const result = await this._predictService.getPrediction(null, null, commodity_id, region_id, false);
          
          if (result && result.predictions && result.predictions.length > 0) {
            console.log(`PredictionScheduler: Verified/Updated prediction for commodity ${commodity_id} in region ${region_id}`);
          } else {
            console.log(`PredictionScheduler: Prediction not available (e.g. insufficient history < 36 months) for commodity ${commodity_id} in region ${region_id}`);
          }
          
          // Small pause of 1 second between pairs to avoid overloading resources
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (pairErr) {
          console.error(`PredictionScheduler: Failed to check prediction for commodity ${commodity_id}, region ${region_id}:`, pairErr.message);
        }
      }
      
      console.log('PredictionScheduler: Finished checking all prediction pairs.');
    } catch (err) {
      console.error('PredictionScheduler: Database query failed during prediction check:', err);
    }
  }
}

export default PredictionScheduler;
