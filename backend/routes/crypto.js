const express = require('express');
const axios = require('axios');
const Settings = require('../models/Settings');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// CoinGecko free public market data. Server-side caching (120 s) and
// in-flight dedupe keep us within rate limits. Prices are never fabricated:
// on failure with no cache we return stale:true and an empty coin list.
const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'tether', symbol: 'USDT', name: 'Tether' }
];
const CACHE_TTL_MS = 120 * 1000;
const ALLOWED_COINS = COINS.map((c) => c.symbol);
let cache = { data: null, fetchedAt: 0 };
let inFlight = null;

async function fetchPrices() {
  const ids = COINS.map((c) => c.id).join(',');
  const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
    params: { ids, vs_currencies: 'usd', include_24hr_change: true },
    timeout: 8000
  });
  const lastUpdated = new Date();
  const coins = COINS.map((c) => {
    const row = response.data[c.id] || {};
    const price = Number(row.usd);
    const change24h = Number(row.usd_24h_change);
    if (!Number.isFinite(price) || price <= 0) return null; // no false zero prices
    return {
      symbol: c.symbol,
      name: c.name,
      price,
      change24h: Number.isFinite(change24h) ? change24h : null,
      lastUpdated,
      source: 'CoinGecko'
    };
  }).filter(Boolean);
  return { coins };
}

// @route GET /api/crypto/prices
// @desc Cached market prices from CoinGecko
// @access Public
router.get('/prices', async (req, res, next) => {
  try {
    if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return res.json({ success: true, message: 'Market prices (cached)', data: { ...cache.data, stale: false, cached: true } });
    }
    if (!inFlight) {
      inFlight = fetchPrices()
        .then((data) => { cache = { data, fetchedAt: Date.now() }; return data; })
        .finally(() => { inFlight = null; });
    }
    const data = await inFlight;
    return res.json({ success: true, message: 'Market prices', data: { ...data, stale: false, cached: false } });
  } catch (err) {
    if (cache.data) {
      return res.json({ success: true, message: 'Market prices unavailable — serving stale data', data: { ...cache.data, stale: true, cached: true } });
    }
    return res.status(502).json({ success: false, message: 'Market data unavailable', data: { coins: [], stale: true } });
  }
});

// @route GET /api/crypto/wallets
// @desc Configured deposit wallets (current user view)
// @access Private
router.get('/wallets', auth, async (req, res, next) => {
  try {
    const settings = await Settings.findOne() || {};
    const wallets = (settings.cryptoWallets || []).map(({ coin, network, address }) => ({ coin, network, address }));
    return res.json({ success: true, message: 'Deposit wallets retrieved', data: { wallets } });
  } catch (err) {
    return next(err);
  }
});

// @route GET /api/crypto/wallets/admin
// @desc Configured deposit wallets (full view)
// @access Admin
router.get('/wallets/admin', auth, adminOnly, async (req, res, next) => {
  try {
    const settings = await Settings.findOne() || {};
    return res.json({ success: true, message: 'Deposit wallets retrieved', data: { wallets: settings.cryptoWallets || [] } });
  } catch (err) {
    return next(err);
  }
});

// @route PUT /api/crypto/wallets
// @desc Replace the configured deposit wallet list
// @access Admin
router.put('/wallets', auth, adminOnly, async (req, res, next) => {
  try {
    const { wallets } = req.body;
    if (!Array.isArray(wallets)) {
      return res.status(400).json({ success: false, message: 'wallets must be an array' });
    }
    const cleaned = [];
    for (const entry of wallets) {
      const coin = String(entry.coin || '').trim().toUpperCase();
      const network = String(entry.network || '').trim();
      const address = String(entry.address || '').trim();
      if (!ALLOWED_COINS.includes(coin)) {
        return res.status(400).json({ success: false, message: `Unsupported coin "${coin}". Allowed: ${ALLOWED_COINS.join(', ')}` });
      }
      if (!network) {
        return res.status(400).json({ success: false, message: `Network is required for ${coin}` });
      }
      if (address.length < 8 || address.length > 120) {
        return res.status(400).json({ success: false, message: `Invalid address length for ${coin} (${network})` });
      }
      cleaned.push({ coin, network, address, updatedAt: new Date() });
    }
    const seen = new Set();
    for (const w of cleaned) {
      const key = `${w.coin}:${w.network}`;
      if (seen.has(key)) {
        return res.status(400).json({ success: false, message: `Duplicate entry for ${key}` });
      }
      seen.add(key);
    }
    const settings = await Settings.findOneAndUpdate({}, { $set: { cryptoWallets: cleaned, updatedAt: new Date() } }, { new: true, upsert: true });
    return res.json({ success: true, message: 'Deposit wallets updated', data: { wallets: settings.cryptoWallets } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
