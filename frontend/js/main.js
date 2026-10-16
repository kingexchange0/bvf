/* ==========================================================================
   BrightVale Finance — main.js
   Shared runtime for every page: API client, auth, theme, app shell,
   notifications, toasts, modals, pagination, message notifier.

   Pages opt into the app shell via window.PAGE_CONFIG = { role, active, title }.
   Pages WITHOUT PAGE_CONFIG (landing, login) get global helpers only.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Theme — applied BEFORE first paint (this script loads synchronously in head)
// ---------------------------------------------------------------------------
(function injectFavicon() {
  if (document.querySelector('link[rel*="icon"]')) return;
  var inSubdir = /\/(user|admin)\/?$|\/(user|admin)\//.test(window.location.pathname);
  var link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = (inSubdir ? '../' : '') + 'assets/img/favicon.png';
  document.head.appendChild(link);
})();

(function applyStoredTheme() {
  var stored = null;
  try {
    // New key first; fall back to the legacy CrestCoin key once for migration.
    stored = localStorage.getItem('brightvale-theme');
    if (stored === null) {
      stored = localStorage.getItem('crestcoin-theme');
      if (stored !== null) {
        localStorage.setItem('brightvale-theme', stored);
        localStorage.removeItem('crestcoin-theme');
      }
    }
  } catch (e) { /* storage unavailable */ }
  // Nothing stored (or invalid) defaults to LIGHT; a stored preference always wins.
  document.documentElement.dataset.theme = (stored === 'dark') ? 'dark' : 'light';
})();

// Warm up connections to third-party origins used across pages (speeds up
// font/icon/price-data fetches on first paint).
(function preconnectOrigins() {
  var plain = ['https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'];
  var cors = ['https://fonts.gstatic.com', 'https://api.coingecko.com'];
  plain.concat(cors).forEach(function (h) {
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = h;
    if (cors.indexOf(h) !== -1) link.crossOrigin = '';
    document.head.appendChild(link);
  });
})();

const API_BASE_URL = 'https://bvf.onrender.com/api';
const SERVER_BASE_URL = 'https://bvf.onrender.com';

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------
const utils = {
  // Format currency
  formatCurrency: (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  },

  // Format date
  formatDate: (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },

  // Format datetime
  formatDateTime: (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  // Format relative time
  timeAgo: (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + ' years ago';
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + ' months ago';
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + ' days ago';
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + ' hours ago';
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + ' minutes ago';
    return 'Just now';
  },

  // Get initials from name
  getInitials: (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  },

  // Generate random color
  getRandomColor: () => {
    const colors = ['#4C1D95', '#6D28D9', '#F5B301', '#3F6212', '#EC4899', '#84CC16', '#0D9488'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  // Debounce function
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Copy to clipboard with fallback
  copyToClipboard: async (text) => {
    if (!text) return false;

    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.log('Clipboard API failed, trying fallback');
      }
    }

    // Fallback for older browsers or non-secure contexts
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    }
  },

  // Escape HTML for safe interpolation into templates
  escapeHtml: (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------
const api = {
  // Get auth token
  getToken: () => localStorage.getItem('token'),

  // Get auth headers
  getHeaders: (isFormData = false) => {
    const headers = {};
    const token = api.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  },

  // GET request
  get: async (endpoint) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: api.getHeaders()
    });
    return response.json();
  },

  // POST request
  post: async (endpoint, data, isFormData = false) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: api.getHeaders(isFormData),
      body: isFormData ? data : JSON.stringify(data)
    });
    return response.json();
  },

  // PUT request
  put: async (endpoint, data, isFormData = false) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: api.getHeaders(isFormData),
      body: isFormData ? data : JSON.stringify(data)
    });
    return response.json();
  },

  // DELETE request
  delete: async (endpoint) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: api.getHeaders()
    });
    return response.json();
  }
};

// ---------------------------------------------------------------------------
// Toast Notification System
// ---------------------------------------------------------------------------
const toast = {
  container: null,

  init: () => {
    if (!toast.container) {
      toast.container = document.createElement('div');
      toast.container.className = 'toast-container';
      document.body.appendChild(toast.container);
    }
  },

  show: (message, type = 'info', duration = 3000) => {
    toast.init();

    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    toastEl.innerHTML = `
      <span>${icons[type] || icons.info}</span>
      <span>${message}</span>
    `;

    toast.container.appendChild(toastEl);

    setTimeout(() => {
      toastEl.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toastEl.remove(), 300);
    }, duration);
  },

  success: (message) => toast.show(message, 'success'),
  error: (message) => toast.show(message, 'error'),
  warning: (message) => toast.show(message, 'warning'),
  info: (message) => toast.show(message, 'info')
};

// ---------------------------------------------------------------------------
// Modal System — toggles .active on #id modal-overlay
// ---------------------------------------------------------------------------
const modal = {
  open: (modalId) => {
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
      modalEl.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  close: (modalId) => {
    const modalEl = document.getElementById(modalId);
    if (modalEl) {
      modalEl.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  closeAll: () => {
    document.querySelectorAll('.modal-overlay.active').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  }
};

// ---------------------------------------------------------------------------
// KYC-gated feature modal
// Backend returns 403 { success:false, message:'Complete identity
// verification (KYC) to access this feature.' } for transfers, withdrawals,
// investments, loans, and card applications when KYC is not verified.
// ---------------------------------------------------------------------------
const kycGate = {
  KYC_MESSAGE: 'Complete identity verification (KYC) to access this feature.',

  isKycError: (res) => {
    return !!res && res.success === false && typeof res.message === 'string' &&
      res.message.indexOf('identity verification') !== -1;
  },

  show: (message) => {
    let overlay = document.getElementById('kycGateModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'kycGateModal';
      overlay.innerHTML = `
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <div class="modal-title"><i class="fas fa-id-card" style="color:var(--primary);margin-right:8px;"></i> Identity Verification Required</div>
            <button class="modal-close" onclick="kycGate.hide()"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p style="margin:0;line-height:1.6;color:var(--text-2);font-size:14px;" id="kycGateMessage"></p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="kycGate.hide()">Later</button>
            <a class="btn btn-primary" href="kyc.html"><i class="fas fa-arrow-right"></i> Verify now</a>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) kycGate.hide(); });
    }
    const msgEl = overlay.querySelector('#kycGateMessage');
    if (msgEl) msgEl.textContent = message || kycGate.KYC_MESSAGE;
    modal.open('kycGateModal');
  },

  hide: () => modal.close('kycGateModal')
};

// ---------------------------------------------------------------------------
// Auth Functions
// ---------------------------------------------------------------------------
const auth = {
  // Check if user is logged in
  isLoggedIn: () => {
    return !!localStorage.getItem('token');
  },

  // Get current user
  getUser: () => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Check if user is admin
  isAdmin: () => {
    const user = auth.getUser();
    return user && user.role === 'admin';
  },

  // Login
  login: (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  // Logout
  logout: function() {
    try {
      // Clear all storage
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.clear();
    } catch (error) {
      console.error('Logout error:', error);
    }
    // Resolve login.html relative to the current page (root or a subfolder).
    var path = window.location.pathname;
    var inSubfolder = /\/(user|admin)\//.test(path);
    window.location.href = inSubfolder ? '../login.html' : 'login.html';
    return false;
  },

  // Redirect if not logged in
  requireAuth: () => {
    if (!auth.isLoggedIn()) {
      auth._redirectToLogin();
      return false;
    }
    return true;
  },

  // Redirect if not admin
  requireAdmin: () => {
    if (!auth.isLoggedIn() || !auth.isAdmin()) {
      auth._redirectToLogin();
      return false;
    }
    return true;
  },

  // Repo-relative redirect to login.html
  _redirectToLogin: () => {
    var path = window.location.pathname;
    var inSubfolder = /\/(user|admin)\//.test(path);
    window.location.href = inSubfolder ? '../login.html' : 'login.html';
  },

  // Update stored user
  updateUser: (updates) => {
    const user = auth.getUser();
    if (user) {
      const updatedUser = { ...user, ...updates };
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }
  }
};

// ---------------------------------------------------------------------------
// Theme System
// ---------------------------------------------------------------------------
const theme = {
  get: () => {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  },

  set: (t) => {
    const value = (t === 'light') ? 'light' : 'dark';
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem('brightvale-theme', value);
    } catch (e) { /* storage unavailable */ }
  },

  toggle: () => {
    theme.set(theme.get() === 'dark' ? 'light' : 'dark');
    return theme.get();
  }
};

// ---------------------------------------------------------------------------
// Navigation Definitions (injected sidebar)
// ---------------------------------------------------------------------------
const NAV = {
  user: [
    // FINANCE
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html', section: 'FINANCE' },
    { id: 'deposit', label: 'Deposit', icon: 'fa-download', href: 'deposit.html', section: 'FINANCE' },
    { id: 'withdraw', label: 'Withdraw', icon: 'fa-upload', href: 'withdraw.html', section: 'FINANCE' },
    { id: 'transfers', label: 'Transfers', icon: 'fa-money-bill-transfer', href: 'transfers.html', section: 'FINANCE' },
    { id: 'invest', label: 'Invest', icon: 'fa-chart-line', href: 'invest.html', section: 'FINANCE' },
    { id: 'loans', label: 'Loans', icon: 'fa-hand-holding-dollar', href: 'loans.html', section: 'FINANCE' },
    { id: 'cards', label: 'Cards', icon: 'fa-credit-card', href: 'cards.html', section: 'FINANCE' },
    // ACTIVITY
    { id: 'crypto', label: 'Crypto', icon: 'fa-bitcoin-sign', href: 'crypto.html', section: 'ACTIVITY' },
    { id: 'transactions', label: 'Transactions', icon: 'fa-arrow-right-arrow-left', href: 'transactions.html', section: 'ACTIVITY' },
    { id: 'referrals', label: 'Referrals', icon: 'fa-user-plus', href: 'referrals.html', section: 'ACTIVITY' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-bell', href: 'notifications.html', section: 'ACTIVITY' },
    // ACCOUNT
    { id: 'kyc', label: 'KYC Verification', icon: 'fa-id-card', href: 'kyc.html', section: 'ACCOUNT' },
    { id: 'support', label: 'Support', icon: 'fa-headset', href: 'support.html', section: 'ACCOUNT' },
    { id: 'settings', label: 'Settings', icon: 'fa-gear', href: 'user-settings.html', section: 'ACCOUNT' }
  ],

  admin: [
    // OVERVIEW
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', href: 'dashboard.html', section: 'OVERVIEW' },
    { id: 'users', label: 'Users', icon: 'fa-users', href: 'users.html', section: 'OVERVIEW' },
    { id: 'deposits', label: 'Deposits', icon: 'fa-download', href: 'deposits.html', section: 'OVERVIEW' },
    { id: 'withdrawals', label: 'Withdrawals', icon: 'fa-upload', href: 'withdrawals.html', section: 'OVERVIEW' },
    { id: 'transfers', label: 'Transfers', icon: 'fa-money-bill-transfer', href: 'transfers.html', section: 'OVERVIEW' },
    // MANAGE
    { id: 'investments', label: 'Investments', icon: 'fa-chart-line', href: 'investments.html', section: 'MANAGE' },
    { id: 'investment-plans', label: 'Investment Plans', icon: 'fa-diagram-project', href: 'investment-plans.html', section: 'MANAGE' },
    { id: 'loans', label: 'Loans', icon: 'fa-hand-holding-dollar', href: 'loans.html', section: 'MANAGE' },
    { id: 'loan-plans', label: 'Loan Plans', icon: 'fa-list', href: 'loan-plans.html', section: 'MANAGE' },
    { id: 'cards', label: 'Cards', icon: 'fa-credit-card', href: 'cards.html', section: 'MANAGE' },
    { id: 'kyc', label: 'KYC', icon: 'fa-id-card', href: 'kyc.html', section: 'MANAGE' },
    { id: 'messages', label: 'Messages', icon: 'fa-comments', href: 'messages.html', section: 'MANAGE' },
    { id: 'transactions', label: 'Transactions', icon: 'fa-arrow-right-arrow-left', href: 'transactions.html', section: 'MANAGE' },
    { id: 'logs', label: 'Logs', icon: 'fa-clipboard-list', href: 'logs.html', section: 'MANAGE' },
    // CONFIGURATION
    { id: 'settings', label: 'Settings', icon: 'fa-gear', href: 'settings.html', section: 'CONFIGURATION' },
    { id: 'crypto-wallets', label: 'Crypto Wallets', icon: 'fa-wallet', href: 'crypto-wallets.html', section: 'CONFIGURATION' }
  ]
};

// ---------------------------------------------------------------------------
// Sidebar Toggle (for the injected app shell)
//   Mobile (<= 992px): off-canvas — .active slides in + overlay
//   Desktop (> 992px): .collapsed (icons-only, persisted)
// ---------------------------------------------------------------------------
const sidebar = {
  MOBILE_BREAKPOINT: 992,

  isMobile: () => window.innerWidth <= sidebar.MOBILE_BREAKPOINT,

  toggle: () => {
    if (sidebar.isMobile()) {
      const sidebarEl = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      if (!sidebarEl) return;
      const willOpen = !sidebarEl.classList.contains('active');
      if (willOpen) {
        sidebar.open();
      } else {
        sidebar.close();
      }
      return;
    }
    // Desktop: collapse / expand
    const collapsed = document.getElementById('sidebar') &&
      document.getElementById('sidebar').classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch (e) { /* storage unavailable */ }
  },

  close: () => {
    const sidebarEl = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebarEl) {
      sidebarEl.classList.remove('active');
    }
    if (overlay) {
      overlay.classList.remove('active');
    }
    document.body.style.overflow = '';
  },

  open: () => {
    const sidebarEl = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebarEl) return;
    sidebarEl.classList.add('active');
    if (sidebar.isMobile() && overlay) {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  // Restore persisted desktop collapse state
  applyCollapsedState: () => {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('sidebarCollapsed') === '1';
    } catch (e) { /* storage unavailable */ }
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
      sidebarEl.classList.toggle('collapsed', collapsed);
    }
    document.body.classList.toggle('sidebar-collapsed', collapsed);
  }
};

// ---------------------------------------------------------------------------
// Loading State
// ---------------------------------------------------------------------------
const loading = {
  show: (containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="loading" style="display:block;">
          <div class="skeleton" style="height:16px;width:32%;margin-bottom:14px;"></div>
          <div class="card" style="padding:18px;margin-bottom:12px;">
            <div class="skeleton" style="height:13px;width:55%;margin-bottom:10px;"></div>
            <div class="skeleton" style="height:12px;width:85%;"></div>
          </div>
          <div class="card" style="padding:18px;margin-bottom:12px;">
            <div class="skeleton" style="height:13px;width:70%;margin-bottom:10px;"></div>
            <div class="skeleton" style="height:12px;width:45%;"></div>
          </div>
          <div class="card" style="padding:18px;">
            <div class="skeleton" style="height:13px;width:40%;margin-bottom:10px;"></div>
            <div class="skeleton" style="height:12px;width:65%;"></div>
          </div>
        </div>
      `;
    }
  },

  hide: (containerId) => {
    const container = document.getElementById(containerId);
    if (container) {
      const loadingEl = container.querySelector('.loading');
      if (loadingEl) {
        loadingEl.remove();
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Table Pagination
// ---------------------------------------------------------------------------
const pagination = {
  render: (containerId, currentPage, totalPages, onPageChange) => {
    const container = document.getElementById(containerId);
    if (!container || totalPages <= 1) return;

    let html = `
      <div class="pagination">
        <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage - 1})">
          Previous
        </button>
    `;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        html += `
          <button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="${onPageChange}(${i})">
            ${i}
          </button>
        `;
      } else if (i === currentPage - 2 || i === currentPage + 2) {
        html += `<span>...</span>`;
      }
    }

    html += `
        <button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="${onPageChange}(${currentPage + 1})">
          Next
        </button>
      </div>
    `;

    container.innerHTML = html;
  }
};

// ---------------------------------------------------------------------------
// Notification badge updater + poller (GET /api/notifications?unreadOnly=true)
// ---------------------------------------------------------------------------
const updateNotificationBadge = (count) => {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
};

const notificationPoller = {
  intervalMs: 30000,
  timer: null,
  lastCount: -1,
  popupTimer: null,

  start: (intervalMs) => {
    if (!auth.isLoggedIn()) return;
    if (intervalMs) notificationPoller.intervalMs = intervalMs;
    notificationPoller.check();
    notificationPoller.timer = setInterval(notificationPoller.check, notificationPoller.intervalMs);
  },

  stop: () => {
    if (notificationPoller.timer) {
      clearInterval(notificationPoller.timer);
      notificationPoller.timer = null;
    }
  },

  check: async () => {
    if (!auth.isLoggedIn()) return;
    // Only users have the notification bell
    if (!document.getElementById('notificationBadge')) return;
    try {
      const response = await api.get('/notifications?unreadOnly=true&limit=1');
      if (response && response.success) {
        const count = typeof response.unreadCount === 'number' ? response.unreadCount : 0;
        updateNotificationBadge(count);

        if (notificationPoller.lastCount === -1) {
          // First check after page load — never pop for pre-existing items
          notificationPoller.lastCount = count;
        } else if (count > notificationPoller.lastCount) {
          const latest = (Array.isArray(response.data) && response.data.length) ? response.data[0] : null;
          notificationPoller.showPopup(count - notificationPoller.lastCount, latest);
        }
        notificationPoller.lastCount = count;
      }
    } catch (error) {
      // Silently ignore network errors; badge stays as-is.
    }
  },

  showPopup: (newCount, latest) => {
    let popup = document.getElementById('notifPopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'notifPopup';
      popup.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: var(--surface, white);
        border: 1px solid var(--border, transparent);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        padding: 1rem 1.5rem;
        z-index: 9999;
        max-width: 320px;
        animation: slideInRight 0.3s ease;
        border-left: 4px solid #D97706;
      `;
      document.body.appendChild(popup);
    }

    const title = (latest && latest.title) ? latest.title : 'New Notification';
    const body = (latest && latest.message)
      ? latest.message
      : `You have ${newCount} new notification${newCount > 1 ? 's' : ''}`;

    popup.innerHTML = `
      <div style="display: flex; align-items: start; gap: 1rem;">
        <div style="width: 40px; height: 40px; background: #FFFBEB; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <i class="fas fa-bell" style="color: #D97706;"></i>
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; margin-bottom: 0.25rem;">${utils.escapeHtml(title)}</div>
          <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.75rem; word-break: break-word;">${utils.escapeHtml(body)}</div>
          <button onclick="window.location.href='notifications.html'; notificationPoller.hidePopup();" style="background: #4C1D95; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer;">
            View Notifications
          </button>
        </div>
        <button onclick="notificationPoller.hidePopup()" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 0;">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    popup.style.display = 'block';

    if (notificationPoller.popupTimer) clearTimeout(notificationPoller.popupTimer);
    notificationPoller.popupTimer = setTimeout(() => {
      notificationPoller.hidePopup();
    }, 10000);

    try { messageNotifier.playSound(); } catch (e) {}
  },

  hidePopup: () => {
    const popup = document.getElementById('notifPopup');
    if (popup) {
      popup.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        popup.style.display = 'none';
      }, 300);
    }
  }
};

// ---------------------------------------------------------------------------
// App shell rendering (sidebar + topbar), injected before <main class="main-content">
// ---------------------------------------------------------------------------

// Avatar markup: <img> when a profile picture exists (falls back to initials
// via onerror), otherwise a div.avatar with the user's initials.
const avatarHtml = (user, sizeClass) => {
  const cls = sizeClass ? `avatar ${sizeClass}` : 'avatar';
  const name = user ? (user.name || 'User') : 'User';
  const initials = utils.getInitials(name);
  const pic = user && (user.profilePicture || user.avatar);
  if (pic) {
    const src = pic.startsWith('http') ? pic : `${SERVER_BASE_URL}${pic.startsWith('/') ? '' : '/'}${pic}`;
    return `<img class="${cls}" src="${src}" alt="${utils.escapeHtml(name)}" onerror="this.outerHTML = window.__avatarFallback('${initials}')">`;
  }
  return `<div class="${cls}">${initials}</div>`;
};

// Swap target used by avatarHtml's onerror (kept tiny and global for inline use)
window.__avatarFallback = (initials) => `<div class="avatar">${initials}</div>`;

// Role label shown in the profile dropdown
const roleLabel = (user) => {
  if (user && user.role === 'admin') return 'Administrator';
  return 'Member';
};

// Build the sidebar <nav> markup from NAV definitions
const buildSidebarNav = (role, activeId, user) => {
  const items = NAV[role] || [];

  let html = '<nav class="sidebar-nav">';
  let lastSection = null;

  items.forEach(item => {
    if (item.section !== lastSection) {
      html += `<div class="nav-section-title">${item.section}</div>`;
      lastSection = item.section;
    }
    const active = item.id === activeId ? ' active' : '';
    let badge = '';
    if (role === 'user' && item.id === 'support') {
      badge = '<span class="nav-badge" id="messageBadge">0</span>';
    }
    html += `
      <a href="${item.href}" class="nav-item${active}" title="${utils.escapeHtml(item.label)}">
        <i class="fas ${item.icon}"></i>
        <span class="nav-label">${utils.escapeHtml(item.label)}</span>
        ${badge}
      </a>
    `;
  });

  html += '</nav>';
  return html;
};

// Render the full shell (idempotent — safe to call again after user refresh)
const renderLayout = (user) => {
  const config = window.PAGE_CONFIG || {};
  const role = config.role;
  if (!role) return;

  const title = config.title || 'BrightVale Finance';
  const activeId = config.active || '';
  const name = user ? (user.name || 'User') : 'User';
  const email = user ? (user.email || '') : '';

  const shellHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <span class="brand-logo-wrap">
          <img class="brand-logo brand-logo-light-img" src="../assets/img/brightvale-logo.png" alt="BrightVale Finance">
          <img class="brand-logo brand-logo-dark" src="../assets/img/brightvale-logo-light.png" alt="" aria-hidden="true">
        </span>
      </div>
      ${buildSidebarNav(role, activeId, user)}
      <div class="sidebar-footer">
        <button class="icon-btn" id="sidebarCollapse" title="Collapse sidebar">
          <i class="fas fa-angles-left"></i>
        </button>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <header class="topbar">
      <button class="icon-btn menu-toggle" id="menuToggle" title="Menu"><i class="fas fa-bars"></i></button>
      <div class="topbar-title">${utils.escapeHtml(title)}</div>
      <div class="topbar-actions">
        <button class="icon-btn" id="themeToggle" title="Toggle theme" aria-label="Toggle light/dark theme">
          <i class="fas fa-moon"></i>
        </button>
        <a class="icon-btn" href="${role === 'admin' ? 'messages.html' : 'support.html'}" id="messageTopBtn" title="Messages">
          <i class="fas fa-envelope"></i>
          <span id="messageTopBadge" style="display:none;position:absolute;top:6px;right:6px;background:#DC2626;color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:8px;align-items:center;justify-content:center;padding:0 4px;line-height:16px;">0</span>
        </a>
        ${role === 'admin' ? '' : `
        <a class="icon-btn" href="notifications.html" id="notificationBtn" title="Notifications">
          <i class="fas fa-bell"></i>
          <span id="notificationBadge" style="display:none;position:absolute;top:6px;right:6px;background:#DC2626;color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:8px;align-items:center;justify-content:center;padding:0 4px;line-height:16px;">0</span>
        </a>`}
        <div class="dropdown" id="profileDropdown">
          <button class="dropdown-toggle" id="profileToggle" aria-label="Profile menu"
            style="border:none;background:none;padding:0;cursor:pointer;line-height:0;">
            ${avatarHtml(user)}
          </button>
          <div class="dropdown-menu">
            <div class="dropdown-header" style="display:flex;align-items:center;gap:12px;">
              <span id="dropdownAvatar">${avatarHtml(user, 'avatar-lg')}</span>
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:14px;color:var(--text);">${utils.escapeHtml(name)}</div>
                <div class="text-small text-muted" style="overflow:hidden;text-overflow:ellipsis;">${utils.escapeHtml(email)}</div>
                <span class="badge badge-primary" style="margin-top:4px;">${roleLabel(user)}</span>
              </div>
            </div>
            <div class="dropdown-divider"></div>
            <a class="dropdown-item" href="${role === 'admin' ? 'settings.html' : 'user-settings.html'}"><i class="fas fa-user"></i> Profile</a>
            <a class="dropdown-item" href="${role === 'admin' ? 'settings.html' : 'user-settings.html'}"><i class="fas fa-gear"></i> Settings</a>
            <a class="dropdown-item" href="notifications.html"><i class="fas fa-bell"></i> Notifications</a>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item danger" onclick="auth.logout(); return false;"><i class="fas fa-right-from-bracket"></i> Logout</button>
          </div>
        </div>
      </div>
    </header>
  `;

  const existing = document.getElementById('sidebar');
  if (existing) {
    // Refresh in place (e.g. after user data changed)
    existing.outerHTML = shellHTML.slice(0, shellHTML.indexOf('</aside>') + 8);
    const overlay = document.getElementById('sidebarOverlay');
    const topbar = document.querySelector('.topbar');
    const overlayHTML = '<div class="sidebar-overlay" id="sidebarOverlay"></div>';
    if (overlay) {
      overlay.outerHTML = overlayHTML;
    } else {
      existing.insertAdjacentHTML('afterend', overlayHTML);
    }
    if (topbar) {
      topbar.outerHTML = shellHTML.slice(shellHTML.indexOf('<header'), shellHTML.indexOf('</header>') + 9);
    }
  } else {
    document.body.insertAdjacentHTML('afterbegin', shellHTML);
  }

  sidebar.applyCollapsedState();
  wireShellEvents();
};

// Keep the sun/moon icon in sync with the active theme
const syncThemeToggleIcon = () => {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (icon) {
    const dark = document.documentElement.dataset.theme === 'dark';
    icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }
};

// Wire up shell interactions after each render
const wireShellEvents = () => {
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) menuToggle.onclick = () => sidebar.toggle();

  const collapseBtn = document.getElementById('sidebarCollapse');
  if (collapseBtn) collapseBtn.onclick = () => sidebar.toggle();

  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.onclick = () => sidebar.close();

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.onclick = () => {
      theme.toggle();
      syncThemeToggleIcon();
    };
    syncThemeToggleIcon();
  }

  const profileToggle = document.getElementById('profileToggle');
  if (profileToggle) {
    profileToggle.onclick = (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('profileDropdown');
      if (dropdown) dropdown.classList.toggle('active');
    };
  }
};

// Refresh the topbar/dropdown avatar (and cache the user) after e.g. a photo
// upload on a settings page — call as window.refreshAvatar(user) without reload.
const refreshAvatar = (user) => {
  if (user) auth.updateUser(user);
  const fresh = user || auth.getUser();
  const toggle = document.getElementById('profileToggle');
  if (toggle) toggle.innerHTML = avatarHtml(fresh);
  const dropdownAvatar = document.getElementById('dropdownAvatar');
  if (dropdownAvatar) dropdownAvatar.innerHTML = avatarHtml(fresh, 'avatar-lg');
};

// Initialize the app shell for a PAGE_CONFIG page
const initShell = async () => {
  const config = window.PAGE_CONFIG || {};
  const role = config.role;

  // Role guard: admins on user pages and vice versa get bounced by the page;
  // here we only enforce a valid session.
  if (!auth.requireAuth()) return;

  // Render immediately with the stored user so the shell appears before fetch
  renderLayout(auth.getUser());

  // Refresh the user from the server (profile area and badges)
  if (auth.isLoggedIn()) {
    try {
      const response = await api.get('/auth/me');
      if (response && response.success && response.data) {
        // Email-verification gate: accounts registered after verification was
        // introduced carry isEmailVerified=false and must verify before any
        // dashboard access. Legacy accounts (undefined) are grandfathered.
        if (response.data.isEmailVerified === false) {
          try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) { /* ignore */ }
          var inSub = /\/(user|admin)\//.test(window.location.pathname);
          window.location.href = (inSub ? '../' : '') + 'login.html#verify';
          return;
        }
        auth.updateUser(response.data);
        renderLayout(auth.getUser());
        notificationPoller.check();
      } else if (response && (response.statusCode === 401 || response.message === 'Invalid token')) {
        auth.logout();
        return;
      }
    } catch (error) {
      // Offline or transient failure — keep the shell rendered with cached user
    }
  }

  // Pollers (no-op for guests; messageNotifier self-guards admins)
  notificationPoller.start(30000);
};

// ---------------------------------------------------------------------------
// Global DOM behavior (all pages)
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        modal.closeAll();
      }
    });
  });

  // Initialize dropdowns (delegated: works for page-level and shell dropdowns)
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.dropdown-toggle');
    if (toggle) {
      e.stopPropagation();
      const dropdown = toggle.closest('.dropdown');
      if (dropdown) dropdown.classList.toggle('active');
      return;
    }
    // Close dropdowns when clicking outside
    document.querySelectorAll('.dropdown.active').forEach(d => {
      if (!d.contains(e.target)) d.classList.remove('active');
    });
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    const sidebarEl = document.getElementById('sidebar');
    const menuToggle = document.querySelector('.menu-toggle');

    if (sidebarEl && window.innerWidth <= sidebar.MOBILE_BREAKPOINT) {
      const isClickInsideSidebar = sidebarEl.contains(e.target);
      const isClickOnMenuToggle = menuToggle && (menuToggle === e.target || menuToggle.contains(e.target));

      if (!isClickInsideSidebar && !isClickOnMenuToggle) {
        sidebar.close();
      }
    }
  });

  // Touch support for mobile — close sidebar on touch outside
  document.addEventListener('touchstart', (e) => {
    const sidebarEl = document.getElementById('sidebar');
    const menuToggle = document.querySelector('.menu-toggle');

    if (sidebarEl && window.innerWidth <= sidebar.MOBILE_BREAKPOINT) {
      const isTouchInsideSidebar = sidebarEl.contains(e.target);
      const isTouchOnMenuToggle = menuToggle && (menuToggle === e.target || menuToggle.contains(e.target));

      if (!isTouchInsideSidebar && !isTouchOnMenuToggle && sidebarEl.classList.contains('active')) {
        sidebar.close();
      }
    }
  });

  // Handle window resize — leave off-canvas mode when crossing the breakpoint
  window.addEventListener('resize', utils.debounce(() => {
    if (window.innerWidth > sidebar.MOBILE_BREAKPOINT) {
      const sidebarEl = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      if (sidebarEl) sidebarEl.classList.remove('active');
      if (overlay) overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }, 150));

  // Landing nav: solid background after scrolling
  const landingNav = document.querySelector('.landing-nav');
  if (landingNav) {
    const onScroll = () => {
      landingNav.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Reveal-on-scroll entrance animations (.reveal → .revealed)
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('revealed'));
  }

  // App shell — only when the page declares a role
  if (window.PAGE_CONFIG && window.PAGE_CONFIG.role) {
    initShell();
  }
});

// ---------------------------------------------------------------------------
// Message Notification System (polls /api/messages/unread/count)
// ---------------------------------------------------------------------------
const messageNotifier = {
  lastCount: 0,
  checkInterval: null,

  // Start checking for new messages (works for users AND admins)
  start: (interval = 10000) => {
    if (!auth.isLoggedIn()) return;

    messageNotifier.checkMessages();
    messageNotifier.checkInterval = setInterval(messageNotifier.checkMessages, interval);
  },

  // Stop checking
  stop: () => {
    if (messageNotifier.checkInterval) {
      clearInterval(messageNotifier.checkInterval);
      messageNotifier.checkInterval = null;
    }
  },

  // Check for new messages
  checkMessages: async () => {
    if (!auth.isLoggedIn()) return;

    try {
      const response = await api.get('/messages/unread/count');
      if (response.success) {
        const count = response.data.count;

        // Update badges (sidebar support item + topbar message button)
        const badgeText = count > 9 ? '9+' : String(count);
        [document.getElementById('messageBadge'), document.getElementById('messageTopBadge')].forEach(function (badge) {
          if (!badge) return;
          if (count > 0) {
            badge.textContent = badgeText;
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
        });

        // Show popup notification for new messages (top of screen, with count)
        if (count > messageNotifier.lastCount) {
          messageNotifier.showPopup(count - messageNotifier.lastCount);
        }

        messageNotifier.lastCount = count;
      }
    } catch (error) {
      console.error('Message check error:', error);
    }
  },

  // Show popup notification
  showPopup: (newCount) => {
    // Create popup if it doesn't exist
    let popup = document.getElementById('messagePopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'messagePopup';
      popup.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: var(--surface, white);
        border: 1px solid var(--border, transparent);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        padding: 1rem 1.5rem;
        z-index: 9999;
        max-width: 320px;
        animation: slideInRight 0.3s ease;
        border-left: 4px solid #4C1D95;
      `;
      document.body.appendChild(popup);
    }

    popup.innerHTML = `
      <div style="display: flex; align-items: start; gap: 1rem;">
        <div style="width: 40px; height: 40px; background: #F0EAFB; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <i class="fas fa-envelope" style="color: #4C1D95;"></i>
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 0.25rem;">New Message${newCount > 1 ? 's' : ''}</div>
          <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.75rem;">
            You have ${newCount} new message${newCount > 1 ? 's' : ''} waiting for you
          </div>
          <button onclick="messageNotifier.openMessages(); messageNotifier.hidePopup();" style="background: #4C1D95; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer;">
            View Messages
          </button>
        </div>
        <button onclick="messageNotifier.hidePopup()" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 0;">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    popup.style.display = 'block';

    // Auto hide after 10 seconds
    setTimeout(() => {
      messageNotifier.hidePopup();
    }, 10000);

    // Play notification sound (optional)
    messageNotifier.playSound();
  },

  // Hide popup
  hidePopup: () => {
    const popup = document.getElementById('messagePopup');
    if (popup) {
      popup.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        popup.style.display = 'none';
      }, 300);
    }
  },

  // Open messages page
  openMessages: () => {
    window.location.href = auth.isAdmin() ? 'messages.html' : '../user/support.html';
  },

  // Play notification sound
  playSound: () => {
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch (e) {}
  }
};

// Add CSS animations used by toast reverse-exit and the message popup
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Start message notifier when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    messageNotifier.start();
  }, 2000);
});

// ---------------------------------------------------------------------------
// Export for use in other scripts
// ---------------------------------------------------------------------------
window.API_BASE_URL = API_BASE_URL;
window.SERVER_BASE_URL = SERVER_BASE_URL;
window.utils = utils;
window.api = api;
window.toast = toast;
window.modal = modal;
window.auth = auth;
window.sidebar = sidebar;
window.loading = loading;
window.pagination = pagination;
window.messageNotifier = messageNotifier;
window.kycGate = kycGate;
window.theme = theme;
window.NAV = NAV;
window.renderLayout = renderLayout;
window.updateNotificationBadge = updateNotificationBadge;
window.notificationPoller = notificationPoller;
window.avatarHtml = avatarHtml;
window.refreshAvatar = refreshAvatar;
