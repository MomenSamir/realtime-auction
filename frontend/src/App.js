import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [auctions, setAuctions] = useState([]);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [auctionDetails, setAuctionDetails] = useState(null);
  const [bids, setBids] = useState([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState({});
  const [notification, setNotification] = useState('');
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidForm, setBidForm] = useState({
    bidder_name: '',
    bidder_email: '',
    bid_amount: ''
  });
  const audioRef = useRef(null);

  // Initialize socket
  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  // Fetch auctions
  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(fetchAuctions, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Socket event listeners for selected auction
  useEffect(() => {
    if (!socket || !selectedAuction) return;

    // Join auction room
    socket.emit('join_auction', selectedAuction.id);

    socket.on('new_bid', (data) => {
      if (data.auction.id === selectedAuction.id) {
        setAuctionDetails(data.auction);
        setBids(prev => [data.bid, ...prev]);
        showNotification(`🔥 New bid: $${parseFloat(data.bid.bid_amount).toFixed(2)} by ${data.bid.bidder_name}`);
        
        // Play sound
        if (audioRef.current) {
          audioRef.current.play().catch(err => console.log('Audio play failed'));
        }
        
        // Update auction in list
        setAuctions(prev => prev.map(a => 
          a.id === data.auction.id ? data.auction : a
        ));
      }
    });

    socket.on('time_update', (data) => {
      if (data.auction_id === selectedAuction.id) {
        setTimeLeft(prev => ({
          ...prev,
          [data.auction_id]: data.seconds_left
        }));
      }
    });

    socket.on('auction_ended', (data) => {
      if (data.auction_id === selectedAuction.id) {
        showNotification('⏰ Auction has ended!');
        fetchAuctionDetails(selectedAuction.id);
        fetchAuctions();
      }
    });

    socket.on('auction_sold', (data) => {
      if (data.auction.id === selectedAuction.id) {
        showNotification('🎉 Item SOLD via Buy Now!');
        setAuctionDetails(data.auction);
        fetchAuctions();
      }
    });

    socket.on('viewer_count', (count) => {
      setViewerCount(count);
    });

    return () => {
      socket.emit('leave_auction', selectedAuction.id);
      socket.off('new_bid');
      socket.off('time_update');
      socket.off('auction_ended');
      socket.off('auction_sold');
      socket.off('viewer_count');
    };
  }, [socket, selectedAuction]);

  const fetchAuctions = async () => {
    try {
      const response = await axios.get(`${API_URL}/auctions`);
      setAuctions(response.data);
    } catch (error) {
      console.error('Error fetching auctions:', error);
    }
  };

  const fetchAuctionDetails = async (auctionId) => {
    try {
      const response = await axios.get(`${API_URL}/auctions/${auctionId}`);
      setAuctionDetails(response.data.auction);
      setBids(response.data.bids);
    } catch (error) {
      console.error('Error fetching auction details:', error);
    }
  };

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 4000);
  };

  const handleSelectAuction = (auction) => {
    setSelectedAuction(auction);
    fetchAuctionDetails(auction.id);
  };

  const handleBackToList = () => {
    setSelectedAuction(null);
    setAuctionDetails(null);
    setBids([]);
  };

  const handlePlaceBid = async (e) => {
    e.preventDefault();
    
    try {
      await axios.post(`${API_URL}/auctions/${selectedAuction.id}/bid`, bidForm);
      setShowBidModal(false);
      setBidForm({
        bidder_name: '',
        bidder_email: '',
        bid_amount: ''
      });
      showNotification('✅ Bid placed successfully!');
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Failed to place bid';
      showNotification(`❌ ${errorMsg}`);
    }
  };

  const handleBuyNow = async () => {
    if (!bidForm.bidder_name || !bidForm.bidder_email) {
      showNotification('❌ Please enter your name and email');
      return;
    }

    if (!window.confirm(`Buy now for $${parseFloat(auctionDetails.buyout_price).toFixed(2)}?`)) {
      return;
    }

    try {
      await axios.post(`${API_URL}/auctions/${selectedAuction.id}/buynow`, {
        buyer_name: bidForm.bidder_name,
        buyer_email: bidForm.bidder_email
      });
      setShowBidModal(false);
      showNotification('🎉 Congratulations! You won the auction!');
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Failed to complete purchase';
      showNotification(`❌ ${errorMsg}`);
    }
  };

  const formatTime = (seconds) => {
    if (seconds === undefined || seconds === null) return '--:--';
    if (seconds <= 0) return 'ENDED';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const getStatusBadge = (auction) => {
    const now = new Date();
    const startTime = new Date(auction.start_time);
    const endTime = new Date(auction.end_time);

    if (auction.status === 'sold') {
      return <span className="badge badge-sold">SOLD</span>;
    }
    if (auction.status === 'ended') {
      return <span className="badge badge-ended">ENDED</span>;
    }
    if (auction.status === 'active') {
      return <span className="badge badge-active">LIVE</span>;
    }
    if (auction.status === 'pending') {
      const timeUntilStart = Math.floor((startTime - now) / 1000 / 60);
      return <span className="badge badge-pending">Starts in {timeUntilStart}m</span>;
    }
    return null;
  };

  const getMinimumBid = () => {
    if (!auctionDetails) return 0;
    return parseFloat(auctionDetails.current_price) + 10.00;
  };

  return (
    <div className="App">
      {/* Bid sound */}
      <audio ref={audioRef}>
        <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTgIGWi77eefTRAMUKfj8LZjHAU4ktbyzHksBSR3x/DdkEAKFF606+uoVRQKRp/g8r5sIQYtgsrz2Ik4CBhov+3nn00QDFCn4/C2YxwFOJLW8sx5LAUkd8fw3ZBACRRM=" type="audio/wav" />
      </audio>

      {notification && (
        <div className="notification">
          {notification}
        </div>
      )}

      <header className="header">
        <div className="header-content">
          <h1>🔨 Live Auction</h1>
          <div className="header-stats">
            <div className="stat-pill">
              <span className="stat-label">Active</span>
              <span className="stat-value">{auctions.filter(a => a.status === 'active').length}</span>
            </div>
            <div className="stat-pill">
              <span className="stat-label">Upcoming</span>
              <span className="stat-value">{auctions.filter(a => a.status === 'pending').length}</span>
            </div>
            {socket?.connected && <div className="connection-badge">🟢 LIVE</div>}
          </div>
        </div>
      </header>

      <div className="container">
        {!selectedAuction ? (
          // Auction List View
          <div className="auctions-grid">
            {auctions.map(auction => (
              <div 
                key={auction.id} 
                className={`auction-card ${auction.status}`}
                onClick={() => auction.status !== 'ended' && handleSelectAuction(auction)}
              >
                <div className="auction-image" style={{
                  backgroundImage: `url(${auction.image_url})`
                }}>
                  {getStatusBadge(auction)}
                </div>
                
                <div className="auction-content">
                  <h3 className="auction-title">{auction.title}</h3>
                  <p className="auction-description">{auction.description}</p>
                  
                  <div className="auction-price-section">
                    <div className="price-row">
                      <span className="price-label">Current Bid</span>
                      <span className="price-value">${parseFloat(auction.current_price).toFixed(2)}</span>
                    </div>
                    {auction.buyout_price && (
                      <div className="price-row buyout">
                        <span className="price-label">Buy Now</span>
                        <span className="price-value">${parseFloat(auction.buyout_price).toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <div className="auction-footer">
                    <div className="bid-count">
                      👥 {auction.total_bids} bids
                    </div>
                    {auction.status === 'active' && (
                      <div className="time-left">
                        ⏰ {formatTime(timeLeft[auction.id])}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Auction Detail View
          <div className="auction-detail">
            <button className="back-button" onClick={handleBackToList}>
              ← Back to Auctions
            </button>

            <div className="detail-layout">
              <div className="detail-main">
                <div className="detail-image" style={{
                  backgroundImage: `url(${auctionDetails?.image_url})`
                }}>
                  {auctionDetails && getStatusBadge(auctionDetails)}
                  {auctionDetails?.status === 'active' && (
                    <div className="viewers-badge">
                      👁️ {viewerCount} watching
                    </div>
                  )}
                </div>

                <div className="detail-info">
                  <h1>{auctionDetails?.title}</h1>
                  <p className="detail-description">{auctionDetails?.description}</p>

                  <div className="price-display">
                    <div className="current-bid">
                      <span className="label">Current Bid</span>
                      <span className="amount">${parseFloat(auctionDetails?.current_price || 0).toFixed(2)}</span>
                    </div>
                    {auctionDetails?.buyout_price && auctionDetails?.status === 'active' && (
                      <div className="buyout-bid">
                        <span className="label">Buy Now Price</span>
                        <span className="amount">${parseFloat(auctionDetails.buyout_price).toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  {auctionDetails?.status === 'active' && (
                    <div className="time-display">
                      <span className="time-label">Time Remaining</span>
                      <span className="time-value">
                        {formatTime(timeLeft[selectedAuction.id])}
                      </span>
                    </div>
                  )}

                  {auctionDetails?.status === 'active' && (
                    <div className="action-buttons">
                      <button 
                        className="btn-bid"
                        onClick={() => setShowBidModal(true)}
                      >
                        Place Bid (Min: ${getMinimumBid().toFixed(2)})
                      </button>
                      {auctionDetails.buyout_price && (
                        <button 
                          className="btn-buynow"
                          onClick={() => setShowBidModal(true)}
                        >
                          Buy Now - ${parseFloat(auctionDetails.buyout_price).toFixed(2)}
                        </button>
                      )}
                    </div>
                  )}

                  {auctionDetails?.status === 'sold' && (
                    <div className="sold-banner">
                      🎉 SOLD to {auctionDetails.winner_name} for ${parseFloat(auctionDetails.current_price).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>

              <div className="detail-sidebar">
                <h2>Bid History ({bids.length})</h2>
                <div className="bids-list">
                  {bids.map((bid, index) => (
                    <div key={bid.id} className={`bid-item ${index === 0 ? 'leading' : ''}`}>
                      <div className="bid-header">
                        <span className="bidder-name">
                          {index === 0 && '👑 '}
                          {bid.bidder_name}
                        </span>
                        <span className="bid-amount">
                          ${parseFloat(bid.bid_amount).toFixed(2)}
                        </span>
                      </div>
                      <div className="bid-time">
                        {new Date(bid.bid_time).toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {bids.length === 0 && (
                    <div className="no-bids">
                      No bids yet. Be the first! 🚀
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bid Modal */}
        {showBidModal && (
          <div className="modal-overlay" onClick={() => setShowBidModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Place Your Bid</h2>
              
              <form onSubmit={handlePlaceBid}>
                <input
                  type="text"
                  placeholder="Your Name *"
                  value={bidForm.bidder_name}
                  onChange={(e) => setBidForm({ ...bidForm, bidder_name: e.target.value })}
                  required
                />
                <input
                  type="email"
                  placeholder="Your Email *"
                  value={bidForm.bidder_email}
                  onChange={(e) => setBidForm({ ...bidForm, bidder_email: e.target.value })}
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder={`Minimum bid: $${getMinimumBid().toFixed(2)}`}
                  value={bidForm.bid_amount}
                  onChange={(e) => setBidForm({ ...bidForm, bid_amount: e.target.value })}
                  min={getMinimumBid()}
                  required
                />

                <div className="modal-actions">
                  <button type="submit" className="btn-primary">
                    Place Bid
                  </button>
                  {auctionDetails?.buyout_price && (
                    <button 
                      type="button" 
                      className="btn-buynow-modal"
                      onClick={handleBuyNow}
                    >
                      Buy Now - ${parseFloat(auctionDetails.buyout_price).toFixed(2)}
                    </button>
                  )}
                  <button 
                    type="button" 
                    className="btn-secondary"
                    onClick={() => setShowBidModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
