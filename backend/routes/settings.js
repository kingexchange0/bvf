const express = require('express');
const router = express.Router();

// Legacy SMTP fields are stored in the DB but never exposed to the frontend —
// email delivery is configured via environment variables only.
function sanitizeSettings(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.smtpHost;
  delete obj.smtpPort;
  delete obj.smtpUser;
  delete obj.smtpPass;
  return obj;
}

const { auth, adminOnly } = require('../middleware/auth');
const Settings = require('../models/Settings');

// ABA routing number checksum: 9 digits, 3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9) â‰¡ 0 (mod 10)
function isValidRoutingNumber(value) {
  if (!/^\d{9}$/.test(value)) return false;
  const d = value.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

// @route   GET /api/settings
// @desc    Get settings (public)
// @access  Public
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = await Settings.create({});
    }
    
    // Return only public settings
    res.json({
      success: true,
      data: {
        supportEmail: settings.supportEmail,
        telegramLink: settings.telegramLink,
        whatsappNumber: settings.whatsappNumber,
        responseTime: settings.responseTime,
        siteName: settings.siteName,
        siteLogo: settings.siteLogo,
        minimumDeposit: settings.minimumDeposit,
        minimumWithdrawal: settings.minimumWithdrawal,
        referralBonusPercent: settings.referralBonusPercent,
        broadcastMessage: settings.broadcastMessage,
        bankName: settings.bankName,
        showBankDetails: isValidRoutingNumber(settings.bankRoutingNumber || '')
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/settings/admin
// @desc    Get all settings (admin)
// @access  Private/Admin
router.get('/admin', auth, adminOnly, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = await Settings.create({});
    }
    
    res.json({
      success: true,
      data: sanitizeSettings(settings)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/settings
// @desc    Update settings
// @access  Private/Admin
router.put('/', auth, adminOnly, async (req, res) => {
  try {
    const {
      btcWalletAddress,
      depositRedirectLink,
      supportEmail,
      telegramLink,
      whatsappNumber,
      responseTime,
      tawkScript,
      broadcastMessage,
      siteName,
      siteLogo,
      referralBonusPercent,
      minimumDeposit,
      minimumWithdrawal,
      bankRoutingNumber,
      bankName
    } = req.body;
    
    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = new Settings();
    }
    
    if (btcWalletAddress !== undefined) settings.btcWalletAddress = btcWalletAddress;
    if (depositRedirectLink !== undefined) settings.depositRedirectLink = depositRedirectLink;
    if (supportEmail !== undefined) settings.supportEmail = supportEmail;
    if (telegramLink !== undefined) settings.telegramLink = telegramLink;
    if (whatsappNumber !== undefined) settings.whatsappNumber = whatsappNumber;
    if (responseTime !== undefined) settings.responseTime = responseTime;
    if (tawkScript !== undefined) settings.tawkScript = tawkScript;
    if (broadcastMessage !== undefined) settings.broadcastMessage = broadcastMessage;
    if (siteName !== undefined) settings.siteName = siteName;
    if (siteLogo !== undefined) settings.siteLogo = siteLogo;
    if (referralBonusPercent !== undefined) settings.referralBonusPercent = referralBonusPercent;
    if (minimumDeposit !== undefined) settings.minimumDeposit = minimumDeposit;
    if (minimumWithdrawal !== undefined) settings.minimumWithdrawal = minimumWithdrawal;
    if (bankRoutingNumber !== undefined) {
      const routing = String(bankRoutingNumber).trim();
      if (routing !== '' && !isValidRoutingNumber(routing)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid bank routing number. It must be exactly 9 digits and pass the ABA checksum.'
        });
      }
      settings.bankRoutingNumber = routing;
    }
    if (bankName !== undefined) settings.bankName = bankName;
    
    settings.updatedAt = new Date();
    await settings.save();
    
    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: sanitizeSettings(settings)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/settings/btc-wallet
// @desc    Get BTC wallet address
// @access  Private
router.get('/btc-wallet', auth, async (req, res) => {
  try {
    const settings = await Settings.findOne();
    
    res.json({
      success: true,
      data: {
        btcWalletAddress: settings?.btcWalletAddress || '',
        depositRedirectLink: settings?.depositRedirectLink || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/settings/btc-wallet
// @desc    Update BTC wallet address
// @access  Private/Admin
router.put('/btc-wallet', auth, adminOnly, async (req, res) => {
  try {
    const { btcWalletAddress } = req.body;
    
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }
    
    settings.btcWalletAddress = btcWalletAddress;
    settings.updatedAt = new Date();
    await settings.save();
    
    res.json({
      success: true,
      message: 'BTC wallet address updated successfully',
      data: { btcWalletAddress: settings.btcWalletAddress }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
