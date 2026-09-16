-- ============================================
-- Switch Monitor - Database Initialization
-- ============================================

CREATE DATABASE IF NOT EXISTS switch_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE switch_monitor;

-- --------------------------------------------
-- Users table
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------
-- Devices table
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  vendor ENUM('mikrotik', 'huawei', 'cisco', 'juniper') NOT NULL,
  snmp_community VARCHAR(100) DEFAULT 'public',
  snmp_version TINYINT DEFAULT 2,
  location VARCHAR(200),
  is_active BOOLEAN DEFAULT TRUE,
  last_poll_at TIMESTAMP NULL,
  last_poll_success BOOLEAN NULL,
  last_poll_error VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------
-- ICMP hosts table
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS hosts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(253) NOT NULL UNIQUE,
  location VARCHAR(200),
  is_active BOOLEAN DEFAULT TRUE,
  status ENUM('pending', 'up', 'down') DEFAULT 'pending',
  latency_ms DECIMAL(10, 3) NULL,
  packet_loss DECIMAL(5, 2) NULL,
  last_check_at TIMESTAMP NULL,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hosts_status (is_active, status)
) ENGINE=InnoDB;

-- --------------------------------------------
-- ICMP latency and packet-loss history
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS icmp_data (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  host_id INT NOT NULL,
  status ENUM('up', 'down') NOT NULL,
  min_latency_ms DECIMAL(10, 3) NULL,
  avg_latency_ms DECIMAL(10, 3) NULL,
  max_latency_ms DECIMAL(10, 3) NULL,
  packet_loss DECIMAL(5, 2) DEFAULT 0,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  INDEX idx_icmp_host_checked (host_id, checked_at)
) ENGINE=InnoDB;

-- --------------------------------------------
-- Interface data table (monitoring results)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS interface_data (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  if_index INT NOT NULL,
  if_name VARCHAR(100),
  if_alias VARCHAR(200),
  if_status VARCHAR(10),
  if_speed BIGINT,
  tx_power DECIMAL(8, 3) NULL,
  rx_power DECIMAL(8, 3) NULL,
  in_octets BIGINT DEFAULT 0,
  out_octets BIGINT DEFAULT 0,
  in_traffic_bps BIGINT DEFAULT 0,
  out_traffic_bps BIGINT DEFAULT 0,
  polled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_device_polled (device_id, polled_at),
  INDEX idx_polled_at (polled_at),
  INDEX idx_device_ifindex_polled (device_id, if_index, polled_at)
) ENGINE=InnoDB;

-- --------------------------------------------
-- Default admin user (password: admin123)
-- --------------------------------------------
INSERT INTO users (username, password, full_name, role)
VALUES ('admin', '$2a$10$Vo/ImAuzrqYweB3SUYnKx.rPfXTkh.IQ2ZQwiJRr0/g1FPssJCs3i', 'Administrator', 'admin')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = 'admin';

-- --------------------------------------------
-- Auto-cleanup event (keep up to 2 years for long-range charts)
-- --------------------------------------------
SET GLOBAL event_scheduler = ON;

CREATE EVENT IF NOT EXISTS cleanup_old_data
  ON SCHEDULE EVERY 1 DAY
  STARTS CURRENT_TIMESTAMP
  DO
    DELETE FROM interface_data WHERE polled_at < DATE_SUB(NOW(), INTERVAL 2 YEAR);

CREATE EVENT IF NOT EXISTS cleanup_old_icmp_data
  ON SCHEDULE EVERY 1 DAY
  STARTS CURRENT_TIMESTAMP
  DO
    DELETE FROM icmp_data WHERE checked_at < DATE_SUB(NOW(), INTERVAL 2 YEAR);
