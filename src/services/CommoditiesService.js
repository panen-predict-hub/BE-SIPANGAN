import { pool } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import NotFoundError from '../utils/exceptions/NotFoundError.js';
import InvariantError from '../utils/exceptions/InvariantError.js';


class CommoditiesService {
  constructor(logService) {
    this._pool = pool;
    this._logService = logService;
  }

  async getCommodityById(id) {
    const query = 'SELECT * FROM commodities WHERE id = ? AND deleted_at IS NULL';
    const [rows] = await this._pool.execute(query, [id]);
    if (rows.length === 0) {
      throw new NotFoundError('Komoditas tidak ditemukan');
    }
    return rows[0];
  }

  async getCommodities() {
    const [rows] = await this._pool.query(`
      SELECT c.*, ct.waspada_percentage, ct.kritis_percentage, ct.het_nominal 
      FROM commodities c
      LEFT JOIN commodity_thresholds ct ON c.id = ct.commodity_id
      WHERE c.deleted_at IS NULL
    `);
    return rows;
  }

  async addCommodity({ name, unit }, userId) {
    const connection = await this._pool.getConnection();
    try {
      await connection.beginTransaction();
      const id = uuidv4();
      const query = 'INSERT INTO commodities (id, name, unit) VALUES (?, ?, ?)';
      await connection.execute(query, [id, name, unit]);
      
      // Add default threshold
      await connection.execute(
        'INSERT INTO commodity_thresholds (id, commodity_id) VALUES (?, ?)',
        [uuidv4(), id]
      );

      await connection.commit();
      
      if (this._logService && userId) {
        await this._logService.addLog({
          userId,
          action: 'ADD_COMMODITY',
          targetId: id,
          details: { name, unit }
        });
      }

      return id;
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        throw new InvariantError(`Komoditas dengan nama '${name}' sudah ada.`);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateCommodity(id, { name, unit }, userId) {
    try {
      const query = 'UPDATE commodities SET name = ?, unit = ? WHERE id = ? AND deleted_at IS NULL';
      const [result] = await this._pool.execute(query, [name, unit, id]);
      if (result.affectedRows === 0) {
        throw new NotFoundError('Komoditas tidak ditemukan');
      }

      if (this._logService && userId) {
        await this._logService.addLog({
          userId,
          action: 'UPDATE_COMMODITY',
          targetId: id,
          details: { name, unit }
        });
      }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new InvariantError(`Komoditas dengan nama '${name}' sudah ada.`);
      }
      throw error;
    }
  }

  async updateThreshold(commodityId, { waspada_percentage, kritis_percentage, het_nominal = null }, userId) {
    const query = `
      INSERT INTO commodity_thresholds (id, commodity_id, waspada_percentage, kritis_percentage, het_nominal)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        waspada_percentage = VALUES(waspada_percentage), 
        kritis_percentage = VALUES(kritis_percentage),
        het_nominal = VALUES(het_nominal)
    `;
    await this._pool.execute(query, [uuidv4(), commodityId, waspada_percentage, kritis_percentage, het_nominal]);

    if (this._logService && userId) {
      await this._logService.addLog({
        userId,
        action: 'UPDATE_THRESHOLD',
        targetId: commodityId,
        details: { waspada_percentage, kritis_percentage, het_nominal }
      });
    }
  }

  async deleteCommodity(id, userId) {
    // Ambil data komoditas sebelum di soft-delete
    const commodity = await this.getCommodityById(id);

    try {
      const deletedName = `${commodity.name}_deleted_${Date.now()}`;
      const query = 'UPDATE commodities SET name = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL';
      const [result] = await this._pool.execute(query, [deletedName, id]);
      if (result.affectedRows === 0) {
        throw new NotFoundError('Komoditas tidak ditemukan');
      }

      if (this._logService && userId) {
        await this._logService.addLog({
          userId,
          action: 'DELETE_COMMODITY',
          targetId: id,
          details: { name: commodity.name, unit: commodity.unit }
        });
      }
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
        throw new InvariantError('Komoditas tidak dapat dihapus karena masih digunakan dalam data harga.');
      }
      throw error;
    }
  }
}

export default CommoditiesService;
