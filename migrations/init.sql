-- Drop existing tables if they exist
DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS commodity_thresholds;
DROP TABLE IF EXISTS prices;
DROP TABLE IF EXISTS commodities;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS weather_data;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS authenticators;

-- Create Users table
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    fullname VARCHAR(100) NOT NULL,
    role ENUM('super_admin', 'admin', 'operator') DEFAULT 'operator',
    created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Activity Logs table
CREATE TABLE activity_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_id VARCHAR(36),
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create Regions table
CREATE TABLE regions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    deleted_at TIMESTAMP NULL DEFAULT NULL
);

-- Create Commodities table
CREATE TABLE commodities (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    unit VARCHAR(20) DEFAULT 'kg',
    deleted_at TIMESTAMP NULL DEFAULT NULL
);

-- Create Commodity Thresholds table
CREATE TABLE commodity_thresholds (
    id VARCHAR(36) PRIMARY KEY,
    commodity_id VARCHAR(36) NOT NULL UNIQUE,
    waspada_percentage DECIMAL(5, 2) DEFAULT 10.00,
    kritis_percentage DECIMAL(5, 2) DEFAULT 25.00,
    het_nominal DECIMAL(12, 2) DEFAULT NULL,
    FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE CASCADE
);

-- Create Prices table (Time Series)
CREATE TABLE prices (
    id VARCHAR(36) PRIMARY KEY,
    commodity_id VARCHAR(36) REFERENCES commodities(id) ON DELETE CASCADE,
    region_id VARCHAR(36) REFERENCES regions(id) ON DELETE CASCADE,
    price DECIMAL(12, 2) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE authenticators (token TEXT NOT NULL);

-- Indexing for performance
CREATE INDEX idx_prices_commodity ON prices(commodity_id);
CREATE INDEX idx_prices_region ON prices(region_id);
CREATE INDEX idx_prices_date ON prices(date);

-- Create Alerts table
CREATE TABLE alerts (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'warning', 'critical') DEFAULT 'info',
    commodity_id VARCHAR(36) NOT NULL,
    region_id VARCHAR(36) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

-- Create Predictions table
CREATE TABLE predictions (
    id VARCHAR(36) PRIMARY KEY,
    commodity_id VARCHAR(36) NOT NULL,
    region_id VARCHAR(36) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    prediction_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_prediction (commodity_id, region_id, prediction_date)
);

-- Create Weather Data table
CREATE TABLE weather_data (
    id VARCHAR(36) PRIMARY KEY,
    region_id VARCHAR(36) NOT NULL,
    date DATE NOT NULL,
    temperature DECIMAL(5, 2),
    humidity DECIMAL(5, 2),
    weather_condition VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_weather (region_id, date)
);
