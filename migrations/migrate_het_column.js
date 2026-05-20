import { pool } from '../src/config/database.js';

const migrate = async () => {
  const client = await pool.getConnection();
  try {
    console.log('Running migration to add het_nominal column...');
    await client.execute(`
      ALTER TABLE commodity_thresholds 
      ADD COLUMN het_nominal DECIMAL(12, 2) DEFAULT NULL
    `);
    console.log('Migration completed successfully: het_nominal column added.');
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration skipped: het_nominal column already exists.');
    } else {
      console.error('Migration failed:', error);
    }
  } finally {
    if (client) client.release();
    process.exit();
  }
};

migrate();
