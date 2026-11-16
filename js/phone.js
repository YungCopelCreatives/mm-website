// South African mobile numbers, stored the way the app stores them (E.164, +27XXXXXXXXX), so the
// same person finds the same account whether they sign in on the website or in the app.
// Port of the app's src/lib/phone.ts; keep the two in step.

/** 082 555 0175, 0825550175, +27 82 555 0175, 27825550175, 0027 82 555 0175 -> +27825550175 (mobile ranges only), else null. */
export function normaliseSAPhone(input) {
  if (!input) return null;
  let d = String(input).trim().replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  let national;
  if (/^27\d{9}$/.test(d)) national = d.slice(2);
  else if (/^270\d{9}$/.test(d)) national = d.slice(3);
  else if (/^0\d{9}$/.test(d)) national = d.slice(1);
  else if (/^[1-9]\d{8}$/.test(d)) national = d;
  else return null;
  if (!/^(6\d|7\d|8[1-5])/.test(national)) return null;
  return `+27${national}`;
}

/** For profile phone fields: SA mobiles become E.164; other international numbers (+, 10-15 digits) are kept as digits. */
export function normaliseProfilePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const sa = normaliseSAPhone(raw);
  if (sa) return sa;
  const intl = raw.replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{9,14}$/.test(intl) ? intl : undefined; // undefined = invalid
}

/** +27825550175 -> +27 82 555 0175 */
export function formatSAPhone(e164) {
  const m = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `+27 ${m[1]} ${m[2]} ${m[3]}` : (e164 || '');
}

/** Plain-language messages for Firebase phone-auth errors (same wording as the app). */
export function phoneAuthErrorMessage(err) {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'Enter a valid South African mobile number, for example 082 555 0175.';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return "That code isn't right. Check the SMS and try again.";
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This code has expired. Request a new one.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts. Wait a few minutes, or sign in with email instead.';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
    case 'auth/missing-app-credential':
      return "We couldn't confirm this device. Reload the page and try again.";
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/operation-not-allowed':
      return 'Phone sign-in is not available right now. Sign in with email instead.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    default:
      if (/blocked|unusual activity/i.test(msg)) return 'Too many attempts. Wait a few minutes, or sign in with email instead.';
      if (/network/i.test(msg)) return 'No connection. Check your internet and try again.';
      return "We couldn't send or check the code. Try again.";
  }
}
