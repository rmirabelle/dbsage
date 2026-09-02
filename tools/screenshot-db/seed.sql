DROP DATABASE IF EXISTS dbsage_screenshot_demo;
CREATE DATABASE dbsage_screenshot_demo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
DROP DATABASE IF EXISTS dbsage_screenshot_compare;
CREATE DATABASE dbsage_screenshot_compare
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'dbsage_help'@'127.0.0.1' IDENTIFIED BY 'dbsage-demo';
CREATE USER IF NOT EXISTS 'dbsage_help'@'localhost' IDENTIFIED BY 'dbsage-demo';
GRANT ALL PRIVILEGES ON dbsage_screenshot_demo.* TO 'dbsage_help'@'127.0.0.1';
GRANT ALL PRIVILEGES ON dbsage_screenshot_demo.* TO 'dbsage_help'@'localhost';
GRANT ALL PRIVILEGES ON dbsage_screenshot_compare.* TO 'dbsage_help'@'127.0.0.1';
GRANT ALL PRIVILEGES ON dbsage_screenshot_compare.* TO 'dbsage_help'@'localhost';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'dbsage_help'@'127.0.0.1';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'dbsage_help'@'localhost';
FLUSH PRIVILEGES;

USE dbsage_screenshot_demo;

CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  status ENUM('active', 'trial', 'paused') NOT NULL DEFAULT 'trial',
  region VARCHAR(40) NOT NULL,
  lifetime_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  preferences JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_email (email),
  KEY idx_customers_status_region (status, region)
) ENGINE=InnoDB;

CREATE TABLE products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku VARCHAR(32) NOT NULL,
  name VARCHAR(140) NOT NULL,
  category VARCHAR(60) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  inventory_count INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  attributes JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category_active (category, active)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  order_number VARCHAR(32) NOT NULL,
  status ENUM('draft', 'paid', 'packed', 'shipped', 'refunded') NOT NULL,
  channel ENUM('web', 'retail', 'partner') NOT NULL DEFAULT 'web',
  total DECIMAL(12,2) NOT NULL,
  shipping_address JSON NOT NULL,
  ordered_at DATETIME NOT NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  KEY idx_orders_customer_date (customer_id, ordered_at),
  KEY idx_orders_status_date (status, ordered_at),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  KEY idx_items_product (product_id),
  CONSTRAINT fk_items_order
    FOREIGN KEY (order_id) REFERENCES orders (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_items_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE event_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(80) NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  severity ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
  payload JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_events_type_time (event_type, occurred_at),
  KEY idx_events_actor (actor_id)
) ENGINE=InnoDB;

INSERT INTO customers
  (full_name, email, status, region, lifetime_value, preferences, created_at)
VALUES
  ('Maya Chen', 'maya.chen@example.test', 'active', 'Northeast', 4820.50, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('analytics','design')), '2024-01-12 09:14:00'),
  ('Jon Bell', 'jon.bell@example.test', 'active', 'Midwest', 2915.20, JSON_OBJECT('theme','system','newsletter',false,'interests',JSON_ARRAY('hardware')), '2024-02-03 15:42:00'),
  ('Priya Raman', 'priya.raman@example.test', 'trial', 'West', 840.00, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('automation','data')), '2024-03-18 11:08:00'),
  ('Luis Ortega', 'luis.ortega@example.test', 'active', 'Southwest', 6142.75, JSON_OBJECT('theme','light','newsletter',true,'interests',JSON_ARRAY('operations')), '2024-04-01 08:31:00'),
  ('Avery Brooks', 'avery.brooks@example.test', 'paused', 'Southeast', 1290.40, JSON_OBJECT('theme','system','newsletter',false), '2024-04-27 13:20:00'),
  ('Nora Okafor', 'nora.okafor@example.test', 'active', 'Northeast', 7340.15, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('security','analytics')), '2024-05-09 10:11:00'),
  ('Elliot Price', 'elliot.price@example.test', 'trial', 'Midwest', 425.99, JSON_OBJECT('theme','light','newsletter',true), '2024-06-14 16:55:00'),
  ('Samira Haddad', 'samira.haddad@example.test', 'active', 'West', 3888.80, JSON_OBJECT('theme','dark','newsletter',false,'interests',JSON_ARRAY('design','retail')), '2024-07-02 12:09:00'),
  ('Theo Martin', 'theo.martin@example.test', 'active', 'Southeast', 5105.25, JSON_OBJECT('theme','system','newsletter',true), '2024-07-23 09:47:00'),
  ('Grace Kim', 'grace.kim@example.test', 'paused', 'West', 2144.60, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('data')), '2024-08-06 14:33:00'),
  ('Darius Cole', 'darius.cole@example.test', 'active', 'Southwest', 9080.00, JSON_OBJECT('theme','light','newsletter',false), '2024-08-30 10:25:00'),
  ('Elena Petrova', 'elena.petrova@example.test', 'trial', 'Northeast', 685.35, JSON_OBJECT('theme','dark','newsletter',true), '2024-09-11 17:18:00'),
  ('Noah Williams', 'noah.williams@example.test', 'active', 'Midwest', 4421.10, JSON_OBJECT('theme','system','newsletter',true,'interests',JSON_ARRAY('hardware','automation')), '2024-10-04 08:58:00'),
  ('Amara Singh', 'amara.singh@example.test', 'active', 'West', 5770.45, JSON_OBJECT('theme','dark','newsletter',false), '2024-10-29 11:46:00'),
  ('Mateo Silva', 'mateo.silva@example.test', 'trial', 'Southeast', 995.00, JSON_OBJECT('theme','light','newsletter',true), '2024-11-16 13:04:00'),
  ('Iris Walker', 'iris.walker@example.test', 'active', 'Northeast', 3610.90, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('retail','design')), '2024-12-07 09:39:00'),
  ('Owen Reed', 'owen.reed@example.test', 'paused', 'Midwest', 1760.75, JSON_OBJECT('theme','system','newsletter',false), '2025-01-13 15:22:00'),
  ('Zara Ali', 'zara.ali@example.test', 'active', 'Southwest', 8255.30, JSON_OBJECT('theme','dark','newsletter',true,'interests',JSON_ARRAY('security')), '2025-02-05 10:50:00'),
  ('Caleb Young', 'caleb.young@example.test', 'trial', 'Southeast', 540.20, JSON_OBJECT('theme','light','newsletter',true), '2025-03-21 12:17:00'),
  ('June Park', 'june.park@example.test', 'active', 'West', 4689.65, JSON_OBJECT('theme','dark','newsletter',false,'interests',JSON_ARRAY('analytics','automation')), '2025-04-08 16:03:00');

INSERT INTO products
  (sku, name, category, price, inventory_count, active, attributes)
VALUES
  ('DSK-LAMP-01', 'Arc Desk Lamp', 'Workspace', 89.00, 46, 1, JSON_OBJECT('color','graphite','material','aluminum','dimmable',true)),
  ('KEY-MECH-02', 'Tactile Mechanical Keyboard', 'Workspace', 149.00, 28, 1, JSON_OBJECT('layout','US','switch','tactile','wireless',true)),
  ('MSE-ERG-03', 'Ergonomic Mouse', 'Workspace', 79.00, 71, 1, JSON_OBJECT('hand','right','dpi',3200,'wireless',true)),
  ('HUB-USBC-04', 'USB-C Studio Hub', 'Connectivity', 119.00, 33, 1, JSON_OBJECT('ports',9,'power_delivery_w',100,'display','4K60')), 
  ('CAM-4K-05', '4K Conference Camera', 'Video', 199.00, 19, 1, JSON_OBJECT('resolution','4K','autofocus',true,'privacy_shutter',true)),
  ('MIC-USB-06', 'USB Broadcast Microphone', 'Audio', 129.00, 24, 1, JSON_OBJECT('pattern','cardioid','monitoring',true,'color','black')), 
  ('HPH-NC-07', 'Noise-Canceling Headphones', 'Audio', 249.00, 38, 1, JSON_OBJECT('battery_hours',38,'codec',JSON_ARRAY('AAC','SBC'),'color','slate')), 
  ('STD-LAP-08', 'Adjustable Laptop Stand', 'Workspace', 69.00, 84, 1, JSON_OBJECT('material','aluminum','max_inches',17,'foldable',true)),
  ('PAD-DESK-09', 'Recycled Felt Desk Pad', 'Workspace', 39.00, 112, 1, JSON_OBJECT('width_cm',90,'color','charcoal','recycled',true)),
  ('CBL-USBC-10', 'Braided USB-C Cable', 'Connectivity', 24.00, 210, 1, JSON_OBJECT('length_m',2,'wattage',240,'color','lime')), 
  ('SPK-DESK-11', 'Compact Desktop Speakers', 'Audio', 109.00, 16, 1, JSON_OBJECT('power_w',40,'input',JSON_ARRAY('USB-C','Bluetooth'))),
  ('LGT-BAR-12', 'Monitor Light Bar', 'Workspace', 59.00, 55, 1, JSON_OBJECT('temperature',JSON_ARRAY(3000,4000,5000),'remote',true));

INSERT INTO orders
  (customer_id, order_number, status, channel, total, shipping_address, ordered_at, notes)
WITH RECURSIVE sequence(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM sequence WHERE n < 600
)
SELECT
  ((n - 1) MOD 20) + 1,
  CONCAT('ORD-2026-', LPAD(n, 5, '0')),
  ELT((n MOD 5) + 1, 'draft', 'paid', 'packed', 'shipped', 'refunded'),
  ELT((n MOD 3) + 1, 'web', 'retail', 'partner'),
  ROUND(45 + ((n * 37) MOD 900) + ((n MOD 4) * 0.25), 2),
  JSON_OBJECT(
    'line1', CONCAT(100 + (n MOD 800), ' Market Street'),
    'city', ELT((n MOD 5) + 1, 'Portland', 'Boston', 'Austin', 'Chicago', 'Seattle'),
    'region', ELT((n MOD 5) + 1, 'OR', 'MA', 'TX', 'IL', 'WA'),
    'postal_code', LPAD(10000 + (n MOD 89999), 5, '0'),
    'delivery', JSON_OBJECT('method', ELT((n MOD 3) + 1, 'ground', 'priority', 'pickup'), 'gift', (n MOD 9) = 0)
  ),
  TIMESTAMP('2026-01-01 08:00:00') + INTERVAL (n * 17) HOUR,
  CASE WHEN n MOD 11 = 0 THEN 'Please use recyclable packaging.' ELSE NULL END
FROM sequence;

INSERT INTO order_items
  (order_id, product_id, quantity, unit_price, discount_percent, metadata)
WITH RECURSIVE sequence(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM sequence WHERE n < 1000
)
SELECT
  ((n - 1) MOD 600) + 1,
  ((n * 5 - 1) MOD 12) + 1,
  (n MOD 4) + 1,
  ROUND(24 + ((n * 13) MOD 225), 2),
  CASE WHEN n MOD 8 = 0 THEN 10.00 WHEN n MOD 13 = 0 THEN 15.00 ELSE 0.00 END,
  JSON_OBJECT('warehouse', ELT((n MOD 3) + 1, 'east', 'central', 'west'), 'gift_wrap', (n MOD 17) = 0)
FROM sequence;

INSERT INTO event_log
  (event_type, actor_id, severity, payload, occurred_at)
WITH RECURSIVE sequence(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM sequence WHERE n < 500
)
SELECT
  ELT((n MOD 5) + 1, 'order.created', 'payment.captured', 'shipment.updated', 'customer.updated', 'inventory.warning'),
  CASE WHEN n MOD 7 = 0 THEN NULL ELSE ((n - 1) MOD 20) + 1 END,
  CASE WHEN n MOD 29 = 0 THEN 'error' WHEN n MOD 11 = 0 THEN 'warning' ELSE 'info' END,
  JSON_OBJECT(
    'request_id', CONCAT('req_', LPAD(n, 6, '0')),
    'source', ELT((n MOD 4) + 1, 'storefront', 'worker', 'admin', 'partner_api'),
    'changes', JSON_ARRAY(
      JSON_OBJECT('field', 'status', 'from', 'pending', 'to', ELT((n MOD 3) + 1, 'paid', 'packed', 'shipped')),
      JSON_OBJECT('field', 'attempt', 'from', n MOD 3, 'to', (n MOD 3) + 1)
    ),
    'context', JSON_OBJECT('ip', CONCAT('192.0.2.', (n MOD 240) + 1), 'test_data', true)
  ),
  TIMESTAMP('2026-07-01 00:00:00') + INTERVAL (n * 43) MINUTE
FROM sequence;

ANALYZE TABLE customers, products, orders, order_items, event_log;

/* Structure-only target with intentional, legible comparison differences. */
CREATE TABLE dbsage_screenshot_compare.customers LIKE dbsage_screenshot_demo.customers;
ALTER TABLE dbsage_screenshot_compare.customers
  ADD COLUMN preferred_language CHAR(5) NULL AFTER region,
  MODIFY COLUMN lifetime_value DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE dbsage_screenshot_compare.products LIKE dbsage_screenshot_demo.products;
ALTER TABLE dbsage_screenshot_compare.products
  MODIFY COLUMN inventory_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN discontinued_at DATETIME NULL AFTER active;

CREATE TABLE dbsage_screenshot_compare.orders LIKE dbsage_screenshot_demo.orders;
ALTER TABLE dbsage_screenshot_compare.orders
  MODIFY COLUMN total DECIMAL(14,2) NOT NULL,
  ADD COLUMN fulfillment_priority ENUM('standard', 'expedited', 'critical') NOT NULL DEFAULT 'standard' AFTER channel,
  DROP KEY idx_orders_status_date,
  ADD KEY idx_orders_channel_status (channel, status, ordered_at);

CREATE TABLE dbsage_screenshot_compare.order_items LIKE dbsage_screenshot_demo.order_items;
ALTER TABLE dbsage_screenshot_compare.order_items
  ADD COLUMN fulfillment_state VARCHAR(24) NOT NULL DEFAULT 'unallocated' AFTER discount_percent;

CREATE TABLE dbsage_screenshot_compare.returns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(160) NOT NULL,
  status ENUM('requested', 'approved', 'received', 'refunded') NOT NULL DEFAULT 'requested',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_returns_order (order_id),
  KEY idx_returns_status_date (status, requested_at)
) ENGINE=InnoDB;
