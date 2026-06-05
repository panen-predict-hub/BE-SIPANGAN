import dotenv from 'dotenv';
dotenv.config();

import PredictService from './src/services/PredictService.js';

const run = async () => {
  const service = new PredictService();
  try {
    console.log('Running prediction service...');
    console.log('FASTAPI_URL:', process.env.FASTAPI_URL);
    const result = await service.getPrediction('Beras Medium', 'Kabupaten Bangkalan', null, null, true);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error during prediction:', err);
  } finally {
    process.exit(0);
  }
};

run();
