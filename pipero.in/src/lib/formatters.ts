export function formatCurrency(value: number | string, currencyCode: string = 'USD') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return `$0`;

    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            maximumFractionDigits: 0
        }).format(num);
    } catch (e) {
        // Fallback for invalid currency codes
        return `$${num.toLocaleString('en-US')}`;
    }
}

/**
 * Format phone with country code separation (e.g. +1 (803) 553-7820, +91 99042 16680).
 * Accepts raw digits with or without leading country code.
 */
export function formatPhone(phone: string | null | undefined): string {
    if (!phone) return '';

    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return phone;

    // US/Canada: 1 + 10 digits
    if (digits.length === 11 && digits.startsWith('1')) {
        const local = digits.slice(1);
        return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
    }
    if (digits.length === 10 && !digits.startsWith('0')) {
        return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    // India: 91 + 10 digits
    if (digits.length === 12 && digits.startsWith('91')) {
        const local = digits.slice(2);
        return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
    }

    // UK: 44 + 10 digits
    if (digits.length === 12 && digits.startsWith('44')) {
        const local = digits.slice(2);
        return `+44 ${local.slice(0, 4)} ${local.slice(4)}`;
    }

    // Generic: show + and space every 3–4 digits after country code (guess 1–3 digit CC)
    const ccLen = digits.length === 11 ? 1 : digits.length === 12 ? 2 : digits.length === 13 ? 3 : 1;
    const cc = digits.slice(0, ccLen);
    const rest = digits.slice(ccLen).replace(/(\d{3,4})(?=\d)/g, '$1 ');
    return `+${cc} ${rest}`.trim();
}

/** @deprecated Use formatPhone. Kept for backward compatibility. */
export function formatPhoneUS(phone: string | null | undefined): string {
    return formatPhone(phone);
}

export function formatDateTime(dateString: string | Date | null, timezone?: string) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        
        // Extract exact IANA string if possible, otherwise rely on browser default
        let timeZoneConfig: string | undefined = undefined;
        if (timezone?.includes('Eastern')) timeZoneConfig = 'America/New_York';
        else if (timezone?.includes('Pacific')) timeZoneConfig = 'America/Los_Angeles';
        else if (timezone?.includes('London')) timeZoneConfig = 'Europe/London';
        else if (timezone?.includes('Mumbai')) timeZoneConfig = 'Asia/Kolkata';

        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: timeZoneConfig
        }).format(date);
    } catch (e) {
        return new Date(dateString).toLocaleDateString();
    }
}
