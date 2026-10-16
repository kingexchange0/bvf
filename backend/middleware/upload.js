const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
}

// Create subdirectories
const subdirs = ['kyc', 'deposits', 'profiles', 'artworks', 'seed'];
subdirs.forEach(dir => {
  const dirPath = path.join(uploadsDir, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log('Created subdirectory:', dirPath);
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = uploadsDir;
    
    if (file.fieldname.includes('kyc') || file.fieldname.includes('id') || ['frontImage', 'backImage', 'selfieImage', 'ssnImage'].includes(file.fieldname)) {
      uploadPath = path.join(uploadsDir, 'kyc');
    } else if (file.fieldname.includes('deposit') || file.fieldname.includes('proof')) {
      uploadPath = path.join(uploadsDir, 'deposits');
    } else if (file.fieldname.includes('profile')) {
      uploadPath = path.join(uploadsDir, 'profiles');
    } else if (file.fieldname.includes('art') || file.fieldname.includes('image')) {
      uploadPath = path.join(uploadsDir, 'artworks');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP and PDF are allowed.'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

module.exports = upload;
