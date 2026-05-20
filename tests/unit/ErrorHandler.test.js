import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import errorHandler from '../../src/middleware/error-handler.js';
import ClientError from '../../src/utils/exceptions/ClientError.js';
import InvariantError from '../../src/utils/exceptions/InvariantError.js';

describe('ErrorHandler Middleware', () => {
  let req, res, next;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    // Spy on console.error to avoid polluting the test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    console.error.mockRestore();
  });

  it('should handle ClientError subclasses (e.g. InvariantError) with status code and fail status', () => {
    const error = new InvariantError('Input tidak valid');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Input tidak valid',
    });
  });

  it('should handle SyntaxError from body-parser (malformed JSON)', () => {
    const error = new SyntaxError('Unexpected token } in JSON at position 12');
    error.status = 400;
    error.body = '{ malformed: }';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Format JSON tidak valid / malformed JSON.',
    });
  });

  it('should handle Joi validation errors', () => {
    const error = new Error('ValidationError: "username" is required');
    error.isJoi = true;

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'ValidationError: "username" is required',
    });
  });

  it('should handle Joi ValidationError by name', () => {
    const error = new Error('"password" must be at least 8 characters');
    error.name = 'ValidationError';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: '"password" must be at least 8 characters',
    });
  });

  it('should handle TokenExpiredError from jsonwebtoken', () => {
    const error = new Error('jwt expired');
    error.name = 'TokenExpiredError';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Token kedaluwarsa, silakan masuk kembali.',
    });
  });

  it('should handle JsonWebTokenError from jsonwebtoken', () => {
    const error = new Error('invalid signature');
    error.name = 'JsonWebTokenError';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Token tidak valid atau tidak dikenali.',
    });
  });

  it('should handle MySQL ER_DUP_ENTRY error code', () => {
    const error = new Error('Duplicate entry for key...');
    error.code = 'ER_DUP_ENTRY';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Data sudah ada di sistem (konflik duplikasi data).',
    });
  });

  it('should handle MySQL ER_NO_REFERENCED_ROW or ER_NO_REFERENCED_ROW_2 error codes', () => {
    const error = new Error('Cannot add or update a child row...');
    error.code = 'ER_NO_REFERENCED_ROW_2';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Referensi data tidak ditemukan atau tidak valid.',
    });
  });

  it('should handle MySQL ER_ROW_IS_REFERENCED or ER_ROW_IS_REFERENCED_2 error codes', () => {
    const error = new Error('Cannot delete or update a parent row...');
    error.code = 'ER_ROW_IS_REFERENCED';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Data tidak dapat dihapus karena sedang dirujuk oleh data lain.',
    });
  });

  it('should handle Database connection timeout/failure (ECONNREFUSED)', () => {
    const error = new Error('connect ECONNREFUSED...');
    error.code = 'ECONNREFUSED';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Koneksi ke basis data terputus. Silakan coba beberapa saat lagi.',
    });
  });

  it('should handle Multer LIMIT_FILE_SIZE error', () => {
    const error = new Error('File too large');
    error.name = 'MulterError';
    error.code = 'LIMIT_FILE_SIZE';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Ukuran berkas melebihi batas maksimum yang diperbolehkan.',
    });
  });

  it('should handle generic Multer error', () => {
    const error = new Error('Unexpected field');
    error.name = 'MulterError';

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Terjadi kesalahan pada saat mengunggah berkas.',
    });
  });

  it('should return a generic 500 error in production environment', () => {
    process.env.NODE_ENV = 'production';
    const error = new Error('Something went terribly wrong internally');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Maaf, terjadi kegagalan pada server kami.',
    });
  });

  it('should return a detailed 500 error with stack trace in development environment', () => {
    process.env.NODE_ENV = 'development';
    const error = new Error('Something went terribly wrong internally');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Something went terribly wrong internally',
      stack: error.stack,
    });
  });
});
