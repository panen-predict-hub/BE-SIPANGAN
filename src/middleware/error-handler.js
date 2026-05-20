import ClientError from '../utils/exceptions/ClientError.js';

const errorHandler = (error, req, res, next) => {
  // 1. Handle all ClientError subclasses (InvariantError, NotFoundError, ServiceUnavailableError, etc.)
  if (error instanceof ClientError) {
    return res.status(error.statusCode).json({
      status: 'fail',
      message: error.message,
    });
  }

  // 2. Handle JSON parsing syntax errors (e.g. malformed JSON in request body)
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      status: 'fail',
      message: 'Format JSON tidak valid / malformed JSON.',
    });
  }

  // 3. Handle Joi Validation Errors (just in case they are thrown directly)
  if (error.isJoi || error.name === 'ValidationError') {
    return res.status(400).json({
      status: 'fail',
      message: error.message,
    });
  }

  // 4. Handle JWT Library Errors (if any endpoint or middleware forwards them to next())
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Token kedaluwarsa, silakan masuk kembali.',
    });
  }
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Token tidak valid atau tidak dikenali.',
    });
  }

  // 5. Handle Database/MySQL Errors (via mysql2)
  if (error.code) {
    // Duplicate entry (e.g., unique constraint violation)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        status: 'fail',
        message: 'Data sudah ada di sistem (konflik duplikasi data).',
      });
    }

    // Foreign key constraints
    if (error.code === 'ER_NO_REFERENCED_ROW' || error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        status: 'fail',
        message: 'Referensi data tidak ditemukan atau tidak valid.',
      });
    }

    if (error.code === 'ER_ROW_IS_REFERENCED' || error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({
        status: 'fail',
        message: 'Data tidak dapat dihapus karena sedang dirujuk oleh data lain.',
      });
    }

    // DB Connection lost or refused
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('[Database Connection Error]', error);
      return res.status(503).json({
        status: 'error',
        message: 'Koneksi ke basis data terputus. Silakan coba beberapa saat lagi.',
      });
    }
  }

  // 6. Handle Multer / File Upload errors
  if (error.name === 'MulterError') {
    let message = 'Terjadi kesalahan pada saat mengunggah berkas.';
    if (error.code === 'LIMIT_FILE_SIZE') {
      message = 'Ukuran berkas melebihi batas maksimum yang diperbolehkan.';
    }
    return res.status(400).json({
      status: 'fail',
      message,
    });
  }

  // 7. Unhandled server error — log it but don't leak details to client
  console.error('[Server Error]', error);

  // In development environment, provide detailed error information for easier debugging
  const isDev = process.env.NODE_ENV === 'development';
  return res.status(500).json({
    status: 'error',
    message: isDev ? error.message : 'Maaf, terjadi kegagalan pada server kami.',
    ...(isDev && { stack: error.stack }),
  });
};

export default errorHandler;

