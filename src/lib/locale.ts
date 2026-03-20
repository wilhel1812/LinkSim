// Timezone-based locale formatting utilities
// Determines appropriate time/date formats based on user's timezone region

/**
 * Check if a timezone region typically uses 24-hour time format
 * Most of the world uses 24-hour time; 12-hour is mainly used in Americas and some specific regions
 */
function regionUses24HourTime(timeZone: string): boolean {
  // Known 12-hour time regions (prefix matching)
  const twelveHourRegionPrefixes = [
    'America/', // Most of North/South America uses 12-hour
    'Pacific/Honolulu', // Hawaii
    'Pacific/Pago_Pago', // American Samoa
    'Pacific/Guam', // Guam
    'Pacific/Saipan', // Northern Mariana Islands
    'Asia/Manila', // Philippines
    'Asia/Kolkata', // India (mixed, but often 12-hour in some contexts)
  ];
  
  // Check if timezone matches any 12-hour region
  for (const prefix of twelveHourRegionPrefixes) {
    if (timeZone.startsWith(prefix)) {
      return false; // 12-hour region
    }
  }
  
  // Default to 24-hour for rest of world (more common internationally)
  return true;
}

/**
 * Check if a timezone region typically uses DMY (day/month/year) date format
 * MDY (month/day/year) is mainly used in the US and some specific regions
 */
function regionUsesDMYFormat(timeZone: string): boolean {
  // Known MDY format regions (month/day/year)
  const mdyRegionPrefixes = [
    'America/', // US and some others
    'Pacific/Honolulu', // Hawaii
    'Pacific/Pago_Pago', // American Samoa
    'Pacific/Guam', // Guam
    'Pacific/Saipan', // Northern Mariana Islands
    'Asia/Manila', // Philippines
  ];
  
  for (const prefix of mdyRegionPrefixes) {
    if (timeZone.startsWith(prefix)) {
      return false; // MDY format
    }
  }
  
  // Default to DMY format (more common internationally)
  return true;
}

/**
 * Detect the user's timezone
 */
export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback to UTC if detection fails
    return 'UTC';
  }
}

/**
 * Get formatting options based on user's timezone region
 */
export function getDateTimeFormatOptions(): Intl.DateTimeFormatOptions {
  const timeZone = getUserTimeZone();
  const use24Hour = regionUses24HourTime(timeZone);
  const useDMY = regionUsesDMYFormat(timeZone);
  
  return {
    year: 'numeric',
    month: useDMY ? '2-digit' : '2-digit',
    day: useDMY ? '2-digit' : '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: !use24Hour,
  };
}

/**
 * Format a date using timezone-based preferences
 * Uses undefined locale to respect browser's language settings while applying regional time/date formats
 */
export function formatDate(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '-';
  
  try {
    const options = getDateTimeFormatOptions();
    // Use undefined locale to get browser's default text,
    // but override formatting options based on timezone region
    return new Intl.DateTimeFormat(undefined, options).format(d);
  } catch {
    // Fallback formatting if Intl is not available
    return d.toLocaleString();
  }
}

/**
 * Format a number using system defaults
 * Respects browser/OS number formatting preferences
 */
export function formatNumber(num: number): string {
  try {
    return num.toLocaleString(undefined);
  } catch {
    // Fallback to basic string conversion
    return String(num);
  }
}

/**
 * Format a date for display in UI (shorter format)
 */
export function formatDateShort(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '-';
  
  try {
    const timeZone = getUserTimeZone();
    const useDMY = regionUsesDMYFormat(timeZone);
    
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: useDMY ? '2-digit' : '2-digit',
      day: useDMY ? '2-digit' : '2-digit',
    }).format(d);
  } catch {
    // Fallback
    return d.toLocaleDateString();
  }
}

/**
 * Format a time for display in UI
 */
export function formatTime(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '-';
  
  try {
    const timeZone = getUserTimeZone();
    const use24Hour = regionUses24HourTime(timeZone);
    
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: !use24Hour,
    }).format(d);
  } catch {
    // Fallback
    return d.toLocaleTimeString();
  }
}
