const express = require('express');
const router = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');

// @route   POST /api/messages
// @desc    Send a message
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { userId, message } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    
    let targetUserId = userId;
    let sender = 'user';
    
    // If admin is sending, use provided userId
    if (req.user.role === 'admin') {
      if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }
      sender = 'admin';
    } else {
      // Regular users send to admin (represented by their own ID for the conversation)
      targetUserId = req.user._id;
      sender = 'user';
    }
    
    const newMessage = await Message.create({
      userId: targetUserId,
      sender,
      senderId: req.user._id,
      message: message.trim()
    });
    
    const populatedMessage = await Message.findById(newMessage._id)
      .populate('senderId', 'name role');
    
    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: populatedMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/messages/:userId
// @desc    Get messages for a user
// @access  Private
router.get('/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    // Check authorization
    if (req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    const messages = await Message.find({ userId })
      .populate('senderId', 'name role')
      .sort({ createdAt: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    // Mark messages as read for the requesting user
    if (req.user.role === 'user') {
      await Message.updateMany(
        { userId, sender: 'admin', isRead: false },
        { isRead: true }
      );
    }
    
    const count = await Message.countDocuments({ userId });
    
    res.json({
      success: true,
      data: messages,
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

// @route   GET /api/messages/conversations/all
// @desc    Get all conversations (admin only)
// @access  Private/Admin
router.get('/conversations/all', auth, adminOnly, async (req, res) => {
  try {
    // Get all users who have sent messages
    const conversations = await Message.aggregate([
      {
        $group: {
          _id: '$userId',
          lastMessage: { $last: '$message' },
          lastMessageAt: { $last: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$sender', 'user'] }, { $eq: ['$isRead', false] }] }, 1, 0]
            }
          }
        }
      },
      { $sort: { lastMessageAt: -1 } }
    ]);
    
    // Populate user details
    const userIds = conversations.map(c => c._id);
    const users = await User.find({ _id: { $in: userIds } }).select('name email');
    
    const conversationsWithUsers = conversations.map(conv => ({
      ...conv,
      user: users.find(u => u._id.toString() === conv._id.toString())
    }));
    
    res.json({
      success: true,
      data: conversationsWithUsers
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/messages/:userId/read
// @desc    Mark all messages from a user as read (admin only)
// @access  Private/Admin
router.put('/:userId/read', auth, adminOnly, async (req, res) => {
  try {
    await Message.updateMany(
      { userId: req.params.userId, sender: 'user', isRead: false },
      { isRead: true }
    );
    res.json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/messages/unread/count
// @desc    Get unread message count
// @access  Private
router.get('/unread/count', auth, async (req, res) => {
  try {
    let count = 0;
    
    if (req.user.role === 'admin') {
      // Count all unread messages from users
      count = await Message.countDocuments({ sender: 'user', isRead: false });
    } else {
      // Count unread messages from admin for this user
      count = await Message.countDocuments({
        userId: req.user._id,
        sender: 'admin',
        isRead: false
      });
    }
    
    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
