const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { auth, adminOnly } = require('../middleware/auth');
const KYC = require('../models/KYC');
const Deposit = require('../models/Deposit');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function sendUpload(res, subdir, filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(UPLOADS_DIR, subdir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  res.sendFile(filePath);
}

// @route   GET /api/files/kyc/:filename
// @desc    Serve a KYC image (owner of the KYC doc or admin)
// @access  Private
router.get('/kyc/:filename', auth, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (req.user.role !== 'admin') {
      const kyc = await KYC.findOne({
        userId: req.user._id,
        $or: [
          { frontImage: { $regex: `${filename}$` } },
          { backImage: { $regex: `${filename}$` } },
          { selfieImage: { $regex: `${filename}$` } },
          { ssnImage: { $regex: `${filename}$` } }
        ]
      });
      if (!kyc) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }
    sendUpload(res, 'kyc', filename);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/files/deposits/:filename
// @desc    Serve a deposit proof (owner of the deposit or admin)
// @access  Private
router.get('/deposits/:filename', auth, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (req.user.role !== 'admin') {
      const deposit = await Deposit.findOne({
        userId: req.user._id,
        btcProof: { $regex: `${filename}$` }
      });
      if (!deposit) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }
    sendUpload(res, 'deposits', filename);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/files/profiles/:filename
// @desc    Serve a profile picture (any authenticated user)
// @access  Private
router.get('/profiles/:filename', auth, (req, res) => {
  sendUpload(res, 'profiles', path.basename(req.params.filename));
});

module.exports = router;
