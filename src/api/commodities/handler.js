import { clearCache } from '../../middleware/cache.js';

/**
 * @openapi
 * components:
 *   schemas:
 *     Commodity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: c81b3762-9721-4775-8667-897782b7b55c
 *         name:
 *           type: string
 *           example: Beras Medium
 *         unit:
 *           type: string
 *           example: kg
 *         waspada_percentage:
 *           type: number
 *           nullable: true
 *           example: 10.00
 *         kritis_percentage:
 *           type: number
 *           nullable: true
 *           example: 25.00
 *         het_nominal:
 *           type: number
 *           nullable: true
 *           example: 14000.00
 *     CommodityInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: Beras Premium
 *         unit:
 *           type: string
 *           example: kg
 *     ThresholdInput:
 *       type: object
 *       required:
 *         - waspada_percentage
 *         - kritis_percentage
 *       properties:
 *         waspada_percentage:
 *           type: number
 *           example: 10.00
 *         kritis_percentage:
 *           type: number
 *           example: 25.00
 *         het_nominal:
 *           type: number
 *           nullable: true
 *           example: 14000.00
 */

class CommoditiesHandler {
  constructor(service, validator) {
    this._service = service;
    this._validator = validator;
    this.getCommoditiesHandler = this.getCommoditiesHandler.bind(this);
    this.postCommodityHandler = this.postCommodityHandler.bind(this);
    this.putCommodityHandler = this.putCommodityHandler.bind(this);
    this.putThresholdHandler = this.putThresholdHandler.bind(this);
    this.deleteCommodityHandler = this.deleteCommodityHandler.bind(this);
  }

  /**
   * @openapi
   * /api/v1/commodities:
   *   get:
   *     summary: Ambil daftar semua komoditas
   *     tags: [Commodities]
   *     responses:
   *       200:
   *         description: Daftar komoditas
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status: { type: string, example: success }
   *                 data:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Commodity' }
   */
  async getCommoditiesHandler(req, res, next) {
    try {
      const commodities = await this._service.getCommodities();
      res.status(200).json({
        status: 'success',
        data: commodities,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/v1/commodities:
   *   post:
   *     summary: Tambah komoditas baru
   *     tags: [Commodities]
   *     security:
   *       - apiKeyAuth: []
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CommodityInput'
   *     responses:
   *       201:
   *         description: Komoditas berhasil ditambahkan
   */
  async postCommodityHandler(req, res, next) {
    try {
      this._validator.validateCommodityPayload(req.body);
      const { name, unit } = req.body;
      const id = await this._service.addCommodity({ name, unit }, req.user.id);
      await clearCache('cache:/api/v1/commodities*');
      await clearCache('cache:/api/v1/prices*');
      res.status(201).json({
        status: 'success',
        message: 'Commodity added successfully',
        data: { id },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/v1/commodities/{id}:
   *   put:
   *     summary: Perbarui data komoditas
   *     tags: [Commodities]
   *     security:
   *       - apiKeyAuth: []
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CommodityInput'
   *     responses:
   *       200:
   *         description: Data berhasil diperbarui
   */
  async putCommodityHandler(req, res, next) {
    try {
      const { id } = req.params;
      this._validator.validateCommodityId(id);
      this._validator.validateCommodityPayload(req.body);
      await this._service.updateCommodity(id, req.body, req.user.id);
      await clearCache('cache:/api/v1/commodities*');
      await clearCache('cache:/api/v1/prices*');
      res.status(200).json({
        status: 'success',
        message: 'Commodity updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/v1/commodities/{id}/threshold:
   *   put:
   *     summary: Perbarui batas ambang (threshold) komoditas
   *     tags: [Commodities]
   *     security:
   *       - apiKeyAuth: []
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ThresholdInput'
   *     responses:
   *       200:
   *         description: Batas ambang berhasil diperbarui
   */
  async putThresholdHandler(req, res, next) {
    try {
      const { id } = req.params;
      this._validator.validateCommodityId(id);
      this._validator.validateThresholdPayload(req.body);
      await this._service.updateThreshold(id, req.body, req.user.id);
      await clearCache('cache:/api/v1/commodities*');
      res.status(200).json({
        status: 'success',
        message: 'Commodity threshold updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @openapi
   * /api/v1/commodities/{id}:
   *   delete:
   *     summary: Hapus komoditas
   *     tags: [Commodities]
   *     security:
   *       - apiKeyAuth: []
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Komoditas berhasil dihapus
   */
  async deleteCommodityHandler(req, res, next) {
    try {
      const { id } = req.params;
      this._validator.validateCommodityId(id);
      await this._service.deleteCommodity(id, req.user.id);
      await clearCache('cache:/api/v1/commodities*');
      await clearCache('cache:/api/v1/prices*');
      res.status(200).json({
        status: 'success',
        message: 'Commodity deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

export default CommoditiesHandler;
