const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Investment = require('../models/Investment');
const Loan = require('../models/Loan');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const Notification = require('../models/Notification');
const Message = require('../models/Message');

// @route   GET /api/user/dashboard
// @desc    Get user dashboard data
// @access  Private
router.get('/dashboard', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get total deposits
    const deposits = await Deposit.find({ userId, status: 'approved' });
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    
    // Get total withdrawals
    const withdrawals = await Withdrawal.find({ userId, status: 'approved' });
    const totalWithdrawals = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    
    // Get active investments
    const activeInvestments = await Investment.find({ userId, status: 'active' });
    const totalInvested = activeInvestments.reduce((sum, i) => sum + i.amount, 0);
    
    // Get active loans
    const activeLoans = await Loan.find({ userId, status: { $in: ['approved', 'active'] } });
    const totalLoans = activeLoans.reduce((sum, l) => sum + l.amount, 0);
    
    // Get recent transactions
    const recentTransactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get unread notifications count
    const unreadNotifications = await Notification.countDocuments({ userId, isRead: false });
    
    // Get unread messages count (from admin)
    const unreadMessages = await Message.countDocuments({
      userId,
      sender: 'admin',
      isRead: false
    });
    
    // Get active investments with plan details
    const investments = await Investment.find({ userId, status: 'active' })
      .sort({ createdAt: -1 })
      .limit(3);
    
    res.json({
      success: true,
      data: {
        balance: req.user.balanceUSD,
        accountNumber: req.user.accountNumber,
        savingsBalance: req.user.savingsBalance || 0,
        totalBalance: (req.user.balanceUSD || 0) + (req.user.savingsBalance || 0),
        totalDeposits,
        totalWithdrawals,
        totalInvested,
        totalLoans,
        unreadNotifications,
        unreadMessages,
        recentTransactions,
        activeInvestments: investments,
        kycStatus: req.user.kycStatus
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/user/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/user/update-profile
// @desc    Update user profile
// @access  Private
router.put('/update-profile', auth, async (req, res) => {
  try {
    const { name, phone, country, btcWalletAddress, bankDetails } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (country) updateData.country = country;
    if (btcWalletAddress) updateData.btcWalletAddress = btcWalletAddress;
    if (bankDetails) updateData.bankDetails = bankDetails;
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    ).select('-password');
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/user/profile-picture
// @desc    Upload or replace the user's profile picture
// @access  Private
router.post('/profile-picture', auth, upload.single('profile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided (field name must be "profile")' });
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(415).json({ success: false, message: 'Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP' });
    }

    const maxBytes = 5 * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(413).json({ success: false, message: 'Image exceeds the 5MB size limit' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePicture: `/uploads/profiles/${req.file.filename}` },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile picture updated',
      data: { profilePicture: user.profilePicture, user }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/user/profile-picture
// @desc    Remove the user's profile picture (falls back to initials avatar)
// @access  Private
router.delete('/profile-picture', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePicture: '' },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile picture removed',
      data: { profilePicture: user.profilePicture, user }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/user/stats
// @desc    Get user statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get monthly transaction data
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const transactions = await Transaction.find({
      userId,
      createdAt: { $gte: sixMonthsAgo }
    });
    
    // Group by month
    const monthlyData = {};
    transactions.forEach(t => {
      const month = t.createdAt.toISOString().slice(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { deposits: 0, withdrawals: 0, investments: 0 };
      }
      if (t.type === 'deposit') monthlyData[month].deposits += t.amount;
      else if (t.type === 'withdraw') monthlyData[month].withdrawals += t.amount;
      else if (t.type === 'invest') monthlyData[month].investments += t.amount;
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
