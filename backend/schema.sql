-- Create database
CREATE DATABASE IF NOT EXISTS `node-realtime-auction`;

USE `node-realtime-auction`;

-- Auctions table (services/items for auction)
CREATE TABLE IF NOT EXISTS auctions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  starting_price DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2) NOT NULL,
  buyout_price DECIMAL(10, 2),
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  original_duration_minutes INT NOT NULL,
  time_extension_minutes INT DEFAULT 1,
  status ENUM('pending', 'active', 'ended', 'sold') DEFAULT 'pending',
  winner_name VARCHAR(255),
  winner_email VARCHAR(255),
  total_bids INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Bids table
CREATE TABLE IF NOT EXISTS bids (
  id INT AUTO_INCREMENT PRIMARY KEY,
  auction_id INT NOT NULL,
  bidder_name VARCHAR(255) NOT NULL,
  bidder_email VARCHAR(255) NOT NULL,
  bid_amount DECIMAL(10, 2) NOT NULL,
  bid_time DATETIME NOT NULL,
  is_auto_bid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
  INDEX idx_auction_id (auction_id),
  INDEX idx_bid_time (bid_time)
);

-- Watchers table (users watching specific auctions)
CREATE TABLE IF NOT EXISTS watchers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  auction_id INT NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
  UNIQUE KEY unique_watcher (auction_id, user_email)
);

-- Insert sample auctions

-- Auction 1: Already active (started 10 min ago, ends in 20 min)
INSERT INTO auctions (
  title, description, image_url, starting_price, current_price, buyout_price,
  start_time, end_time, original_duration_minutes, status
) VALUES (
  'Vintage Rolex Submariner Watch',
  'Rare 1960s Rolex Submariner in excellent condition. Authenticated by certified experts.',
  'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=500',
  5000.00, 7500.00, 15000.00,
  DATE_SUB(NOW(), INTERVAL 10 MINUTE),
  DATE_ADD(NOW(), INTERVAL 20 MINUTE),
  30,
  'active'
);

-- Auction 2: Starting in 5 minutes
INSERT INTO auctions (
  title, description, image_url, starting_price, current_price, buyout_price,
  start_time, end_time, original_duration_minutes, status
) VALUES (
  'MacBook Pro 16" M3 Max',
  'Brand new sealed MacBook Pro with M3 Max chip, 64GB RAM, 2TB SSD. Space Black.',
  'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500',
  2000.00, 2000.00, 4000.00,
  DATE_ADD(NOW(), INTERVAL 5 MINUTE),
  DATE_ADD(NOW(), INTERVAL 35 MINUTE),
  30,
  'pending'
);

-- Auction 3: Starting in 15 minutes
INSERT INTO auctions (
  title, description, image_url, starting_price, current_price, buyout_price,
  start_time, end_time, original_duration_minutes, status
) VALUES (
  'Original Signed Picasso Print',
  'Authenticated Picasso lithograph print, signed and numbered. Certificate of authenticity included.',
  'https://images.unsplash.com/photo-1578301978162-7aae4d755744?w=500',
  10000.00, 10000.00, 25000.00,
  DATE_ADD(NOW(), INTERVAL 15 MINUTE),
  DATE_ADD(NOW(), INTERVAL 45 MINUTE),
  30,
  'pending'
);

-- Auction 4: Active, ending soon (5 minutes left)
INSERT INTO auctions (
  title, description, image_url, starting_price, current_price, buyout_price,
  start_time, end_time, original_duration_minutes, status
) VALUES (
  'Tesla Model 3 Performance 2023',
  'Low mileage Tesla Model 3 Performance. Full self-driving capability. Pearl white multi-coat.',
  'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=500',
  35000.00, 42000.00, 50000.00,
  DATE_SUB(NOW(), INTERVAL 25 MINUTE),
  DATE_ADD(NOW(), INTERVAL 5 MINUTE),
  30,
  'active'
);

-- Auction 5: Gaming PC - Starting in 30 minutes
INSERT INTO auctions (
  title, description, image_url, starting_price, current_price, buyout_price,
  start_time, end_time, original_duration_minutes, status
) VALUES (
  'Custom Gaming PC - RTX 4090',
  'High-end gaming PC with RTX 4090, i9-14900K, 64GB DDR5, 2TB NVMe. RGB everything!',
  'https://images.unsplash.com/photo-1587202372634-32705e3bf49c?w=500',
  3000.00, 3000.00, 6000.00,
  DATE_ADD(NOW(), INTERVAL 30 MINUTE),
  DATE_ADD(NOW(), INTERVAL 60 MINUTE),
  30,
  'pending'
);

-- Insert sample bids for active auctions
INSERT INTO bids (auction_id, bidder_name, bidder_email, bid_amount, bid_time) VALUES
(1, 'John Smith', 'john@example.com', 5500.00, DATE_SUB(NOW(), INTERVAL 9 MINUTE)),
(1, 'Sarah Johnson', 'sarah@example.com', 6000.00, DATE_SUB(NOW(), INTERVAL 7 MINUTE)),
(1, 'Mike Davis', 'mike@example.com', 6500.00, DATE_SUB(NOW(), INTERVAL 5 MINUTE)),
(1, 'John Smith', 'john@example.com', 7000.00, DATE_SUB(NOW(), INTERVAL 3 MINUTE)),
(1, 'Sarah Johnson', 'sarah@example.com', 7500.00, DATE_SUB(NOW(), INTERVAL 1 MINUTE)),

(4, 'Emily Chen', 'emily@example.com', 36000.00, DATE_SUB(NOW(), INTERVAL 20 MINUTE)),
(4, 'Robert Wilson', 'robert@example.com', 38000.00, DATE_SUB(NOW(), INTERVAL 15 MINUTE)),
(4, 'Emily Chen', 'emily@example.com', 40000.00, DATE_SUB(NOW(), INTERVAL 10 MINUTE)),
(4, 'Robert Wilson', 'robert@example.com', 42000.00, DATE_SUB(NOW(), INTERVAL 3 MINUTE));

-- Update total_bids count
UPDATE auctions SET total_bids = (SELECT COUNT(*) FROM bids WHERE bids.auction_id = auctions.id);
