const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const KYC = require('../models/KYC');
const User = require('../models/User');
const Notification = require('../models/Notification');
const upload = require('../middleware/upload');

// @route   POST /api/kyc
// @desc    Submit KYC (level 1: identity, level 2: SSN)
// @access  Private
router.post('/', auth, upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 },
  { name: 'selfieImage', maxCount: 1 },
  { name: 'ssnImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const level = parseInt(req.body.level, 10) || 1;

    if (![1, 2].includes(level)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC level' });
    }

    const files = req.files || {};
    const kycData = { userId: req.user._id, level, status: 'pending', submittedAt: new Date(), reviewedAt: undefined, adminNote: '' };

    if (level === 1) {
      const { fullName, address, idType, idNumber } = req.body;
      if (!fullName || !address || !idType || !idNumber) {
        return res.status(400).json({ success: false, message: 'Full name, address, ID type and ID number are required' });
      }
      // Documents without a reverse side only need the front image
      const needsBack = !['passport', 'voters_card'].includes(idType);
      if (!files.frontImage || (needsBack && !files.backImage)) {
        return res.status(400).json({ success: false, message: needsBack ? 'Front and back images of your ID are required' : 'An image of your ID is required' });
      }
      kycData.fullName = fullName;
      kycData.address = address;
      kycData.idType = idType;
      kycData.idNumber = idNumber;
      kycData.frontImage = `/uploads/kyc/${files.frontImage[0].filename}`;
      if (files.backImage) kycData.backImage = `/uploads/kyc/${files.backImage[0].filename}`;
      if (files.selfieImage) kycData.selfieImage = `/uploads/kyc/${files.selfieImage[0].filename}`;
    } else if (level === 2) {
      const { ssnNumber } = req.body;
      if (!ssnNumber) {
        return res.status(400).json({ success: false, message: 'SSN number is required' });
      }
      if (!files.ssnImage) {
        return res.status(400).json({ success: false, message: 'SSN picture is required' });
      }
      kycData.ssnNumber = ssnNumber;
      kycData.ssnImage = `/uploads/kyc/${files.ssnImage[0].filename}`;
    }

    // One record per (user, level); resubmitting the same level replaces it
    const kyc = await KYC.findOneAndUpdate(
      { userId: req.user._id, level },
      kycData,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Update user KYC status (a pending higher level keeps account in review)
    await User.findByIdAndUpdate(req.user._id, { kycStatus: 'pending' });

    res.status(201).json({
      success: true,
      message: `KYC level ${level} submitted successfully`,
      data: kyc
    });
  } catch (error) {
    console.error('KYC submit error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/kyc
// @desc    Get user KYC status (?all=1 returns every level)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    if (req.query.all === '1') {
      const kycs = await KYC.find({ userId: req.user._id }).sort({ level: 1 });
      return res.json({
        success: true,
        data: kycs
      });
    }

    const kyc = await KYC.findOne({ userId: req.user._id }).sort({ level: -1 });

    res.json({
      success: true,
      data: kyc || { status: 'not_submitted' }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/kyc
// @desc    Get all KYC submissions (admin)
// @access  Private/Admin
router.get('/admin/all', auth, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status) query.status = status;
    
    const kycs = await KYC.find(query)
      .populate('userId', 'name email phone country')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await KYC.countDocuments(query);
    
    // Get stats
    const pendingCount = await KYC.countDocuments({ status: 'pending' });
    const approvedCount = await KYC.countDocuments({ status: 'approved' });
    const rejectedCount = await KYC.countDocuments({ status: 'rejected' });
    
    res.json({
      success: true,
      data: kycs,
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      },
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/kyc/:id/approve
// @desc    Approve KYC
// @access  Private/Admin
router.put('/admin/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const kyc = await KYC.findById(id);
    if (!kyc) {
      return res.status(404).json({ success: false, message: 'KYC not found' });
    }
    
    kyc.status = 'approved';
    kyc.reviewedAt = new Date();
    if (adminNote) kyc.adminNote = adminNote;
    await kyc.save();
    
    // Update user KYC status
    await User.findByIdAndUpdate(kyc.userId, { kycStatus: 'verified' });
    
    // Create notification
    await Notification.create({
      userId: kyc.userId,
      title: 'KYC Approved',
      message: 'Your KYC verification has been approved',
      type: 'success'
    });
    
    res.json({
      success: true,
      message: 'KYC approved successfully',
      data: kyc
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/kyc/:id/reject
// @desc    Reject KYC
// @access  Private/Admin
router.put('/admin/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;
    
    const kyc = await KYC.findById(id);
    if (!kyc) {
      return res.status(404).json({ success: false, message: 'KYC not found' });
    }
    
    kyc.status = 'rejected';
    kyc.reviewedAt = new Date();
    if (adminNote) kyc.adminNote = adminNote;
    await kyc.save();
    
    // Update user KYC status
    await User.findByIdAndUpdate(kyc.userId, { kycStatus: 'rejected' });
    
    // Create notification
    await Notification.create({
      userId: kyc.userId,
      title: 'KYC Rejected',
      message: `Your KYC verification has been rejected. Reason: ${adminNote || 'Please contact support'}`,
      type: 'error'
    });
    
    res.json({
      success: true,
      message: 'KYC rejected successfully',
      data: kyc
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
