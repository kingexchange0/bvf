const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');

// @route   GET /api/referrals
// @desc    Get user referrals
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get referred users
    const referredUsers = await User.find({ referredBy: userId })
      .select('name email createdAt')
      .sort({ createdAt: -1 });
    
    // Get referral bonus transactions
    const referralBonuses = await Transaction.find({
      userId,
      type: 'referral_bonus'
    }).sort({ createdAt: -1 });
    
    // Calculate total earnings
    const totalEarnings = referralBonuses.reduce((sum, t) => sum + t.amount, 0);
    
    // Fixed $50 referral bonus per signup
    const REFERRAL_BONUS = 50;
    
    res.json({
      success: true,
      data: {
        referralCode: req.user.referralCode,
        totalReferrals: referredUsers.length,
        totalEarnings,
        bonusAmount: REFERRAL_BONUS,
        referredUsers,
        referralBonuses
      }
    });
  } catch (error) {
    console.error('Referrals error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/referrals/stats
// @desc    Get referral statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get monthly referral data
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const referrals = await User.find({
      referredBy: userId,
      createdAt: { $gte: sixMonthsAgo }
    });
    
    const bonuses = await Transaction.find({
      userId,
      type: 'referral_bonus',
      createdAt: { $gte: sixMonthsAgo }
    });
    
    // Group by month
    const monthlyData = {};
    
    referrals.forEach(r => {
      const month = r.createdAt.toISOString().slice(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { count: 0, earnings: 0 };
      }
      monthlyData[month].count++;
    });
    
    bonuses.forEach(b => {
      const month = b.createdAt.toISOString().slice(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { count: 0, earnings: 0 };
      }
      monthlyData[month].earnings += b.amount;
    });
    
    res.json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
