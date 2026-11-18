CREATE DATABASE IF NOT EXISTS medical_inspection
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE medical_inspection;

CREATE TABLE IF NOT EXISTS inspections (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT NOT NULL,
  record_json JSON NOT NULL,
  PRIMARY KEY (sequence_id),
  UNIQUE KEY inspections_id (id)
) ENGINE=InnoDB;
