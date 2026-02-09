const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Track connected users per auction
const auctionRooms = {};

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join auction room
  socket.on('join_auction', (auctionId) => {
    socket.join(`auction_${auctionId}`);
    
    if (!auctionRooms[auctionId]) {
      auctionRooms[auctionId] = new Set();
    }
    auctionRooms[auctionId].add(socket.id);
    
    // Broadcast viewer count
    io.to(`auction_${auctionId}`).emit('viewer_count', auctionRooms[auctionId].size);
    
    console.log(`Socket ${socket.id} joined auction ${auctionId}`);
  });

  // Leave auction room
  socket.on('leave_auction', (auctionId) => {
    socket.leave(`auction_${auctionId}`);
    
    if (auctionRooms[auctionId]) {
      auctionRooms[auctionId].delete(socket.id);
      io.to(`auction_${auctionId}`).emit('viewer_count', auctionRooms[auctionId].size);
    }
  });

  socket.on('disconnect', () => {
    // Remove from all rooms
    Object.keys(auctionRooms).forEach(auctionId => {
      if (auctionRooms[auctionId].has(socket.id)) {
        auctionRooms[auctionId].delete(socket.id);
        io.to(`auction_${auctionId}`).emit('viewer_count', auctionRooms[auctionId].size);
      }
    });
    console.log('Client disconnected:', socket.id);
  });
});

// Update auction statuses based on time
const updateAuctionStatuses = async () => {
  try {
    const now = new Date();
    
    // Start pending auctions
    await db.query(`
      UPDATE auctions 
      SET status = 'active' 
      WHERE status = 'pending' AND start_time <= ?
    `, [now]);
    
    // End active auctions
    const [endedAuctions] = await db.query(`
      UPDATE auctions 
      SET status = 'ended' 
      WHERE status = 'active' AND end_time <= ?
      RETURNING id
    `, [now]);
    
    // Notify about ended auctions
    if (endedAuctions && endedAuctions.length > 0) {
      endedAuctions.forEach(auction => {
        io.to(`auction_${auction.id}`).emit('auction_ended', { auction_id: auction.id });
      });
    }
  } catch (error) {
    console.error('Error updating auction statuses:', error);
  }
};

// Check auction statuses every second
setInterval(updateAuctionStatuses, 1000);

// Broadcast time updates every second for active auctions
setInterval(async () => {
  try {
    const [activeAuctions] = await db.query(`
      SELECT id, end_time FROM auctions WHERE status = 'active'
    `);
    
    const now = new Date();
    activeAuctions.forEach(auction => {
      const timeLeft = Math.max(0, Math.floor((new Date(auction.end_time) - now) / 1000));
      io.to(`auction_${auction.id}`).emit('time_update', {
        auction_id: auction.id,
        seconds_left: timeLeft
      });
      
      // Auto-end if time is up
      if (timeLeft === 0) {
        io.to(`auction_${auction.id}`).emit('auction_ended', { auction_id: auction.id });
      }
    });
  } catch (error) {
    console.error('Error broadcasting time updates:', error);
  }
}, 1000);

// ========== AUCTIONS ROUTES ==========

// Get all auctions
app.get('/api/auctions', async (req, res) => {
  try {
    const [auctions] = await db.query(`
      SELECT 
        a.*,
        (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as total_bids,
        (SELECT bidder_name FROM bids WHERE auction_id = a.id ORDER BY bid_time DESC LIMIT 1) as leading_bidder
      FROM auctions a
      ORDER BY 
        CASE 
          WHEN status = 'active' THEN 1
          WHEN status = 'pending' THEN 2
          WHEN status = 'ended' THEN 3
          ELSE 4
        END,
        start_time ASC
    `);
    res.json(auctions);
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({ error: 'Failed to fetch auctions' });
  }
});

// Get single auction with bids
app.get('/api/auctions/:id', async (req, res) => {
  try {
    const [auctions] = await db.query(`
      SELECT * FROM auctions WHERE id = ?
    `, [req.params.id]);
    
    if (auctions.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    const [bids] = await db.query(`
      SELECT * FROM bids 
      WHERE auction_id = ? 
      ORDER BY bid_time DESC 
      LIMIT 50
    `, [req.params.id]);
    
    res.json({
      auction: auctions[0],
      bids: bids
    });
  } catch (error) {
    console.error('Error fetching auction:', error);
    res.status(500).json({ error: 'Failed to fetch auction' });
  }
});

// Place a bid
app.post('/api/auctions/:id/bid', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { bidder_name, bidder_email, bid_amount } = req.body;
    const auctionId = req.params.id;
    
    // Get auction with lock
    const [auctions] = await connection.query(`
      SELECT * FROM auctions 
      WHERE id = ? AND status = 'active'
      FOR UPDATE
    `, [auctionId]);
    
    if (auctions.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Auction not found or not active' });
    }
    
    const auction = auctions[0];
    
    // Validate bid amount
    const minimumBid = parseFloat(auction.current_price) + 10.00; // Minimum increment $10
    if (parseFloat(bid_amount) < minimumBid) {
      await connection.rollback();
      return res.status(400).json({ 
        error: `Bid must be at least $${minimumBid.toFixed(2)}` 
      });
    }
    
    // Check if auction ended
    if (new Date(auction.end_time) <= new Date()) {
      await connection.rollback();
      return res.status(400).json({ error: 'Auction has ended' });
    }
    
    // Insert bid
    const [bidResult] = await connection.query(`
      INSERT INTO bids (auction_id, bidder_name, bidder_email, bid_amount, bid_time)
      VALUES (?, ?, ?, ?, NOW())
    `, [auctionId, bidder_name, bidder_email, bid_amount]);
    
    // Update auction current price
    await connection.query(`
      UPDATE auctions 
      SET current_price = ?,
          total_bids = total_bids + 1
      WHERE id = ?
    `, [bid_amount, auctionId]);
    
    // MAGIC: Extend auction time by 1 minute if bid is placed
    const extensionMinutes = auction.time_extension_minutes || 1;
    await connection.query(`
      UPDATE auctions 
      SET end_time = DATE_ADD(end_time, INTERVAL ? MINUTE)
      WHERE id = ?
    `, [extensionMinutes, auctionId]);
    
    await connection.commit();
    
    // Fetch updated auction
    const [updatedAuction] = await db.query('SELECT * FROM auctions WHERE id = ?', [auctionId]);
    const [newBid] = await db.query('SELECT * FROM bids WHERE id = ?', [bidResult.insertId]);
    
    // Broadcast to all users watching this auction
    io.to(`auction_${auctionId}`).emit('new_bid', {
      auction: updatedAuction[0],
      bid: newBid[0]
    });
    
    res.status(201).json({
      auction: updatedAuction[0],
      bid: newBid[0]
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error placing bid:', error);
    res.status(500).json({ error: 'Failed to place bid' });
  } finally {
    connection.release();
  }
});

// Buy now (buyout price)
app.post('/api/auctions/:id/buynow', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { buyer_name, buyer_email } = req.body;
    const auctionId = req.params.id;
    
    const [auctions] = await connection.query(`
      SELECT * FROM auctions 
      WHERE id = ? AND status = 'active' AND buyout_price IS NOT NULL
      FOR UPDATE
    `, [auctionId]);
    
    if (auctions.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Auction not available for buyout' });
    }
    
    const auction = auctions[0];
    
    // Create final bid at buyout price
    await connection.query(`
      INSERT INTO bids (auction_id, bidder_name, bidder_email, bid_amount, bid_time)
      VALUES (?, ?, ?, ?, NOW())
    `, [auctionId, buyer_name, buyer_email, auction.buyout_price]);
    
    // End auction immediately
    await connection.query(`
      UPDATE auctions 
      SET status = 'sold',
          current_price = ?,
          winner_name = ?,
          winner_email = ?,
          end_time = NOW()
      WHERE id = ?
    `, [auction.buyout_price, buyer_name, buyer_email, auctionId]);
    
    await connection.commit();
    
    const [soldAuction] = await db.query('SELECT * FROM auctions WHERE id = ?', [auctionId]);
    
    // Broadcast auction sold
    io.to(`auction_${auctionId}`).emit('auction_sold', {
      auction: soldAuction[0]
    });
    
    res.json({ auction: soldAuction[0] });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error buying now:', error);
    res.status(500).json({ error: 'Failed to complete purchase' });
  } finally {
    connection.release();
  }
});

// Get auction statistics
app.get('/api/stats', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_auctions,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as upcoming_auctions,
        COUNT(CASE WHEN status = 'ended' OR status = 'sold' THEN 1 END) as completed_auctions,
        SUM(total_bids) as total_bids_placed,
        COUNT(DISTINCT id) as total_auctions
      FROM auctions
    `);
    
    const [topBidders] = await db.query(`
      SELECT 
        bidder_name,
        COUNT(*) as bid_count,
        SUM(bid_amount) as total_bid_amount
      FROM bids
      GROUP BY bidder_name, bidder_email
      ORDER BY bid_count DESC
      LIMIT 5
    `);
    
    res.json({
      summary: stats[0],
      top_bidders: topBidders
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🔨 Auction system server running on port ${PORT}`);
  console.log(`⏰ Real-time updates active`);
});
