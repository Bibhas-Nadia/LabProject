/*****************************************************************************
 *  AshokK Laboratory - Booking & Feedback backend  (Google Apps Script)
 *
 *  This script is the "background database" of your website.
 *  Website (script.js)  --POST JSON-->  this script  -->  Google Sheet
 *  Website (script.js)  <--JSON reply-- this script      { status, message, ref }
 *
 *  SHEETS (created automatically):   Bookings | Feedback | Logs
 *
 *  ONLY PLACE YOU MUST EDIT:  CONFIG.SPREADSHEET_ID  (a few lines below)
 *
 *  FIRST-TIME SETUP
 *   1. Paste your Google Sheet ID into CONFIG.SPREADSHEET_ID.
 *   2. Select function  setupSheets  in the toolbar > click Run > Authorize.
 *      (creates the 3 sheets with headings, colours and dropdowns)
 *   3. Run  testBooking  and  testFeedback  once. Check the rows in the sheet
 *      (then delete those test rows).
 *   4. Deploy > New deployment > type "Web app"
 *        Execute as: Me      Who has access: Anyone
 *      Copy the Web App URL  ->  paste in website script.js  ->  SCRIPT_URL
 *   5. In website script.js set  USE_DUMMY_RESPONSE = false
 *
 *  IMPORTANT: every time you change this code, use
 *      Deploy > Manage deployments > (pencil) > Version: New version > Deploy
 *  otherwise the website keeps running the OLD code.
 *
 *  Do NOT rename or re-order the column headings. If you need extra columns,
 *  add them AFTER the last heading.
 *****************************************************************************/


/* =========================  1. SETTINGS (edit here)  ======================== */
var CONFIG = {
  // Google Sheet ID = the long text in the sheet URL:
  // https://docs.google.com/spreadsheets/d/  <THIS_PART>  /edit
  SPREADSHEET_ID: "1z0qEZ8iOeWHHuDK6WJJdtC6kf0PT49GsNoDCx5Xt21k",

  // Sheet (tab) names
  SHEET_BOOKINGS: "Bookings",
  SHEET_FEEDBACK: "Feedback",
  SHEET_LOGS: "Logs",

  TIMEZONE: "Asia/Kolkata",
  LAB_NAME: "Ashok Laboratory",
  LAB_PHONE: "7384513355",

  // ---- E-mail settings
  SEND_PATIENT_EMAIL: true,    // true  -> patient gets a confirmation e-mail after booking (Gmail limit ~100 mails/day)
  LAB_EMAIL: "bibhasdas1205@gmail.com",  // patient replies go here (Reply-To). Also used by testEmail()
  NOTIFY_EMAIL: "",            // e.g. "bibhasdas1205@gmail.com" -> YOU get an alert for every booking/feedback. "" = off

  MAX_DAYS_AHEAD: 90,          // bookings allowed up to this many days in future
  CLOSED_ON_SUNDAY: false,     // true -> reject Sunday dates
  MAX_SUBMISSIONS_PER_HOUR: 5, // per phone number (bookings) / per e-mail (feedback) -> stops spam
  MAX_BODY_CHARS: 20000,       // reject huge requests

  // Time slots - must match "timeSlots" in the website config.json (same spelling)
  // Set to []  to switch this check off.
  ALLOWED_SLOTS: ["7:00 - 9:00 AM", "9:00 - 11:00 AM", "11:00 AM - 1:00 PM", "4:00 - 7:00 PM"],

  // PIN codes you serve. Others are still accepted but flagged in the "Remarks" column.
  SERVED_PINCODES: ["700000", "700001", "700002", "700003", "700004"],

  // Extra-strict mode: accept only these names for "Test / Package / Doctor".
  // Keep false unless you update this list every time you change packages/doctors in config.json.
  ENFORCE_ITEM_LIST: false,
  ALLOWED_ITEMS: [
    "Preventive Health Checkup - BASIC", "Cardiac (Heart) Panel Basic", "Diabetic Basic Profile",
    "Women's Wellness Package", "Senior Citizen Package", "Full Body Checkup",
    "Dr. Lipika D. Mukherjee", "Dr. Devjit Majumdar", "Dr. Monideep Banerjee", "Dr. Sanjib Roy", "Dr. Anita Sen"
  ]
};


/* ====================  2. SHEET HEADINGS (do not rename)  =================== */
var BOOKING_HEADERS = [
  "Booking Ref",            // A  AK123456
"Received At",            // B  when the server got it (India time)
"Service",                // C  Lab Test / Package Booking | Doctor Appointment | Home Sample Collection | Doctor Home Visit
"Booking Type",           // D  appointment | home | doctorvisit
"Item Type",              // E  Package / Lab Test | Doctor | Home Collection
"Test / Package / Doctor",// F
"Visit Date",             // G  2026-10-02
"Visit Date (Readable)",  // H  Friday, 2 October 2026
"Time Slot",              // I
"Patient Name",           // J
"Mobile",                 // K
"Email",                  // L
"Address",                // M  (home / doctor visit only)
"PIN Code",               // N  (home / doctor visit only)
"Notes / Enquiry",        // O
"Booked On",              // P  the day the booking was made
"Status",                 // Q  dropdown: New / Confirmed / Completed / Cancelled
"Remarks",                // Q+1 auto notes + your own notes
"Client Time (UTC)"       // last
];
var BOOKING_STATUS = ["New", "Confirmed", "Sample Collected", "Completed", "Cancelled"];

var FEEDBACK_HEADERS = [
  "Feedback ID",   // A  FB1A2B3C
"Received At",   // B
"Name",          // C
"Email",         // D
"Rating",        // E  1-5
"Message",       // F
"Status",        // G  dropdown: Pending / Approved / Hidden
"Client Time (UTC)" // H
];
var FEEDBACK_STATUS = ["Pending", "Approved", "Hidden"];

var LOG_HEADERS = ["Time", "Type", "Code", "Reason", "Data (first 300 characters)"];

var BOOKING_TYPES = ["appointment", "home", "doctorvisit"];


/* ===========================  3. WEB APP ENTRY POINTS  ====================== */

/** Website sends bookings / feedback here (HTTP POST). */
function doPost(e) {
  var raw = "";
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return fail_("BAD_REQUEST", "No data received.");
    }
    raw = String(e.postData.contents);
    if (raw.length > CONFIG.MAX_BODY_CHARS) {
      return fail_("BAD_REQUEST", "Request is too large.", raw);
    }

    var data;
    try { data = JSON.parse(raw); } catch (parseErr) {
      return fail_("BAD_REQUEST", "Invalid data format.", raw);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return fail_("BAD_REQUEST", "Invalid data format.", raw);
    }

    var kind = clean_(data.type, 20).toLowerCase();
    var result;
    if (kind === "feedback") result = handleFeedback_(data);
    else if (BOOKING_TYPES.indexOf(kind) !== -1) result = handleBooking_(data, kind);
    else result = { status: "error", code: "BAD_REQUEST", message: "Unknown request type." };

    if (result.status !== "success") logEvent_(kind || "unknown", result.code, result.message, raw);
    return json_(result);

  } catch (err) {
    // Never show technical details to the website visitor.
    logEvent_("exception", "SERVER_ERROR", String(err && err.message ? err.message : err), raw);
    return json_({
      status: "error", code: "SERVER_ERROR",
      message: "Sorry, something went wrong on our server. Please call us on " + CONFIG.LAB_PHONE + "."
    });
  }
}

/** Opening the Web App URL in a browser only shows a health message (no data is exposed). */
function doGet() {
  return json_({ status: "success", code: "OK", message: CONFIG.LAB_NAME + " booking service is running." });
}


/* ===============================  4. BOOKINGS  ============================== */
function handleBooking_(d, type) {
  var errors = [];

  // ---- patient details
  var name = clean_(d.name, 60);
  if (!NAME_RE.test(name)) errors.push("Please enter a valid full name (letters only, 2-60 characters).");

  var phone = normalizePhone_(d.phone);
  if (!phone) errors.push("Please enter a valid 10-digit Indian mobile number.");

  var email = clean_(d.email, 254).toLowerCase();
  if (!isValidEmail_(email)) errors.push("Please enter a valid email address.");

  // ---- date & time
  var date = clean_(d.date, 10);
  var dateInfo = checkDate_(date);
  if (dateInfo.error) errors.push(dateInfo.error);

  var slot = clean_(d.slot, 40);
  if (CONFIG.ALLOWED_SLOTS.length && CONFIG.ALLOWED_SLOTS.indexOf(slot) === -1) {
    errors.push("Please choose a valid time slot.");
  }

  // ---- what is being booked (server decides labels; client text is not trusted)
  var item = "", itemType = "", service = "";
  if (type === "home") {
    item = "Home Sample Collection"; itemType = "Home Collection"; service = "Home Sample Collection";
  } else {
    item = clean_(d.item, 120);
    if (item.length < 2) {
      errors.push(type === "doctorvisit" ? "Please select a doctor." : "Please select a lab test, package or doctor.");
    } else if (CONFIG.ENFORCE_ITEM_LIST && !inListI_(CONFIG.ALLOWED_ITEMS, item)) {
      errors.push("Selected test / package / doctor is not available.");
    }
    if (type === "doctorvisit") { itemType = "Doctor"; service = "Doctor Home Visit"; }
    else {
      var sentType = clean_(d.itemType, 40);
      itemType = (sentType === "Doctor") ? "Doctor" : "Package / Lab Test";
      service = (itemType === "Doctor") ? "Doctor Appointment" : "Lab Test / Package Booking";
    }
  }

  // ---- address (only home collection / doctor home visit)
  var address = "", pincode = "";
  if (type !== "appointment") {
    address = clean_(d.address, 300);
    if (address.length < 8) errors.push("Please enter your full address (at least 8 characters).");
    pincode = clean_(d.pincode, 6);
    if (!/^[1-9][0-9]{5}$/.test(pincode)) errors.push("Please enter a valid 6-digit PIN code.");
  }

  // ---- notes
  var enquiry = clean_(d.enquiry, 500);

  if (errors.length) {
    return { status: "error", code: "VALIDATION", message: errors.join(" "), errors: errors };
  }

  // ---- write to sheet (one at a time)
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (lockErr) { return { status: "error", code: "BUSY", message: "Server is busy. Please try again in a moment." }; }

  try {
    var ss = getSpreadsheet_();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_BOOKINGS, BOOKING_HEADERS);
    var C = colMap_(BOOKING_HEADERS);

    var ref = clean_(d.ref, 8);
    if (!/^AK[0-9]{6}$/.test(ref)) ref = "";

    // recent rows -> detect retries & duplicates
    var recent = readRecent_(sheet, BOOKING_HEADERS.length, 300);
    for (var i = recent.length - 1; i >= 0; i--) {
      var row = recent[i];
      var samePerson = String(row[C.mobile]) === phone;
      // same ref + same person = the website retried -> treat as success (no second row)
      if (ref && String(row[C.ref]) === ref && samePerson) {
        return { status: "success", code: "OK", message: "Booking saved successfully.", ref: ref };
      }
      // same person, same day, same item, still active -> duplicate
      if (samePerson && String(row[C.date]) === date && String(row[C.item]) === item &&
        String(row[C.type]) === type && String(row[C.status]) !== "Cancelled") {
        return { status: "error", code: "DUPLICATE",
          message: "You already have a booking for this on " + dateInfo.readable + " (Ref: " + row[C.ref] + "). Please call us to change it." };
        }
    }

    if (isRateLimited_("bk_" + phone)) {
      return { status: "error", code: "RATE_LIMIT", message: "Too many requests from this number. Please try again after some time or call us." };
    }

    // make sure the reference number is unique
    if (!ref || refExists_(sheet, C.ref, ref)) {
      var tries = 0;
      do { ref = "AK" + (100000 + Math.floor(Math.random() * 900000)); tries++; }
      while (refExists_(sheet, C.ref, ref) && tries < 20);
    }

    var remarks = "";
    if (type !== "appointment" && CONFIG.SERVED_PINCODES.length && CONFIG.SERVED_PINCODES.indexOf(pincode) === -1) {
      remarks = "PIN " + pincode + " is outside our usual service area - please confirm by call.";
    }

    var values = [
      ref,                          // Booking Ref
      nowText_(),                   // Received At
      service,                      // Service
      type,                         // Booking Type
      itemType,                     // Item Type
      item,                         // Test / Package / Doctor
      date,                         // Visit Date
      dateInfo.readable,            // Visit Date (Readable)
      slot,                         // Time Slot
      name,                         // Patient Name
      phone,                        // Mobile
      email,                        // Email
      address,                      // Address
      pincode,                      // PIN Code
      enquiry,                      // Notes / Enquiry
      todayText_(),                 // Booked On
      "New",                        // Status
      remarks,                      // Remarks
      clientTime_(d.timestamp)      // Client Time (UTC)
    ];
    appendSafeRow_(sheet, values, BOOKING_HEADERS.indexOf("Status") + 1, BOOKING_STATUS);
    countSubmission_("bk_" + phone);

    var mailJob = null;
    var booking = { ref: ref, service: service, item: item, dateReadable: dateInfo.readable, slot: slot,
      name: name, phone: phone, email: email, address: address, pincode: pincode, notes: enquiry };
      mailJob = booking;   // e-mails are sent in "finally", after the sheet lock is released

      return { status: "success", code: "OK", message: "Booking saved successfully.", ref: ref };

  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
    if (mailJob) sendBookingMails_(mailJob);
  }
}


/* ===============================  5. FEEDBACK  ============================== */
function handleFeedback_(d) {
  var errors = [];

  var name = clean_(d.name, 60);
  if (!NAME_RE.test(name)) errors.push("Please enter a valid name (letters only, 2-60 characters).");

  var email = clean_(d.email, 254).toLowerCase();
  if (!isValidEmail_(email)) errors.push("Please enter a valid email address.");

  var rating = Number(d.rating);
  if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) errors.push("Please choose a rating from 1 to 5 stars.");

  var message = clean_(d.message, 1000);
  if (message.length < 3) errors.push("Please write a short note (at least 3 characters).");

  if (errors.length) {
    return { status: "error", code: "VALIDATION", message: errors.join(" "), errors: errors };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (lockErr) { return { status: "error", code: "BUSY", message: "Server is busy. Please try again in a moment." }; }

  try {
    // identical feedback sent twice within 10 minutes = accidental double click
    var cache = CacheService.getScriptCache();
    var dupKey = "fbdup_" + hash_(email + "|" + message);
    if (cache.get(dupKey)) {
      return { status: "success", code: "OK", message: "Feedback received. Thank you!" };
    }
    if (isRateLimited_("fb_" + email)) {
      return { status: "error", code: "RATE_LIMIT", message: "You have sent several feedbacks recently. Please try again later." };
    }

    var ss = getSpreadsheet_();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_FEEDBACK, FEEDBACK_HEADERS);
    var fbMail = null;
    var id = "FB" + Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();

    var values = [id, nowText_(), name, email, rating, message, "Pending", clientTime_(d.timestamp)];
    appendSafeRow_(sheet, values, FEEDBACK_HEADERS.indexOf("Status") + 1, FEEDBACK_STATUS, FEEDBACK_HEADERS.indexOf("Rating") + 1);

    cache.put(dupKey, "1", 600);
    countSubmission_("fb_" + email);
    fbMail = { id: id, name: name, email: email, rating: rating, message: message };

    return { status: "success", code: "OK", message: "Feedback received. Thank you!", ref: id };

  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
    if (fbMail) sendFeedbackMail_(fbMail);
  }
}


/* ==========================  6. CLEANING & VALIDATION  ====================== */

// Letters (any language, e.g. Bengali/Hindi/English), spaces, dot, apostrophe, hyphen. 2-60 chars.
var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019\-]{1,59}$/u;

/**
 * Makes ANY incoming value safe:
 *  - only text/number accepted (objects, arrays, booleans -> "")
 *  - removes hidden/control/bidi characters
 *  - removes <script>..</script> blocks, every HTML tag and < > `
 *  - removes javascript: / vbscript: / data:text/html
 *  - turns tabs/new-lines into single spaces, trims, cuts to max length
 * (The result is plain text. The website also escapes text before showing it.)
 */
function clean_(value, maxLen) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  var s = String(value);
  try { s = s.normalize("NFC"); } catch (e) { /* ignore */ }
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");         // control chars
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "");                // zero-width / bidi tricks
  s = s.replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ""); // dangerous blocks
  s = s.replace(/<[^>]*>?/g, "");                                                       // any tag (even unclosed)
  s = s.replace(/[<>`]/g, "");                                                          // leftovers
  s = s.replace(/(java|vb)script\s*:/gi, "").replace(/data\s*:\s*text\/html/gi, "");
  s = s.replace(/\s+/g, " ").trim();                                                    // tabs / new lines / double spaces
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

/**
 * Spreadsheet "formula injection" guard: a cell starting with = + - @ could run as a formula
 * when someone opens/exports the sheet. A leading apostrophe makes it plain text.
 */
function cell_(v) {
  if (typeof v !== "string") return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function normalizePhone_(v) {
  if (typeof v !== "string" && typeof v !== "number") return "";
  var s = String(v).replace(/[\s\-().]/g, "");
  if (/^\+91[0-9]{10}$/.test(s)) s = s.slice(3);
  else if (/^91[0-9]{10}$/.test(s)) s = s.slice(2);
  else if (/^0[0-9]{10}$/.test(s)) s = s.slice(1);
  if (!/^[6-9][0-9]{9}$/.test(s)) return "";        // Indian mobiles start with 6-9
  if (/^(\d)\1{9}$/.test(s)) return "";              // 9999999999, 8888888888 ...
  return s;
}

function isValidEmail_(s) {
  if (!s || s.length > 254) return false;
  var m = /^([a-z0-9._%+\-]{1,64})@([a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)*\.[a-z]{2,24})$/.exec(s);
  if (!m) return false;
  if (/\.\./.test(s) || m[1].charAt(0) === "." || m[1].charAt(m[1].length - 1) === ".") return false;
  return true;
}

/** Date must be real, YYYY-MM-DD, not in the past (India time), not too far ahead. */
function checkDate_(iso) {
  var out = { error: "", readable: "" };
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) { out.error = "Please choose a valid date."; return out; }
  var y = +m[1], mo = +m[2], da = +m[3];
  var t = Date.UTC(y, mo - 1, da);
  var dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) {
    out.error = "Please choose a valid date."; return out;
  }
  var tp = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayText_());
  var today = Date.UTC(+tp[1], +tp[2] - 1, +tp[3]);
  var diff = Math.round((t - today) / 86400000);
  if (diff < 0) { out.error = "The selected date is in the past. Please choose today or a later date."; return out; }
  if (diff > CONFIG.MAX_DAYS_AHEAD) { out.error = "Bookings are open only for the next " + CONFIG.MAX_DAYS_AHEAD + " days."; return out; }
  if (CONFIG.CLOSED_ON_SUNDAY && dt.getUTCDay() === 0) { out.error = "We are closed on Sundays. Please choose another date."; return out; }
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  out.readable = days[dt.getUTCDay()] + ", " + da + " " + months[mo - 1] + " " + y;
  return out;
}

function clientTime_(v) {
  var s = clean_(v, 40);
  return /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(s) ? s : "";
}

function inListI_(list, value) {
  var v = String(value).toLowerCase();
  for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === v) return true;
  return false;
}


/* ===============================  7. SPREADSHEET  =========================== */
function getSpreadsheet_() {
  var id = String(CONFIG.SPREADSHEET_ID || "").trim();
  if (!id || id.indexOf("PASTE_YOUR") === 0) {
    throw new Error("CONFIG.SPREADSHEET_ID is not set in the Google Script.");
  }
  return SpreadsheetApp.openById(id);
}

/** Returns the sheet, creating it (with headings) if it does not exist. */
function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  var first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function (c) { return String(c) === ""; });
  if (empty) {
    styleHeader_(sheet, headers);
  } else {
    for (var i = 0; i < headers.length; i++) {
      if (String(first[i]) !== headers[i]) {
        throw new Error('Sheet "' + name + '" heading in column ' + (i + 1) + ' should be "' + headers[i] +
        '" but is "' + first[i] + '". Do not rename/reorder headings.');
      }
    }
  }
  return sheet;
}

function styleHeader_(sheet, headers) {
  var r = sheet.getRange(1, 1, 1, headers.length);
  r.setValues([headers]);
  r.setFontWeight("bold").setFontColor("#ffffff").setBackground("#0e7490")
  .setVerticalAlignment("middle").setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 36);
  for (var c = 1; c <= headers.length; c++) sheet.setColumnWidth(c, widthFor_(headers[c - 1]));
}

function widthFor_(h) {
  if (/Address|Message|Notes|Remarks/.test(h)) return 300;
  if (/Test|Email|Readable/.test(h)) return 220;
  if (/Received|Client|Slot|Name|Service/.test(h)) return 160;
  return 110;
}

function colMap_(headers) {
  function ix(n) { return headers.indexOf(n); }
  return {
    ref: ix("Booking Ref"), type: ix("Booking Type"), item: ix("Test / Package / Doctor"),
    date: ix("Visit Date"), mobile: ix("Mobile"), status: ix("Status")
  };
}

function readRecent_(sheet, width, limit) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var n = Math.min(limit, last - 1);
  return sheet.getRange(last - n + 1, 1, n, width).getValues();
}

function refExists_(sheet, refCol0, ref) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var found = sheet.getRange(2, refCol0 + 1, last - 1, 1).createTextFinder(ref).matchEntireCell(true).findNext();
  return !!found;
}

/**
 * Writes one row. Every cell is sanitised against formula injection and stored as TEXT
 * (so phone numbers / dates / PIN codes are never changed by Google Sheets).
 */
function appendSafeRow_(sheet, values, statusCol, statusList, numberCol) {
  var row = sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, values.length);
  var formats = [], safe = [];
  for (var i = 0; i < values.length; i++) {
    var isNum = numberCol && i === numberCol - 1;
    formats.push(isNum ? "0" : "@");
    safe.push(isNum ? values[i] : cell_(String(values[i])));
  }
  range.setNumberFormats([formats]);
  range.setValues([safe]);
  range.setVerticalAlignment("top");

  if (statusCol && statusList) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(statusList, true).setAllowInvalid(false).build();
    sheet.getRange(row, statusCol).setDataValidation(rule);
  }
}


/* ============================  8. RATE LIMIT & TIME  ======================== */
function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function isRateLimited_(key) {
  var n = parseInt(CacheService.getScriptCache().get("rl_" + hash_(key)) || "0", 10);
  return n >= CONFIG.MAX_SUBMISSIONS_PER_HOUR;
}
function countSubmission_(key) {
  var cache = CacheService.getScriptCache(), k = "rl_" + hash_(key);
  var n = parseInt(cache.get(k) || "0", 10);
  cache.put(k, String(n + 1), 3600);
}

function nowText_()   { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss"); }
function todayText_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd"); }


/* ==============================  9. E-MAIL  ================================ */
function mailSafe_(s) { return String(s || "").replace(/[\r\n]+/g, " "); }   // no header injection
function esc_(s) {                                                          // HTML-escape (XSS safe e-mail)
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sends the lab alert and the patient confirmation. Each has its own try/catch,
 *  so one failing never blocks the other or the booking itself. Errors go to the "Logs" sheet. */
function sendBookingMails_(b) {
  if (CONFIG.NOTIFY_EMAIL) {
    try {
      MailApp.sendEmail({
        to: CONFIG.NOTIFY_EMAIL, name: CONFIG.LAB_NAME,
        subject: mailSafe_("New booking " + b.ref + " - " + b.service + " - " + b.dateReadable),
                        body: ["New booking received", "",
                        "Ref: " + b.ref, "Service: " + b.service, "Item: " + b.item,
                        "Date: " + b.dateReadable, "Time: " + b.slot, "",
                        "Patient: " + b.name, "Mobile: " + b.phone, "Email: " + b.email,
                        (b.address ? "Address: " + b.address + " - " + b.pincode : ""),
                        (b.notes ? "Notes: " + b.notes : "")].filter(String).join("\n")
      });
    } catch (err) { logMailError_("lab alert", err); }
  }

  if (CONFIG.SEND_PATIENT_EMAIL && b.email) {
    try {
      MailApp.sendEmail(patientMail_(b, b.email));
    } catch (err) { logMailError_("patient confirmation to " + b.email, err); }
  }
}

/** Builds the patient confirmation (plain text + nice HTML). All values are escaped. */
function patientMail_(b, to) {
  var rows = [
    ["Booking Ref", b.ref],
    ["Service", b.service],
    (b.item && b.item !== b.service) ? ["Test / Package / Doctor", b.item] : null,
    ["Date", b.dateReadable],
    ["Time", b.slot],
    ["Patient", b.name],
    ["Mobile", b.phone],
    b.address ? ["Address", b.address + (b.pincode ? " - " + b.pincode : "")] : null,
    b.notes ? ["Notes", b.notes] : null
  ].filter(Boolean);

  var text = ["Dear " + b.name + ",", "",
  "Thank you for booking with " + CONFIG.LAB_NAME + ". Your booking request is received.", ""]
  .concat(rows.map(function (r) { return r[0] + ": " + r[1]; }))
  .concat(["", "Our team will call you on " + b.phone + " to confirm.",
          "Need help? Call " + CONFIG.LAB_PHONE + ".", "", CONFIG.LAB_NAME]).join("\n");

          var trs = rows.map(function (r) {
            return '<tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap">' + esc_(r[0]) +
            '</td><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e2e8f0">' + esc_(r[1]) + '</td></tr>';
          }).join("");
          var html =
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#0f172a">' +
          '<div style="background:#0e7490;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">' + esc_(CONFIG.LAB_NAME) + '</div>' +
          '<div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 12px 12px">' +
          '<p style="margin:0 0 6px">Dear <b>' + esc_(b.name) + '</b>,</p>' +
          '<p style="margin:0 0 16px">Thank you for booking with us. <b style="color:#16a34a">Your booking request is received.</b></p>' +
          '<table style="border-collapse:collapse;width:100%;font-size:14px">' + trs + '</table>' +
          '<p style="margin:16px 0 4px">Our team will call you on <b>' + esc_(b.phone) + '</b> to confirm.</p>' +
          '<p style="margin:0;color:#64748b;font-size:13px">Need help? Call ' + esc_(CONFIG.LAB_PHONE) + '. Please keep your booking reference handy.</p>' +
          '</div></div>';

          var mail = { to: to, name: CONFIG.LAB_NAME, subject: mailSafe_("Booking received - Ref " + b.ref + " | " + CONFIG.LAB_NAME), body: text, htmlBody: html };
          if (CONFIG.LAB_EMAIL) mail.replyTo = CONFIG.LAB_EMAIL;
          return mail;
}

function sendFeedbackMail_(f) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL, name: CONFIG.LAB_NAME,
      subject: mailSafe_("New feedback " + f.id + " - " + f.rating + " stars"),
                      body: ["ID: " + f.id, "Name: " + f.name, "Email: " + f.email, "Rating: " + f.rating + "/5", "", f.message].join("\n")
    });
  } catch (err) { logMailError_("feedback alert", err); }
}

function logMailError_(what, err) {
  var quota = "";
  try { quota = " (mails left today: " + MailApp.getRemainingDailyQuota() + ")"; } catch (e) { /* ignore */ }
  logEvent_("mail", "MAIL_ERROR", what + ": " + String(err && err.message ? err.message : err) + quota, "");
}


/* ==============================  10. LOG & REPLIES  ========================= */
/** Writes rejected requests / errors to the "Logs" sheet. Never throws. */
function logEvent_(type, code, reason, payload) {
  try {
    var sheet = ensureSheet_(getSpreadsheet_(), CONFIG.SHEET_LOGS, LOG_HEADERS);
    var row = [nowText_(), clean_(type, 30), clean_(code, 30), clean_(reason, 300), clean_(payload, 300)];
    appendSafeRow_(sheet, row);
  } catch (e) {
    console.error("Log failed: " + e);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code, message, payload) {
  logEvent_("request", code, message, payload || "");
  return json_({ status: "error", code: code, message: message });
}


/* ==========================  11. RUN THESE FROM THE EDITOR  ================= */

/** Run ONCE first: creates the 3 sheets with headings, colours and status dropdowns. */
function setupSheets() {
  var ss = getSpreadsheet_();
  var b = ensureSheet_(ss, CONFIG.SHEET_BOOKINGS, BOOKING_HEADERS);
  var f = ensureSheet_(ss, CONFIG.SHEET_FEEDBACK, FEEDBACK_HEADERS);
  ensureSheet_(ss, CONFIG.SHEET_LOGS, LOG_HEADERS);

  // dropdowns for the whole Status column (rows 2-5000) so you can also add rows by hand
  var bRule = SpreadsheetApp.newDataValidation().requireValueInList(BOOKING_STATUS, true).setAllowInvalid(false).build();
  b.getRange(2, BOOKING_HEADERS.indexOf("Status") + 1, 4999, 1).setDataValidation(bRule);
  var fRule = SpreadsheetApp.newDataValidation().requireValueInList(FEEDBACK_STATUS, true).setAllowInvalid(false).build();
  f.getRange(2, FEEDBACK_HEADERS.indexOf("Status") + 1, 4999, 1).setDataValidation(fRule);

  // remove the empty default "Sheet1" if it is still there
  var s1 = ss.getSheetByName("Sheet1");
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);

  Logger.log("Done. Sheets ready: " + [CONFIG.SHEET_BOOKINGS, CONFIG.SHEET_FEEDBACK, CONFIG.SHEET_LOGS].join(", "));
}

/** Sends a fake booking through the real code path (delete the test row afterwards). */
function testBooking() {
  var d = new Date(); d.setDate(d.getDate() + 1);
  var fake = { postData: { contents: JSON.stringify({
    type: "home", ref: "AK000000", date: Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd"),
                                                    slot: CONFIG.ALLOWED_SLOTS[0] || "7:00 - 9:00 AM", name: "Test Patient", phone: "9876543210",
                                                    email: "test@example.com", address: "12 Test Road, Jodhpur Park", pincode: "700068",
                                                    enquiry: "TEST ONLY - please delete", timestamp: new Date().toISOString()
  }) } };
  Logger.log(doPost(fake).getContent());
}

/** Sends fake feedback through the real code path (delete the test row afterwards). */
function testFeedback() {
  var fake = { postData: { contents: JSON.stringify({
    type: "feedback", name: "Test User", email: "test@example.com", rating: 5,
    message: "TEST ONLY - please delete", timestamp: new Date().toISOString()
  }) } };
  Logger.log(doPost(fake).getContent());
}

/**
 * Run this to TEST e-mail sending. It sends a sample patient confirmation to CONFIG.LAB_EMAIL.
 * The first time, Google asks you to allow "Send email as you" -> click Allow.
 * If something is wrong, the error is shown in the Execution log below (not hidden).
 */
function testEmail() {
  var to = CONFIG.LAB_EMAIL || CONFIG.NOTIFY_EMAIL;
  if (!to) throw new Error("Set CONFIG.LAB_EMAIL first.");
  var b = { ref: "AK000000", service: "Home Sample Collection", item: "Home Sample Collection",
    dateReadable: "Test date", slot: "7:00 - 9:00 AM", name: "Test Patient", phone: "9876543210",
    email: to, address: "12 Test Road, Jodhpur Park", pincode: "700068", notes: "" };
    Logger.log("Mails you can still send today: " + MailApp.getRemainingDailyQuota());
    MailApp.sendEmail(patientMail_(b, to));
    Logger.log("Test e-mail sent to " + to + ". Check Inbox AND Spam.");
}
