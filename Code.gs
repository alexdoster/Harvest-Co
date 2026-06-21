// ============================================================
// Harvest & Co Scheduling App — Code.gs
// ============================================================
// This file runs on Google's servers, not in the browser.
// It reads and writes to Google Sheets, and responds to
// requests from the frontend (Index.html).
//
// HOW APPS SCRIPT WORKS:
// Functions here are called from the browser using:
//   google.script.run.withSuccessHandler(callback).functionName(args)
// The callback runs when the server responds with a return value.
// You cannot share variables between this file and Index.html —
// they run in completely separate environments.
// ============================================================


// ============================================================
// CONFIGURATION
// The only things you need to change if moving to a new sheet.
// ============================================================

// Your Google Sheet ID — found in the URL between /d/ and /edit
const SHEET_ID = '1W9vwgk2Dji6CpZezud4XjyIRSH1r0rTaTHQLlbIYDJs';

// Exact tab names in the spreadsheet.
// If you rename a tab, update the matching value here.
const SHEETS = {
  FACT:    'FACT_Schedule',
  CHEF:    'DIM_Chef',
  PRODUCT: 'DIM_Product',
  STORE:   'DIM_Store',
  ADMIN:   'DIM_Admin'
};

// Dropdown option lists — defined here so the frontend and backend
// always use exactly the same values without duplicating them.
const COAT_SIZES  = ['S', 'M', 'L', 'XL', 'XXL'];
const CHEF_TYPES  = ['Cook', 'Shift Lead', 'Manager'];
const STATUS_VALS = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled'];


// ============================================================
// ENTRY POINT
// ============================================================
// doGet() runs automatically when someone visits the web app URL.
// It loads Index.html and serves it as the page the user sees.
// You should never need to change this.
// ============================================================

function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')   // loads Index.html
    .setTitle('Harvest & Co Scheduling')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ============================================================
// AUTH & SESSION
// Controls who can access the app and what they can see.
// ============================================================

// Called when the app first loads.
// Returns an object describing the user's role:
//   role: 'chef'     — email matched an active row in DIM_Chef
//   role: 'operator' — email matched an active row in DIM_Admin
//   role: 'denied'   — email not found in either table
//
// Chefs see a read-only schedule + their own profile.
// Operators see the full calendar, entry form, and roster.
// Denied users see an access denied screen.
//
// NOTE: The Active flag is checked on both tables so you can
// deactivate a user without deleting their record.
function getUserContext() {
  const email = Session.getActiveUser().getEmail();
  Logger.log('Email detected: ' + email);

  // Check DIM_Chef first
  const chefs = getSheetData(SHEETS.CHEF);
  const chefMatch = chefs.find(r =>
    (r.Chef_Email || '').toLowerCase() === email.toLowerCase() &&
    r.Active !== false &&
    String(r.Active).toUpperCase() !== 'FALSE' &&
    String(r.Active).toUpperCase() !== 'N'
  );
  if (chefMatch) {
    return {
      role:     'chef',
      email:    email,
      chefId:   chefMatch.Chef_ID,
      chefName: chefMatch.Chef_Name,
      dc:       chefMatch.Chef_DC || chefMatch.DC
    };
  }

  // Check DIM_Admin
  const admins = getSheetData(SHEETS.ADMIN);
  const adminMatch = admins.find(r =>
    (r.Admin_Email || '').toLowerCase() === email.toLowerCase() &&
    r.Active !== false &&
    String(r.Active).toUpperCase() !== 'FALSE' &&
    String(r.Active).toUpperCase() !== 'N'
  );
  if (adminMatch) {
    return { role: 'operator', email: email, name: adminMatch.Admin_Name };
  }

  return { role: 'denied', email: email };
}

// Returns the DC the operator last selected.
// Stored in Google's UserProperties — persists between sessions.
function getSavedDC() {
  return PropertiesService.getUserProperties().getProperty('selectedDC') || '';
}

// Saves the operator's selected DC so it's restored next visit.
function saveDC(dc) {
  PropertiesService.getUserProperties().setProperty('selectedDC', dc);
  return true;
}


// ============================================================
// GENERIC SHEET HELPERS
// Low-level utilities used by all other functions.
// ============================================================

// Opens a sheet tab by name. Throws a clear error if the tab
// doesn't exist (rather than failing silently downstream).
function getSheet(name) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

// Reads all rows from a sheet and returns them as an array of objects.
// Each object represents one row, keyed by column header name.
//
// IMPORTANT: Date objects from Sheets are converted to 'YYYY-MM-DD' strings
// here so they survive JSON serialization back to the browser correctly.
// Exception: time columns (Time_Start, Time_End) are kept as-is since
// formatTime() handles them separately using UTC hours.
const TIME_COLUMNS = ['Time_Start', 'Time_End'];
function getSheetData(sheetName) {
  const sheet = getSheet(sheetName);
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = r[i];
        // Convert Date objects to ISO strings to ensure clean JSON serialization,
        // EXCEPT for time columns which are handled by formatTime() instead.
        if (val instanceof Date && TIME_COLUMNS.indexOf(h) === -1) {
          val = normaliseDate(val);
        }
        obj[h] = val;
      });
      return obj;
    });
}

// Returns just the header row for a sheet (column names in order).
// Used when writing new rows so we know which column each value belongs in.
function getSheetHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}


// ============================================================
// DATE / TIME HELPERS
// These exist because Google Sheets handles dates and times in
// ways that require special handling in Apps Script.
// ============================================================

// Converts a date value from Sheets to a 'YYYY-MM-DD' string.
//
// WHY THIS IS NEEDED:
// Sheets stores date-only cells as midnight UTC Date objects.
// Using Utilities.formatDate() with a US timezone (which is behind UTC)
// shifts midnight UTC to the previous evening, giving the wrong date.
// Reading UTC components directly avoids this timezone shift entirely.
function normaliseDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    // Read UTC components directly to avoid timezone shift
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  const str = String(val).trim();
  // ISO format: '2026-03-15' or '2026-03-15 12:00:00'
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  // US format: '3/22/2026' or '03/22/2026' — happens when Sheets
  // stores the date as text rather than a Date object
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split('/');
    const y = parts[2].substring(0, 4);
    const m = parts[0].padStart(2, '0');
    const d = parts[1].padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return str.substring(0, 10);
}

// Converts a time value from Sheets to a 'HH:MM' string.
//
// WHY THIS IS NEEDED:
// Sheets stores time-only values as a decimal fraction of a day.
// For example: 10:00 AM = 10/24 = 0.4167, noon = 0.5, 6:00 PM = 0.75
// When Apps Script reads a time cell it returns a Date object set to
// that fraction of midnight UTC (e.g. 10:00 = 10 hours past midnight UTC).
// Using getHours() applies local timezone offset and shifts the time back,
// causing the same off-by-hours bug as dates. Use getUTCHours() instead.
function formatTime(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    // Use UTC hours/minutes — same reason as normaliseDate uses UTC components
    return String(val.getUTCHours()).padStart(2, '0') + ':' + String(val.getUTCMinutes()).padStart(2, '0');
  }
  if (typeof val === 'number') {
    // Decimal fraction — convert to total minutes then to HH:MM
    const totalMins = Math.round(val * 24 * 60);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  // Already a string like '10:00 AM' or '10:00' — normalise to HH:MM 24hr
  const str = String(val).trim();
  // Handle '10:00 AM' / '06:00 PM' format from sample data
  const ampm = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const mins = ampm[2];
    const period = ampm[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return String(h).padStart(2, '0') + ':' + mins;
  }
  return str.substring(0, 5);
}

// Converts a 'HH:MM' string back to a Sheets time fraction for writing.
// e.g. '10:00' → 0.4167,  '18:00' → 0.75
function parseTimeToFraction(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return '';
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (h * 60 + m) / (24 * 60);
}

// Determines whether a product is currently active based on its date range.
// Rules:
//   Active_Date blank   → product is active with no start restriction
//   Inactive_Date blank → product has no end date (ongoing)
//   Today before Active_Date   → not yet active
//   Today after Inactive_Date  → expired
//
// Handles Date objects, ISO strings ('2026-01-01'), and datetime strings
// ('2026-01-01 00:00:00') since Sheets may return any of these formats.
function isProductActive(product) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function toDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    const str = String(val).trim();
    // ISO datetime: '2026-01-01 00:00:00' or ISO date: '2026-01-01'
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str.substring(0, 10));
    // US format: '1/1/2026' or '01/01/2026'
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
      const parts = str.split('/');
      return new Date(parts[2].substring(0,4) + '-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0'));
    }
    return new Date(str);
  }

  const activeDate   = toDate(product.Active_Date);
  const inactiveDate = toDate(product.Inactive_Date);
  if (activeDate   && today < activeDate)   return false;
  if (inactiveDate && today > inactiveDate) return false;
  return true;
}


// ============================================================
// DIMENSION DATA
// Returns all reference tables in one server call so the
// frontend only needs one round trip on startup.
// ============================================================

function getDimData() {
  try {
    const chefs    = getSheetData(SHEETS.CHEF);
    const products = getSheetData(SHEETS.PRODUCT);
    const stores   = getSheetData(SHEETS.STORE);

    // Only return the store fields the frontend actually needs.
    // Returning all 13 columns for 529 stores approaches Apps Script's
    // response size limit and can silently drop the callback.
    const slimStores = stores.map(s => ({
      Store_ID:        s.Store_ID,
      'Store Name':    s['Store Name'],
      Region:          s.Region,
      DC:              s.DC,
      'Street Address':s['Street Address'],
      City:            s.City,
      State:           s.State,
      Zip:             s.Zip,
      Active:          s.Active,
      Preferences:     s.Preferences,
      Notes:           s.Notes
    }));

    const dcSet = new Set();
    slimStores.forEach(s => { if (s.DC) dcSet.add(s.DC); });
    const dcs = Array.from(dcSet).sort();

    products.forEach(p => {
      try {
        p.isActive = isProductActive(p);
      } catch(e) {
        p.isActive = true;
      }
    });

    return {
      chefs, products, stores: slimStores, dcs,
      coatSizes:  COAT_SIZES,
      chefTypes:  CHEF_TYPES,
      statusVals: STATUS_VALS
    };
  } catch(e) {
    // Return a minimal object so the frontend can show the error
    // instead of crashing silently with STATE.dims null
    throw new Error('getDimData failed: ' + e.message);
  }
}


// ============================================================
// SCHEDULE DATA — monthly calendar query
// Fetches all schedule rows for a DC and date range.
// Called when the calendar month changes or data is refreshed.
//
// Parameters:
//   dc       — selected DC name, or 'ALL' to show everything
//   startStr — first date in range, format 'YYYY-MM-DD'
//   endStr   — last date in range, format 'YYYY-MM-DD'
// ============================================================

function getScheduleForRange(dc, startStr, endStr) {
  const rows     = getSheetData(SHEETS.FACT);
  const chefs    = getSheetData(SHEETS.CHEF);
  const stores   = getSheetData(SHEETS.STORE);
  const products = getSheetData(SHEETS.PRODUCT);

  // Build lookup maps keyed by ID for fast access (O(1) vs O(n) search)
  const chefMap    = {}; chefs.forEach(c    => { chefMap[c.Chef_ID]       = c; });
  const storeMap   = {}; stores.forEach(s   => { storeMap[s.Store_ID]     = s; });
  const productMap = {}; products.forEach(p => { productMap[p.Product_ID] = p; });

  // Filter by DC and date range using string comparison.
  // String comparison works for ISO dates because the format is sortable.
  const filtered = rows.filter(r => {
    if (r.Status === 'Deleted') return false;
    if (dc !== 'ALL' && r.DC !== dc) return false;
    const ds = normaliseDate(r.Date);
    return ds >= startStr && ds <= endStr;
  });

  // Return a clean flat object for each row with names resolved from lookups.
  // The || fallback handles cases where a lookup fails (e.g. a deleted chef).
  return filtered.map(r => {
    const chef  = chefMap[r.Chef_ID]       || {};
    const store = storeMap[r.Store_ID]     || {};
    const prod  = productMap[r.Product_ID] || {};
    return {
      id:          r.Schedule_ID,
      dc:          r.DC,
      date:        normaliseDate(r.Date),
      timeStart:   formatTime(r.Time_Start),
      timeEnd:     formatTime(r.Time_End),
      chefId:      r.Chef_ID,
      chefName:    chef.Chef_Name      || r.Chef_ID,
      storeId:     r.Store_ID,
      storeName:   store['Store Name'] || r.Store_ID,
      productId:   r.Product_ID,
      productName: prod.Product_Name   || r.Product_ID,
      status:      r.Status,
      notes:       r.Notes || ''
    };
  });
}


// ============================================================
// CHEF SCHEDULE
// Returns all schedule entries for a specific chef.
// Used for the chef's read-only schedule view.
// Cancelled and Deleted entries are excluded.
// The isPast flag lets the frontend grey out past visits.
// chefType is included so the frontend can show the Shift Lead
// Visit Report button for the appropriate chef type.
// ============================================================

function getChefSchedule(chefId) {
  const rows     = getSheetData(SHEETS.FACT);
  const stores   = getSheetData(SHEETS.STORE);
  const products = getSheetData(SHEETS.PRODUCT);
  const storeMap   = {}; stores.forEach(s   => { storeMap[s.Store_ID]     = s; });
  const productMap = {}; products.forEach(p => { productMap[p.Product_ID] = p; });
  const chefMap    = {}; getSheetData(SHEETS.CHEF).forEach(c => { chefMap[c.Chef_ID] = c; });

  const todayStr = normaliseDate(new Date());

  return rows
    .filter(r => String(r.Chef_ID) === String(chefId) && r.Status !== 'Cancelled' && r.Status !== 'Deleted')
    .map(r => {
      const ds    = normaliseDate(r.Date);
      const store = storeMap[r.Store_ID]     || {};
      const prod  = productMap[r.Product_ID] || {};

      return {
        id:           r.Schedule_ID,
        dc:           r.DC,
        date:         ds,
        timeStart:    formatTime(r.Time_Start),
        timeEnd:      formatTime(r.Time_End),
        chefId:       r.Chef_ID,
        storeId:      r.Store_ID,
        storeName:    store['Store Name']     || r.Store_ID,
        storeAddress: store['Street Address'] || '',
        storeCity:    store.City              || '',
        storeState:   store.State             || '',
        storeZip:     store.Zip               || '',
        storeNotes:   store.Notes             || '',
        notes:        r.Notes                 || '',
        productId:    r.Product_ID,
        productName:  prod.Product_Name       || r.Product_ID,
        productInfo:  prod.Product_Info       || '',
        status:       r.Status,
        isPast:       ds < todayStr,
        chefType:     (chefMap[r.Chef_ID] || {}).Chef_Type || ''
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Returns the full DIM_Chef record for a single chef.
// Used when loading the chef's profile edit form.
function getChefProfile(chefId) {
  const chefs = getSheetData(SHEETS.CHEF);
  return chefs.find(c => c.Chef_ID === chefId) || null;
}


// ============================================================
// UPDATE CHEF PROFILE (chef self-edit)
// Chefs can update only their own contact/personal info.
// Identity and role fields are locked to prevent self-promotion.
//
// Editable:   Chef_Phone, Address, Coat_Size, Availability
// Read-only:  Chef_ID, Chef_Name, Chef_DC, Chef_Email, Chef_Type, Active
// ============================================================

function updateChefProfile(chefId, updates) {
  const sheet   = getSheet(SHEETS.CHEF);
  const headers = getSheetHeaders(SHEETS.CHEF);
  const idCol   = headers.indexOf('Chef_ID');
  const data    = sheet.getDataRange().getValues();

  const EDITABLE = ['Chef_Phone', 'Address', 'Coat_Size', 'Availability'];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(chefId)) {
      EDITABLE.forEach(field => {
        if (updates[field] !== undefined) {
          const col = headers.indexOf(field);
          // col + 1 because Sheets columns are 1-indexed but headers array is 0-indexed
          if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(updates[field]);
        }
      });
      return { success: true };
    }
  }
  return { success: false, error: 'Chef not found' };
}


// ============================================================
// CREATE SCHEDULE ENTRIES
// Writes one or more new rows to FACT_Schedule.
// Called when the operator saves a new entry from the side panel.
//
// The entries parameter is an array of objects, one per product
// (each product the chef is demoing creates its own row):
//   [{ dc, date, chefId, storeId, productId, status, timeStart, timeEnd, notes }, ...]
//
// Returns how many rows were created and how many were skipped
// as exact duplicates (same DC + date + chef + store + product).
// ============================================================

function createScheduleEntries(entries) {
  const sheet   = getSheet(SHEETS.FACT);
  const headers = getSheetHeaders(SHEETS.FACT);
  const allRows = getSheetData(SHEETS.FACT);

  // Build a Set of fingerprints for existing rows to detect duplicates.
  // Joining the key fields with '|' creates a unique string per combination.
  const existingKeys = new Set(
    allRows
      .filter(r => r.Status !== 'Deleted')
      .map(r => [r.DC, normaliseDate(r.Date), r.Chef_ID, r.Store_ID, r.Product_ID].join('|'))
  );

  // Find the highest existing Schedule_ID so new rows get the next number
  let maxId = 0;
  allRows.forEach(r => {
    const n = parseInt(r.Schedule_ID, 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  });

  const now = new Date();
  const duplicates = [];
  const newRows    = [];

  entries.forEach(e => {
    const key = [e.dc, e.date, e.chefId, e.storeId, e.productId].join('|');
    if (existingKeys.has(key)) { duplicates.push(key); return; } // skip exact duplicate

    maxId++;
    const row = {};
    row['Schedule_ID'] = maxId;
    row['DC']          = e.dc;
    // Use noon (T12:00:00) to prevent date shifting across timezones
    row['Date']        = new Date(e.date + 'T12:00:00');
    row['Chef_ID']     = e.chefId;
    row['Store_ID']    = e.storeId;
    row['Product_ID']  = e.productId;
    row['Status']      = e.status || 'Scheduled';
    // Convert HH:MM strings to Sheets time fractions; default to 10am-6pm
    row['Time_Start']  = e.timeStart ? parseTimeToFraction(e.timeStart) : parseTimeToFraction('10:00');
    row['Time_End']    = e.timeEnd   ? parseTimeToFraction(e.timeEnd)   : parseTimeToFraction('18:00');
    row['Notes']       = e.notes || '';
    row['Created_At']  = now;
    row['Updated_At']  = now;

    // Convert the named object into an array ordered by the sheet's column headers
    newRows.push(headers.map(h => row[h] !== undefined ? row[h] : ''));
  });

  if (newRows.length > 0) {
    // Use column A (Schedule_ID) to find the true last data row.
    // sheet.getLastRow() is fooled by ArrayFormulas in other columns
    // (like the Chef_Name VLOOKUP in column M) which extend far down the sheet.
    const colAValues = sheet.getRange('A:A').getValues();
    let lastDataRow = 1; // start at 1 to skip header
    for (let i = colAValues.length - 1; i >= 1; i--) {
      if (colAValues[i][0] !== '' && colAValues[i][0] !== null) {
        lastDataRow = i + 1; // +1 because getValues is 0-indexed, Sheets is 1-indexed
        break;
      }
    }
    const firstNewRow = lastDataRow + 1;

    // Write all rows in one operation (far more efficient than writing row by row)
    sheet.getRange(firstNewRow, 1, newRows.length, headers.length).setValues(newRows);

    // Apply display formats to the new rows.
    // Without this, Sheets may show times as decimals or timestamps as dates only.
    const timeStartCol = headers.indexOf('Time_Start') + 1;
    const timeEndCol   = headers.indexOf('Time_End')   + 1;
    const createdCol   = headers.indexOf('Created_At') + 1;
    const updatedCol   = headers.indexOf('Updated_At') + 1;

    if (timeStartCol > 0) sheet.getRange(firstNewRow, timeStartCol, newRows.length, 1).setNumberFormat('hh:mm am/pm');
    if (timeEndCol   > 0) sheet.getRange(firstNewRow, timeEndCol,   newRows.length, 1).setNumberFormat('hh:mm am/pm');
    if (createdCol   > 0) sheet.getRange(firstNewRow, createdCol,   newRows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    if (updatedCol   > 0) sheet.getRange(firstNewRow, updatedCol,   newRows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  return { success: true, created: newRows.length, skipped: duplicates.length };
}


// ============================================================
// UPDATE SCHEDULE ENTRY
// General-purpose update function that handles status changes,
// product swaps, reschedules, time changes, and notes in one call.
//
// Pass only the fields you want to change in the updates object.
// Example: updateScheduleEntry(42, { Status: 'Confirmed', Notes: 'Store confirmed by phone' })
//
// Special handling:
//   Time_Start / Time_End — strings are converted to Sheets fractions
//   Date                  — strings are parsed with noon time to avoid shift
//   All other fields      — written as-is
//
// Updated_At is always stamped regardless of what changed.
// ============================================================

function updateScheduleEntry(scheduleId, updates) {
  const sheet   = getSheet(SHEETS.FACT);
  const headers = getSheetHeaders(SHEETS.FACT);
  const idCol   = headers.indexOf('Schedule_ID') + 1;
  const updCol  = headers.indexOf('Updated_At')  + 1;
  const data    = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol - 1]) === String(scheduleId)) {
      Object.keys(updates).forEach(field => {
        const col = headers.indexOf(field) + 1;
        if (col > 0) {
          let val = updates[field];
          if ((field === 'Time_Start' || field === 'Time_End') && typeof val === 'string') {
            val = parseTimeToFraction(val);
            sheet.getRange(i + 1, col).setValue(val);
            sheet.getRange(i + 1, col).setNumberFormat('hh:mm am/pm');
          } else if (field === 'Date') {
            sheet.getRange(i + 1, col).setValue(new Date(val + 'T12:00:00'));
            sheet.getRange(i + 1, col).setNumberFormat('yyyy-mm-dd');
          } else {
            sheet.getRange(i + 1, col).setValue(val);
          }
        }
      });
      if (updCol > 0) {
        sheet.getRange(i + 1, updCol).setValue(new Date());
        sheet.getRange(i + 1, updCol).setNumberFormat('yyyy-mm-dd hh:mm:ss');
      }
      return { success: true };
    }
  }
  return { success: false, error: 'Record not found' };
}


// ============================================================
// DELETE SCHEDULE ENTRY (soft delete)
// Sets Status = 'Deleted' instead of removing the row.
// This preserves data integrity and allows recovery.
// Deleted entries are hidden from all views by default.
// ============================================================

function deleteScheduleEntry(scheduleId) {
  return updateScheduleEntry(scheduleId, { Status: 'Deleted' });
}


// ============================================================
// DIMENSION RECORD MANAGEMENT
// Handles add and edit operations for DIM_Chef, DIM_Store,
// and DIM_Product from the Roster tab.
//
// saveDimRecord() automatically detects whether the record
// is new (insert) or existing (update) by matching on the ID field.
// ============================================================

function saveDimRecord(dimType, record) {
  // Map the dimType string to the actual sheet name and primary key field
  const sheetName = { chef: SHEETS.CHEF, product: SHEETS.PRODUCT, store: SHEETS.STORE }[dimType];
  const idField   = { chef: 'Chef_ID', product: 'Product_ID', store: 'Store_ID' }[dimType];

  const sheet   = getSheet(sheetName);
  const headers = getSheetHeaders(sheetName);
  const data    = sheet.getDataRange().getValues();
  const idCol   = headers.indexOf(idField);  // 0-indexed for array access

  // Search for an existing row with the same ID (update path)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(record[idField])) {
      // Build the updated row — use the record value if provided,
      // otherwise keep the existing cell value (preserves fields not in the form)
      const newRow = headers.map(h => record[h] !== undefined ? record[h] : data[i][headers.indexOf(h)]);
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([newRow]);
      return { success: true, action: 'updated' };
    }
  }

  // No match found — append as a new row (insert path)
  const newRow = headers.map(h => record[h] !== undefined ? record[h] : '');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([newRow]);
  return { success: true, action: 'created' };
}

// Toggles the Active flag on any dimension record.
// Not currently wired to a UI button but available for future use.
function toggleDimActive(dimType, id, active) {
  const sheetName = { chef: SHEETS.CHEF, product: SHEETS.PRODUCT, store: SHEETS.STORE }[dimType];
  const idField   = { chef: 'Chef_ID', product: 'Product_ID', store: 'Store_ID' }[dimType];
  const sheet     = getSheet(sheetName);
  const headers   = getSheetHeaders(sheetName);
  const idCol     = headers.indexOf(idField) + 1;
  const actCol    = headers.indexOf('Active') + 1;
  const data      = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol - 1]) === String(id)) {
      sheet.getRange(i + 1, actCol).setValue(active);
      return { success: true };
    }
  }
  return { success: false, error: 'Record not found' };
}
