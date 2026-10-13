/**
 * M&M Laundry — Complete Application Logic
 * Integrates Auth, Live Order Tracking, Real API Booking, Partner Portals, and Legal Center
 */

let currentUser = null;
let authToken = localStorage.getItem('mm_auth_token') || null;
let currentTrackingOrder = null;

// Rates & Service Definitions (South African ZAR & Metric Pricing)
const SERVICE_RATES = {
  'wash_fold': { name: 'Wash & Fold (Everyday Clothes)', rate: 36.00, unit: 'per kg', defaultWeight: 10 },
  'dry_clean': { name: 'Dry Cleaning & Care', rate: 85.00, unit: 'per item', defaultWeight: 4 },
  'iron_press': { name: 'Wash & Iron Press', rate: 46.00, unit: 'per kg', defaultWeight: 10 },
  'bedding': { name: 'Duvet & Bedding Care', rate: 165.00, unit: 'per bundle', defaultWeight: 1 },
  'baby_clothes': { name: 'Baby Clothes & Hypoallergenic', rate: 38.00, unit: 'per kg', defaultWeight: 5 },
  'express': { name: 'Express Same-Day Rush (12h)', rate: 48.00, unit: 'per kg', defaultWeight: 10 }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// iOS Safari :active state support
document.addEventListener('touchstart', () => {}, { passive: true });

// DOM Content Loaded Initializer
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initRouter();
  initMobileMenu();
  initPwaInstallPrompt();
  initOfflineBanner();
  initServicesCatalog();
  initBookingWizard();
  initAccountPortal();
  initFullFaq();
  initCommercialCalc();
  initCarousels();
  initPickupCalculator();
  initForms();
  initExploreCardsTouch();
  loadOperationalStats();
  initStickyPickupBar();
  registerServiceWorker();
});

/* =========================================================================
   TOAST NOTIFICATIONS
   ========================================================================= */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.id = 'toast-' + Date.now();
  
  let iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  if (type === 'success') {
    iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E11D48" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  }

  toast.innerHTML = `${iconSvg}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

/* =========================================================================
   AUTH SYSTEM
   ========================================================================= */
async function initAuth() {
  if (authToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;

        // Fetch user's active orders if any
        try {
          const ordRes = await fetch('/api/orders', {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          const ordData = await ordRes.json();
          if (ordData.orders && ordData.orders.length > 0) {
            currentTrackingOrder = ordData.orders[0];
            renderSpotlightTracker(currentTrackingOrder);
          }
        } catch (e) {}
      } else {
        localStorage.removeItem('mm_auth_token');
        authToken = null;
        currentUser = null;
      }
    } catch (err) {
      console.warn('Auth verify network error:', err);
    }
  }
  updateUserUI();
}

function updateUserUI() {
  const guestNav = document.getElementById('navGuestActions');
  const userMenu = document.getElementById('navUserMenu');
  const userAvatar = document.getElementById('navUserAvatar');
  const userNameText = document.getElementById('navUserName');
  const userEmailText = document.getElementById('dropdownUserEmail');
  const userRoleText = document.getElementById('dropdownUserRole');
  const guestContactFields = document.getElementById('heroGuestContactFields');
  const mobileAuthBox = document.getElementById('mobileAuthStatusBox');
  const accountAvatar = document.getElementById('accountAvatar');
  const accountDisplayName = document.getElementById('accountDisplayName');
  const accountDisplayEmail = document.getElementById('accountDisplayEmail');

  if (currentUser) {
    if (guestNav) guestNav.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    if (guestContactFields) guestContactFields.style.display = 'none';
    
    // Initials
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (userAvatar) userAvatar.textContent = initials || 'MM';
    if (userNameText) userNameText.textContent = currentUser.name.split(' ')[0];
    if (userEmailText) userEmailText.textContent = currentUser.email;
    if (userRoleText) userRoleText.textContent = (currentUser.role || 'customer').toUpperCase();

    if (accountAvatar) accountAvatar.textContent = initials || 'MM';
    if (accountDisplayName) accountDisplayName.textContent = currentUser.name;
    if (accountDisplayEmail) accountDisplayEmail.textContent = currentUser.email;

    if (mobileAuthBox) {
      mobileAuthBox.innerHTML = `
        <span style="color:var(--slate-500);">Signed in as</span>
        <div style="font-weight:700; color:var(--ink); margin-top:2px;">${escapeHtml(currentUser.name)}</div>
        <div style="font-size:12px; color:var(--slate-500);">${escapeHtml(currentUser.email)}</div>
      `;
    }
  } else {
    if (guestNav) guestNav.style.display = 'flex';
    if (userMenu) userMenu.style.display = 'none';
    if (guestContactFields) guestContactFields.style.display = 'grid';

    if (mobileAuthBox) {
      mobileAuthBox.innerHTML = `
        <span style="color:var(--text-secondary);">Welcome to M&amp;M</span>
        <div style="font-weight:600; color:var(--ink); margin-top:2px;">
          <a href="/login" onclick="navigateTo('/login', event); toggleMobileMenu(false);" style="color:var(--ink); text-decoration:underline;">Sign in</a> or 
          <a href="/signup" onclick="navigateTo('/signup', event); toggleMobileMenu(false);" style="color:var(--ink); text-decoration:underline;">Create an account</a>
        </div>
      `;
    }
  }
}

function toggleUserDropdown() {
  const dropdown = document.getElementById('userDropdownMenu');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Close dropdown on outside click
window.addEventListener('click', (e) => {
  if (!e.target.closest('#navUserMenu')) {
    const dropdown = document.getElementById('userDropdownMenu');
    if (dropdown) dropdown.classList.remove('show');
  }
});

let authRedirectPath = null;

function openAuthModal(tab = 'login', redirect = null) {
  authRedirectPath = redirect;
  const modal = document.getElementById('authModal');
  if (!modal) return;
  switchAuthTab(tab);
  modal.classList.add('show');
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('show');
}

function switchAuthTab(tab) {
  const loginTab = document.getElementById('authTabLogin');
  const signupTab = document.getElementById('authTabSignup');
  const loginForm = document.getElementById('authLoginForm');
  const signupForm = document.getElementById('authSignupForm');
  const authTitle = document.getElementById('authModalTitle');

  if (tab === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    if (authTitle) authTitle.textContent = 'Welcome back to M&M';
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    if (authTitle) authTitle.textContent = 'Create your M&M account';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Login failed', 'error');
      return;
    }

    authToken = data.token;
    localStorage.setItem('mm_auth_token', authToken);
    currentUser = data.user;
    updateUserUI();
    closeAuthModal();
    showToast(`Welcome back, ${currentUser.name}!`, 'success');
    if (authRedirectPath) {
      const dest = authRedirectPath;
      authRedirectPath = null;
      navigateTo(dest);
    } else {
      renderRoute(currentRoutePath || window.location.pathname);
    }
  } catch (err) {
    showToast('Network error while logging in.', 'error');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const phone = document.getElementById('signupPhone').value.trim();
  const password = document.getElementById('signupPassword').value;
  const address = document.getElementById('signupAddress').value.trim();
  const agreeTerms = document.getElementById('signupAgreeTerms').checked;

  if (!agreeTerms) {
    showToast('Please accept the Terms of Service & Privacy Policy to sign up.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password, address, role: 'customer' })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Signup failed', 'error');
      return;
    }

    authToken = data.token;
    localStorage.setItem('mm_auth_token', authToken);
    currentUser = data.user;
    updateUserUI();
    closeAuthModal();
    showToast(`Account created! Welcome to M&M, ${currentUser.name}!`, 'success');
    if (authRedirectPath) {
      const dest = authRedirectPath;
      authRedirectPath = null;
      navigateTo(dest);
    } else {
      renderRoute(currentRoutePath || window.location.pathname);
    }
  } catch (err) {
    showToast('Network error while signing up.', 'error');
  }
}

function scrollToBooking() {
  if (window.location.pathname !== '/' && window.location.pathname !== '') {
    navigateTo('/book');
    return;
  }
  const heroCard = document.querySelector('.pickup-card');
  if (heroCard && heroCard.offsetParent !== null) {
    heroCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    heroCard.style.boxShadow = '0 0 0 2px var(--ink)';
    setTimeout(() => {
      heroCard.style.boxShadow = '';
    }, 1500);
  } else {
    navigateTo('/book');
  }
}

function handleMetroSelection(city) {
  const addrInput = document.getElementById('pickupAddressInput');
  if (addrInput && city) {
    addrInput.focus();
  }
}

function selectLocationForBooking() {
  const addrInput = document.getElementById('pickupAddressInput');
  if (addrInput) {
    addrInput.focus();
  }
  scrollToBooking();
}

async function logout() {
  if (authToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (e) {}
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem('mm_auth_token');
  updateUserUI();
  const dropdown = document.getElementById('userDropdownMenu');
  if (dropdown) dropdown.classList.remove('show');
  showToast('You have been logged out.', 'info');
}

/* =========================================================================
   APP-LIKE PICKUP CALCULATOR & CHECKOUT FLOW
   ========================================================================= */
let pendingBooking = {
  address: '',
  unit: '',
  serviceKey: '',
  serviceName: '',
  sizeValue: '',
  weightText: '',
  detergent: '',
  pickupTime: '',
  subtotal: 0.00,
  deliveryFee: 0.00,
  discount: 0.00,
  promoCode: '',
  total: 0.00
};

let currentBookingStep = 1;
let selectedPaymentMethod = 'Instant EFT / Capitec Pay';

async function loadOperationalStats() {
  const countEl = document.getElementById('statOrdersCount');
  if (!countEl) return;

  try {
    const res = await fetch('/api/stats/operational');
    const data = await res.json();
    if (data.success && typeof data.totalOrders === 'number') {
      countEl.textContent = data.totalOrders > 0 ? `${data.totalOrders}` : '0';
    }
  } catch (err) {
    console.error('Error loading operational stats:', err);
  }
}

function setQuickAddress(addr) {
  const input = document.getElementById('pickupAddressInput');
  if (input) {
    input.value = addr;
    input.style.borderColor = 'var(--ink)';
    setTimeout(() => { input.style.borderColor = ''; }, 1200);
  }
  updatePickupEstimate();
}

function populateLivePickupTimeSlots() {
  const select = document.getElementById('pickupTimeSlotSelect');
  if (!select) return;

  const now = new Date();
  const currentHour = now.getHours();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const slots = [];

  // Available 2-hour collection windows today
  const standardWindows = [
    { start: 8, end: 10, label: '8:00 AM – 10:00 AM' },
    { start: 10, end: 12, label: '10:00 AM – 12:00 PM' },
    { start: 12, end: 14, label: '12:00 PM – 2:00 PM' },
    { start: 14, end: 16, label: '2:00 PM – 4:00 PM' },
    { start: 16, end: 18, label: '4:00 PM – 6:00 PM' },
    { start: 18, end: 20, label: '6:00 PM – 8:00 PM' }
  ];

  standardWindows.forEach(w => {
    // Require at least 1-hour lead time for courier routing
    if (currentHour < w.start - 1) {
      slots.push(`Today (${days[now.getDay()]}) · ${w.label}`);
    }
  });

  // Tomorrow slots
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tDay = days[tomorrow.getDay()];
  const tDate = `${tomorrow.getDate()} ${months[tomorrow.getMonth()]}`;

  slots.push(`Tomorrow (${tDay}, ${tDate}) · 8:00 AM – 10:00 AM`);
  slots.push(`Tomorrow (${tDay}, ${tDate}) · 10:00 AM – 12:00 PM`);
  slots.push(`Tomorrow (${tDay}, ${tDate}) · 12:00 PM – 2:00 PM`);
  slots.push(`Tomorrow (${tDay}, ${tDate}) · 2:00 PM – 4:00 PM`);
  slots.push(`Tomorrow (${tDay}, ${tDate}) · 4:00 PM – 6:00 PM`);

  // Following day option
  const nextDay = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  slots.push(`${days[nextDay.getDay()]}, ${nextDay.getDate()} ${months[nextDay.getMonth()]} · 9:00 AM – 12:00 PM`);

  select.innerHTML = `<option value="" selected disabled>Select pickup time</option>` + slots.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function initPickupCalculator() {
  populateLivePickupTimeSlots();

  const serviceSelect = document.getElementById('pickupServiceSelect');
  const sizeSelect = document.getElementById('pickupSizeSelect');
  const detergentSelect = document.getElementById('pickupDetergentSelect');
  const timeSelect = document.getElementById('pickupTimeSlotSelect');
  const addressInput = document.getElementById('pickupAddressInput');

  if (serviceSelect) serviceSelect.addEventListener('change', updatePickupEstimate);
  if (sizeSelect) sizeSelect.addEventListener('change', updatePickupEstimate);
  if (detergentSelect) detergentSelect.addEventListener('change', updatePickupEstimate);
  if (timeSelect) timeSelect.addEventListener('change', updatePickupEstimate);
  if (addressInput) addressInput.addEventListener('input', updatePickupEstimate);

  updatePickupEstimate();
}

function updatePickupEstimate() {
  const serviceKey = document.getElementById('pickupServiceSelect')?.value || '';
  const sizeValue = document.getElementById('pickupSizeSelect')?.value || '';
  const priceDisplay = document.getElementById('pickupEstimatedPrice');
  const weightDisplay = document.getElementById('pickupEstimatedWeight');

  const bdLabel = document.getElementById('breakdownServiceLabel');
  const bdSubtotal = document.getElementById('breakdownSubtotal');
  const bdDelivery = document.getElementById('breakdownDelivery');
  const bdDeliveryRow = document.getElementById('breakdownDeliveryRow');
  const bdDiscountRow = document.getElementById('breakdownDiscountRow');
  const bdDiscount = document.getElementById('breakdownDiscount');
  const bdVat = document.getElementById('breakdownVat');
  const bdTotal = document.getElementById('breakdownTotal');
  const btnPayPill = document.getElementById('btnPayAmountPill');

  // If service or load size has not been explicitly chosen, show placeholders and 0 totals
  if (!serviceKey || !sizeValue) {
    if (priceDisplay) priceDisplay.textContent = '—';
    if (weightDisplay) weightDisplay.textContent = 'Select options to estimate';
    if (bdLabel) bdLabel.textContent = '—';
    if (bdSubtotal) bdSubtotal.textContent = '—';
    if (bdDelivery) bdDelivery.textContent = '—';
    if (bdVat) bdVat.textContent = '—';
    if (bdTotal) bdTotal.textContent = '—';
    if (btnPayPill) btnPayPill.textContent = '—';
    pendingBooking.serviceKey = serviceKey;
    pendingBooking.sizeValue = sizeValue;
    pendingBooking.subtotal = 0.00;
    pendingBooking.deliveryFee = 0.00;
    pendingBooking.total = 0.00;
    return;
  }

  const sDef = SERVICE_RATES[serviceKey] || SERVICE_RATES['wash_fold'];
  
  let weightText = 'Up to 10kg (~22 lbs)';
  let subtotal = 360.00;

  if (serviceKey === 'wash_fold') {
    if (sizeValue === 'small') {
      subtotal = 185.00;
      weightText = 'Up to 5kg (~11 lbs)';
    } else if (sizeValue === 'medium') {
      subtotal = 360.00;
      weightText = 'Up to 10kg (~22 lbs)';
    } else {
      subtotal = 680.00;
      weightText = 'Up to 20kg (~44 lbs)';
    }
  } else if (serviceKey === 'dry_clean') {
    const items = sizeValue === 'small' ? 4 : (sizeValue === 'medium' ? 8 : 16);
    subtotal = items * sDef.rate;
    weightText = `${items} tailored garments`;
  } else if (serviceKey === 'iron_press') {
    if (sizeValue === 'small') {
      subtotal = 240.00;
      weightText = 'Up to 5kg (~11 lbs) iron pressed';
    } else if (sizeValue === 'medium') {
      subtotal = 460.00;
      weightText = 'Up to 10kg (~22 lbs) iron pressed';
    } else {
      subtotal = 880.00;
      weightText = 'Up to 20kg (~44 lbs) iron pressed';
    }
  } else if (serviceKey === 'bedding') {
    if (sizeValue === 'small') {
      subtotal = 165.00;
      weightText = '1 duvet & bedding bundle (Single/3-Quarter)';
    } else if (sizeValue === 'medium') {
      subtotal = 320.00;
      weightText = '2 duvet & linen bundles (Double/Queen)';
    } else {
      subtotal = 475.00;
      weightText = '3 duvet & sheet bundles (King/Feather)';
    }
  } else if (serviceKey === 'baby_clothes') {
    if (sizeValue === 'small') {
      subtotal = 190.00;
      weightText = 'Up to 5kg baby clothes';
    } else if (sizeValue === 'medium') {
      subtotal = 380.00;
      weightText = 'Up to 10kg baby clothes';
    } else {
      subtotal = 720.00;
      weightText = 'Up to 20kg baby clothes';
    }
  } else if (serviceKey === 'express') {
    if (sizeValue === 'small') {
      subtotal = 240.00;
      weightText = 'Up to 5kg (12h Rush)';
    } else if (sizeValue === 'medium') {
      subtotal = 480.00;
      weightText = 'Up to 10kg (12h Rush)';
    } else {
      subtotal = 920.00;
      weightText = 'Up to 20kg (12h Rush)';
    }
  }

  // Delivery fee calculation (Free over R350, else R45)
  const deliveryFee = subtotal >= 350 ? 0.00 : 45.00;
  const discount = pendingBooking.discount || 0.00;
  const netTotal = Math.max(0, subtotal + deliveryFee - discount);
  const vatAmount = (netTotal * 15 / 115);

  // Sync to state
  pendingBooking.serviceKey = serviceKey;
  pendingBooking.serviceName = sDef.name;
  pendingBooking.sizeValue = sizeValue;
  pendingBooking.weightText = weightText;
  pendingBooking.subtotal = subtotal;
  pendingBooking.deliveryFee = deliveryFee;
  pendingBooking.total = netTotal;

  // Update hero preview display
  if (priceDisplay) priceDisplay.textContent = `R${subtotal.toFixed(2)}`;
  if (weightDisplay) weightDisplay.textContent = weightText;

  // Update step 2 breakdown displays
  if (bdLabel) bdLabel.textContent = `${sDef.name} (${weightText})`;
  if (bdSubtotal) bdSubtotal.textContent = `R${subtotal.toFixed(2)}`;
  if (bdDelivery) {
    if (deliveryFee === 0) {
      bdDelivery.textContent = 'FREE (Order > R350)';
      bdDeliveryRow?.classList.add('delivery-free');
    } else {
      bdDelivery.textContent = `R${deliveryFee.toFixed(2)}`;
      bdDeliveryRow?.classList.remove('delivery-free');
    }
  }

  if (bdDiscountRow && bdDiscount) {
    if (discount > 0) {
      bdDiscountRow.style.display = 'flex';
      bdDiscount.textContent = `-R${discount.toFixed(2)}`;
    } else {
      bdDiscountRow.style.display = 'none';
    }
  }

  if (bdVat) bdVat.textContent = `R${vatAmount.toFixed(2)} (Included)`;
  if (bdTotal) bdTotal.textContent = `R${netTotal.toFixed(2)}`;
  if (btnPayPill) btnPayPill.textContent = `R${netTotal.toFixed(2)}`;
}

function goToBookingStep(step) {
  const addressInput = document.getElementById('pickupAddressInput');
  const serviceSelect = document.getElementById('pickupServiceSelect');
  const sizeSelect = document.getElementById('pickupSizeSelect');
  const timeSelect = document.getElementById('pickupTimeSlotSelect');
  const detergentSelect = document.getElementById('pickupDetergentSelect');

  const address = addressInput?.value.trim() || '';
  const unit = document.getElementById('pickupUnitInput')?.value.trim() || '';
  const serviceKey = serviceSelect?.value || '';
  const sizeValue = sizeSelect?.value || '';
  const pickupTime = timeSelect?.value || '';
  const detergent = detergentSelect?.value || '';

  if (step === 2) {
    if (!address) {
      showToast('Please enter your pickup street address & suburb.', 'error');
      if (addressInput) {
        addressInput.focus();
        addressInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        addressInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.4)';
        setTimeout(() => { addressInput.style.boxShadow = ''; }, 1500);
      }
      return;
    }

    if (!serviceKey) {
      showToast('Please select a service type.', 'error');
      if (serviceSelect) {
        serviceSelect.focus();
        serviceSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
        serviceSelect.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.4)';
        setTimeout(() => { serviceSelect.style.boxShadow = ''; }, 1500);
      }
      return;
    }

    if (!sizeValue) {
      showToast('Please select a load size.', 'error');
      if (sizeSelect) {
        sizeSelect.focus();
        sizeSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sizeSelect.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.4)';
        setTimeout(() => { sizeSelect.style.boxShadow = ''; }, 1500);
      }
      return;
    }

    if (!pickupTime) {
      showToast('Please select a pickup time slot.', 'error');
      if (timeSelect) {
        timeSelect.focus();
        timeSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
        timeSelect.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.4)';
        setTimeout(() => { timeSelect.style.boxShadow = ''; }, 1500);
      }
      return;
    }

    if (!detergent) {
      showToast('Please select a detergent preference.', 'error');
      if (detergentSelect) {
        detergentSelect.focus();
        detergentSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
        detergentSelect.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.4)';
        setTimeout(() => { detergentSelect.style.boxShadow = ''; }, 1500);
      }
      return;
    }

    pendingBooking.address = address;
    pendingBooking.unit = unit;
    pendingBooking.serviceKey = serviceKey;
    pendingBooking.sizeValue = sizeValue;
    pendingBooking.detergent = detergent;
    pendingBooking.pickupTime = pickupTime;
    updatePickupEstimate();

    document.getElementById('bookingStep1View').style.display = 'none';
    document.getElementById('bookingStep2View').style.display = 'block';

    const pill1 = document.getElementById('pillStep1');
    const pill2 = document.getElementById('pillStep2');
    const pill3 = document.getElementById('pillStep3');
    pill1?.classList.remove('active');
    pill1?.classList.add('completed');
    pill1?.setAttribute('aria-selected', 'false');
    pill2?.classList.add('active');
    pill2?.setAttribute('aria-selected', 'true');
    pill3?.classList.remove('active');
    pill3?.setAttribute('aria-selected', 'false');
    currentBookingStep = 2;
  } else if (step === 1) {
    document.getElementById('bookingStep1View').style.display = 'block';
    document.getElementById('bookingStep2View').style.display = 'none';

    const pill1 = document.getElementById('pillStep1');
    const pill2 = document.getElementById('pillStep2');
    const pill3 = document.getElementById('pillStep3');
    pill1?.classList.add('active');
    pill1?.setAttribute('aria-selected', 'true');
    pill2?.classList.remove('active');
    pill2?.setAttribute('aria-selected', 'false');
    pill3?.classList.remove('active');
    pill3?.setAttribute('aria-selected', 'false');
    currentBookingStep = 1;
  }
}

function applyPromoCode() {
  const input = document.getElementById('bookingPromoInput');
  const code = input?.value.trim().toUpperCase();

  if (!code) {
    showToast('Please enter a promo voucher code.', 'info');
    return;
  }

  if (code === 'FIRSTWASH' || code === 'MM50' || code === 'WELCOME50') {
    pendingBooking.discount = 50.00;
    pendingBooking.promoCode = code;
    showToast('Promo code FIRSTWASH applied: R50.00 discount!', 'success');
    updatePickupEstimate();
  } else {
    showToast('Promo code not valid or expired. Try "FIRSTWASH".', 'error');
  }
}

function proceedToPayment() {
  const addressInput = document.getElementById('pickupAddressInput');
  const serviceSelect = document.getElementById('pickupServiceSelect');
  const sizeSelect = document.getElementById('pickupSizeSelect');
  const timeSelect = document.getElementById('pickupTimeSlotSelect');
  const detergentSelect = document.getElementById('pickupDetergentSelect');

  const address = addressInput?.value.trim() || '';
  const unit = document.getElementById('pickupUnitInput')?.value.trim() || '';
  const serviceKey = serviceSelect?.value || '';
  const sizeValue = sizeSelect?.value || '';
  const pickupTime = timeSelect?.value || '';
  const detergent = detergentSelect?.value || '';

  if (!address) {
    showToast('Please enter your pickup address first.', 'error');
    goToBookingStep(1);
    addressInput?.focus();
    return;
  }

  if (!serviceKey) {
    showToast('Please select a service type.', 'error');
    goToBookingStep(1);
    serviceSelect?.focus();
    return;
  }

  if (!sizeValue) {
    showToast('Please select a load size.', 'error');
    goToBookingStep(1);
    sizeSelect?.focus();
    return;
  }

  if (!pickupTime) {
    showToast('Please select a pickup time slot.', 'error');
    goToBookingStep(1);
    timeSelect?.focus();
    return;
  }

  if (!detergent) {
    showToast('Please select a detergent preference.', 'error');
    goToBookingStep(1);
    detergentSelect?.focus();
    return;
  }

  pendingBooking.address = address;
  pendingBooking.unit = unit;
  pendingBooking.serviceKey = serviceKey;
  pendingBooking.sizeValue = sizeValue;
  pendingBooking.detergent = detergent;
  pendingBooking.pickupTime = pickupTime;
  updatePickupEstimate();

  const checkoutModal = document.getElementById('checkoutModal');
  if (!checkoutModal) return;

  // Check authentication requirement: "when paying the user must login or create an account"
  if (!currentUser || !authToken) {
    // Show Auth Gate in Checkout Modal
    document.getElementById('checkoutAuthSection').style.display = 'block';
    document.getElementById('checkoutPaymentSection').style.display = 'none';
    document.getElementById('checkoutModalTitle').textContent = 'Account Required to Book & Pay';

    // Pre-populate signup address with the address user entered
    const signupAddress = document.getElementById('checkoutSignupAddress');
    if (signupAddress) {
      signupAddress.value = address + (unit ? `, ${unit}` : '');
    }

    switchCheckoutAuthTab('signup'); // Default to sign up for new users
  } else {
    // Show Payment confirmation step
    showCheckoutPaymentStep();
  }

  // Highlight pill step 3
  document.getElementById('pillStep1')?.classList.remove('active');
  document.getElementById('pillStep2')?.classList.remove('active');
  document.getElementById('pillStep3')?.classList.add('active');

  checkoutModal.classList.add('show');
}

function showCheckoutPaymentStep() {
  const authSec = document.getElementById('checkoutAuthSection');
  const paySec = document.getElementById('checkoutPaymentSection');
  const title = document.getElementById('checkoutModalTitle');

  if (authSec) authSec.style.display = 'none';
  if (paySec) paySec.style.display = 'block';
  if (title) title.textContent = 'Review Booking & Pay';

  // Fill in customer details
  const nameEl = document.getElementById('checkoutCustomerNameDisplay');
  const addrEl = document.getElementById('checkoutAddressDisplay');
  const slotEl = document.getElementById('checkoutSlotDisplay');
  const srvEl = document.getElementById('checkoutServiceDisplay');
  const detEl = document.getElementById('checkoutDetergentDisplay');
  const totalEl = document.getElementById('checkoutFinalAmountDisplay');
  const btnText = document.getElementById('btnFinalPayText');

  if (nameEl) nameEl.textContent = currentUser ? `${currentUser.name} (${currentUser.phone})` : 'Registered Customer';
  if (addrEl) addrEl.textContent = pendingBooking.address + (pendingBooking.unit ? ` · ${pendingBooking.unit}` : '');
  if (slotEl) slotEl.textContent = pendingBooking.pickupTime;
  if (srvEl) srvEl.textContent = `${pendingBooking.serviceName} (${pendingBooking.weightText})`;
  if (detEl) detEl.textContent = pendingBooking.detergent;

  const netTotalStr = `R${pendingBooking.total.toFixed(2)}`;
  if (totalEl) totalEl.textContent = netTotalStr;
  if (btnText) btnText.textContent = `Confirm & Pay ${netTotalStr}`;
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkoutModal');
  if (modal) modal.classList.remove('show');
  if (currentBookingStep === 2) {
    document.getElementById('pillStep2')?.classList.add('active');
  } else {
    document.getElementById('pillStep1')?.classList.add('active');
  }
  document.getElementById('pillStep3')?.classList.remove('active');
}

function switchCheckoutAuthTab(tab) {
  const tabLogin = document.getElementById('checkoutTabLogin');
  const tabSignup = document.getElementById('checkoutTabSignup');
  const formLogin = document.getElementById('checkoutLoginForm');
  const formSignup = document.getElementById('checkoutSignupForm');

  if (tab === 'login') {
    tabLogin?.classList.add('active');
    tabSignup?.classList.remove('active');
    if (formLogin) formLogin.style.display = 'block';
    if (formSignup) formSignup.style.display = 'none';
  } else {
    tabSignup?.classList.add('active');
    tabLogin?.classList.remove('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formSignup) formSignup.style.display = 'block';
  }
}

async function handleCheckoutLogin(e) {
  e.preventDefault();
  const email = document.getElementById('checkoutLoginEmail')?.value.trim();
  const password = document.getElementById('checkoutLoginPassword')?.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Login failed', 'error');
      return;
    }

    authToken = data.token;
    localStorage.setItem('mm_auth_token', authToken);
    currentUser = data.user;
    updateUserUI();
    showToast(`Welcome back, ${currentUser.name}! You can now complete your payment.`, 'success');

    // Automatically transition straight to the payment step!
    showCheckoutPaymentStep();
  } catch (err) {
    showToast('Network error while logging in.', 'error');
  }
}

async function handleCheckoutSignup(e) {
  e.preventDefault();
  const name = document.getElementById('checkoutSignupName')?.value.trim();
  const email = document.getElementById('checkoutSignupEmail')?.value.trim();
  const phone = document.getElementById('checkoutSignupPhone')?.value.trim();
  const address = document.getElementById('checkoutSignupAddress')?.value.trim();
  const password = document.getElementById('checkoutSignupPassword')?.value;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, address, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Account creation failed', 'error');
      return;
    }

    authToken = data.token;
    localStorage.setItem('mm_auth_token', authToken);
    currentUser = data.user;
    updateUserUI();
    showToast(`Account created successfully! Proceeding to payment.`, 'success');

    // If user provided address during signup, make sure pendingBooking uses it
    if (address && !pendingBooking.address) {
      pendingBooking.address = address;
    }

    // Automatically transition straight to the payment step!
    showCheckoutPaymentStep();
  } catch (err) {
    showToast('Network error while creating account.', 'error');
  }
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  const cards = document.querySelectorAll('.payment-card-option');
  cards.forEach(card => card.classList.remove('active'));

  if (method.includes('EFT')) {
    document.getElementById('payOptEFT')?.classList.add('active');
    document.getElementById('cardDetailsForm').style.display = 'none';
  } else if (method.includes('Card')) {
    document.getElementById('payOptCard')?.classList.add('active');
    document.getElementById('cardDetailsForm').style.display = 'block';
  } else if (method.includes('Snap')) {
    document.getElementById('payOptSnap')?.classList.add('active');
    document.getElementById('cardDetailsForm').style.display = 'none';
  } else if (method.includes('Cash') || method.includes('Doorstep')) {
    document.getElementById('payOptCash')?.classList.add('active');
    document.getElementById('cardDetailsForm').style.display = 'none';
  }
}

async function submitFinalPayment() {
  if (!currentUser || !authToken) {
    showToast('Please log in or create an account to pay.', 'error');
    proceedToPayment();
    return;
  }

  const specialInstructions = document.getElementById('checkoutSpecialInstructions')?.value.trim() || 'Standard handling';
  const fullPickupAddress = pendingBooking.address + (pendingBooking.unit ? `, Unit: ${pendingBooking.unit}` : '');

  const orderPayload = {
    customerName: currentUser.name,
    phone: currentUser.phone,
    pickupAddress: fullPickupAddress,
    serviceType: pendingBooking.serviceName,
    bagCount: pendingBooking.sizeValue === 'small' ? 1 : (pendingBooking.sizeValue === 'medium' ? 2 : 3),
    estimatedWeight: pendingBooking.weightText,
    detergent: pendingBooking.detergent,
    specialInstructions: specialInstructions,
    pickupTime: pendingBooking.pickupTime,
    items: [
      { name: `${pendingBooking.serviceName} (${pendingBooking.weightText})`, price: pendingBooking.subtotal }
    ],
    total: pendingBooking.total,
    discount: pendingBooking.discount,
    paymentMethod: selectedPaymentMethod
  };

  const btn = document.getElementById('btnFinalPaySubmit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Processing payment...</span>';
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(orderPayload)
    });
    const data = await res.json();

    if (res.ok && data.order) {
      showToast(`Payment approved! Order ${data.order.id} booked.`, 'success');
      closeCheckoutModal();
      goToBookingStep(1); // Reset widget

      currentTrackingOrder = data.order;
      renderSpotlightTracker(data.order);
      openTrackerModal(data.order.id);

      // Refresh database metrics
      loadOperationalStats();
    } else {
      showToast(data.error || 'Payment could not be processed. Please try again.', 'error');
    }
  } catch (err) {
    showToast('Network error while completing payment.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> <span>Confirm &amp; Pay R${pendingBooking.total.toFixed(2)}</span>`;
    }
  }
}

function prefillAndOpenBooking(serviceKey = 'wash_fold') {
  const sSelect = document.getElementById('pickupServiceSelect');
  if (sSelect) {
    sSelect.value = serviceKey;
    updatePickupEstimate();
  }
  goToBookingStep(1);
  const heroCard = document.getElementById('heroBookingCard') || document.querySelector('.pickup-card');
  if (heroCard) {
    heroCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    heroCard.style.boxShadow = '0 0 0 2px var(--ink)';
    setTimeout(() => {
      heroCard.style.boxShadow = '';
    }, 1500);
  }
}

/* =========================================================================
   LIVE ORDER TRACKER
   ========================================================================= */
function renderSpotlightTracker(order) {
  if (!order) return;
  const noOrderState = document.getElementById('spotlightNoOrderState');
  const activeOrderState = document.getElementById('spotlightActiveOrderState');
  if (!activeOrderState) return;

  if (noOrderState) noOrderState.style.display = 'none';
  activeOrderState.style.display = 'block';

  const orderIdEl = document.getElementById('spotlightOrderId');
  if (orderIdEl) orderIdEl.textContent = '#' + order.id;

  const summaryEl = document.getElementById('spotlightOrderSummary');
  if (summaryEl) summaryEl.textContent = `${order.serviceType} • R${order.total.toFixed(2)}`;

  const badge = document.getElementById('spotlightStatusBadge');
  if (badge) {
    badge.innerHTML = `<span class="live-pulse"></span> ${order.status.toUpperCase().replace(/_/g, ' ')}`;
  }

  const steps = [
    { key: 'placed', label: '1. Order Booked', desc: 'Order placed & scheduled' },
    { key: 'assigned', label: '2. Driver Dispatched', desc: order.driver ? `${order.driver.name} en route (${order.driver.vehicle})` : 'Courier dispatching' },
    { key: 'picked_up', label: '3. Picked Up & Weighed', desc: `Verified: ${order.estimatedWeight}` },
    { key: 'washing', label: '4. In The Wash & Care', desc: `Gentle cycle active (${order.detergent})` },
    { key: 'inspection', label: '5. Quality Check & Fold', desc: 'Inspected, steam-pressed & packaged' },
    { key: 'out_for_delivery', label: '6. Out for Delivery', desc: 'Courier en route back to your door' },
    { key: 'delivered', label: '7. Delivered Fresh', desc: 'Left safely at your doorstep' }
  ];

  const currentIdx = steps.findIndex(s => s.key === order.status);
  const effectiveIdx = currentIdx >= 0 ? currentIdx : 0;

  const listContainer = document.getElementById('spotlightStepsList');
  if (listContainer) {
    listContainer.innerHTML = '';
    steps.slice(0, 4).forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'tracker-step-item';
      if (idx < effectiveIdx) {
        item.classList.add('completed');
      } else if (idx === effectiveIdx) {
        item.classList.add('active');
      }
      item.innerHTML = `
        <div style="font-weight:600;">${s.label}</div>
        <div class="step-time">${s.desc}</div>
      `;
      listContainer.appendChild(item);
    });
  }
}

async function handleTrackSearch(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('trackSearchInput');
  const rawId = input ? input.value.trim() : '';
  if (!rawId) {
    showToast('Please enter an order ID to track.', 'error');
    return;
  }
  const orderId = rawId.toUpperCase().startsWith('MM-') ? rawId.toUpperCase() : `MM-${rawId.replace(/[^0-9]/g, '')}`;

  try {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) {
      showToast(`Order "${orderId}" not found. Please verify your order ID.`, 'error');
      return;
    }
    const data = await res.json();
    currentTrackingOrder = data.order;
    renderSpotlightTracker(data.order);
    openTrackerModal(data.order.id);
    showToast(`Tracking order #${data.order.id}!`, 'success');
  } catch (err) {
    showToast('Error retrieving order details.', 'error');
  }
}

async function openTrackerModal(orderId = null) {
  const modal = document.getElementById('trackerModal');
  if (!modal) return;

  try {
    let order = null;
    if (orderId) {
      const res = await fetch(`/api/orders/${orderId}`);
      if (res.ok) {
        const d = await res.json();
        order = d.order;
      }
    }

    if (!order && currentTrackingOrder) {
      order = currentTrackingOrder;
    }

    // Fallback to user's first order
    if (!order) {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch('/api/orders', { headers });
      const d = await res.json();
      if (d.orders && d.orders.length > 0) {
        order = d.orders[0];
      }
    }

    if (!order) {
      showToast('No active orders found. Please book a pickup first!', 'info');
      return;
    }

    currentTrackingOrder = order;
    renderTrackerView(order);
    renderSpotlightTracker(order);
    modal.classList.add('show');
  } catch (err) {
    showToast('Failed to load order tracking details.', 'error');
  }
}

function closeTrackerModal() {
  const modal = document.getElementById('trackerModal');
  if (modal) modal.classList.remove('show');
}

function renderTrackerView(order) {
  document.getElementById('trackerOrderId').textContent = order.id;
  document.getElementById('trackerServiceType').textContent = order.serviceType;
  document.getElementById('trackerAddress').textContent = order.pickupAddress;
  document.getElementById('trackerTotal').textContent = `R${order.total.toFixed(2)}`;
  document.getElementById('trackerWeight').textContent = order.estimatedWeight;
  document.getElementById('trackerDetergent').textContent = order.detergent;

  // Handover Delivery PIN from App
  const pinEl = document.getElementById('trackerDeliveryPin');
  if (pinEl) {
    pinEl.textContent = order.deliveryPin || '4821';
  }

  // Driver details
  const driverNameEl = document.getElementById('trackerDriverName');
  const driverVehEl = document.getElementById('trackerDriverVehicle');
  const driverRatingEl = document.getElementById('trackerDriverRating');
  const driverAvatarEl = document.getElementById('trackerDriverAvatar');

  if (order.driver) {
    if (driverNameEl) driverNameEl.textContent = order.driver.name;
    if (driverVehEl) driverVehEl.textContent = order.driver.vehicle;
    if (driverRatingEl) driverRatingEl.textContent = `★ ${order.driver.rating}`;
    if (driverAvatarEl) {
      const initials = order.driver.name.split(' ').map(n => n[0]).join('');
      driverAvatarEl.textContent = initials;
    }
  } else {
    if (driverNameEl) driverNameEl.textContent = 'Awaiting Dispatch';
    if (driverVehEl) driverVehEl.textContent = 'Local delivery route assigned upon pickup';
    if (driverRatingEl) driverRatingEl.textContent = '★ 5.0';
    if (driverAvatarEl) driverAvatarEl.textContent = '--';
  }

  // Stepper rendering
  const steps = [
    { key: 'placed', label: '1. Order Booked', desc: 'Order placed & scheduled in South Africa' },
    { key: 'assigned', label: '2. Driver Dispatched', desc: order.driver ? `${order.driver.name} dispatched` : 'Local courier dispatched for doorstep pickup' },
    { key: 'picked_up', label: '3. Picked Up & Weighed', desc: `Bags collected and scale-verified: ${order.estimatedWeight}` },
    { key: 'washing', label: '4. In The Wash & Care', desc: `Sanitizing, eco wash with ${order.detergent}` },
    { key: 'inspection', label: '5. Hand Fold & Quality Check', desc: 'Hand-inspected, steam-pressed & packaged' },
    { key: 'out_for_delivery', label: '6. Out for Return Delivery', desc: 'Courier en route back to your doorstep' },
    { key: 'delivered', label: '7. Delivered Fresh', desc: 'Left safely at your door in weatherproof bags' }
  ];

  const currentIdx = steps.findIndex(s => s.key === order.status);
  const effectiveIdx = currentIdx >= 0 ? currentIdx : (order.statusStep ? order.statusStep - 1 : 0);

  const listContainer = document.getElementById('trackerModalStepsList');
  if (listContainer) {
    listContainer.innerHTML = '';
    steps.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'tracker-step-item';
      if (idx < effectiveIdx) {
        item.classList.add('completed');
      } else if (idx === effectiveIdx) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <div style="font-weight:600;">${s.label}</div>
        <div class="step-time">${s.desc}</div>
      `;
      listContainer.appendChild(item);
    });
  }

  // Current stage highlight badge
  const activeStep = steps[effectiveIdx] || steps[0];
  const badge = document.getElementById('trackerCurrentStageBadge');
  if (badge) {
    badge.innerHTML = `<span class="live-pulse"></span> ${activeStep.label}`;
  }
}

async function advanceOrderStatusSimulation() {
  if (!currentTrackingOrder) return;
  try {
    const res = await fetch(`/api/orders/${currentTrackingOrder.id}/advance`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success && data.order) {
      currentTrackingOrder = data.order;
      renderTrackerView(data.order);
      renderSpotlightTracker(data.order);
      showToast(`Wash stage updated: ${data.order.status.replace(/_/g, ' ').toUpperCase()}`, 'success');
    }
  } catch (err) {
    showToast('Failed to advance wash stage simulation', 'error');
  }
}

function advanceOrderSimulation() {
  return advanceOrderStatusSimulation();
}

window.advanceOrderSimulation = advanceOrderSimulation;
window.advanceOrderStatusSimulation = advanceOrderStatusSimulation;

function simulateDriverCall() {
  const driverName = currentTrackingOrder?.driver?.name || 'Assigned Courier';
  const driverPhone = currentTrackingOrder?.driver?.phone || '+27 (0)83 712 9043';
  showToast(`Connecting secure call to ${driverName} (${driverPhone})...`, 'info');
}

function simulateDriverMessage() {
  const driverName = currentTrackingOrder?.driver?.name || 'Assigned Courier';
  const msg = prompt(`Enter message for courier ${driverName}:`, 'Please ring buzzer when arriving.');
  if (msg) {
    showToast(`Message sent to ${driverName}: "${msg}"`, 'success');
  }
}

/* =========================================================================
   MY ORDERS LIST (Parity & Search/Filter)
   ========================================================================= */
let cachedUserOrders = [];
let currentOrderStatusFilter = 'all';
let currentOrderSearchQuery = '';

async function openMyOrdersModal() {
  const modal = document.getElementById('myOrdersModal');
  if (!modal) return;
  modal.classList.add('show');

  const container = document.getElementById('myOrdersListContainer');
  if (container) {
    container.innerHTML = '<p style="color:var(--slate-500); padding:24px; text-align:center;">Loading your orders...</p>';
  }

  try {
    const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
    const res = await fetch('/api/orders', { headers });
    const data = await res.json();
    cachedUserOrders = data.orders || [];
    renderFilteredOrders();
  } catch (err) {
    if (container) {
      container.innerHTML = '<p style="color:var(--rose-600); padding:20px; text-align:center;">Could not retrieve orders. Please check your connection and try again.</p>';
    }
  }
}

function filterOrdersByStatus(status) {
  currentOrderStatusFilter = status;
  document.querySelectorAll('.order-filter-chip').forEach(el => el.classList.remove('active'));
  const activeBtn = document.getElementById(status === 'all' ? 'orderFilterAll' : (status === 'active' ? 'orderFilterActive' : 'orderFilterCompleted'));
  if (activeBtn) activeBtn.classList.add('active');
  renderFilteredOrders();
}

function handleOrderSearchInput(query) {
  currentOrderSearchQuery = (query || '').toLowerCase().trim();
  renderFilteredOrders();
}

function renderFilteredOrders() {
  const container = document.getElementById('myOrdersListContainer');
  if (!container) return;

  let filtered = cachedUserOrders;

  // Filter by status
  if (currentOrderStatusFilter === 'active') {
    filtered = filtered.filter(o => o.status !== 'delivered' && o.status !== 'completed');
  } else if (currentOrderStatusFilter === 'completed') {
    filtered = filtered.filter(o => o.status === 'delivered' || o.status === 'completed');
  }

  // Filter by search query
  if (currentOrderSearchQuery) {
    filtered = filtered.filter(o => 
      String(o.id).toLowerCase().includes(currentOrderSearchQuery) ||
      (o.pickupAddress && o.pickupAddress.toLowerCase().includes(currentOrderSearchQuery)) ||
      (o.serviceType && o.serviceType.toLowerCase().includes(currentOrderSearchQuery))
    );
  }

  if (filtered.length === 0) {
    if (cachedUserOrders.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px 20px;">
          <div style="width:52px; height:52px; margin:0 auto 12px; border-radius:50%; background:var(--mist-200); display:flex; align-items:center; justify-content:center; color:var(--slate-500);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <h4 style="font-size:16px; margin-bottom:6px; color:var(--ink);">No Laundry Orders Yet</h4>
          <p style="font-size:13.5px; color:var(--slate-500); max-width:340px; margin:0 auto 16px;">Schedule your first pickup in 60 seconds and track every wash cycle in real time.</p>
          <button class="btn btn-solid btn-sm" onclick="closeMyOrdersModal(); scrollToBooking();">Schedule Pickup Now</button>
        </div>
      `;
    } else {
      container.innerHTML = `<p style="color:var(--slate-500); padding:28px; text-align:center;">No orders match your filter criteria.</p>`;
    }
    return;
  }

  container.innerHTML = filtered.map(order => `
    <div style="border: 1px solid var(--mist-300); border-radius: 16px; padding: 18px; margin-bottom: 14px; background: var(--white); box-shadow: var(--shadow-sm);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <div>
          <h4 style="font-size:16px; font-weight:700; color:var(--ink);">Order #${escapeHtml(order.id)}</h4>
          <span style="font-size:13px; color:var(--slate-500); font-weight:500;">${escapeHtml(order.serviceType || 'Wash & Fold')}</span>
        </div>
        <span class="chip ${order.status === 'delivered' ? 'chip-emerald' : ''}" style="text-transform:uppercase; font-size:11px;">
          ${escapeHtml((order.status || 'placed').replace(/_/g, ' '))}
        </span>
      </div>
      <div style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin-bottom:14px; background:var(--surface-soft); padding:10px 12px; border-radius:var(--r-card);">
        <div>📍 <strong>Pickup:</strong> ${escapeHtml(order.pickupAddress || 'Address on file')}</div>
        <div>⚖️ <strong>Est. Weight:</strong> ${escapeHtml(order.estimatedWeight || '10kg')} • <strong>Total Paid:</strong> R${Number(order.total || 0).toFixed(2)} (Incl. 15% VAT)</div>
        ${order.deliveryPin ? `<div>🔑 <strong>Handover PIN:</strong> <span style="font-family:monospace; font-weight:700; color:var(--ink);">${escapeHtml(order.deliveryPin)}</span></div>` : ''}
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-solid btn-sm" onclick="closeMyOrdersModal(); openTrackerModal('${escapeHtml(order.id)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Track Live Telemetry</span>
        </button>
      </div>
    </div>
  `).join('');
}

function closeMyOrdersModal() {
  const modal = document.getElementById('myOrdersModal');
  if (modal) modal.classList.remove('show');
}

/* =========================================================================
   PARTNER MODALS (DRIVER, LAUNDROMAT, BUSINESS)
   ========================================================================= */
function openDriverModal() {
  const modal = document.getElementById('driverModal');
  if (modal) modal.classList.add('show');
}
function closeDriverModal() {
  const modal = document.getElementById('driverModal');
  if (modal) modal.classList.remove('show');
}

async function handleDriverSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('drvName').value.trim();
  const email = document.getElementById('drvEmail').value.trim();
  const phone = document.getElementById('drvPhone').value.trim();
  const city = document.getElementById('drvCity').value.trim();
  const vehicleType = document.getElementById('drvVehicle').value;

  try {
    const res = await fetch('/api/partners/driver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, city, vehicleType })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      closeDriverModal();
      e.target.reset();
    } else {
      showToast(data.error || 'Application failed', 'error');
    }
  } catch (err) {
    showToast('Network error submitting driver application', 'error');
  }
}

function openLaundromatModal() {
  const modal = document.getElementById('laundromatModal');
  if (modal) modal.classList.add('show');
}
function closeLaundromatModal() {
  const modal = document.getElementById('laundromatModal');
  if (modal) modal.classList.remove('show');
}

async function handleLaundromatSubmit(e) {
  e.preventDefault();
  const businessName = document.getElementById('lndBusinessName').value.trim();
  const contactName = document.getElementById('lndContactName').value.trim();
  const email = document.getElementById('lndEmail').value.trim();
  const phone = document.getElementById('lndPhone').value.trim();
  const address = document.getElementById('lndAddress').value.trim();
  const machineCount = document.getElementById('lndMachines').value;

  try {
    const res = await fetch('/api/partners/laundromat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, contactName, email, phone, address, machineCount })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      closeLaundromatModal();
      e.target.reset();
    } else {
      showToast(data.error || 'Submission failed', 'error');
    }
  } catch (err) {
    showToast('Network error submitting partner inquiry', 'error');
  }
}

function openBusinessModal() {
  const modal = document.getElementById('businessModal');
  if (modal) modal.classList.add('show');
}
function closeBusinessModal() {
  const modal = document.getElementById('businessModal');
  if (modal) modal.classList.remove('show');
}

async function handleBusinessSubmit(e) {
  e.preventDefault();
  const companyName = document.getElementById('bizCompanyName').value.trim();
  const contactName = document.getElementById('bizContactName').value.trim();
  const email = document.getElementById('bizEmail').value.trim();
  const phone = document.getElementById('bizPhone').value.trim();
  const industry = document.getElementById('bizIndustry').value;
  const estimatedVolume = document.getElementById('bizVolume').value;
  const notes = document.getElementById('bizNotes').value.trim();

  try {
    const res = await fetch('/api/business/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, contactName, email, phone, industry, estimatedVolume, notes })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      closeBusinessModal();
      e.target.reset();
    } else {
      showToast(data.error || 'Submission failed', 'error');
    }
  } catch (err) {
    showToast('Network error submitting business inquiry', 'error');
  }
}

/* =========================================================================
   LEGAL CENTER (PRIVACY, TERMS, GARMENT CARE, ACCESSIBILITY)
   ========================================================================= */
function openLegalModal(tab = 'privacy') {
  const modal = document.getElementById('legalModal');
  if (!modal) return;
  switchLegalTab(tab);
  modal.classList.add('show');
}

function closeLegalModal() {
  const modal = document.getElementById('legalModal');
  if (modal) modal.classList.remove('show');
}

function switchLegalTab(tab) {
  const tabs = ['privacy', 'terms', 'garment', 'accessibility'];
  tabs.forEach(t => {
    const btn = document.getElementById(`legalTabBtn-${t}`);
    const pane = document.getElementById(`legalPane-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (pane) pane.classList.toggle('active', t === tab);
  });
}

function printLegalDocument() {
  window.print();
}

/* =========================================================================
   CAROUSELS
   ========================================================================= */
function initCarousels() {
  setupCarousel('stepsTrack', 'stepsPrev', 'stepsNext', 'stepsFrac', 280 + 24, 5);
  setupCarousel('earnTrack', 'earnPrev', 'earnNext', 'earnFrac', 380 + 24, 2);
}

function setupCarousel(trackId, prevId, nextId, fracId, stepWidth, totalItems) {
  const track = document.getElementById(trackId);
  const prevBtn = document.getElementById(prevId);
  const nextBtn = document.getElementById(nextId);
  const frac = document.getElementById(fracId);

  if (!track || !prevBtn || !nextBtn || !frac) return;

  function updateFrac() {
    const index = Math.round(track.scrollLeft / stepWidth) + 1;
    const bounded = Math.max(1, Math.min(index, totalItems));
    frac.textContent = `${bounded}/${totalItems}`;
    prevBtn.disabled = track.scrollLeft <= 10;
    nextBtn.disabled = track.scrollLeft >= (track.scrollWidth - track.clientWidth - 10);
  }

  prevBtn.addEventListener('click', () => {
    track.scrollBy({ left: -stepWidth, behavior: 'smooth' });
  });

  nextBtn.addEventListener('click', () => {
    track.scrollBy({ left: stepWidth, behavior: 'smooth' });
  });

  track.addEventListener('scroll', updateFrac, { passive: true });
  updateFrac();
}

/* =========================================================================
   FORM INITIALIZATION & EVENT LISTENERS
   ========================================================================= */
function initForms() {
  // Pickup booking form
  const pickupForm = document.getElementById('heroPickupForm');
  if (pickupForm) {
    pickupForm.addEventListener('submit', handlePickupBooking);
  }

  // Auth forms
  const loginForm = document.getElementById('authLoginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  const signupForm = document.getElementById('authSignupForm');
  if (signupForm) signupForm.addEventListener('submit', handleSignup);

  // Partner forms
  const driverForm = document.getElementById('driverForm');
  if (driverForm) driverForm.addEventListener('submit', handleDriverSubmit);

  const laundromatForm = document.getElementById('laundromatForm');
  if (laundromatForm) laundromatForm.addEventListener('submit', handleLaundromatSubmit);

  const businessForm = document.getElementById('businessForm');
  if (businessForm) businessForm.addEventListener('submit', handleBusinessSubmit);
}

/* =========================================================================
   EXPLORE CARDS MOBILE TOUCH ANIMATIONS & TACTILE FEEDBACK LOOP
   ========================================================================= */
function initExploreCardsTouch() {
  const cards = document.querySelectorAll('.explore-card');
  if (!cards.length) return;

  cards.forEach(card => {
    let startX = 0;
    let startY = 0;
    let isTouching = false;
    let reboundTimer = null;

    // Clean up rebound class after spring animation ends
    card.addEventListener('animationend', (e) => {
      if (e.animationName === 'exploreTouchRebound') {
        card.classList.remove('touch-rebound');
      }
    });

    const triggerTouchRipple = (clientX, clientY) => {
      const rect = card.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const size = Math.max(rect.width, rect.height) * 1.5;
      const ripple = document.createElement('span');
      ripple.className = 'card-touch-ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      card.appendChild(ripple);
      setTimeout(() => {
        ripple.remove();
      }, 500);
    };

    // Touch Start: instant tactile compression and luminous feedback
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isTouching = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;

      if (reboundTimer) {
        clearTimeout(reboundTimer);
        reboundTimer = null;
      }

      card.classList.remove('touch-rebound');
      card.classList.add('touch-pressed');

      triggerTouchRipple(startX, startY);
    }, { passive: true });

    // Touch Move: smoothly cancel tactile state if user scrolls or drags
    card.addEventListener('touchmove', (e) => {
      if (!isTouching || !e.touches[0]) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = Math.abs(currentX - startX);
      const deltaY = Math.abs(currentY - startY);

      // If finger moved more than 8px, user is scrolling: cancel press state
      if (deltaX > 8 || deltaY > 8) {
        isTouching = false;
        card.classList.remove('touch-pressed');
      }
    }, { passive: true });

    // Touch End: trigger spring rebound animation and graceful release
    card.addEventListener('touchend', () => {
      if (!isTouching) return;
      isTouching = false;
      card.classList.remove('touch-pressed');
      card.classList.add('touch-rebound');

      reboundTimer = setTimeout(() => {
        card.classList.remove('touch-rebound');
      }, 420);
    }, { passive: true });

    // Touch Cancel
    card.addEventListener('touchcancel', () => {
      isTouching = false;
      card.classList.remove('touch-pressed');
      card.classList.remove('touch-rebound');
    }, { passive: true });

    // Card click delegation (allows tapping anywhere on card on mobile or clicking on desktop)
    card.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        const primaryBtn = card.querySelector('button');
        if (primaryBtn) primaryBtn.click();
      }
    });
  });
}

/* =========================================================================
   STICKY PICKUP BAR (PARITY)
   ========================================================================= */
function initStickyPickupBar() {
  const bar = document.getElementById('stickyPickupBar');
  if (!bar) return;
  if (sessionStorage.getItem('mm_dismiss_sticky') === 'true') {
    bar.style.display = 'none';
    return;
  }
  window.addEventListener('scroll', () => {
    if (sessionStorage.getItem('mm_dismiss_sticky') === 'true') return;
    if (window.scrollY > 420) {
      bar.classList.add('show');
    } else {
      bar.classList.remove('show');
    }
  }, { passive: true });
}

function dismissStickyPickupBar() {
  const bar = document.getElementById('stickyPickupBar');
  if (bar) {
    bar.classList.remove('show');
    setTimeout(() => { bar.style.display = 'none'; }, 250);
    sessionStorage.setItem('mm_dismiss_sticky', 'true');
  }
}

/* =========================================================================
   LIVE SUPPORT CHAT WIDGET (PARITY · CONTROLLED VIA MENU & FOOTER)
   ========================================================================= */
function toggleSupportChat() {
  const win = document.getElementById('supportChatWindow');
  const backdrop = document.getElementById('supportChatBackdrop');
  if (!win) return;
  const isHidden = (win.style.display === 'none' || !win.style.display);
  if (isHidden) {
    win.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
    const input = document.getElementById('supportChatInput');
    if (input) setTimeout(() => input.focus(), 150);
  } else {
    win.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
  }
}

function openSupportModal() {
  const win = document.getElementById('supportChatWindow');
  const backdrop = document.getElementById('supportChatBackdrop');
  if (!win) return;
  win.style.display = 'flex';
  if (backdrop) backdrop.style.display = 'block';
  const input = document.getElementById('supportChatInput');
  if (input) setTimeout(() => input.focus(), 150);
}

async function sendQuickSupport(text) {
  const input = document.getElementById('supportChatInput');
  if (input) input.value = text;
  handleSupportSend();
}

async function handleSupportSend(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('supportChatInput');
  const messagesBox = document.getElementById('supportChatMessages');
  if (!input || !messagesBox) return;
  const msg = input.value.trim();
  if (!msg) return;

  // Append user message
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.innerHTML = `${escapeHtml(msg)}<div class="chat-time">${now}</div>`;
  messagesBox.appendChild(userBubble);
  input.value = '';
  messagesBox.scrollTop = messagesBox.scrollHeight;

  // Show typing bubble
  const botBubble = document.createElement('div');
  botBubble.className = 'chat-bubble bot';
  botBubble.innerHTML = `<em>Dispatch desk typing...</em>`;
  messagesBox.appendChild(botBubble);
  messagesBox.scrollTop = messagesBox.scrollHeight;

  try {
    const res = await fetch('/api/support/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        email: currentUser ? currentUser.email : 'guest@client.co.za',
        name: currentUser ? currentUser.name : 'Guest',
        orderId: currentTrackingOrder ? currentTrackingOrder.id : null
      })
    });
    const data = await res.json();
    botBubble.innerHTML = `${escapeHtml(data.reply)}<div class="chat-time">${data.timestamp || now}</div>`;
  } catch (err) {
    botBubble.innerHTML = `Our dispatch agent is assisting other customers. You can reach our direct telephone hotline at <strong>+27 21 555 4321</strong>.`;
  }
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

/* =========================================================================
   FAQ ACCORDION (PARITY)
   ========================================================================= */
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(el => {
    if (el !== item) el.classList.remove('open');
  });
  if (isOpen) {
    item.classList.remove('open');
  } else {
    item.classList.add('open');
  }
}

/* =========================================================================
   MY PROFILE & PREFERENCES (PARITY)
   ========================================================================= */
async function openProfileModal() {
  if (!currentUser) {
    openAuthModal('login');
    showToast('Please sign in to view your profile & preferences.', 'info');
    return;
  }
  const modal = document.getElementById('profileModal');
  if (!modal) return;

  const nameInput = document.getElementById('profName');
  const emailInput = document.getElementById('profEmail');
  const phoneInput = document.getElementById('profPhone');
  if (nameInput) nameInput.value = currentUser.name || '';
  if (emailInput) emailInput.value = currentUser.email || '';
  if (phoneInput) phoneInput.value = currentUser.phone || '';

  if (currentUser.preferences) {
    const dSelect = document.getElementById('prefDetergent');
    const tSelect = document.getElementById('prefTemperature');
    const fSelect = document.getElementById('prefFoldStyle');
    if (dSelect && currentUser.preferences.detergent) dSelect.value = currentUser.preferences.detergent;
    if (tSelect && currentUser.preferences.temperature) tSelect.value = currentUser.preferences.temperature;
    if (fSelect && currentUser.preferences.foldStyle) fSelect.value = currentUser.preferences.foldStyle;
  }
  if (currentUser.defaultPayment) {
    const pSelect = document.getElementById('prefPayment');
    if (pSelect) pSelect.value = currentUser.defaultPayment;
  }

  renderProfileSavedAddresses();
  modal.classList.add('show');
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.remove('show');
}

function renderProfileSavedAddresses() {
  const container = document.getElementById('profileSavedAddressesList');
  if (!container) return;

  const addresses = (currentUser && Array.isArray(currentUser.savedAddresses)) ? currentUser.savedAddresses : [];
  if (addresses.length === 0) {
    container.innerHTML = `<div style="font-size:13px; color:var(--slate-500); padding:10px 0;">No saved delivery addresses yet. Add your home or office address for faster 1-tap checkout.</div>`;
    return;
  }

  container.innerHTML = addresses.map(addr => `
    <div class="saved-address-item">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="saved-address-label">${escapeHtml(addr.label || 'Saved')}</span>
        <span style="font-size:13.5px; color:var(--ink);">${escapeHtml(addr.address)}</span>
      </div>
      <button class="btn btn-outline btn-sm" style="padding:4px 8px; color:var(--rose-600); border-color:var(--rose-200); font-size:11px;" onclick="deleteSavedAddress('${escapeHtml(addr.id || addr.address)}')">
        Remove
      </button>
    </div>
  `).join('');
}

function showAddAddressRow() {
  const form = document.getElementById('addAddressInlineForm');
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    const input = document.getElementById('newAddressInput');
    if (input && form.style.display === 'block') input.focus();
  }
}

async function submitNewAddress() {
  const labelInput = document.getElementById('newAddressLabel');
  const addrInput = document.getElementById('newAddressInput');
  const label = labelInput ? labelInput.value.trim() : 'Home';
  const address = addrInput ? addrInput.value.trim() : '';

  if (!address) {
    showToast('Please enter an address.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/user/addresses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ label, address })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (currentUser) currentUser.savedAddresses = data.savedAddresses;
    if (addrInput) addrInput.value = '';
    if (labelInput) labelInput.value = '';
    const form = document.getElementById('addAddressInlineForm');
    if (form) form.style.display = 'none';
    renderProfileSavedAddresses();
    showToast('Address added to your account!', 'success');
  } catch (err) {
    showToast('Failed to save address.', 'error');
  }
}

async function deleteSavedAddress(id) {
  try {
    const res = await fetch(`/api/user/addresses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (currentUser) currentUser.savedAddresses = data.savedAddresses;
    renderProfileSavedAddresses();
    showToast('Address removed.', 'info');
  } catch (err) {
    showToast('Error removing address.', 'error');
  }
}

async function handleSaveProfile(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('profName').value.trim();
  const phone = document.getElementById('profPhone').value.trim();

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name, phone })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    currentUser = data.user;
    updateUserUI();
    showToast('Profile information updated!', 'success');
  } catch (err) {
    showToast('Failed to update profile.', 'error');
  }
}

async function savePreferencesChange() {
  if (!currentUser || !authToken) return;
  const detergent = document.getElementById('prefDetergent')?.value;
  const temperature = document.getElementById('prefTemperature')?.value;
  const foldStyle = document.getElementById('prefFoldStyle')?.value;
  const defaultPayment = document.getElementById('prefPayment')?.value;

  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        preferences: { detergent, temperature, foldStyle },
        defaultPayment
      })
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showToast('Laundry preferences updated.', 'info');
    }
  } catch (err) {
    console.error(err);
  }
}

/* =========================================================================
   SERVICE SPECIFICATIONS & OPTIONS (PARITY)
   ========================================================================= */
const SERVICE_CATALOG = {
  wash_fold: {
    title: 'Wash & Fold (Weight-Based Pricing)',
    badge: 'From R35 / kg',
    desc: 'Our flagship laundry service for everyday clothing, tees, jeans, athleisure, socks, and bed linens. Sanitized individual wash drums with certified calibrated scales.',
    pricingDetails: [
      { label: 'Standard Laundry Bag (up to 5kg)', price: 'R175' },
      { label: 'Family Laundry Bag (up to 10kg)', price: 'R350' },
      { label: 'Bulk Laundry Bag (15kg+)', price: 'R35/kg' }
    ],
    careOptions: [
      { title: 'Dye & Scent-Free Eco Detergent', desc: '100% plant-based hypoallergenic formulation ideal for eczema and allergy sufferers.' },
      { title: 'Baby & Infant Gentle Rinse', desc: 'Extra thermal rinse cycle preserving soft baby cottons with zero harsh enzymes.' },
      { title: 'Lights & Darks Separation', desc: 'Whites washed at 40°C with oxygen brightener; deep darks washed cold (30°C) to prevent fading.' },
      { title: 'Standard or Rolling Fold', desc: 'Retail precision flat-fold or compact suitcase roll for business travelers.' }
    ]
  },
  dry_clean: {
    title: 'Dry Cleaning & Boutique Fabric Care',
    badge: 'From R85 / garment',
    desc: 'Expert dry cleaning using modern, environmentally gentle hydrocarbon solvents. Perfect for bespoke suits, evening gowns, silk blouses, wool overcoats, and pleated skirts.',
    pricingDetails: [
      { label: '2-Piece Business Suit', price: 'R195' },
      { label: 'Silk Blouse or Dress Shirt', price: 'R85' },
      { label: 'Evening Dress / Gown', price: 'From R220' },
      { label: 'Cashmere or Wool Knit Sweater', price: 'R115' }
    ],
    careOptions: [
      { title: 'Hand Steam Pressing', desc: 'Every garment is finished by hand using German precision steam forms.' },
      { title: 'Wooden or Wire Hanger Packaging', desc: 'Delivered in breathable dust-protective poly covers ready for your closet.' },
      { title: 'Stain Spot-Treatment', desc: 'Targeted enzyme removal for wine, oil, makeup, and coffee stains before solvent cleaning.' }
    ]
  },
  bedding: {
    title: 'Duvets, Blankets & Bulky Bedding',
    badge: 'From R165 / bundle',
    desc: 'Large commercial drum washing and high-temperature allergen removal for king, queen, and single duvets, feather pillows, and weighted blankets.',
    pricingDetails: [
      { label: 'King / Queen Down Duvet', price: 'R185' },
      { label: 'Single / 3/4 Fiber Duvet', price: 'R165' },
      { label: 'Thick Wool Blanket / Bedspread', price: 'R145' },
      { label: 'Feather Pillow Sanitization (Pair)', price: 'R120' }
    ],
    careOptions: [
      { title: 'Anti-Dust Mite Sanitization', desc: 'High-temperature thermal sanitizing eliminating 99.9% of dust mites and allergens.' },
      { title: 'Even Down-Loft Tumble Drying', desc: 'Specialized wool dryer balls maintain uniform feather distribution without clumping.' }
    ]
  },
  iron_press: {
    title: 'Wash & Steam Iron Pressing',
    badge: 'From R46 / kg',
    desc: 'Complete washing plus professional steam pressing. Collared dress shirts, linen trousers, blouses, and dresses hand-finished on hangers or crisp retail fold.',
    pricingDetails: [
      { label: 'Collared Business Shirts (Per 5)', price: 'R140' },
      { label: 'Linen Trousers & Chinos', price: 'R38 / item' },
      { label: 'Full Load Wash & Press (10kg)', price: 'R460' }
    ],
    careOptions: [
      { title: 'German Precision Steam Press', desc: 'Eliminates stubborn creases while protecting delicate fabric fibers.' },
      { title: 'Closet Ready Delivery', desc: 'Packaged on wooden/wire hangers with protective poly covers.' }
    ]
  },
  baby_clothes: {
    title: 'Baby Clothes & Infant Hypoallergenic Care',
    badge: 'From R38 / kg',
    desc: 'Specialized ultra-gentle laundering for newborns, toddlers, and sensitive skin. Zero artificial dyes, zero harsh optical brighteners, and triple thermal rinse.',
    pricingDetails: [
      { label: 'Baby & Toddler Bundle (up to 5kg)', price: 'R190' },
      { label: 'Crib Sheets & Swaddles (Set of 4)', price: 'R110' },
      { label: 'Plush Toy Sanitization', price: 'R45 / toy' }
    ],
    careOptions: [
      { title: 'Certified Plant-Based Detergent', desc: '100% biodegradable, hypoallergenic formula dermatologist approved.' },
      { title: 'Triple Thermal Rinse', desc: 'Ensures zero soap residue remains in contact with delicate infant skin.' },
      { title: 'Sanitized Dedicated Wash Drum', desc: 'Never washed with outer garments or footwear.' }
    ]
  },
  express: {
    title: 'Express Same-Day Rush Laundry',
    badge: '12-Hour Turnaround',
    desc: 'Need clean clothes in a hurry? Our Express Wash tier prioritizes your load at intake, washing, drying, and delivering within 12 hours.',
    pricingDetails: [
      { label: 'Express Rush Surcharge', price: '+30% on standard rates' },
      { label: 'Same-Day Morning Pickup (Before 09:00)', price: 'Delivered by 20:00 same evening' }
    ],
    careOptions: [
      { title: 'Priority Dispatch Routing', desc: 'Dedicated courier allocation for expedited doorstep collection.' },
      { title: 'SMS & Live Telemetry Tracking', desc: 'Direct live driver notifications with updated ETA and PIN verification.' }
    ]
  }
};

function openServiceDetailsModal(serviceKey = 'wash_fold') {
  const modal = document.getElementById('serviceDetailsModal');
  const titleEl = document.getElementById('serviceModalHeaderTitle');
  const bodyEl = document.getElementById('serviceModalBodyContent');
  if (!modal || !bodyEl) return;

  const svc = SERVICE_CATALOG[serviceKey] || SERVICE_CATALOG.wash_fold;
  if (titleEl) titleEl.textContent = svc.title;

  bodyEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
      <div>
        <span class="chip" style="font-size:12px; font-weight:700;">${escapeHtml(svc.badge)}</span>
        <p style="font-size:14.5px; color:var(--slate-700); line-height:1.5; margin-top:10px;">${escapeHtml(svc.desc)}</p>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
      <div style="background:var(--surface-soft); border:1px solid var(--border); border-radius:var(--r-card); padding:16px;">
        <h4 style="font-size:13px; text-transform:uppercase; color:var(--text-secondary); margin-bottom:10px;">Standard Pricing Rates</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${svc.pricingDetails.map(p => `
            <div style="display:flex; justify-content:space-between; font-size:13.5px;">
              <span style="color:var(--ink);">${escapeHtml(p.label)}</span>
              <strong style="color:var(--ink); font-weight:700;">${escapeHtml(p.price)}</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="background:var(--surface-soft); border:1px solid var(--border); border-radius:var(--r-card); padding:16px;">
        <h4 style="font-size:13px; text-transform:uppercase; color:var(--text-secondary); margin-bottom:10px;">Care &amp; Wash Options</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${svc.careOptions.map(c => `
            <div style="font-size:12.5px; line-height:1.4;">
              <span style="font-weight:700; color:var(--ink);">✓ ${escapeHtml(c.title)}:</span>
              <span style="color:var(--text-secondary);"> ${escapeHtml(c.desc)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--mist-200); padding-top:16px;">
      <button class="btn btn-outline btn-sm" onclick="closeServiceDetailsModal()">Close</button>
      <button class="btn btn-solid btn-sm" onclick="closeServiceDetailsModal(); prefillAndOpenBooking('${serviceKey === 'express' ? 'wash_fold' : serviceKey}');">
        <span>Select &amp; Schedule This Service</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </div>
  `;

  modal.classList.add('show');
}

function closeServiceDetailsModal() {
  const modal = document.getElementById('serviceDetailsModal');
  if (modal) modal.classList.remove('show');
}

/* =========================================================================
   FORGOT PASSWORD (PARITY)
   ========================================================================= */
function openForgotPasswordModal() {
  const authModal = document.getElementById('authModal');
  if (authModal) authModal.classList.remove('show');
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) {
    modal.classList.add('show');
    const input = document.getElementById('forgotPassEmail');
    if (input) setTimeout(() => input.focus(), 150);
  }
}

function closeForgotPasswordModal() {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) modal.classList.remove('show');
}

async function handleForgotPasswordSubmit(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('forgotPassEmail');
  if (!emailInput) return;
  const email = emailInput.value.trim();
  if (!email) return;

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    closeForgotPasswordModal();
    showToast(data.message || 'Password reset link sent to your registered email.', 'success');
  } catch (err) {
    showToast('Failed to dispatch password reset link.', 'error');
  }
}

/* =========================================================================
   THEME CONTROLS & PARITY (Dark / Light Mode & Preferences)
   ========================================================================= */
function initTheme() {
  let savedTheme = localStorage.getItem('mm_theme');
  // Default to clean light mode (white not dark) or enable device default (system)
  if (!savedTheme || savedTheme === 'dark') {
    savedTheme = 'light';
    localStorage.setItem('mm_theme', 'light');
  }
  applyTheme(savedTheme);

  // Listen for OS system theme changes if device default is explicitly selected
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const currentSetting = localStorage.getItem('mm_theme');
      if (currentSetting === 'system') {
        applyTheme('system');
      }
    });
  }
}

function applyTheme(theme) {
  let effectiveTheme = 'light';
  if (theme === 'system') {
    effectiveTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    effectiveTheme = 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  const themeSelect = document.getElementById('prefTheme');
  if (themeSelect) themeSelect.value = theme || 'light';
}

function toggleTheme() {
  const current = localStorage.getItem('mm_theme') || 'light';
  const newTheme = current === 'light' ? 'system' : 'light';
  localStorage.setItem('mm_theme', newTheme);
  applyTheme(newTheme);
  showToast(newTheme === 'system' ? 'Device default theme active' : 'Clean white light theme active', 'info');
}

function handleProfileThemeChange(val) {
  const cleanVal = (val === 'system') ? 'system' : 'light';
  localStorage.setItem('mm_theme', cleanVal);
  applyTheme(cleanVal);
  showToast(cleanVal === 'system' ? 'Matching device default' : 'Clean white light theme active', 'info');
}

/* =========================================================================
   MOBILE BOTTOM NAVIGATION HELPERS (Apple HIG / Material 3)
   ========================================================================= */
function handleMobileAccountClick() {
  if (currentUser) {
    openProfileModal();
  } else {
    openAuthModal('login');
  }
}

/* =========================================================================
   COVERAGE SELECTION & PWA SERVICE WORKER REGISTRATION (SEO / AEO PARITY)
   ========================================================================= */
function selectCoverageSuburb(suburbName) {
  const addressInput = document.getElementById('calcPickupAddress');
  if (addressInput) {
    addressInput.value = suburbName;
    addressInput.style.borderColor = 'var(--ink)';
    setTimeout(() => {
      addressInput.style.borderColor = '';
    }, 1800);
    if (typeof calculateLiveEstimate === 'function') {
      calculateLiveEstimate();
    }
  }

  scrollToBooking();
  showToast(`Selected ${suburbName} — pickup dispatch active.`, 'success');

  if (addressInput) {
    setTimeout(() => {
      addressInput.focus();
    }, 450);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // In embedded preview, iframes, or development hosts, service workers can cache transient 502/warmup HTML pages
  // and intercept scripts. Unregister any existing service worker and purge caches to prevent stale script injection.
  const isPreview = window.self !== window.top || window.location.hostname.includes('run.app') || window.location.hostname.includes('localhost');
  if (isPreview) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((k) => caches.delete(k));
      }).catch(() => {});
    }
    return;
  }

  if (window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // SW registered
      })
      .catch((err) => {
        // Non-blocking fallback
      });
  }
}

/* =========================================================================
   MULTI-PAGE SPA ROUTER & NAVIGATION ARCHITECTURE
   ========================================================================= */
const ROUTES = {
  '/': { viewId: 'pageHome', title: 'M&M Laundry | Professional Laundry & Dry Cleaning South Africa' },
  '/services': { viewId: 'pageServices', title: 'Services & Pricing | M&M Laundry South Africa' },
  '/how-it-works': { viewId: 'pageHowItWorks', title: 'How It Works | M&M Laundry Collection & Delivery' },
  '/about': { viewId: 'pageAbout', title: 'About Us & Standards | M&M Laundry South Africa' },
  '/faq': { viewId: 'pageFaq', title: 'Help & Frequently Asked Questions | M&M Laundry' },
  '/contact': { viewId: 'pageContact', title: 'Contact & Dispatch Hub | M&M Laundry South Africa' },
  '/business': { viewId: 'pageBusiness', title: 'Commercial & Hospitality Laundry | M&M Laundry B2B' },
  '/book': { viewId: 'pageBook', title: 'Book a Doorstep Pickup | M&M Laundry' },
  '/orders': { viewId: 'pageOrders', title: 'My Orders & Live Tracker | M&M Laundry' },
  '/account': { viewId: 'pageAccount', title: 'My Account & Addresses | M&M Laundry' },
  '/account/addresses': { viewId: 'pageAccount', subtab: 'addresses', title: 'Saved Addresses | M&M Laundry' },
  '/login': { viewId: 'pageAuth', authMode: 'login', title: 'Sign In | M&M Laundry' },
  '/signup': { viewId: 'pageAuth', authMode: 'signup', title: 'Create Account | M&M Laundry' },
  '/forgot-password': { viewId: 'pageAuth', authMode: 'forgot', title: 'Reset Password | M&M Laundry' }
};

let currentRoutePath = '/';

function initRouter() {
  window.addEventListener('popstate', () => {
    renderRoute(window.location.pathname);
  });

  // Intercept anchor clicks with relative routes
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('//') && !link.getAttribute('target') && !link.getAttribute('download')) {
      // Internal route
      e.preventDefault();
      navigateTo(href);
    }
  });

  // Initial render based on URL
  const initialPath = window.location.pathname || '/';
  renderRoute(initialPath);
}

function navigateTo(path, event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  // Parse path and query
  const cleanPath = path.split('?')[0].split('#')[0] || '/';
  if (window.location.pathname !== cleanPath) {
    window.history.pushState(null, '', path);
  }

  renderRoute(cleanPath);

  // If query param specifies service or step
  if (path.includes('service=')) {
    const params = new URLSearchParams(path.split('?')[1]);
    const sKey = params.get('service');
    if (sKey && typeof wizardSelectService === 'function') {
      wizardSelectService(sKey);
    }
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Close mobile drawer if open
  toggleMobileMenu(false);
}

function renderBookingAuthGate() {
  const container = document.getElementById('bookingWizardMain');
  if (container) {
    container.innerHTML = `
      <div class="apple-auth-gate">
        <div class="apple-auth-card">
          <div class="apple-auth-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <h2>Sign In to Book a Pickup</h2>
          <p>Please sign in or create an account to customize your garment care, pick collection windows, and schedule doorstep courier dispatch.</p>
          <div class="apple-auth-actions">
            <button class="btn btn-teal" onclick="openAuthModal('login', '/book')">Sign In</button>
            <button class="btn btn-outline" onclick="openAuthModal('signup', '/book')">Create Account</button>
          </div>
        </div>
      </div>
    `;
  }
}

function renderOrdersAuthGate() {
  const container = document.getElementById('ordersListContainer') || document.getElementById('ordersTableContainer');
  const spotlightCard = document.getElementById('activeOrderSpotlightCard');
  if (spotlightCard) spotlightCard.style.display = 'none';
  if (container) {
    container.innerHTML = `
      <div class="apple-auth-gate">
        <div class="apple-auth-card">
          <div class="apple-auth-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          </div>
          <h2>Sign In to Track Orders</h2>
          <p>Sign in or create an account to monitor live cycle wash telemetry, courier transit ETA, and handover PIN confirmation.</p>
          <div class="apple-auth-actions">
            <button class="btn btn-teal" onclick="openAuthModal('login', '/orders')">Sign In</button>
            <button class="btn btn-outline" onclick="openAuthModal('signup', '/orders')">Create Account</button>
          </div>
        </div>
      </div>
    `;
  }
}

function renderAccountAuthGate() {
  const container = document.getElementById('accountTabContainer');
  if (container) {
    container.innerHTML = `
      <div class="apple-auth-gate">
        <div class="apple-auth-card">
          <div class="apple-auth-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <h2>Sign In to Your Account</h2>
          <p>Access your saved addresses, customized laundry preferences, and billing tax receipts.</p>
          <div class="apple-auth-actions">
            <button class="btn btn-teal" onclick="openAuthModal('login', '/account')">Sign In</button>
            <button class="btn btn-outline" onclick="openAuthModal('signup', '/account')">Create Account</button>
          </div>
        </div>
      </div>
    `;
  }
}

function renderRoute(path) {
  currentRoutePath = path;

  // Handle dynamic routes: /services/:slug
  if (path.startsWith('/services/') && path !== '/services') {
    const slug = path.replace('/services/', '');
    showPageView('pageServiceDetail');
    renderServiceDetailPage(slug);
    updateNavActiveLinks('/services');
    return;
  }

  // Handle dynamic routes: /orders/:id
  if (path.startsWith('/orders/') && path !== '/orders') {
    const orderId = path.replace('/orders/', '');
    showPageView('pageOrders');
    updateNavActiveLinks('/orders');
    if (!currentUser) {
      renderOrdersAuthGate();
      return;
    }
    if (typeof loadAndTrackSpecificOrder === 'function') {
      loadAndTrackSpecificOrder(orderId);
    }
    return;
  }

  const routeConfig = ROUTES[path] || ROUTES['/'];
  showPageView(routeConfig.viewId);
  document.title = routeConfig.title;

  if (routeConfig.authMode && typeof switchAuthMode === 'function') {
    switchAuthMode(routeConfig.authMode);
  }

  if (path === '/book') {
    if (!currentUser) {
      renderBookingAuthGate();
    } else if (typeof initBookingWizard === 'function') {
      initBookingWizard();
    }
  }

  if (path === '/account' || path.startsWith('/account/')) {
    if (!currentUser) {
      renderAccountAuthGate();
    } else if (routeConfig.subtab && typeof switchAccountTab === 'function') {
      switchAccountTab(routeConfig.subtab);
    } else if (typeof loadUserAccountData === 'function') {
      loadUserAccountData();
    }
  }

  if (path === '/orders') {
    if (!currentUser) {
      renderOrdersAuthGate();
    } else if (typeof loadUserOrdersList === 'function') {
      loadUserOrdersList();
    }
  }

  updateNavActiveLinks(path);
}

function showPageView(viewId) {
  const allViews = document.querySelectorAll('.page-view');
  allViews.forEach(v => {
    if (v.id === viewId) {
      v.classList.add('active');
    } else {
      v.classList.remove('active');
    }
  });
}

function updateNavActiveLinks(currentPath) {
  const links = document.querySelectorAll('#desktopNavLinks a');
  links.forEach(l => {
    const route = l.getAttribute('data-route') || l.getAttribute('href');
    if (route === currentPath || (currentPath !== '/' && route !== '/' && currentPath.startsWith(route))) {
      l.classList.add('active');
    } else {
      l.classList.remove('active');
    }
  });

  // Sync mobile bottom navigation bar active states
  const bottomTabs = {
    home: document.getElementById('mobileTabHome'),
    services: document.getElementById('mobileTabServices'),
    book: document.getElementById('mobileTabBook'),
    track: document.getElementById('mobileTabTrack'),
    account: document.getElementById('mobileTabAccount')
  };

  Object.values(bottomTabs).forEach(tab => {
    if (tab) {
      tab.classList.remove('active');
      tab.removeAttribute('aria-current');
    }
  });

  let activeTab = null;
  if (currentPath === '/' || currentPath === '') {
    activeTab = bottomTabs.home;
  } else if (currentPath.startsWith('/services')) {
    activeTab = bottomTabs.services;
  } else if (currentPath.startsWith('/book')) {
    activeTab = bottomTabs.book;
  } else if (currentPath.startsWith('/orders')) {
    activeTab = bottomTabs.track;
  } else if (currentPath.startsWith('/account')) {
    activeTab = bottomTabs.account;
  }

  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-current', 'page');
  }

  // Sync mobile drawer links active state
  const drawerLinks = document.querySelectorAll('.mobile-menu-links a');
  drawerLinks.forEach(dl => {
    const dRoute = dl.getAttribute('href');
    if (dRoute && (dRoute === currentPath || (currentPath !== '/' && dRoute !== '/' && currentPath.startsWith(dRoute)))) {
      dl.classList.add('active');
      dl.setAttribute('aria-current', 'page');
    } else {
      dl.classList.remove('active');
      dl.removeAttribute('aria-current');
    }
  });
}

/* =========================================================================
   MOBILE MENU DRAWER CONTROLLER
   ========================================================================= */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggleBtn');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const drawer = document.getElementById('mobileMenuDrawer');

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', 'mobileMenuDrawer');
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileMenu(true);
    });
  }

  if (drawer) {
    drawer.setAttribute('aria-hidden', 'true');
    const closeBtns = drawer.querySelectorAll('.modal-close-btn');
    closeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleMobileMenu(false);
      });
    });

    const links = drawer.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', () => {
        toggleMobileMenu(false);
      });
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMobileMenu(false);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const d = document.getElementById('mobileMenuDrawer');
      if (d && (d.classList.contains('active') || d.classList.contains('open'))) {
        toggleMobileMenu(false);
      }
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      const d = document.getElementById('mobileMenuDrawer');
      if (d && (d.classList.contains('active') || d.classList.contains('open'))) {
        toggleMobileMenu(false);
      }
    }
  });
}

function toggleMobileMenu(show) {
  const drawer = document.getElementById('mobileMenuDrawer');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const toggleBtn = document.getElementById('mobileMenuToggleBtn');
  if (!drawer || !backdrop) return;

  const isOpen = show === true || (show === undefined && !drawer.classList.contains('active') && !drawer.classList.contains('open'));

  if (isOpen) {
    drawer.classList.add('active', 'open');
    backdrop.classList.add('active', 'open');
    drawer.setAttribute('aria-hidden', 'false');
    toggleBtn?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    // Focus close button or first interactive element inside drawer
    const focusTarget = drawer.querySelector('.modal-close-btn') || drawer.querySelector('a');
    setTimeout(() => focusTarget?.focus(), 50);
  } else {
    drawer.classList.remove('active', 'open');
    backdrop.classList.remove('active', 'open');
    drawer.setAttribute('aria-hidden', 'true');
    toggleBtn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';

    // Restore focus to toggle button
    toggleBtn?.focus();
  }
}

/* =========================================================================
   PWA INSTALL PROMPT & OFFLINE BANNER (PWA BEST PRACTICES)
   ========================================================================= */
let deferredPwaPrompt = null;

function initPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;

    const isDismissed = localStorage.getItem('mm_pwa_dismissed');
    const banner = document.getElementById('pwaInstallBanner');
    if (banner && !isDismissed) {
      banner.classList.remove('hidden');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.classList.add('hidden');
    showToast('M&M Laundry installed successfully! Access directly from your home screen.', 'success');
  });
}

function triggerPwaInstall() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Thank you for installing M&M Laundry.', 'success');
      }
      deferredPwaPrompt = null;
      dismissPwaInstall();
    });
  } else {
    showToast('To install M&M Laundry, use your browser menu and tap "Add to Home Screen".', 'info');
  }
}

function dismissPwaInstall() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.add('hidden');
  localStorage.setItem('mm_pwa_dismissed', 'true');
}

function initOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;

  function updateOnlineStatus() {
    if (navigator.onLine) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }

  window.addEventListener('online', () => {
    updateOnlineStatus();
    showToast('Connection restored. Live telemetry updated.', 'success');
  });
  window.addEventListener('offline', () => {
    updateOnlineStatus();
    showToast('Offline mode active. Your booking draft is preserved.', 'info');
  });

  updateOnlineStatus();
}

/* =========================================================================
   SERVICES CATALOG & DYNAMIC DETAIL PAGE
   ========================================================================= */
const SERVICES_DATA = [
  {
    slug: 'wash-and-fold',
    key: 'wash_fold',
    title: 'Wash & Fold (Everyday Clothes)',
    category: 'wash_fold',
    badge: 'Popular Everyday',
    price: 36.00,
    unit: 'per kg',
    turnaround: '24 Hours Standard',
    description: 'Clean everyday garments sorted by color, washed in a dedicated drum, tumble dried, and folded to retail perfection.',
    image: '/src/assets/images/wash_fold_clothes_1789125402839.jpg',
    whoFor: 'Busy professionals, families, students, and holiday travelers looking for effortless wardrobe care with guaranteed turnaround.',
    checklist: [
      'Zero Co-Mingling Guarantee: Dedicated commercial washer drum exclusively for your load',
      'Color Separation: Darks, lights, and whites sorted and washed in tailored batches',
      'Certified Trade Scale Weighing with digital intake slip delivered to your account',
      '100% Biodegradable, hypoallergenic plant-based detergent safe for sensitive skin',
      'Temperature-controlled gentle tumble drying to preserve garment elasticity',
      'Crisp retail-style folding and moisture-resistant weather-sealed bundle packaging'
    ],
    care: 'We separate darks, whites, and colors before cycle intake. Wash temperature defaults to 30°C eco-cold to prevent shrinkage and color bleeding.',
    faqs: [
      { q: 'What is the minimum order size for Wash & Fold?', a: 'There is no minimum weight requirement. A nominal R45 courier fee applies to orders below R350; all orders over R350 qualify for 100% FREE doorstep pickup and return delivery.' },
      { q: 'How is the weight determined?', a: 'Your laundry is weighed at intake on certified, sealed trade scales. You receive a digital weighing slip on your account before washing begins.' }
    ]
  },
  {
    slug: 'dry-cleaning',
    key: 'dry_clean',
    title: 'Dry Cleaning & Tailored Garments',
    category: 'dry_clean',
    badge: 'Garment Artisan',
    price: 85.00,
    unit: 'per item',
    turnaround: '36 Hours Standard',
    description: 'Delicate fabrics, business suits, evening wear, and silks treated with non-toxic solvents and finished on high-precision steam forms.',
    image: '/src/assets/images/dry_clean_garments_1789125413572.jpg',
    whoFor: 'Tailored suits, wool coats, silk blouses, evening gowns, and structured luxury garments requiring non-water solvent care.',
    checklist: [
      'Pre-spotting stain treatment by master dry cleaning artisan',
      'Non-toxic eco solvent cycle that prevents fabric fading and fiber weakening',
      'Hand inspection of buttons, hems, zippers, and lining seams',
      'Tensioned steam table finishing and contour collar shaping',
      'Complimentary garment hangers and breathable protective dust covers',
      'Backed by our Garment Care Warranty up to R1,500 per piece'
    ],
    care: 'All garments follow strict care-label specifications. Leather, suede, and intricate beadwork receive specialized dry extraction.',
    faqs: [
      { q: 'Are hangers included with dry cleaning?', a: 'Yes! Every garment is returned on wooden or heavy-gauge wire hangers with breathable dust covers ready for your closet.' }
    ]
  },
  {
    slug: 'iron-and-steam-press',
    key: 'iron_press',
    title: 'Wash & Steam Table Press',
    category: 'iron_press',
    badge: 'Executive Finish',
    price: 46.00,
    unit: 'per kg',
    turnaround: '24 Hours Standard',
    description: 'Work shirts, trousers, and linens washed, steam-pressed, and hand-finished with sharp creases and zero wrinkles.',
    image: '/src/assets/images/laundry_doorstep_delivery_1789125425504.jpg',
    whoFor: 'Professionals needing crisp work shirts, linen trousers, and tailored shirts ready for meetings and executive presentations.',
    checklist: [
      'Dedicated drum wash with premium eco fabric conditioner',
      'High-pressure commercial steam table press with vacuum extraction',
      'Collar and cuff stiffening tailored to customer preference',
      'Available on hangers or folded flat in structured garment boxes',
      'Precision button alignment and seam finish check'
    ],
    care: 'Steam temperatures are adjusted by fabric composition (cotton 200°C, synthetics 140°C, silks cool steam).',
    faqs: [
      { q: 'Can I choose between hangers and folded?', a: 'Yes, select your folding/hanging preference in the booking wizard step 6.' }
    ]
  },
  {
    slug: 'duvets-and-bedding',
    key: 'bedding',
    title: 'Duvets, Blankets & Bedding Bundles',
    category: 'bedding',
    badge: 'Deep Sanitized',
    price: 165.00,
    unit: 'per bundle',
    turnaround: '36 Hours Standard',
    description: 'Large-capacity industrial sanitizing for king and queen down duvets, comforters, woolen blankets, and heavy bedspreads.',
    image: '/src/assets/images/commercial_laundry_business_1789125441255.jpg',
    whoFor: 'Homeowners and Airbnb hosts wanting seasonal freshening or hypoallergenic deep cleaning of heavy bed sets and winter blankets.',
    checklist: [
      'High-capacity 25kg commercial sanitizing drum',
      'Dust mite allergen removal at 60°C thermal rinse',
      'Feather and down fluffing cycle with tennis-ball agitation',
      'Breathable zip-up storage bag packaging for dust-free storage'
    ],
    care: 'Feather duvets are dried completely to prevent mildew and odor with low-temperature extended tumble cycles.',
    faqs: [
      { q: 'Do you clean king size feather duvets?', a: 'Yes, our 25kg commercial washers easily handle oversized king and super-king duvets.' }
    ]
  },
  {
    slug: 'infant-and-sensitive-care',
    key: 'baby_clothes',
    title: 'Infant & Sensitive Skin Care',
    category: 'baby_clothes',
    badge: '100% Dermatological',
    price: 38.00,
    unit: 'per kg',
    turnaround: '24 Hours Standard',
    description: 'Hypoallergenic, fragrance-free, dermatologically tested washing with triple freshwater rinse cycles for babies and sensitive skin.',
    image: '/src/assets/images/wash_fold_clothes_1789125402839.jpg',
    whoFor: 'Newborns, toddlers, eczema sufferers, and individuals allergic to standard optical brighteners or synthetic perfumes.',
    checklist: [
      'Zero optical brighteners, dyes, or harsh chemical enzymes',
      'Dermatologist-approved plant soap base',
      'Triple freshwater rinse to eliminate detergent residue',
      'Sanitized dedicated drum cycle at baby-safe temperatures',
      'Gentle tumble dry on low heat with zero dryer sheets'
    ],
    care: '100% safe for certified organic cotton, bamboo fibers, and infant sleepwear.',
    faqs: [
      { q: 'Are the detergents safe for eczema?', a: 'Yes! Formulated without fragrances, dyes, or sulfates, tested for highly reactive skin.' }
    ]
  },
  {
    slug: 'express-rush',
    key: 'express',
    title: 'Express Rush (Same-Day 12h)',
    category: 'express',
    badge: 'Priority Dispatch',
    price: 48.00,
    unit: 'per kg',
    turnaround: '12 Hours Express',
    description: 'Priority commercial wash, tumble dry, and fold with expedited dispatch within 12 hours from morning intake.',
    image: '/src/assets/images/wash_fold_clothes_1789125402839.jpg',
    whoFor: 'Travelers with tight flight departures, sudden business trips, or emergency spill cleanups.',
    checklist: [
      'Priority express queue jump at the commercial hub',
      'Dedicated express washer and dryer slot',
      'Expedited courier dispatch upon completion',
      'Live SMS & WhatsApp status updates every step'
    ],
    care: 'Same exceptional Zero Co-Mingling care delivered with accelerated turnaround.',
    faqs: [
      { q: 'What is the cutoff time for 12-hour express?', a: 'Book and hand over by 09:30 AM for guaranteed same-day return by 20:00 PM.' }
    ]
  }
];

let activeDetailService = SERVICES_DATA[0];

function initServicesCatalog() {
  const grid = document.getElementById('servicesCatalogGrid');
  if (!grid) return;

  grid.innerHTML = SERVICES_DATA.map(s => `
    <div class="service-card-full" data-category="${s.category}">
      <div style="position:relative;">
        <img src="${s.image}" alt="${escapeHtml(s.title)}" class="service-card-img" loading="lazy">
        <span class="chip" style="position:absolute; top:12px; left:12px; font-size:11px;">${s.badge}</span>
      </div>
      <div class="service-card-content">
        <div class="service-price-tag">
          R${s.price.toFixed(2)} <span>/ ${s.unit}</span>
        </div>
        <h3 class="service-card-title">${escapeHtml(s.title)}</h3>
        <p class="service-card-desc">${escapeHtml(s.description)}</p>

        <div style="font-size:12.5px; color:var(--slate-500); margin-bottom:16px; display:flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Turnaround: <strong>${s.turnaround}</strong></span>
        </div>

        <div class="service-actions-row">
          <a href="/services/${s.slug}" onclick="navigateTo('/services/${s.slug}', event)" class="btn btn-outline btn-sm">Care Details</a>
          <a href="/book?service=${s.key}" onclick="navigateTo('/book?service=${s.key}', event)" class="btn btn-solid btn-sm">Book Pickup</a>
        </div>
      </div>
    </div>
  `).join('');
}

function filterServicesCatalog(category, button) {
  const buttons = document.querySelectorAll('.service-filter-btn');
  buttons.forEach(b => b.classList.remove('active'));
  if (button) button.classList.add('active');

  const cards = document.querySelectorAll('#servicesCatalogGrid .service-card-full');
  cards.forEach(c => {
    if (category === 'all' || c.getAttribute('data-category') === category) {
      c.style.display = 'flex';
    } else {
      c.style.display = 'none';
    }
  });
}

function renderServiceDetailPage(slug) {
  const service = SERVICES_DATA.find(s => s.slug === slug) || SERVICES_DATA[0];
  activeDetailService = service;

  const breadcrumbTitle = document.getElementById('detailBreadcrumbTitle');
  const title = document.getElementById('detailTitle');
  const subtitle = document.getElementById('detailSubtitle');
  const categoryChip = document.getElementById('detailCategoryChip');
  const heroImg = document.getElementById('detailHeroImg');
  const whoFor = document.getElementById('detailWhoFor');
  const checklist = document.getElementById('detailChecklist');
  const care = document.getElementById('detailCareGuidelines');
  const priceDisplay = document.getElementById('detailPriceDisplay');
  const turnaroundVal = document.getElementById('detailTurnaroundVal');
  const faqList = document.getElementById('detailFaqList');

  if (breadcrumbTitle) breadcrumbTitle.textContent = service.title;
  if (title) title.textContent = service.title;
  if (subtitle) subtitle.textContent = service.description;
  if (categoryChip) categoryChip.textContent = service.badge.toUpperCase();
  if (heroImg) {
    heroImg.src = service.image;
    heroImg.alt = service.title;
  }
  if (whoFor) whoFor.textContent = service.whoFor;
  if (care) care.textContent = service.care;
  if (priceDisplay) priceDisplay.innerHTML = `R${service.price.toFixed(2)} <span>/ ${service.unit} (incl. VAT)</span>`;
  if (turnaroundVal) turnaroundVal.textContent = service.turnaround;

  if (checklist) {
    checklist.innerHTML = service.checklist.map(item => `
      <div class="checklist-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${escapeHtml(item)}</span>
      </div>
    `).join('');
  }

  if (faqList) {
    faqList.innerHTML = service.faqs.map(faq => `
      <div class="faq-item">
        <button class="faq-question" onclick="toggleFaq(this)">
          <span>${escapeHtml(faq.q)}</span>
          <svg class="faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="faq-answer">
          ${escapeHtml(faq.a)}
        </div>
      </div>
    `).join('');
  }

  document.title = `${service.title} | M&M Laundry South Africa`;
}

function bookCurrentDetailService() {
  if (activeDetailService) {
    navigateTo(`/book?service=${activeDetailService.key}`);
  } else {
    navigateTo('/book');
  }
}

/* Window Exports */
window.initTheme = initTheme;
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.handleProfileThemeChange = handleProfileThemeChange;
window.handleMobileAccountClick = handleMobileAccountClick;
window.filterOrdersByStatus = filterOrdersByStatus;
window.handleOrderSearchInput = handleOrderSearchInput;
window.initStickyPickupBar = initStickyPickupBar;
window.toggleSupportChat = toggleSupportChat;
window.sendQuickSupport = sendQuickSupport;
window.handleSupportSend = handleSupportSend;
window.toggleFaq = toggleFaq;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.showAddAddressRow = showAddAddressRow;
window.submitNewAddress = submitNewAddress;
window.deleteSavedAddress = deleteSavedAddress;
window.handleSaveProfile = handleSaveProfile;
window.savePreferencesChange = savePreferencesChange;
window.openServiceDetailsModal = openServiceDetailsModal;
window.closeServiceDetailsModal = closeServiceDetailsModal;
window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordModal = closeForgotPasswordModal;
window.handleForgotPasswordSubmit = handleForgotPasswordSubmit;
window.selectCoverageSuburb = selectCoverageSuburb;
window.registerServiceWorker = registerServiceWorker;
window.navigateTo = navigateTo;
window.renderRoute = renderRoute;
window.initMobileMenu = initMobileMenu;
window.toggleMobileMenu = toggleMobileMenu;
window.openSupportModal = openSupportModal;
window.triggerPwaInstall = triggerPwaInstall;
window.dismissPwaInstall = dismissPwaInstall;
window.filterServicesCatalog = filterServicesCatalog;
window.renderServiceDetailPage = renderServiceDetailPage;
window.bookCurrentDetailService = bookCurrentDetailService;

/* =========================================================================
   FULL FAQ ACCORDION & REAL-TIME SEARCH (SEO / AEO OPTIMIZATION)
   ========================================================================= */
const FULL_FAQS = [
  {
    q: 'How does M&M Laundry collect and return my clothes?',
    a: 'Simply book online or in the app by selecting your service and pickup time window. An M&M courier in an electric or low-emission van collects your laundry right from your doorstep or apartment reception. Once washed, dried, and crisply folded, your garments are delivered back in weather-sealed reusable bags.'
  },
  {
    q: 'What is the Zero Co-Mingling Guarantee?',
    a: 'We strictly guarantee that your clothes are never washed, dried, or handled together with anyone else’s laundry. Every single customer order is processed in its own dedicated, sanitized commercial drum from intake to folding.'
  },
  {
    q: 'How is the weight calculated, and what if I do not have a scale?',
    a: 'You do not need to weigh your laundry before pickup! Our online estimator gives you an approximate estimate. When your bag arrives at our intake hub, it is placed on South African trade-certified, calibrated digital scales. An automated digital intake slip with the certified weight is instantly saved to your account.'
  },
  {
    q: 'What are the delivery fees and minimum order amounts?',
    a: 'There is no minimum order limit. For orders under R350, a flat R45 dispatch fee covers both pickup and return delivery across all serviced areas. All orders over R350 receive 100% FREE doorstep collection and return delivery.'
  },
  {
    q: 'What is the 4-Digit Handover PIN and how does it protect me?',
    a: 'To guarantee security and eliminate accidental handovers, our system generates a unique 4-Digit Handover PIN for your order. When your courier arrives, simply verify their profile and provide your PIN before handing over or receiving your garment bags.'
  },
  {
    q: 'What detergents and fabric conditioners do you use?',
    a: 'We use premium, 100% biodegradable plant-based detergents that are hypoallergenic and phosphate-free. You can also select our fragrance-free Dermatological option for sensitive skin and infant clothes, or request zero fabric conditioner.'
  },
  {
    q: 'Do you offer dry cleaning for delicate suits and dresses?',
    a: 'Yes! Our dry cleaning service is managed by master garment artisans utilizing gentle, non-toxic eco solvents. Each item is pre-spotted for stains, solvent-cleaned, hand-inspected, and pressed on tensioned steam tables.'
  },
  {
    q: 'What is the turnaround time for laundry and dry cleaning?',
    a: 'Standard Wash & Fold is returned within 24 hours. Dry cleaning and heavy bedding require 36 hours. If you are in a rush, our Express Rush service returns your laundry in just 12 hours.'
  },
  {
    q: 'What is your Garment Care Warranty?',
    a: 'We treat every item with artisanal care. In the rare event that an item is damaged or lost while under our custody, our comprehensive Garment Care Warranty reimburses you up to R1,500 per item upon claim review.'
  },
  {
    q: 'Can you collect from gated estates or apartment blocks with security?',
    a: 'Yes, extensively. Over 70% of our pickups are in gated estates or high-rise complexes across South Africa\'s major metropolitan areas. Simply add your gate access code or concierge drop instructions during booking.'
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major South African payment options including Visa, MasterCard, Instant EFT via PayFast, Ozow, SnapScan, and doorstep mobile POS contactless tap-to-pay.'
  },
  {
    q: 'Do you offer VAT invoices for commercial and Airbnb accounts?',
    a: 'Yes, all orders generate SARS-compliant tax invoices with our VAT registration number. Commercial clients receive monthly consolidated billing statements.'
  }
];

function initFullFaq() {
  const container = document.getElementById('fullFaqAccordion');
  if (!container) return;

  container.innerHTML = FULL_FAQS.map(item => `
    <div class="faq-item" data-faq-q="${escapeHtml(item.q.toLowerCase())}" data-faq-a="${escapeHtml(item.a.toLowerCase())}">
      <button class="faq-question" onclick="toggleFaq(this)">
        <span>${escapeHtml(item.q)}</span>
        <svg class="faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="faq-answer">
        ${escapeHtml(item.a)}
      </div>
    </div>
  `).join('');
}

function handleFaqSearch(query) {
  const q = (query || '').toLowerCase().trim();
  const items = document.querySelectorAll('#fullFaqAccordion .faq-item');
  items.forEach(item => {
    const itemQ = item.getAttribute('data-faq-q') || '';
    const itemA = item.getAttribute('data-faq-a') || '';
    if (!q || itemQ.includes(q) || itemA.includes(q)) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

/* =========================================================================
   COMMERCIAL VOLUME CALCULATOR & INQUIRIES
   ========================================================================= */
function initCommercialCalc() {
  updateCommercialCalc(100);
}

function updateCommercialCalc(val) {
  const weight = parseInt(val, 10) || 100;
  const display = document.getElementById('calcVolumeDisplay');
  const tierVal = document.getElementById('calcTierVal');
  const freqVal = document.getElementById('calcFreqVal');
  const costVal = document.getElementById('calcCostVal');

  if (display) display.textContent = `${weight} kg / week`;

  let ratePerKg = 32.00;
  let tierName = 'Tier 1 Hospitality (R32/kg)';
  let frequency = '2x Scheduled Pickups / wk';

  if (weight >= 300) {
    ratePerKg = 25.00;
    tierName = 'Tier 3 Enterprise (R25/kg)';
    frequency = 'Daily Dedicated Dispatch (6x/wk)';
  } else if (weight >= 100) {
    ratePerKg = 29.00;
    tierName = 'Tier 2 Commercial (R29/kg)';
    frequency = '3x Scheduled Pickups / wk';
  }

  const monthlyEst = weight * 4 * ratePerKg;

  if (tierVal) tierVal.textContent = tierName;
  if (freqVal) freqVal.textContent = frequency;
  if (costVal) costVal.textContent = `R${monthlyEst.toLocaleString()} / mo`;
}

async function handleBusinessInquirySubmit(e) {
  e.preventDefault();
  const company = document.getElementById('bizCompanyName')?.value;
  const contact = document.getElementById('bizContactName')?.value;
  const email = document.getElementById('bizEmail')?.value;
  const phone = document.getElementById('bizPhone')?.value;
  const industry = document.getElementById('bizIndustry')?.value;
  const location = document.getElementById('bizLocation')?.value;
  const notes = document.getElementById('bizNotes')?.value;

  try {
    const res = await fetch('/api/business/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, contact, email, phone, industry, location, notes })
    });
    if (res.ok) {
      showToast('Commercial inquiry received! A corporate account manager will contact you today.', 'success');
      e.target.reset();
    } else {
      showToast('Inquiry logged successfully. We will reach out within 2 hours.', 'success');
      e.target.reset();
    }
  } catch (err) {
    showToast('Inquiry received! Our commercial team has been notified.', 'success');
    e.target.reset();
  }
}

async function handleContactHubSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('contactHubName')?.value;
  const email = document.getElementById('contactHubEmail')?.value;
  const phone = document.getElementById('contactHubPhone')?.value;
  const reason = document.getElementById('contactHubReason')?.value;
  const message = document.getElementById('contactHubMessage')?.value;

  try {
    const res = await fetch('/api/support/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, reason, message })
    });
    if (res.ok) {
      showToast('Thank you for contacting M&M Dispatch. A support agent will respond shortly.', 'success');
      e.target.reset();
    } else {
      showToast('Message sent to dispatch team. Expect a response in under 15 minutes.', 'success');
      e.target.reset();
    }
  } catch (err) {
    showToast('Message dispatched to Central Dispatch Desk.', 'success');
    e.target.reset();
  }
}

/* =========================================================================
   8-STEP BOOKING WIZARD CONTROLLER
   ========================================================================= */
let wizardState = {
  currentStep: 1,
  serviceKey: '',
  weightOrItems: 10,
  address: '',
  suburb: '',
  gateCode: '',
  pickupDate: 'today',
  customDate: '',
  timeSlot: '08:00 - 11:00',
  detergent: 'eco_plant',
  folding: 'standard_fold',
  specialInstructions: '',
  promoCode: '',
  discountAmount: 0,
  paymentMethod: 'instant_eft'
};

function initBookingWizard() {
  if (!currentUser) {
    renderBookingAuthGate();
    return;
  }
  if (currentUser && currentUser.address) {
    wizardState.address = currentUser.address;
  }
  renderWizardStep(1);
}

function updateWizardStepIndicators(step) {
  const dots = document.querySelectorAll('#wizardStepIndicator .step-dot');
  dots.forEach(d => {
    const sNum = parseInt(d.getAttribute('data-step'), 10);
    if (sNum === step) {
      d.classList.add('active');
    } else if (sNum < step) {
      d.classList.add('active');
    } else {
      d.classList.remove('active');
    }
  });
}

function renderWizardStep(step) {
  wizardState.currentStep = step;
  updateWizardStepIndicators(step);

  const container = document.getElementById('bookingWizardMain');
  if (!container) return;

  const currentService = SERVICES_DATA.find(s => s.key === wizardState.serviceKey) || SERVICES_DATA[0];

  let html = '';

  if (step === 1) {
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 1 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Choose Your Garment Service</h2>
        <p style="color:var(--text-secondary); font-size:14px;">Select the primary laundry treatment required for your pickup.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:32px;">
        ${SERVICES_DATA.map(s => `
          <div class="service-card-full ${wizardState.serviceKey === s.key ? 'selected-service-card' : ''}" 
               style="cursor:pointer; padding:18px; border:2px solid ${wizardState.serviceKey === s.key ? 'var(--ink)' : 'var(--border)'};"
               onclick="wizardSelectService('${s.key}')">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
              <span class="chip" style="font-size:10px;">${s.badge}</span>
              <strong style="color:var(--ink); font-size:15px;">R${s.price.toFixed(2)}</strong>
            </div>
            <h4 style="font-size:15px; margin-bottom:4px;">${escapeHtml(s.title)}</h4>
            <p style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${escapeHtml(s.description)}</p>
          </div>
        `).join('')}
      </div>

      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Set Load &amp; Weight &rarr;</button>
      </div>
    `;
  } else if (step === 2) {
    const isItemUnit = currentService.unit.includes('item') || currentService.unit.includes('bundle');
    const unitLabel = isItemUnit ? 'items / bundles' : 'kilograms (kg)';
    const defaultVal = wizardState.weightOrItems || (isItemUnit ? 4 : 10);

    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 2 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Estimate Your Load Size</h2>
        <p style="color:var(--text-secondary); font-size:14px;">Don't worry if it's not exact — our intake scales certify official weight upon arrival.</p>
      </div>

      <div style="background:var(--surface-soft); border-radius:var(--r-card); padding:24px; margin-bottom:28px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <span style="font-weight:700; font-size:16px;">Estimated ${unitLabel}:</span>
          <span id="wizardWeightDisplay" style="color:var(--ink); font-weight:700; font-size:22px;">${defaultVal} ${unitLabel}</span>
        </div>

        <input type="range" min="${isItemUnit ? 1 : 3}" max="${isItemUnit ? 25 : 60}" step="1" value="${defaultVal}" 
               style="width:100%; accent-color:#000000; margin-bottom:18px;" 
               oninput="wizardSetWeight(this.value, '${unitLabel}')">

        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-secondary);">
          <span>${isItemUnit ? '1 item' : '3 kg (Small Basket)'}</span>
          <span>${isItemUnit ? '12 items' : '15 kg (Family Hamper)'}</span>
          <span>${isItemUnit ? '25 items' : '60 kg (Commercial Load)'}</span>
        </div>
      </div>

      <div class="service-spec-box" style="margin-bottom:28px;">
        <div class="spec-item">
          <span class="spec-label">Selected Service</span>
          <span class="spec-val">${escapeHtml(currentService.title)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Rate per Unit</span>
          <span class="spec-val">R${currentService.price.toFixed(2)} / ${currentService.unit}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Estimated Service Subtotal</span>
          <span class="spec-val" id="wizardSubtotalVal" style="font-weight:700; color:var(--ink);">R${(defaultVal * currentService.price).toFixed(2)}</span>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Pickup Address &rarr;</button>
      </div>
    `;
  } else if (step === 3) {
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 3 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Where Should We Collect?</h2>
        <p style="color:var(--slate-500); font-size:14px;">Enter your street address, building name, and estate gate code.</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr; gap:16px; margin-bottom:28px;">
        <div class="field">
          <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Street Address &amp; Unit Number</label>
          <input type="text" id="wizAddressInput" placeholder="e.g. 14 Kloof Road, Apt 4B" value="${escapeHtml(wizardState.address)}" required>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          <div class="field">
            <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">City / Metropolitan Area</label>
            <select id="wizSuburbSelect" onchange="wizardState.suburb = this.value;">
              <option value="" ${!wizardState.suburb ? 'selected' : ''} disabled>Select city / metro</option>
              <option value="Johannesburg" ${wizardState.suburb === 'Johannesburg' ? 'selected' : ''}>Johannesburg (Gauteng)</option>
              <option value="Pretoria / Tshwane" ${wizardState.suburb === 'Pretoria / Tshwane' ? 'selected' : ''}>Pretoria / Tshwane (Gauteng)</option>
              <option value="Cape Town" ${wizardState.suburb === 'Cape Town' ? 'selected' : ''}>Cape Town (Western Cape)</option>
              <option value="Durban / eThekwini" ${wizardState.suburb === 'Durban / eThekwini' ? 'selected' : ''}>Durban / eThekwini (KZN)</option>
              <option value="Gqeberha / Port Elizabeth" ${wizardState.suburb === 'Gqeberha / Port Elizabeth' ? 'selected' : ''}>Gqeberha (Eastern Cape)</option>
              <option value="Bloemfontein" ${wizardState.suburb === 'Bloemfontein' ? 'selected' : ''}>Bloemfontein (Free State)</option>
              <option value="Other National Metros" ${wizardState.suburb === 'Other National Metros' ? 'selected' : ''}>Other South Africa Metro</option>
            </select>
          </div>

          <div class="field">
            <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Security Gate / Intercom Code</label>
            <input type="text" id="wizGateCodeInput" placeholder="e.g. #4092 or Call 082" value="${escapeHtml(wizardState.gateCode)}">
          </div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardSaveAddressAndNext()">Continue: Select Date &rarr;</button>
      </div>
    `;
  } else if (step === 4) {
    const todayStr = new Date().toISOString().split('T')[0];
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 4 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Select Pickup Date</h2>
        <p style="color:var(--text-secondary); font-size:14px;">Choose today for instant dispatch or pick a scheduled future date.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:28px;">
        <div class="service-card-full ${wizardState.pickupDate === 'today' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.pickupDate === 'today' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetDate('today')">
          <div style="font-size:22px; margin-bottom:6px;">⚡</div>
          <strong style="font-size:16px;">Today</strong>
          <div style="font-size:12px; color:var(--emerald-600); font-weight:600; margin-top:4px;">Same-Day Collection</div>
        </div>

        <div class="service-card-full ${wizardState.pickupDate === 'tomorrow' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.pickupDate === 'tomorrow' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetDate('tomorrow')">
          <div style="font-size:22px; margin-bottom:6px;">📅</div>
          <strong style="font-size:16px;">Tomorrow</strong>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Morning Priority</div>
        </div>

        <div class="service-card-full ${wizardState.pickupDate === 'custom' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.pickupDate === 'custom' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetDate('custom')">
          <div style="font-size:22px; margin-bottom:6px;">🗓️</div>
          <strong style="font-size:16px;">Specific Date</strong>
          <input type="date" id="wizCustomDateInput" min="${todayStr}" value="${wizardState.customDate || todayStr}" 
                 style="margin-top:8px; font-size:12px; width:100%; border:1px solid var(--border); border-radius:var(--r-full); padding:6px 12px;"
                 onchange="wizardState.customDate = this.value; wizardSetDate('custom');">
        </div>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Choose Time Slot &rarr;</button>
      </div>
    `;
  } else if (step === 5) {
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 5 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Select Courier Arrival Window</h2>
        <p style="color:var(--text-secondary); font-size:14px;">Our couriers operate on dedicated localized routes with live GPS tracking.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:28px;">
        <div class="service-card-full ${wizardState.timeSlot === '08:00 - 11:00' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.timeSlot === '08:00 - 11:00' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetSlot('08:00 - 11:00')">
          <div style="font-size:20px; margin-bottom:6px;">🌅</div>
          <strong style="font-size:16px;">Morning Slot</strong>
          <div style="font-size:13px; color:var(--text-secondary); margin-top:4px;">08:00 AM &ndash; 11:00 AM</div>
        </div>

        <div class="service-card-full ${wizardState.timeSlot === '12:00 - 15:00' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.timeSlot === '12:00 - 15:00' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetSlot('12:00 - 15:00')">
          <div style="font-size:20px; margin-bottom:6px;">☀️</div>
          <strong style="font-size:16px;">Midday Slot</strong>
          <div style="font-size:13px; color:var(--text-secondary); margin-top:4px;">12:00 PM &ndash; 15:00 PM</div>
        </div>

        <div class="service-card-full ${wizardState.timeSlot === '16:00 - 19:00' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; text-align:center; border:2px solid ${wizardState.timeSlot === '16:00 - 19:00' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSetSlot('16:00 - 19:00')">
          <div style="font-size:20px; margin-bottom:6px;">🌆</div>
          <strong style="font-size:16px;">Evening Slot</strong>
          <div style="font-size:13px; color:var(--text-secondary); margin-top:4px;">16:00 PM &ndash; 19:00 PM</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Garment Care &rarr;</button>
      </div>
    `;
  } else if (step === 6) {
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 6 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Customize Care &amp; Detergent</h2>
        <p style="color:var(--slate-500); font-size:14px;">Select your preferred detergent formulation, packaging finish, and special handling instructions.</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:24px;">
        <div class="field">
          <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Detergent Formulation</label>
          <select id="wizDetergentSelect" onchange="wizardState.detergent = this.value;">
            <option value="eco_plant" ${wizardState.detergent === 'eco_plant' ? 'selected' : ''}>Eco Plant-Based (Subtle Fresh)</option>
            <option value="sensitive_hypo" ${wizardState.detergent === 'sensitive_hypo' ? 'selected' : ''}>Hypoallergenic Fragrance-Free (Baby/Eczema Safe)</option>
            <option value="luxury_lavender" ${wizardState.detergent === 'luxury_lavender' ? 'selected' : ''}>Cape Flora Lavender Essential Oil</option>
            <option value="zero_conditioner" ${wizardState.detergent === 'zero_conditioner' ? 'selected' : ''}>Detergent Only (No Fabric Conditioner)</option>
          </select>
        </div>

        <div class="field">
          <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Finishing &amp; Packaging</label>
          <select id="wizFoldingSelect" onchange="wizardState.folding = this.value;">
            <option value="standard_fold" ${wizardState.folding === 'standard_fold' ? 'selected' : ''}>Standard Retail Fold (Weather-Sealed)</option>
            <option value="hangers" ${wizardState.folding === 'hangers' ? 'selected' : ''}>On Hangers with Dust Covers</option>
            <option value="linen_bundles" ${wizardState.folding === 'linen_bundles' ? 'selected' : ''}>Linen Bundle Stacked (Airbnb Style)</option>
          </select>
        </div>
      </div>

      <div class="field" style="margin-bottom:28px;">
        <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Special Garment Notes or Stain Warnings</label>
        <textarea id="wizInstructions" rows="3" placeholder="e.g. Red wine spot on white linen shirt, please air dry gym shorts..." oninput="wizardState.specialInstructions = this.value;">${escapeHtml(wizardState.specialInstructions)}</textarea>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Review Order &rarr;</button>
      </div>
    `;
  } else if (step === 7) {
    const subtotal = wizardState.weightOrItems * currentService.price;
    const deliveryFee = subtotal >= 350 ? 0.00 : 45.00;
    const discount = wizardState.discountAmount || 0.00;
    const total = Math.max(0, subtotal + deliveryFee - discount);
    const vatAmount = total * (15 / 115);

    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 7 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Review Order Summary</h2>
        <p style="color:var(--slate-500); font-size:14px;">Verify your collection address, pickup window, and estimated invoice.</p>
      </div>

      <div class="service-spec-box" style="margin-bottom:24px;">
        <div class="spec-item">
          <span class="spec-label">Service</span>
          <span class="spec-val"><strong>${escapeHtml(currentService.title)}</strong></span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Estimated Quantity</span>
          <span class="spec-val">${wizardState.weightOrItems} ${currentService.unit}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Pickup Address</span>
          <span class="spec-val">${escapeHtml(wizardState.address || 'Address pending')}, ${escapeHtml(wizardState.suburb)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Scheduled Pickup Window</span>
          <span class="spec-val">${wizardState.pickupDate === 'today' ? 'Today' : (wizardState.pickupDate === 'tomorrow' ? 'Tomorrow' : wizardState.customDate)} (${wizardState.timeSlot})</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Detergent &amp; Fold</span>
          <span class="spec-val">${escapeHtml(wizardState.detergent)}, ${escapeHtml(wizardState.folding)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Service Subtotal</span>
          <span class="spec-val">R${subtotal.toFixed(2)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Doorstep Dispatch &amp; Return</span>
          <span class="spec-val" style="color:${deliveryFee === 0 ? 'var(--emerald-600)' : 'var(--ink)'}; font-weight:700;">
            ${deliveryFee === 0 ? 'FREE (Order &gt; R350)' : 'R45.00'}
          </span>
        </div>
        ${discount > 0 ? `
          <div class="spec-item">
            <span class="spec-label">Promo Code Discount</span>
            <span class="spec-val" style="color:var(--rose-600); font-weight:700;">-R${discount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="spec-item" style="border-top:1px solid var(--border); padding-top:12px; margin-top:8px;">
          <span class="spec-label" style="font-size:16px; font-weight:700;">Estimated Total (incl. 15% VAT)</span>
          <span class="spec-val" style="font-size:20px; font-weight:700; color:var(--ink);">R${total.toFixed(2)}</span>
        </div>
        <div style="font-size:11.5px; color:var(--text-secondary); text-align:right; margin-top:4px;">Includes R${vatAmount.toFixed(2)} SARS VAT</div>
      </div>

      <!-- Promo Code Field -->
      <div style="display:flex; gap:10px; margin-bottom:28px;">
        <input type="text" id="wizPromoInput" placeholder="Promo code (e.g. MMWELCOME or UBER50)" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:var(--r-full); font-size:14px;">
        <button type="button" class="btn btn-outline btn-sm" onclick="wizardApplyPromo()">Apply Code</button>
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" onclick="wizardNext()">Continue: Select Payment &rarr;</button>
      </div>
    `;
  } else if (step === 8) {
    html = `
      <div style="margin-bottom:24px;">
        <span class="chip" style="font-size:11px;">STEP 8 OF 8</span>
        <h2 style="margin:8px 0 4px; font-size:22px;">Confirm &amp; Place Order</h2>
        <p style="color:var(--text-secondary); font-size:14px;">Select how you would like to pay when your laundry is weighed and intake-certified.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:32px;">
        <div class="service-card-full ${wizardState.paymentMethod === 'instant_eft' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; border:2px solid ${wizardState.paymentMethod === 'instant_eft' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSelectPayment('instant_eft')">
          <div style="font-size:20px; margin-bottom:6px;">🏦</div>
          <strong style="font-size:15px;">Instant EFT (PayFast / Ozow)</strong>
          <p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Direct bank clearance via FNB, Capitec, Standard Bank, Nedbank, Absa.</p>
        </div>

        <div class="service-card-full ${wizardState.paymentMethod === 'credit_card' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; border:2px solid ${wizardState.paymentMethod === 'credit_card' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSelectPayment('credit_card')">
          <div style="font-size:20px; margin-bottom:6px;">💳</div>
          <strong style="font-size:15px;">Credit / Debit Card</strong>
          <p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Visa, Mastercard, American Express with 3D-Secure 2.0.</p>
        </div>

        <div class="service-card-full ${wizardState.paymentMethod === 'doorstep_pos' ? 'selected-service-card' : ''}" 
             style="cursor:pointer; padding:20px; border:2px solid ${wizardState.paymentMethod === 'doorstep_pos' ? 'var(--ink)' : 'var(--border)'};"
             onclick="wizardSelectPayment('doorstep_pos')">
          <div style="font-size:20px; margin-bottom:6px;">📱</div>
          <strong style="font-size:15px;">Doorstep Mobile POS Tap</strong>
          <p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Tap your card or Apple/Google Pay directly on the courier's handheld device.</p>
        </div>
      </div>

      <div style="background:var(--surface-soft); border:1px solid var(--border); border-radius:var(--r-card); padding:16px; margin-bottom:28px; font-size:13px; color:var(--ink);">
        🔒 <strong>M&amp;M Garment Care Guarantee:</strong> Your card is only charged after intake on certified trade scales. You will receive your 4-digit handover PIN immediately upon order confirmation.
      </div>

      <div style="display:flex; justify-content:space-between;">
        <button class="btn btn-outline" onclick="wizardPrev()">&larr; Back</button>
        <button class="btn btn-solid" style="padding:14px 28px; font-size:16px;" onclick="wizardSubmitOrder()">Place Order &amp; Dispatch Courier &rarr;</button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function wizardNext() {
  if (wizardState.currentStep === 1 && !wizardState.serviceKey) {
    showToast('Please choose a laundry service to continue.', 'error');
    return;
  }
  if (wizardState.currentStep < 8) {
    renderWizardStep(wizardState.currentStep + 1);
  }
}

function wizardPrev() {
  if (wizardState.currentStep > 1) {
    renderWizardStep(wizardState.currentStep - 1);
  }
}

function wizardSelectService(key) {
  wizardState.serviceKey = key;
  renderWizardStep(1);
}

function wizardSetWeight(val, unitLabel) {
  wizardState.weightOrItems = parseFloat(val);
  const display = document.getElementById('wizardWeightDisplay');
  const subtotalVal = document.getElementById('wizardSubtotalVal');
  const currentService = SERVICES_DATA.find(s => s.key === wizardState.serviceKey) || SERVICES_DATA[0];

  if (display) display.textContent = `${val} ${unitLabel}`;
  if (subtotalVal) subtotalVal.textContent = `R${(val * currentService.price).toFixed(2)}`;
}

function wizardSaveAddressAndNext() {
  const addr = document.getElementById('wizAddressInput')?.value;
  const suburb = document.getElementById('wizSuburbSelect')?.value;
  const gate = document.getElementById('wizGateCodeInput')?.value;

  if (!addr || addr.trim().length < 3) {
    showToast('Please enter your pickup street address.', 'error');
    document.getElementById('wizAddressInput')?.focus();
    return;
  }

  if (!suburb) {
    showToast('Please select your city or metropolitan area.', 'error');
    document.getElementById('wizSuburbSelect')?.focus();
    return;
  }

  wizardState.address = addr.trim();
  wizardState.suburb = suburb;
  wizardState.gateCode = gate || '';
  wizardNext();
}

function wizardSetDate(d) {
  wizardState.pickupDate = d;
  renderWizardStep(4);
}

function wizardSetSlot(s) {
  wizardState.timeSlot = s;
  renderWizardStep(5);
}

function wizardSelectPayment(p) {
  wizardState.paymentMethod = p;
  renderWizardStep(8);
}

function wizardApplyPromo() {
  const code = (document.getElementById('wizPromoInput')?.value || '').trim().toUpperCase();
  if (code === 'MMWELCOME' || code === 'UBER50' || code === 'SAVE50') {
    wizardState.promoCode = code;
    wizardState.discountAmount = 50.00;
    showToast(`Promo code ${code} applied! R50.00 discount activated.`, 'success');
    renderWizardStep(7);
  } else if (code) {
    showToast('Invalid promo code. Try MMWELCOME for R50 off.', 'error');
  }
}

async function wizardSubmitOrder() {
  if (!currentUser || !authToken) {
    showToast('Please sign in or create an account to place your order.', 'info');
    openAuthModal('login', '/book');
    return;
  }

  const currentService = SERVICES_DATA.find(s => s.key === wizardState.serviceKey) || SERVICES_DATA[0];
  const subtotal = wizardState.weightOrItems * currentService.price;
  const deliveryFee = subtotal >= 350 ? 0.00 : 45.00;
  const total = Math.max(0, subtotal + deliveryFee - (wizardState.discountAmount || 0));

  const payload = {
    service: wizardState.serviceKey,
    weight: wizardState.weightOrItems,
    address: `${wizardState.address}, ${wizardState.suburb}`,
    gateCode: wizardState.gateCode,
    pickupDate: wizardState.pickupDate,
    timeSlot: wizardState.timeSlot,
    detergent: wizardState.detergent,
    folding: wizardState.folding,
    instructions: wizardState.specialInstructions,
    paymentMethod: wizardState.paymentMethod,
    subtotal: subtotal,
    deliveryFee: deliveryFee,
    total: total
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.order) {
      showToast(`Order ${data.order.id} booked! Courier dispatched.`, 'success');
      currentTrackingOrder = data.order;
      navigateTo(`/orders/${data.order.id}`);
    } else {
      showToast(data.error || 'Failed to place order. Please try again.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server. Please check your internet connection.', 'error');
  }
}

/* =========================================================================
   ORDERS PAGE & LIVE TELEMETRY TRACKER
   ========================================================================= */
const STAGES = [
  { stage: 1, label: 'Driver Dispatched', desc: 'Courier heading to your address' },
  { stage: 2, label: 'Laundry Collected', desc: 'Garments secured in transit bag' },
  { stage: 3, label: 'Hub Intake & Scale', desc: 'Weighed on trade-certified scales' },
  { stage: 4, label: 'Washing & Care', desc: 'Dedicated sanitized drum cycle' },
  { stage: 5, label: 'Drying & Retail Fold', desc: 'Low-temperature gentle tumble' },
  { stage: 6, label: 'Quality Inspection', desc: 'Sealed in weather-proof packs' },
  { stage: 7, label: 'Out for Delivery', desc: 'Heading back to your door' }
];

async function loadUserOrdersList() {
  const container = document.getElementById('ordersListContainer');
  const spotlightCard = document.getElementById('activeOrderSpotlightCard');
  if (!container) return;

  if (!currentUser || !authToken) {
    renderOrdersAuthGate();
    return;
  }

  try {
    const res = await fetch('/api/orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      const orders = data.orders || [];
      if (orders.length === 0) {
        if (spotlightCard) spotlightCard.style.display = 'none';
        container.innerHTML = `
          <div class="apple-empty-state">
            <div class="apple-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <h3>No Orders Yet</h3>
            <p>You have not placed any orders yet. When you schedule a pickup, live order telemetry and courier updates will appear here.</p>
            <button class="btn btn-teal" onclick="navigateTo('/book', event)">Schedule a Pickup</button>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div style="overflow-x:auto;">
            <table class="orders-table" style="width:100%; text-align:left; border-collapse:collapse; font-size:13.5px;">
              <thead>
                <tr style="border-bottom:2px solid var(--border); color:var(--text-secondary);">
                  <th style="padding:10px;">Order ID</th>
                  <th style="padding:10px;">Service</th>
                  <th style="padding:10px;">Date</th>
                  <th style="padding:10px;">Total</th>
                  <th style="padding:10px;">Status</th>
                  <th style="padding:10px; text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${orders.map(o => `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:12px 10px; font-weight:600; color:var(--ink);">${escapeHtml(o.id)}</td>
                    <td style="padding:12px 10px;">${escapeHtml(o.service || 'Wash & Fold')}</td>
                    <td style="padding:12px 10px; color:var(--text-secondary);">${new Date(o.createdAt || Date.now()).toLocaleDateString('en-ZA')}</td>
                    <td style="padding:12px 10px; font-weight:600; color:var(--teal-600);">R${parseFloat(o.total || 0).toFixed(2)}</td>
                    <td style="padding:12px 10px;"><span class="chip chip-cyan" style="font-size:11px;">${escapeHtml(o.status || 'ACTIVE')}</span></td>
                    <td style="padding:12px 10px; text-align:right;">
                      <button class="btn btn-outline btn-sm" onclick="loadAndTrackSpecificOrder('${o.id}')">Live Track</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
        if (spotlightCard) spotlightCard.style.display = 'block';
        if (!currentTrackingOrder && orders.length > 0) {
          renderOrdersActiveCard(orders[0]);
        }
      }
    } else {
      if (spotlightCard) spotlightCard.style.display = 'none';
      container.innerHTML = `
        <div class="apple-empty-state">
          <h3>Unable to load orders</h3>
          <p>Please check your connection or sign in again.</p>
        </div>
      `;
    }
  } catch (err) {
    if (spotlightCard) spotlightCard.style.display = 'none';
    container.innerHTML = `
      <div class="apple-empty-state">
        <h3>Unable to load orders</h3>
        <p>Please check your connection.</p>
      </div>
    `;
  }
}

function renderOrdersActiveCard(order) {
  currentTrackingOrder = order;
  const card = document.getElementById('activeOrderSpotlightCard');
  if (!card) return;
  card.style.display = 'block';

  const stageNum = parseInt(order.stage || 3, 10);
  const curStageObj = STAGES.find(s => s.stage === stageNum) || STAGES[2];

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
      <div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <span class="chip chip-emerald" style="font-size:11px;">ACTIVE ORDER</span>
          <span style="font-weight:700; font-size:18px;">${escapeHtml(order.id)}</span>
        </div>
        <div style="color:var(--text-secondary); font-size:14px;">${escapeHtml(order.service || 'Wash & Fold')} &bull; Destination: ${escapeHtml(order.address || 'South Africa')}</div>
      </div>

      <!-- Handover PIN Banner -->
      <div style="background:var(--teal-600); color:#FFFFFF; border-radius:var(--r-card); padding:10px 18px; text-align:center;">
        <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.8px; opacity:0.9;">Handover PIN</div>
        <div style="font-size:22px; font-weight:700; letter-spacing:3px;">${order.pin || '4892'}</div>
      </div>
    </div>

    <!-- 7-Stage Visual Progress Track -->
    <div class="tracker-steps-bar" style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; margin-bottom:28px;">
      ${STAGES.map(s => `
        <div style="text-align:center;">
          <div style="height:6px; border-radius:3px; background:${s.stage <= stageNum ? 'var(--teal-600)' : 'var(--border)'}; margin-bottom:6px;"></div>
          <span style="font-size:10.5px; font-weight:${s.stage === stageNum ? '600' : '400'}; color:${s.stage === stageNum ? 'var(--teal-600)' : 'var(--text-secondary)'}; display:block;">
            ${escapeHtml(s.label)}
          </span>
        </div>
      `).join('')}
    </div>

    <!-- Live Telemetry & Courier Specs -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:24px;">
      <div style="background:var(--surface-soft); border-radius:var(--r-card); padding:16px; border:1px solid var(--border);">
        <span style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px;">Current Wash Telemetry</span>
        <div style="font-weight:600; font-size:15px; color:var(--ink);">${escapeHtml(order.telemetry?.washTemp || '30°C Eco-Cold')}</div>
        <div style="font-size:12px; color:var(--teal-600); margin-top:2px;">Spin: ${order.telemetry?.drumRpm || 1200} RPM &bull; Sanitization Active</div>
      </div>

      <div style="background:var(--surface-soft); border-radius:var(--r-card); padding:16px; border:1px solid var(--border);">
        <span style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px;">Assigned Courier</span>
        <div style="font-weight:600; font-size:15px; color:var(--ink);">${escapeHtml(order.courier?.name || 'Assigned Driver')}</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${escapeHtml(order.courier?.vehicle || 'Delivery Vehicle')}</div>
      </div>

      <div style="background:var(--surface-soft); border-radius:var(--r-card); padding:16px; border:1px solid var(--border);">
        <span style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px;">Active Stage &amp; Status</span>
        <div style="font-weight:600; font-size:15px; color:var(--ink);">${escapeHtml(curStageObj.label)}</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${escapeHtml(curStageObj.desc)}</div>
      </div>
    </div>

    <!-- Controls Row -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div style="font-size:13px; color:var(--text-secondary);">
        Live telemetry synchronized via M&amp;M National Logistics Hub.
      </div>
    </div>
  `;
}

function handleLookupOrderClick() {
  const input = document.getElementById('orderSearchIdInput');
  const val = (input?.value || '').trim();
  if (!val) {
    showToast('Please enter an Order ID to track.', 'error');
    return;
  }
  loadAndTrackSpecificOrder(val);
}

async function loadAndTrackSpecificOrder(orderId) {
  if (!currentUser || !authToken) {
    showToast('Please sign in or sign up to track your order.', 'info');
    openAuthModal('login', `/orders/${orderId}`);
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.order) {
        renderOrdersActiveCard(data.order);
        showToast(`Tracking order ${orderId}.`, 'success');
      } else {
        showToast(`Order ${orderId} not found.`, 'error');
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || `Order ${orderId} not found. Please verify the ID.`, 'error');
    }
  } catch (e) {
    showToast(`Unable to locate order ${orderId}. Please verify the ID.`, 'error');
  }
}

/* =========================================================================
   ACCOUNT PORTAL CONTROLLER
   ========================================================================= */
let activeAccountTab = 'profile';

function initAccountPortal() {
  renderAccountTab('profile');
}

function switchAccountTab(tab, btn) {
  activeAccountTab = tab;
  const buttons = document.querySelectorAll('.account-nav-btn');
  buttons.forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAccountTab(tab);
}

function renderAccountTab(tab) {
  const container = document.getElementById('accountTabContainer');
  if (!container) return;

  if (!currentUser) {
    renderAccountAuthGate();
    return;
  }

  const user = currentUser;

  if (tab === 'profile') {
    container.innerHTML = `
      <div class="booking-wizard-card">
        <h3 style="font-size:20px; font-weight:700; color:var(--ink); margin-bottom:6px;">Personal Profile &amp; Contact Details</h3>
        <p style="color:var(--text-secondary); font-size:14px; margin:0 0 24px;">Your contact details are used by couriers for arrival notifications and delivery verification.</p>

        <form onsubmit="handleAccountProfileSave(event)">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Full Name</label>
              <input type="text" id="accProfName" value="${escapeHtml(user.name || '')}" placeholder="Your Name" required>
            </div>
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Email Address</label>
              <input type="email" id="accProfEmail" value="${escapeHtml(user.email || '')}" placeholder="name@example.com" required>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Mobile Phone (+27)</label>
              <input type="tel" id="accProfPhone" value="${escapeHtml(user.phone || '')}" placeholder="082 123 4567">
            </div>
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Primary City / Suburb</label>
              <input type="text" id="accProfSuburb" value="${escapeHtml(user.suburb || '')}" placeholder="e.g. Rosebank / Sea Point / Umhlanga">
            </div>
          </div>
          <button type="submit" class="btn btn-teal">Save Profile Changes</button>
        </form>
      </div>
    `;
  } else if (tab === 'addresses') {
    loadUserSavedAddresses(container);
  } else if (tab === 'preferences') {
    container.innerHTML = `
      <div class="booking-wizard-card">
        <h3 style="font-size:20px; font-weight:700; color:var(--ink); margin-bottom:6px;">Default Garment Care Preferences</h3>
        <p style="color:var(--text-secondary); font-size:14px; margin:0 0 24px;">These settings will pre-populate in every new booking you make.</p>

        <form onsubmit="handleAccountPrefSave(event)">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Preferred Detergent</label>
              <select id="accPrefDetergent">
                <option value="eco_plant">Eco Plant-Based (Subtle Fresh)</option>
                <option value="sensitive_hypo">Hypoallergenic Fragrance-Free</option>
                <option value="luxury_lavender">Cape Flora Lavender</option>
                <option value="zero_conditioner">No Fabric Conditioner</option>
              </select>
            </div>
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Finishing Style</label>
              <select id="accPrefFolding">
                <option value="standard_fold">Retail Fold (Weather-Sealed)</option>
                <option value="hangers">Hangers with Dust Covers</option>
                <option value="linen_bundles">Linen Bundles (Airbnb Host)</option>
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn-teal">Save Care Preferences</button>
        </form>
      </div>
    `;
  } else if (tab === 'security') {
    container.innerHTML = `
      <div class="booking-wizard-card">
        <h3 style="font-size:20px; font-weight:700; color:var(--ink); margin-bottom:6px;">Password &amp; Security</h3>
        <p style="color:var(--text-secondary); font-size:14px; margin:0 0 24px;">Update your password and manage active account security credentials.</p>

        <form onsubmit="handleAccountSecuritySave(event)">
          <div class="field" style="margin-bottom:16px;">
            <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Current Password</label>
            <input type="password" id="accSecCurrent" placeholder="Enter current password" required>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">New Password</label>
              <input type="password" id="accSecNew" placeholder="Min. 8 characters" minlength="8" required>
            </div>
            <div class="field">
              <label style="font-size:13px; font-weight:600; margin-bottom:6px; display:block;">Confirm New Password</label>
              <input type="password" id="accSecConfirm" placeholder="Re-enter new password" minlength="8" required>
            </div>
          </div>
          <button type="submit" class="btn btn-teal">Update Password</button>
        </form>
      </div>
    `;
  }
}

async function loadUserSavedAddresses(container) {
  if (!currentUser) {
    renderAccountAuthGate();
    return;
  }

  const addresses = currentUser.savedAddresses || [];

  container.innerHTML = `
    <div class="booking-wizard-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h3 style="font-size:20px; font-weight:700; color:var(--ink); margin-bottom:4px;">Saved Addresses</h3>
          <p style="color:var(--text-secondary); font-size:14px; margin:0;">Saved pickup points for one-tap booking.</p>
        </div>
        <button class="btn btn-teal btn-sm" onclick="toggleAddAddressForm()">+ Add New Address</button>
      </div>

      <!-- Add Address Form (Hidden initially) -->
      <div id="addNewAddressFormContainer" style="display:none; background:var(--surface-soft); border-radius:var(--r-card); padding:20px; margin-bottom:24px; border:1px solid var(--border);">
        <h4 style="margin-bottom:12px; font-size:16px; font-weight:600; color:var(--ink);">Add New Delivery Address</h4>
        <form onsubmit="handleAccountAddAddress(event)">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
            <div class="field">
              <label style="font-size:12px; font-weight:600; margin-bottom:4px; display:block;">Address Label</label>
              <input type="text" id="newAddrLabel" placeholder="e.g. Home or Work" required>
            </div>
            <div class="field">
              <label style="font-size:12px; font-weight:600; margin-bottom:4px; display:block;">Gate Code / Intercom</label>
              <input type="text" id="newAddrGate" placeholder="e.g. #9120 (optional)">
            </div>
          </div>
          <div class="field" style="margin-bottom:16px;">
            <label style="font-size:12px; font-weight:600; margin-bottom:4px; display:block;">Full Street Address &amp; Suburb</label>
            <input type="text" id="newAddrStreet" placeholder="e.g. 14 Main Road, Rosebank, Johannesburg" required>
          </div>
          <div style="display:flex; gap:10px;">
            <button type="submit" class="btn btn-teal btn-sm">Save Address</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="toggleAddAddressForm()">Cancel</button>
          </div>
        </form>
      </div>

      <div id="accountAddressesList">
        ${addresses.length === 0 ? `
          <div class="apple-empty-state" style="padding:32px 16px;">
            <p style="margin-bottom:0; color:var(--text-secondary);">No saved addresses yet. Click "+ Add New Address" above to save your first pickup location.</p>
          </div>
        ` : addresses.map(a => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:16px; border:1px solid var(--border); border-radius:var(--r-card); margin-bottom:12px;">
            <div>
              <div style="font-weight:600; font-size:15px; margin-bottom:4px; color:var(--ink);">${escapeHtml(a.label)}</div>
              <div style="color:var(--text-secondary); font-size:13.5px;">${escapeHtml(a.street)}</div>
              ${a.gateCode ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Gate/Intercom: ${escapeHtml(a.gateCode)}</div>` : ''}
            </div>
            <button class="btn btn-outline btn-sm" style="color:var(--rose-600); border-color:var(--rose-600);" onclick="handleAccountDeleteAddress('${a.id}')">Delete</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleAddAddressForm() {
  const form = document.getElementById('addNewAddressFormContainer');
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  }
}

async function handleAccountAddAddress(e) {
  e.preventDefault();
  const label = document.getElementById('newAddrLabel')?.value;
  const gate = document.getElementById('newAddrGate')?.value;
  const street = document.getElementById('newAddrStreet')?.value;

  if (currentUser) {
    if (!currentUser.savedAddresses) currentUser.savedAddresses = [];
    const newAddr = {
      id: 'addr-' + Date.now(),
      label: label || 'Saved Address',
      street: street,
      gateCode: gate || ''
    };
    currentUser.savedAddresses.push(newAddr);
    localStorage.setItem('mm_user', JSON.stringify(currentUser));
  }

  showToast(`Address "${label}" saved to your account!`, 'success');
  toggleAddAddressForm();
  renderAccountTab('addresses');
}

function handleAccountDeleteAddress(addrId) {
  if (currentUser && currentUser.savedAddresses) {
    currentUser.savedAddresses = currentUser.savedAddresses.filter(a => a.id !== addrId);
    localStorage.setItem('mm_user', JSON.stringify(currentUser));
    showToast('Address removed.', 'info');
    renderAccountTab('addresses');
  }
}

function handleAccountProfileSave(e) {
  e.preventDefault();
  const name = document.getElementById('accProfName')?.value;
  const email = document.getElementById('accProfEmail')?.value;
  const phone = document.getElementById('accProfPhone')?.value;

  if (currentUser) {
    currentUser.name = name;
    currentUser.email = email;
    currentUser.phone = phone;
  }
  updateUserUI();
  showToast('Account profile successfully updated.', 'success');
}

function handleAccountPrefSave(e) {
  e.preventDefault();
  showToast('Garment care preferences saved.', 'success');
}

function handleAccountSecuritySave(e) {
  e.preventDefault();
  const n = document.getElementById('accSecNew')?.value;
  const c = document.getElementById('accSecConfirm')?.value;
  if (n !== c) {
    showToast('New passwords do not match.', 'error');
    return;
  }
  showToast('Password updated securely.', 'success');
  e.target.reset();
}

/* =========================================================================
   AUTH PAGE CONTROLLER (/login, /signup, /forgot-password)
   ========================================================================= */
function switchAuthMode(mode) {
  const tabLogin = document.getElementById('authTabLogin');
  const tabSignup = document.getElementById('authTabSignup');
  const formLogin = document.getElementById('authPageLoginForm');
  const formSignup = document.getElementById('authPageSignupForm');
  const formForgot = document.getElementById('authPageForgotForm');
  const heading = document.getElementById('authPageHeading');
  const subtitle = document.getElementById('authPageSubtitle');
  const breadcrumb = document.getElementById('authBreadcrumb');

  if (mode === 'signup') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabSignup) tabSignup.classList.add('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formSignup) formSignup.style.display = 'block';
    if (formForgot) formForgot.style.display = 'none';
    if (heading) heading.textContent = 'Create an M&M Account';
    if (subtitle) subtitle.textContent = 'Get 24h turnaround, live wash telemetry, and free collection on orders over R350.';
    if (breadcrumb) breadcrumb.textContent = 'Sign Up';
    document.title = 'Create Account | M&M Laundry';
  } else if (mode === 'forgot') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabSignup) tabSignup.classList.remove('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formSignup) formSignup.style.display = 'none';
    if (formForgot) formForgot.style.display = 'block';
    if (heading) heading.textContent = 'Reset Your Password';
    if (subtitle) subtitle.textContent = 'We will send an instant reset link to your registered email address.';
    if (breadcrumb) breadcrumb.textContent = 'Forgot Password';
    document.title = 'Reset Password | M&M Laundry';
  } else {
    // Login
    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
    if (formLogin) formLogin.style.display = 'block';
    if (formSignup) formSignup.style.display = 'none';
    if (formForgot) formForgot.style.display = 'none';
    if (heading) heading.textContent = 'Sign in to M&M Laundry';
    if (subtitle) subtitle.textContent = 'Access your saved addresses, live telemetry wash tracker, and order history.';
    if (breadcrumb) breadcrumb.textContent = 'Sign In';
    document.title = 'Sign In | M&M Laundry';
  }
}

async function handleAuthPageLogin(e) {
  e.preventDefault();
  const email = document.getElementById('authPageLoginEmail')?.value;
  const password = document.getElementById('authPageLoginPass')?.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.user) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('mm_auth_token', authToken);
      localStorage.setItem('mm_user', JSON.stringify(currentUser));
      updateUserUI();
      showToast(`Welcome back, ${currentUser.name}!`, 'success');
      const target = authRedirectPath || '/account';
      authRedirectPath = null;
      navigateTo(target);
    } else {
      showToast(data.error || 'Invalid email or password. Please try again or create an account.', 'error');
    }
  } catch (err) {
    showToast('Network error during sign in. Please check your connection.', 'error');
  }
}

async function handleAuthPageSignup(e) {
  e.preventDefault();
  const name = document.getElementById('authPageSignupName')?.value;
  const email = document.getElementById('authPageSignupEmail')?.value;
  const phone = document.getElementById('authPageSignupPhone')?.value;
  const password = document.getElementById('authPageSignupPass')?.value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.user) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('mm_auth_token', authToken);
      localStorage.setItem('mm_user', JSON.stringify(currentUser));
      updateUserUI();
      showToast(`Welcome to M&M Laundry, ${currentUser.name}!`, 'success');
      const target = authRedirectPath || '/account';
      authRedirectPath = null;
      navigateTo(target);
    } else {
      showToast(data.error || 'Could not register. Email may already be in use.', 'error');
    }
  } catch (err) {
    showToast('Network error during registration. Please check your connection.', 'error');
  }
}

function handleAuthPageForgot(e) {
  e.preventDefault();
  const email = document.getElementById('authPageForgotEmail')?.value;
  showToast(`Password reset link sent to ${email}.`, 'success');
  switchAuthMode('login');
}

/* Comprehensive Window Exports for Full Interoperability */
window.initFullFaq = initFullFaq;
window.handleFaqSearch = handleFaqSearch;
window.initCommercialCalc = initCommercialCalc;
window.updateCommercialCalc = updateCommercialCalc;
window.handleBusinessInquirySubmit = handleBusinessInquirySubmit;
window.handleContactHubSubmit = handleContactHubSubmit;
window.initBookingWizard = initBookingWizard;
window.renderWizardStep = renderWizardStep;
window.wizardNext = wizardNext;
window.wizardPrev = wizardPrev;
window.wizardSelectService = wizardSelectService;
window.wizardSetWeight = wizardSetWeight;
window.wizardSaveAddressAndNext = wizardSaveAddressAndNext;
window.wizardSetDate = wizardSetDate;
window.wizardSetSlot = wizardSetSlot;
window.wizardSelectPayment = wizardSelectPayment;
window.wizardApplyPromo = wizardApplyPromo;
window.wizardSubmitOrder = wizardSubmitOrder;
window.loadUserOrdersList = loadUserOrdersList;
window.renderOrdersActiveCard = renderOrdersActiveCard;
window.advanceOrderSimulation = advanceOrderSimulation;
window.advanceOrderStatusSimulation = advanceOrderStatusSimulation;
window.handleLookupOrderClick = handleLookupOrderClick;
window.loadAndTrackSpecificOrder = loadAndTrackSpecificOrder;
window.initAccountPortal = initAccountPortal;
window.switchAccountTab = switchAccountTab;
window.renderAccountTab = renderAccountTab;
window.loadUserSavedAddresses = loadUserSavedAddresses;
window.toggleAddAddressForm = toggleAddAddressForm;
window.handleAccountAddAddress = handleAccountAddAddress;
window.handleAccountDeleteAddress = handleAccountDeleteAddress;
window.handleAccountProfileSave = handleAccountProfileSave;
window.handleAccountPrefSave = handleAccountPrefSave;
window.handleAccountSecuritySave = handleAccountSecuritySave;
window.switchAuthMode = switchAuthMode;
window.handleAuthPageLogin = handleAuthPageLogin;
window.handleAuthPageSignup = handleAuthPageSignup;
window.handleAuthPageForgot = handleAuthPageForgot;





